"""
Web search and fact-checking using Perplexity's Sonar API.
Searches for content related to video transcripts and assesses their legitimacy.
"""

import os
import json
from typing import Optional, List, Dict
from dataclasses import dataclass

from openai import OpenAI

from backend.config import (
    PERPLEXITY_MODEL,
    PERPLEXITY_API_BASE,
    WEB_SEARCH_SYSTEM_PROMPT,
    WEB_SEARCH_MAX_RESULTS,
    get_web_search_user_prompt,
)


@dataclass
class SearchResult:
    """A single web search result with legitimacy assessment."""
    url: str
    assessment: str
    increases_legitimacy: bool
    

@dataclass
class WebSearchResponse:
    """Complete web search response with multiple sources."""
    results: List[SearchResult]
    summary: str
    total_found: int


def search_web_from_transcript(
    transcript: str,
    api_key: Optional[str] = None,
    model: Optional[str] = None,
    max_results: Optional[int] = None,
) -> WebSearchResponse:
    """
    Search the web for information related to a video transcript and assess legitimacy.
    
    Uses Perplexity's Sonar API to find authoritative sources that either support
    or contradict the claims made in the transcript. Useful for detecting
    misinformation in AI-generated or misleading YouTube shorts.
    
    Note: This implementation uses non-streaming mode. For Pro Search features
    (multi-step reasoning, automated tools), enable streaming with stream=True
    and set web_search_options={'search_type': 'pro'} or 'auto'.
    See: https://docs.perplexity.ai/docs/sonar/pro-search/quickstart
    
    Args:
        transcript: The video transcript text to analyze
        api_key: Perplexity API key. If None, reads from PERPLEXITY_API_KEY environment variable
        model: Perplexity model to use. If None, uses PERPLEXITY_MODEL from config
        max_results: Maximum number of results to return. If None, uses WEB_SEARCH_MAX_RESULTS
        
    Returns:
        WebSearchResponse containing:
            - results: List of SearchResult objects with URLs and assessments
            - summary: Overall assessment of transcript legitimacy
            - total_found: Number of relevant sources found
        
    Raises:
        ValueError: If API key is not provided or found in environment
        Exception: For API errors during search
        
    Example:
        >>> transcript = "Your breakfast starts with oatmeal. Oats are a grain..."
        >>> response = search_web(transcript)
        >>> for result in response.results:
        >>>     print(f"{result.url}")
        >>>     print(f"Assessment: {result.assessment}")
    """
    # Get API key
    if api_key is None:
        api_key = os.environ.get("PERPLEXITY_API_KEY")
    if not api_key:
        raise ValueError(
            "PERPLEXITY_API_KEY not found. Please provide api_key parameter or set PERPLEXITY_API_KEY environment variable"
        )
    
    # Use defaults from config if not specified
    if model is None:
        model = PERPLEXITY_MODEL
    if max_results is None:
        max_results = WEB_SEARCH_MAX_RESULTS
    
    # Initialize Perplexity client (uses OpenAI-compatible API)
    client = OpenAI(
        api_key=api_key,
        base_url=PERPLEXITY_API_BASE,
    )
    
    # Construct the search query
    user_prompt = get_web_search_user_prompt(transcript, max_results)
    
    print("Searching web for related content...")
    
    try:
        # Make API request with Sonar Pro search capabilities
        # Using search_type "auto" for intelligent routing between fast/pro search
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": WEB_SEARCH_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            # Enable web search with automatic complexity detection
            # This uses Pro Search for complex queries, Fast Search for simple ones
            stream=False,  # Can enable streaming for real-time responses
        )
        
        # Extract response
        response_text = response.choices[0].message.content
        print("Search completed successfully")
        
        # Parse JSON response
        try:
            # Try to find JSON in the response (in case there's extra text)
            json_start = response_text.find('{')
            json_end = response_text.rfind('}') + 1
            if json_start != -1 and json_end > json_start:
                json_str = response_text[json_start:json_end]
                data = json.loads(json_str)
            else:
                data = json.loads(response_text)
            
            # Parse results
            results = []
            for item in data.get("results", []):
                results.append(SearchResult(
                    url=item["url"],
                    assessment=item["assessment"],
                    increases_legitimacy=item.get("increases_legitimacy", False),
                ))
            
            return WebSearchResponse(
                results=results,
                summary=data.get("summary", "No summary provided"),
                total_found=len(results),
            )
            
        except json.JSONDecodeError as e:
            # Fallback: parse as plain text
            print(f"Warning: Could not parse JSON response, returning raw text")
            print(f"JSON Error: {e}")
            print(f"Response text: {response_text[:500]}...")
            
            # Return a simple response with the raw text
            return WebSearchResponse(
                results=[SearchResult(
                    url="N/A",
                    assessment=response_text,
                    increases_legitimacy=False,
                )],
                summary="Unable to parse structured response",
                total_found=0,
            )
            
    except Exception as e:
        raise Exception(f"Error during web search: {str(e)}")


def format_search_results(response: WebSearchResponse) -> str:
    """
    Format search results as a readable string.
    
    Args:
        response: WebSearchResponse object from search_web()
        
    Returns:
        Formatted string with search results
    """
    output = []
    output.append("=" * 80)
    output.append("WEB SEARCH FACT-CHECK RESULTS")
    output.append("=" * 80)
    output.append(f"Total Sources Found: {response.total_found}")
    output.append("")
    
    for i, result in enumerate(response.results, 1):
        legitimacy_indicator = "✓ SUPPORTS" if result.increases_legitimacy else "✗ CONTRADICTS"
        output.append(f"{i}. {legitimacy_indicator}")
        output.append(f"   URL: {result.url}")
        output.append(f"   Assessment: {result.assessment}")
        output.append("")
    
    output.append("-" * 80)
    output.append("OVERALL ASSESSMENT")
    output.append("-" * 80)
    output.append(response.summary)
    output.append("=" * 80)
    
    return "\n".join(output)

def search_web_from_transcript_str(
    transcript_str: str,
    api_key: Optional[str] = None,
    model: Optional[str] = None,
    max_results: Optional[int] = None,
) -> WebSearchResponse:
    """
    Search the web for information related to a video transcript and assess legitimacy.
    
    Args:
        transcript_str: The video transcript text to analyze
        api_key: Perplexity API key. If None, reads from PERPLEXITY_API_KEY environment variable
        model: Perplexity model to use. If None, uses PERPLEXITY_MODEL from config
        max_results: Maximum number of results to return. If None, uses WEB_SEARCH_MAX_RESULTS
        
    Returns:
        WebSearchResponse containing:
        results: List of SearchResult objects with URLs and assessments
        summary: Overall assessment of transcript legitimacy
        total_found: Number of relevant sources found
        
    Raises:
        ValueError: If API key is not provided or found in environment
        Exception: For API errors during search
    """
    response = search_web_from_transcript(transcript=transcript_str, api_key=api_key, model=model, max_results=max_results)
    return format_search_results(response)
