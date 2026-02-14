"""
Batch audio transcription using Mistral Voxtral Mini 3B — self-hosted on Modal with vLLM.

Uses Voxtral-Mini-3B-2507 for batch transcription of pre-recorded audio files.
Supports 8 languages, up to 30 minutes of audio per file.

Note: For streaming/real-time transcription, use Voxtral-Mini-4B-Realtime instead.

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
__all__ = ["app", "voice_to_text", "transcribe", "serve"]

# Import config - will work locally and in Modal after we add it to the image
from backend import config

# Container: Build from CUDA base following the exact working pattern from HuggingFace
# See: https://huggingface.co/mistralai/Voxtral-Mini-4B-Realtime-2602/discussions/15
vllm_image = (
    modal.Image.from_registry(
        "nvidia/cuda:12.9.0-devel-ubuntu22.04",
        add_python="3.12",
    )
    .entrypoint([])
    .env({
        "HF_XET_HIGH_PERFORMANCE": "1",
        "VLLM_DISABLE_COMPILE_CACHE": "1",  # Required for Voxtral Realtime
    })
    # Use Modal's native uv_pip_install for nightly vLLM with audio support
    .uv_pip_install(
        "vllm[audio]",
        extra_index_url=config.VOXTRAL_VLLM_NIGHTLY_INDEX,
        extra_options="--torch-backend=cu129",
    )
    # Install mistral-common with audio extras and other dependencies
    .uv_pip_install(
        "mistral-common[audio]",
        "soxr",
        "librosa",
        "soundfile",
        "huggingface-hub>=0.36.0",
        "python-dotenv",
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
    port=8000,  # Hardcoded to ensure it's available at decorator evaluation time
    startup_timeout=15 * 60, 
)
def serve():
    """Run vLLM serving Voxtral Mini 3B for batch audio transcription.
    
    This model is optimized for batch transcription of pre-recorded audio files.
    Supports 8 languages, up to 30 minutes of audio, with transcription and translation.
    """
    # Voxtral Mini 3B (batch transcription) configuration
    # See: https://huggingface.co/mistralai/Voxtral-Mini-3B-2507
    cmd = [
        "vllm",
        "serve",
        config.VOXTRAL_MODEL_ID,
        "--host", "0.0.0.0",
        "--port", "8000",
        "--uvicorn-log-level", "debug"
    ]
    
    print("Starting vLLM with Voxtral Mini 3B (batch):", " ".join(cmd))
    
    # Start vLLM - Modal's @web_server decorator handles waiting for readiness
    # Don't use shell=True to avoid quote escaping issues with JSON
    subprocess.Popen(cmd)


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
    
    Note:
        This uses batch transcription mode for pre-recorded audio files.
        The target_streaming_delay_ms parameter only applies to streaming mode.
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
    # Note: target_streaming_delay_ms only applies to streaming mode, not batch transcription
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
        
        # Check if the response contains an error
        if hasattr(response, "error") and response.error:
            error_msg = response.error.get("message", "Unknown error")
            error_type = response.error.get("type", "Unknown")
            print(f"Server returned error: {error_type} - {error_msg}")
            print(f"Full error details: {response.error}")
            raise RuntimeError(f"Transcription failed: {error_msg}. Check Modal logs for details.")
        
        # Extract transcription text
        if hasattr(response, "text") and response.text:
            return response.text
        elif isinstance(response, str):
            return response
        elif isinstance(response, dict):
            return response.get("text", "")
        else:
            print(f"Warning: Unexpected response format: {type(response)}")
            print(f"Response: {response}")
            return str(response) if response else ""
            
    except TypeError as e:
        print(f"TypeError: {e}")
        print(f"Request keys: {list(req.keys())}")
        raise
    except Exception as e:
        print(f"Transcription error: {e}")
        raise


def transcribe(
    audio_path: str,
    language: Optional[str] = None,
    url: Optional[str] = None,
    timeout: int = 300,
) -> str:
    """
    Convenience function for transcribing audio that automatically handles the modal URL
    
    Args:
        audio_path: Path to the audio file to transcribe (e.g., "test_data/test_audio_2.mp3")
        language: Optional ISO language code (e.g., "en", "es", "fr"). Auto-detects if None.
        url: Optional modal server URL. If None, uses TRANSCRIPTION_URL from .env.
        timeout: Timeout in seconds for API calls (default 300s = 5 minutes).
    
    Returns:
        The transcription text.
    
    Raises:
        RuntimeError: If no server URL is configured and none provided.
        Exception: If transcription fails (network, audio format, etc.)
    
    Examples:
        >>> # Using env var TRANSCRIPTION_URL
        >>> text = transcribe("audio.mp3")
        
        >>> # With specific language
        >>> text = transcribe("audio.mp3", language="es")
        
        >>> # With custom URL
        >>> text = transcribe("audio.mp3", url="https://my-server.modal.run")
    """
    # Get URL from config if not provided
    server_url = url or config.get_transcription_url()
    
    if not server_url:
        raise RuntimeError(
            "No transcription server URL configured. Either:\n"
            "1. Set TRANSCRIPTION_URL in your .env file, or\n"
            "2. Pass url parameter explicitly, or\n"
            "3. Deploy the server: modal deploy backend/voice_to_text.py"
        )
    
    return voice_to_text(audio_path, server_url, language=language, timeout=timeout)


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
