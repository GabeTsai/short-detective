"""
Tests for web search fact-checking functionality.
"""

import pytest
import os
from backend.web_search import search_web_from_transcript, format_search_results
import time


def test_search_web_sample():
    """Sample test of web search with example oats transcript."""
    # Skip if no API key
    if not os.environ.get("PERPLEXITY_API_KEY"):
        pytest.skip("PERPLEXITY_API_KEY not set - add to .env file")
    
    # Example transcript with misleading health claims
    transcript = """Your breakfast versus my breakfast. Your breakfast starts with oatmeal. 
    Oats are a grain. Grains are seeds. Seeds are highly defended. They are full of plant 
    defense chemicals. In the case of oats, oats are full of phytic acid, a substance 
    that chelates, that bites minerals and prevents their absorption. Oats are also full 
    of digestive enzyme inhibitors. Oats are total bullshit."""
    
    print("\n" + "="*80)
    print("Testing Web Search Fact-Checking")
    print("="*80)
    print(f"\nTranscript: {transcript[:100]}...")
    print("\nSearching for fact-check sources...\n")
    
    # Perform web search
    start = time.time()
    response = search_web_from_transcript(transcript, max_results=5)
    
    # Basic validation
    assert response is not None
    assert len(response.results) > 0
    assert response.summary is not None
    
    # Display results
    print(format_search_results(response))
    print("\n✓ Web search completed successfully")
    end = time.time()
    print(f"Time taken: {end - start} seconds")

if __name__ == "__main__":
    test_search_web_sample()