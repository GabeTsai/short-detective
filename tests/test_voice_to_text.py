from backend import voice_to_text, config
import urllib.request
import json
import time

def test_voice_to_text():
    url = config.get_transcription_url()
    
    print(f"Testing transcription with modal server URL: {url}")
    
    # Check if server is responsive
    print("Checking server health...")
    try:
        urllib.request.urlopen(f"{url}/health", timeout=5)
        print("✓ Server is responding")
    except Exception as e:
        print(f"✗ Server health check failed: {e}")
        print("Server needs cold start (~2-5 min)")
    
    # Check if models are loaded
    print("Checking if model is loaded...")
    max_retries = 0
    for i in range(max_retries):
        try:
            response = urllib.request.urlopen(f"{url}/v1/models", timeout=10)
            data = json.loads(response.read())
            if data.get("data") and len(data["data"]) > 0:
                print(f"✓ Model loaded: {data['data'][0]['id']}")
                break
            else:
                print(f"  Model not ready yet (attempt {i+1}/{max_retries})...")
        except Exception as e:
            print(f"  Model check failed (attempt {i+1}/{max_retries}): {e}")
        
        if i < max_retries - 1:
            time.sleep(10)
    
    # Perform transcription
    print("\nStarting transcription...")
    text = voice_to_text("test_data/test_audio_2.mp3", url)
    print(f"\n--- Transcript ({len(text)} characters) ---")
    print(text)
    print("---\n")
    
    assert text is not None
    assert len(text) > 0
    print("✓ Test passed!")

if __name__ == "__main__":
    test_voice_to_text()