from backend.semantic_analysis import analyze_video, analyze_video_quick
from dotenv import load_dotenv
import os
import sys

# Load .env from project root
load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

def test_semantic_analysis():
    # Get API key from environment
    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    
    if not api_key:
        print("✗ GEMINI_API_KEY or GOOGLE_API_KEY not found in environment")
        print("Please set one of these environment variables to run the test")
        return
    
    print(f"Testing semantic video analysis with Gemini API...")
    
    # Use a test video - update this path to your test video
    video_path = "test_data/oatsarebadguy.mp4"
    
    if len(sys.argv) > 1:
        video_path = sys.argv[1]
    
    if not os.path.exists(video_path):
        print(f"✗ Test video not found at: {video_path}")
        print("Please provide a valid video path as argument or create test_data/test_video.mp4")
        return
    
    print(f"Using video: {video_path}")
    
    # Perform analysis
    print("\nStarting video analysis...")
    print("(This may take 30-60 seconds depending on video length)")
    analysis = analyze_video(video_path, api_key=api_key)
    
    print("\n" + "="*80)
    print(analysis)
    print("="*80 + "\n")
    
    assert analysis is not None
    assert len(analysis) > 0
    assert "VIDEO CONTENT ANALYSIS REPORT" in analysis
    print("✓ Test passed!")

if __name__ == "__main__":
    from google import genai
    client = genai.Client(api_key=os.environ.get("GEMINI_API_KEY"))
    test_semantic_analysis()
