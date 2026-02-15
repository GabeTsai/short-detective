"""
Semantic video analysis using Google Gemini API.
Provides detailed analysis of video content with focus on detecting misinformation,
propaganda, and agenda-pushing content.
"""

import os
import time
from pathlib import Path
from typing import Optional
import time

import google.generativeai as genai

from config import (
    GEMINI_MODEL_VIDEO,
    SEMANTIC_ANALYSIS_PROMPT,
    SEMANTIC_ANALYSIS_QUICK_PROMPT,
)

def get_formatted_result(analysis: str, video_file: Path, video_path: str, model_name: str) -> str:
    return f"""
{'='*80}
VIDEO CONTENT ANALYSIS REPORT
{'='*80}
File: {video_file.name}
Path: {video_path}
Model: {model_name}
{'='*80}

{analysis}

{'='*80}
End of Analysis
"""

def analyze_video(
    video_path: str,
    api_key: Optional[str] = None,
    model_name: Optional[str] = None,
    custom_prompt: Optional[str] = None,
) -> str:
    """
    Analyze a video file using Google Gemini API with focus on detecting concerning content.
    
    Performs comprehensive analysis to identify:
    - Misinformation and factual inaccuracies
    - Propaganda and manipulation techniques
    - Agenda-pushing and bias
    - Conspiracy theories and extremism
    
    Args:
        video_path: Path to the MP4 video file to analyze
        api_key: Google AI API key. If None, reads from GEMINI_API_KEY environment variable
        model_name: Gemini model to use. If None, uses GEMINI_MODEL_VIDEO from config
        custom_prompt: Optional custom prompt for analysis. If None, uses SEMANTIC_ANALYSIS_PROMPT
        
    Returns:
        Formatted string containing detailed video analysis with risk assessment
        
    Raises:
        FileNotFoundError: If video file doesn't exist
        ValueError: If API key is not provided or found in environment
        Exception: For API errors during upload or generation
    """
    # Use default model from config if not specified
    if model_name is None:
        model_name = GEMINI_MODEL_VIDEO
    # Validate video file exists
    video_file = Path(video_path)
    if not video_file.exists():
        raise FileNotFoundError(f"Video file not found: {video_path}")
    
    # Get API key
    if api_key is None:
        api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise ValueError(
            "GEMINI_API_KEY not found. Please provide api_key parameter or set GEMINI_API_KEY environment variable"
        )
    
    # Configure Gemini API
    genai.configure(api_key=api_key)
    
    # Upload video file
    start = time.time()
    print(f"Uploading video: {video_file.name}...")
    video_file_obj = genai.upload_file(path=str(video_file))
    end = time.time()
    print(f"Video uploaded in {end - start} seconds")

    print("Processing video...")
    while video_file_obj.state.name == "PROCESSING":
        time.sleep(2)
        video_file_obj = genai.get_file(video_file_obj.name)
    
    if video_file_obj.state.name == "FAILED":
        raise Exception(f"Video processing failed: {video_file_obj.state}")
    
    print("Video ready for analysis...")
    
    # Use default prompt from config if not specified
    prompt = custom_prompt if custom_prompt is not None else SEMANTIC_ANALYSIS_PROMPT
    
    # Create model and generate analysis
    model = genai.GenerativeModel(model_name=model_name)
    
    print("Generating analysis...")
    start = time.time()
    response = model.generate_content([video_file_obj, prompt])
    end = time.time()
    print(f"Analysis generated in {end - start} seconds")
    # Format the result
    analysis = response.text
    
    # Add metadata header
    formatted_result = get_formatted_result(analysis, video_file, video_path, model_name)
    
    # Clean up uploaded file
    try:
        genai.delete_file(video_file_obj.name)
        print("Cleaned up uploaded file from Gemini servers")
    except Exception as e:
        print(f"Warning: Could not delete uploaded file: {e}")
    
    return formatted_result.strip()


def analyze_video_quick(video_path: str, api_key: Optional[str] = None) -> str:
    """
    Quick video analysis focused on identifying red flags and risk level.
    
    Args:
        video_path: Path to the MP4 video file
        api_key: Google AI API key (optional, reads from env)
        
    Returns:
        Concise video analysis string with risk assessment
    """
    return analyze_video(
        video_path=video_path,
        api_key=api_key,
        custom_prompt=SEMANTIC_ANALYSIS_QUICK_PROMPT,
    )


if __name__ == "__main__":
    # Example usage
    import sys
    
    if len(sys.argv) < 2:
        print("Usage: python semantic_analysis.py <path_to_video.mp4>")
        sys.exit(1)
    
    video_path = sys.argv[1]
    
    try:
        analysis = analyze_video(video_path)
        print(analysis)
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)
