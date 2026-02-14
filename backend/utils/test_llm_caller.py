import os
import sys
from pathlib import Path
from dotenv import load_dotenv

# Allow importing utils from backend when run from any folder
_backend_dir = Path(__file__).resolve().parent.parent
if str(_backend_dir) not in sys.path:
    sys.path.insert(0, str(_backend_dir))

from utils import LlmRequest, call_llm

# Load .env from root folder
root_dir = Path(__file__).resolve().parent.parent.parent
load_dotenv(root_dir / ".env")


def test_openai():
    request = LlmRequest(
        organization="openai",
        model="gpt-4o-mini",
        system_prompt="You are a helpful assistant.",
        instructions="Say hello in exactly 3 words.",
        images=[]
    )
    response = call_llm(request)
    print(f"OpenAI response: {response}")
    assert response is not None
    assert len(response) > 0


def test_google():
    request = LlmRequest(
        organization="google",
        model="gemini-2.0-flash",
        system_prompt="You are a helpful assistant.",
        instructions="Say hello in exactly 3 words.",
        images=[]
    )
    response = call_llm(request)
    print(f"Google response: {response}")
    assert response is not None
    assert len(response) > 0


def test_anthropic():
    request = LlmRequest(
        organization="anthropic",
        model="claude-3-5-haiku-latest",
        system_prompt="You are a helpful assistant.",
        instructions="Say hello in exactly 3 words.",
        images=[]
    )
    response = call_llm(request)
    print(f"Anthropic response: {response}")
    assert response is not None
    assert len(response) > 0


if __name__ == "__main__":
    #print("Testing OpenAI...")
   # test_openai()
   # print("OpenAI passed!\n")

    print("Testing Google...")
    test_google()
    print("Google passed!\n")
    '''
    print("Testing Anthropic...")
    test_anthropic()
    print("Anthropic passed!\n")

    print("All tests passed!")
    '''