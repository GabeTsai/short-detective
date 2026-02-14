"""Backend package for short-detective.

Example usage:
    from backend import voice_to_text, config
    
    # Get the transcription URL from config
    url = config.get_transcription_url()
    
    # Transcribe an audio file
    text = voice_to_text("/path/to/audio.mp3", url, language="en")
"""

# Import config module for easy access
from backend import config

# Import voice-to-text functionality
from backend.voice_to_text import voice_to_text, app, serve

# Define public API
__all__ = [
    "config",
    "voice_to_text",
    "app",
    "serve",
]
