"""Backend package for short-detective.

Example usage:
    from backend import transcribe
    
    # Easy way: automatically uses TRANSCRIPTION_URL from .env
    text = transcribe("audio.mp3")
    
    # With specific language
    text = transcribe("audio.mp3", language="es")
    
    # Advanced usage with explicit URL
    from backend import voice_to_text, config
    url = config.get_transcription_url()
    text = voice_to_text("audio.mp3", url, language="en")
"""

# Import config module for easy access
from backend import config

# Import voice-to-text functionality
from backend.voice_to_text import (
    voice_to_text,
    transcribe,
    clear_client_cache,
    app,
    serve,
)

# Define public API
__all__ = [
    "config",
    "transcribe",           # Convenience function (recommended)
    "transcribe_batch",     # Batch processing with concurrent requests
    "voice_to_text",        # Advanced usage
    "clear_client_cache",   # Clear cached clients (for debugging)
    "app",
    "serve",
]
