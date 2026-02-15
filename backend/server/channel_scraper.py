import sys
import os
import json
import re
import subprocess
import urllib.request
from pathlib import Path
from dotenv import load_dotenv
from openai import OpenAI
from config import CHANNEL_CONTEXT_MAX_VIDEOS

# Load .env from root folder
root_dir = Path(__file__).resolve().parent.parent.parent
load_dotenv(root_dir / ".env")


def get_channel_from_short(short_url):
    """Extract channel URL and info from a YouTube Shorts URL using yt-dlp."""
    result = subprocess.run(
        ["yt-dlp", "--dump-json", "--no-download", "--no-cache-dir", short_url],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        print(f"Error fetching short info: {result.stderr.strip()}")
        sys.exit(1)

    data = json.loads(result.stdout)
    channel_info = {
        "channel_name": data.get("channel"),
        "channel_id": data.get("channel_id"),
        "channel_url": data.get("channel_url"),
        "uploader": data.get("uploader"),
        "uploader_url": data.get("uploader_url"),
    }
    print(f"[Channel Scraper] Short: {short_url} -> Channel: {channel_info.get('channel_name')} ({channel_info.get('channel_url')})")
    return channel_info


def get_lightweight_channel_context(short_url, max_recent_videos=CHANNEL_CONTEXT_MAX_VIDEOS):
    """
    Get minimal channel context for semantic analysis (fast, ~2-3 seconds).
    Returns just the description and a few recent video titles.
    """
    try:
        # Get channel URL from the short
        channel_info = get_channel_from_short(short_url)
        channel_url = channel_info["channel_url"]
        
        # Get channel description (fast - just metadata)
        about_url = channel_url.rstrip("/") + "/about"
        req = urllib.request.Request(about_url, headers={
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
            "Accept-Language": "en-US,en;q=0.9",
        })
        with urllib.request.urlopen(req, timeout=5) as resp:
            html = resp.read().decode("utf-8")
        
        # Extract description
        match = re.search(r"var ytInitialData\s*=\s*({.*?});\s*</script>", html)
        description = ""
        keywords = ""
        if match:
            yt_data = json.loads(match.group(1))
            md = yt_data.get("metadata", {}).get("channelMetadataRenderer", {})
            description = md.get("description", "")
            keywords = md.get("keywords", "")
        
        # Get a few recent video/shorts titles (fast - flat playlist)
        recent_titles = []
        for tab in ["shorts", "videos"]:
            try:
                tab_url = channel_url.rstrip("/") + "/" + tab
                result = subprocess.run(
                    ["yt-dlp", "--dump-json", "--flat-playlist", "--no-cache-dir", "--playlist-end", str(max_recent_videos), tab_url],
                    capture_output=True, text=True, timeout=5
                )
                if result.returncode == 0:
                    for line in result.stdout.strip().split("\n")[:max_recent_videos]:
                        if line:
                            entry = json.loads(line)
                            recent_titles.append(entry.get("title", ""))
                    break  # Just get from first available tab
            except:
                continue
        
        context = {
            "channel_name": channel_info.get("channel_name", ""),
            "channel_url": channel_url,  # Include URL for verification
            "channel_id": channel_info.get("channel_id", ""),
            "description": description,
            "keywords": keywords,
            "recent_titles": recent_titles[:max_recent_videos],
            "short_url": short_url  # Add short_url for debugging
        }
        print(f"[Lightweight Context] Fetched for {channel_info.get('channel_name')}: {len(description)} char description, {len(recent_titles)} titles")
        return context
    except Exception as e:
        print(f"Warning: Could not fetch lightweight channel context for {short_url}: {e}")
        import traceback
        traceback.print_exc()
        return None


def scrape_channel_about(channel_url):
    """Scrape channel about page by parsing YouTube's embedded JSON data."""
    about_url = channel_url.rstrip("/") + "/about"
    req = urllib.request.Request(about_url, headers={
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
    })
    with urllib.request.urlopen(req) as resp:
        html = resp.read().decode("utf-8")

    # Extract the ytInitialData JSON blob embedded in the page
    match = re.search(r"var ytInitialData\s*=\s*({.*?});\s*</script>", html)
    if not match:
        print("Warning: Could not find ytInitialData in channel page")
        return {}

    yt_data = json.loads(match.group(1))

    meta = {}

    # Get channel name/description from top-level metadata
    md = yt_data.get("metadata", {}).get("channelMetadataRenderer", {})
    meta["channel"] = md.get("title", "")
    meta["channel_url"] = md.get("channelUrl", channel_url)
    meta["channel_id"] = md.get("externalId", "")
    meta["description"] = md.get("description", "")
    meta["keywords"] = md.get("keywords", "")

    # The about data lives in onResponseReceivedEndpoints (engagement panel)
    for endpoint in yt_data.get("onResponseReceivedEndpoints", []):
        panel = (
            endpoint.get("showEngagementPanelEndpoint", {})
            .get("engagementPanel", {})
            .get("engagementPanelSectionListRenderer", {})
            .get("content", {})
            .get("sectionListRenderer", {})
            .get("contents", [{}])[0]
            .get("itemSectionRenderer", {})
            .get("contents", [{}])[0]
            .get("aboutChannelRenderer", {})
            .get("metadata", {})
            .get("aboutChannelViewModel", {})
        )
        if not panel:
            continue

        meta["description"] = panel.get("description", meta.get("description", ""))
        meta["country"] = panel.get("country", "")
        meta["joined"] = panel.get("joinedDateText", {}).get("content", "")
        meta["view_count"] = panel.get("viewCountText", "")
        meta["subscriber_count"] = panel.get("subscriberCountText", "")
        meta["video_count"] = panel.get("videoCountText", "")
        meta["canonical_url"] = panel.get("canonicalChannelUrl", "")

        # Extract external links (website, social media, etc.)
        links = []
        for link in panel.get("links", []):
            lvm = link.get("channelExternalLinkViewModel", {})
            title = lvm.get("title", {}).get("content", "")
            # The display URL is directly in link.content
            url = lvm.get("link", {}).get("content", "")
            if title or url:
                links.append({"title": title, "url": url})
        if links:
            meta["links"] = links
        break

    return meta


def scrape_channel_videos(channel_url, limit=10):
    """Scrape video and shorts titles and URLs from a channel."""
    all_content = []

    # Try both /videos and /shorts tabs
    for tab in ["videos", "shorts"]:
        tab_url = channel_url.rstrip("/") + "/" + tab

        result = subprocess.run(
            [
                "yt-dlp", "--dump-json", "--flat-playlist", "--no-cache-dir",
                "--playlist-end", str(limit),
                tab_url,
            ],
            capture_output=True, text=True
        )
        if result.returncode != 0:
            print(f"Warning: Could not scrape {tab} tab: {result.stderr.strip()}")
            continue

        for line in result.stdout.strip().split("\n"):
            if not line:
                continue
            entry = json.loads(line)
            all_content.append({
                "title": entry.get("title"),
                "url": entry.get("url") or f"https://www.youtube.com/watch?v={entry.get('id')}",
                "type": tab,
            })

    return all_content


def scrape_channel(short_url, video_limit=10):
    """Scrape all channel info from a YouTube Shorts URL. Returns a dict."""
    channel_info = get_channel_from_short(short_url)
    channel_url = channel_info["channel_url"]
    about = scrape_channel_about(channel_url)
    videos = scrape_channel_videos(channel_url, limit=video_limit)
    return {**about, "videos": videos}


### Takes around 20s ish for 3k character dictionary
def check_channel_page(short_url: str) -> str:
    channel_info = scrape_channel(short_url)

    client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    system_prompt = """
    You are a helpful assistant that analyzes YouTube channel information for signs of 
    misinformation, scams, or suspicious activity. Be BRIEF and CONCISE. User input may be truncated. 
    Try to be barebones and only give the most important information. 
    """
    response = client.chat.completions.create(
        model="gpt-5-mini-2025-08-07",
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"Analyze this YouTube channel and give a short summary of its trustworthiness:\n\n{json.dumps(channel_info, indent=2)[:5000]}"}
        ]
    )
    
    return response.choices[0].message.content


if __name__ == "__main__":
    import time
    start_time = time.perf_counter()
    x = check_channel_page("https://www.youtube.com/shorts/EaDxKdpvMhc")
    print(x)
    print(len(x))
    end_time = time.perf_counter()
    print(f"Time taken: {end_time - start_time} seconds")
