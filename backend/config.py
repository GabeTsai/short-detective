"""
Backend configuration. Loads .env from project root and defines constants
for voice-to-text (Voxtral/vLLM) and other agent backend services.
"""

import os
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv

# Load .env from project root (parent of backend/)
_PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(_PROJECT_ROOT / ".env")

# -----------------------------------------------------------------------------
# Voice-to-text / Voxtral (self-hosted vLLM on Modal)
# See https://huggingface.co/mistralai/Voxtral-Small-24B-2507
# -----------------------------------------------------------------------------

VOXTRAL_MODEL_ID: str = "mistralai/Voxtral-Small-24B-2507"
"""Hugging Face model id for Voxtral Small 1.0 (24B)."""

VOXTRAL_N_GPU: int = 1
"""Number of GPUs for vLLM (model needs ~55 GB; single H100 is enough)."""

VOXTRAL_GPU_TYPE: str = "H100"
"""GPU type for Modal (e.g. H100, A100)."""

VLLM_PORT: int = 8000
"""Port vLLM server listens on inside the container."""

SECONDS_PER_MINUTE: int = 60
"""Used to express timeouts in minutes."""

VOXTRAL_SERVER_TIMEOUT_MINUTES: int = 15
"""Modal function timeout (max time for a single request)."""

VOXTRAL_SCALEDOWN_WINDOW_MINUTES: int = 10
"""How long to keep the server up with no requests before scaling down."""

VOXTRAL_STARTUP_TIMEOUT_MINUTES: int = 15
"""Max time to wait for vLLM server to become ready."""

VOXTRAL_HEALTH_CHECK_RETRIES: int = 60
"""Number of health-check attempts before giving up."""

VOXTRAL_HEALTH_CHECK_INTERVAL_SECONDS: int = 10
"""Seconds between health-check attempts."""

VOXTRAL_HEALTH_CHECK_TIMEOUT_SECONDS: int = 5
"""Timeout for each health-check request."""

HF_CACHE_VOLUME_NAME: str = "huggingface-cache"
"""Modal Volume name for Hugging Face model cache."""

VLLM_CACHE_VOLUME_NAME: str = "vllm-cache"
"""Modal Volume name for vLLM cache."""

MODAL_APP_NAME_VOXTRAL: str = "voice-to-text-voxtral"
"""Modal App name for the Voxtral serving app."""

VOXTRAL_IMAGE_PYTHON: str = "3.12"
VOXTRAL_IMAGE_CUDA: str = "nvidia/cuda:12.8.0-devel-ubuntu22.04"
"""Container image for vLLM with audio support."""

VOXTRAL_VLLM_INSTALL: str = "vllm[audio]>=0.10.0"
VOXTRAL_HUB_INSTALL: str = "huggingface-hub>=0.36.0"

DEFAULT_TRANSCRIPTION_LANGUAGE: str = "en"
"""Default ISO language code for transcription."""

# -----------------------------------------------------------------------------
# Env-based settings (overridable via .env)
# -----------------------------------------------------------------------------

def get_transcription_url() -> Optional[str]:
    """URL of the deployed vLLM server (TRANSCRIPTION_URL). Empty = start server via modal run."""
    return os.environ.get("TRANSCRIPTION_URL") or None

