"""
Toy audio transcription using Mistral Voxtral Small 1.0 (24B) — self-hosted on Modal H100 with vLLM.

The model weights are loaded and run on GPU in serve(). vLLM exposes an OpenAI-compatible HTTP API;
we use the openai library as a plain HTTP client pointed at your own server URL.

--- Deploy the server (once) ---
  From repo root:
    modal deploy backend/voice_to_text.py
  Modal prints the server URL, e.g. https://your-workspace--voice-to-text-voxtral-serve.modal.run

--- Use the deployed server to transcribe ---

  1) Set the URL in .env (project root):
     TRANSCRIPTION_URL=https://your-workspace--voice-to-text-voxtral-serve.modal.run

  2) From the CLI (starts nothing; uses the deployed URL from .env):
     modal run backend/voice_to_text.py --audio-path /path/to/audio.mp3
     # optional: --language es  --url https://...  (--url overrides .env)

  3) From your backend code:
     from backend import config, voice_to_text

     url = config.get_transcription_url()  # from TRANSCRIPTION_URL
     text = voice_to_text("/path/to/audio.mp3", url, language="en")

--- Run server on-demand (no deploy) ---
  modal run backend/voice_to_text.py --audio-path /path/to/audio.mp3
  (No TRANSCRIPTION_URL: Modal starts the server, waits for it, then transcribes.)
"""

import os
import subprocess
import time
from typing import Optional

import modal

# Re-export for callers that import from this module
__all__ = ["app", "voice_to_text", "serve"]

# Import config - will work locally and in Modal after we add it to the image
from backend import config

# Container: vLLM with audio support for Voxtral (installs mistral_common automatically)
# IMPORTANT: .add_local_python_source() must come LAST to avoid rebuilds on every code change
vllm_image = (
    modal.Image.from_registry(
        config.VOXTRAL_IMAGE_CUDA,
        add_python=config.VOXTRAL_IMAGE_PYTHON,
    )
    .env({"HF_XET_HIGH_PERFORMANCE": "1"})
    .uv_pip_install(
        config.VOXTRAL_VLLM_INSTALL,
        config.VOXTRAL_HUB_INSTALL,
        "python-dotenv",  # For config.py to load .env
    )
    .add_local_python_source("backend")  # Include the backend package (must be LAST!)
)

# create volumes to cache model weights
hf_cache_vol = modal.Volume.from_name(
    config.HF_CACHE_VOLUME_NAME, create_if_missing=True
)
vllm_cache_vol = modal.Volume.from_name(
    config.VLLM_CACHE_VOLUME_NAME, create_if_missing=True
)

app = modal.App(config.MODAL_APP_NAME_VOXTRAL)


@app.function(
    image=vllm_image,
    gpu=f"{config.VOXTRAL_GPU_TYPE}:{config.VOXTRAL_N_GPU}",
    timeout=config.VOXTRAL_SERVER_TIMEOUT_MINUTES * config.SECONDS_PER_MINUTE,
    scaledown_window=config.VOXTRAL_SCALEDOWN_WINDOW_MINUTES * config.SECONDS_PER_MINUTE,
    volumes={
        "/root/.cache/huggingface": hf_cache_vol,
        "/root/.cache/vllm": vllm_cache_vol,
    },
)
@modal.web_server(
    port=config.VLLM_PORT,
    startup_timeout=config.VOXTRAL_STARTUP_TIMEOUT_MINUTES * config.SECONDS_PER_MINUTE,
)
def serve():
    """Run vLLM serving Voxtral in OpenAI-compatible mode (includes /v1/audio/transcriptions)."""
    cmd = [
        "vllm",
        "serve",
        config.VOXTRAL_MODEL_ID,
        "--tokenizer_mode", "mistral",
        "--config_format", "mistral",
        "--load_format", "mistral",
        "--tensor-parallel-size", str(config.VOXTRAL_N_GPU),
        "--tool-call-parser", "mistral",
        "--enable-auto-tool-choice",
        "--host", "0.0.0.0",
        "--port", str(config.VLLM_PORT),
    ]
    print("Starting vLLM:", " ".join(cmd))
    # Use subprocess.run() to block until vLLM exits (keeps the web server alive)
    subprocess.run(" ".join(cmd), shell=True)


