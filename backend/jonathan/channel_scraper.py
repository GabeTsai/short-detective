import sys
import os
import json
import re
import subprocess
import urllib.request
from pathlib import Path
from dotenv import load_dotenv
from openai import OpenAI

# Load .env from root folder
root_dir = Path(__file__).resolve().parent.parent.parent
load_dotenv(root_dir / ".env")


def get_channel_from_short(short_url):
    """Extract channel URL and info from a YouTube Shorts URL using yt-dlp."""
    result = subprocess.run(
        ["yt-dlp", "--dump-json", "--no-download", short_url],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        print(f"Error fetching short info: {result.stderr.strip()}")
        sys.exit(1)

    data = json.loads(result.stdout)
    return {
        "channel_name": data.get("channel"),
        "channel_id": data.get("channel_id"),
        "channel_url": data.get("channel_url"),
        "uploader": data.get("uploader"),
        "uploader_url": data.get("uploader_url"),
    }


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
    """Scrape video titles and URLs from a channel."""
    videos_url = channel_url.rstrip("/") + "/videos"

    result = subprocess.run(
        [
            "yt-dlp", "--dump-json", "--flat-playlist",
            "--playlist-end", str(limit),
            videos_url,
        ],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        print(f"Error scraping channel videos: {result.stderr.strip()}")
        sys.exit(1)

    videos = []
    for line in result.stdout.strip().split("\n"):
        if not line:
            continue
        entry = json.loads(line)
        videos.append({
            "title": entry.get("title"),
            "url": entry.get("url") or f"https://www.youtube.com/watch?v={entry.get('id')}",
        })

    return videos


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
    misinformation, scams, or suspicious activity. Be brief and concise. User input may be truncated. 
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
    print(check_channel_page("https://www.youtube.com/shorts/EaDxKdpvMhc"))