def voice_to_text(
    audio_path: str,
    self_hosted_vllm_url: str,
    language: Optional[str] = None,
    timeout: int = 300,
) -> str:
    """Call our self-hosted vLLM server (Voxtral on H100). Uses openai lib only as HTTP client.
    
    Args:
        audio_path: Path to the audio file to transcribe.
        self_hosted_vllm_url: URL of the self-hosted vLLM server.
        language: ISO language code for transcription (e.g. en, es, fr). Default from config.
        timeout: Timeout in seconds for API calls (default 300s = 5 minutes).
    
    Returns:
        The transcription text.
    """
    from openai import OpenAI
    from mistral_common.audio import Audio
    from mistral_common.protocol.instruct.messages import RawAudio
    from mistral_common.protocol.transcription.request import TranscriptionRequest
    import httpx

    lang = language if language is not None else config.DEFAULT_TRANSCRIPTION_LANGUAGE
    # OpenAI lib is just an HTTP client here; no OpenAI API key needed for self-hosted vLLM
    client = OpenAI(
        api_key="EMPTY",
        base_url=self_hosted_vllm_url.rstrip("/") + "/v1",
        timeout=httpx.Timeout(timeout, read=timeout, write=timeout, connect=10.0),
        max_retries=0,
    )
    
    # Get model ID (with timeout protection)
    print("Fetching model list from server...")
    try:
        models = client.models.list()
        model_id = models.data[0].id
        print(f"Using model: {model_id}")
    except Exception as e:
        print(f"Error listing models: {e}")
        print("Attempting to use default model ID...")
        model_id = config.VOXTRAL_MODEL_ID

    print(f"Transcribing audio file: {audio_path}")
    audio = Audio.from_file(audio_path, strict=False)
    raw = RawAudio.from_audio(audio)
    
    # Convert to OpenAI format, excluding Mistral-specific parameters
    req = TranscriptionRequest(
        model=model_id,
        audio=raw,
        language=lang,
        temperature=0.0,
    ).to_openai(exclude=("top_p", "seed", "target_streaming_delay_ms"))
    
    # Debug: print the request parameters (excluding large audio data)
    debug_req = {k: v for k, v in req.items() if k != "file"}
    print(f"Request parameters: {debug_req}")

    try:
        response = client.audio.transcriptions.create(**req)
        return response.text if hasattr(response, "text") else str(response)
    except TypeError as e:
        # If we get parameter errors, try to identify which parameter is the problem
        print(f"Error: {e}")
        print(f"Full request keys: {list(req.keys())}")
        raise


@app.local_entrypoint()
def main(
    audio_path: str = "",
    language: Optional[str] = None,
    url: Optional[str] = None,
):
    """
    Transcribe a local audio file using the Modal Voxtral server.

    Args:
        audio_path: Path to a local audio file (e.g. .mp3, .wav).
        language: ISO language code for transcription (e.g. en, es, fr). Default from config.
        url: Override server URL (e.g. from TRANSCRIPTION_URL or after deploy).
    """
    # URL of our self-hosted vLLM server (your Modal app; model runs on your H100)
    # Loaded from .env (TRANSCRIPTION_URL) when not passed as --url
    self_hosted_url = url or config.get_transcription_url()
    if not self_hosted_url:
        print("No URL provided; starting Modal server (this may take several minutes)...")
        self_hosted_url = serve.get_web_url()
        # Wait for vLLM to be ready (model load can take 2–5+ min)
        import urllib.request
        import json
        
        print("Waiting for server to be ready...")
        health_ready = False
        models_ready = False
        
        for i in range(config.VOXTRAL_HEALTH_CHECK_RETRIES):
            # Check health endpoint
            if not health_ready:
                try:
                    urllib.request.urlopen(
                        f"{self_hosted_url}/health",
                        timeout=config.VOXTRAL_HEALTH_CHECK_TIMEOUT_SECONDS,
                    )
                    health_ready = True
                    print("✓ Health endpoint responding")
                except Exception:
                    if i == 0:
                        print("  Waiting for health endpoint...")
                    time.sleep(config.VOXTRAL_HEALTH_CHECK_INTERVAL_SECONDS)
                    continue
            
            # Check if models are loaded
            if health_ready and not models_ready:
                try:
                    response = urllib.request.urlopen(
                        f"{self_hosted_url}/v1/models",
                        timeout=config.VOXTRAL_HEALTH_CHECK_TIMEOUT_SECONDS,
                    )
                    data = json.loads(response.read())
                    if data.get("data") and len(data["data"]) > 0:
                        models_ready = True
                        print(f"✓ Model loaded: {data['data'][0]['id']}")
                        print(f"Server ready at {self_hosted_url}")
                        break
                    else:
                        print("  Model still loading...")
                except Exception as e:
                    print(f"  Model not ready yet... ({e})")
                
                time.sleep(config.VOXTRAL_HEALTH_CHECK_INTERVAL_SECONDS)
        
        if not models_ready:
            print("⚠ Server did not fully load model in time.")
            print("You can still try transcription, but it may take longer or timeout.")

    if not audio_path:
        print("Usage: modal run voice_to_text.py --audio-path /path/to/audio.mp3")
        print("Optional: --language en --url https://your-app--serve.modal.run")
        return

    if not os.path.isfile(audio_path):
        print(f"Error: file not found: {audio_path}")
        return

    lang = language if language is not None else config.DEFAULT_TRANSCRIPTION_LANGUAGE
    print(f"Transcribing: {audio_path} (language={lang})")
    text = voice_to_text(audio_path, self_hosted_url, language=lang)
    print("--- Transcript ---")
    print(text)
    print("---")
    return text
