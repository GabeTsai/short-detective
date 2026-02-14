from pytubefix import YouTube
import subprocess
import os
import re
from concurrent.futures import ThreadPoolExecutor, as_completed


def video_id_from_url(url: str) -> str:
    """Extract YouTube video ID from URL (watch or shorts)."""
    # watch: ?v=VIDEO_ID
    m = re.search(r"[?&]v=([^&]+)", url)
    if m:
        return m.group(1)
    # shorts: /shorts/VIDEO_ID
    m = re.search(r"/shorts/([^/?]+)", url)
    if m:
        return m.group(1)
    # fallback: use a safe slug from the last path segment
    return re.sub(r"[^a-zA-Z0-9_-]", "_", url.split("/")[-1].split("?")[0]) or "video"


def download_video_max_720p(url, download_path="videos", duration=30):
    """
    Downloads the first `duration` seconds of a video using pytubefix + ffmpeg.
    Skips if already downloaded. Uses lowest progressive stream for speed.
    Returns filename (e.g., "VIDEO_ID.mp4") or None on failure.
    """
    try:
        os.makedirs(download_path, exist_ok=True)

        video_id = video_id_from_url(url)
        filename = f"{video_id}.mp4"
        output_path = os.path.join(download_path, filename)

        if os.path.exists(output_path):
            print(f"Already exists: {output_path}")
            return filename

        yt = YouTube(url)
        stream = (
            yt.streams
              .filter(progressive=True, file_extension="mp4")
              .order_by("resolution")
              .first()
        )

        if stream is None:
            print(f"Error downloading {url}: No progressive MP4 stream found.")
            return None

        result = subprocess.run(
            [
                "ffmpeg", "-y",
                "-ss", "0",
                "-t", str(duration),
                "-i", stream.url,
                "-c", "copy",
                output_path,
            ],
            capture_output=True, text=True,
        )

        if result.returncode != 0:
            print(f"Error downloading {url}: {result.stderr.strip()}")
            return None

        print(f"Downloaded (first {duration}s): {output_path}")
        return filename

    except Exception as e:
        print(f"An unexpected error occurred: {type(e).__name__} - {e}")
        return None


def download_videos_batch(urls, download_path="videos", n=10, duration=30):
    """
    Downloads the first `duration` seconds of multiple videos in parallel using n threads.
    Returns a list of downloaded filenames (None for failures).
    """
    filenames = []
    with ThreadPoolExecutor(max_workers=n) as executor:
        futures = {
            executor.submit(download_video_max_720p, url, download_path, duration): url
            for url in urls
        }
        for future in as_completed(futures):
            url = futures[future]
            try:
                name = future.result()
                if name is not None:
                    filenames.append(name)
            except Exception as e:
                print(f"Failed for {url}: {e}")
    return filenames


if __name__ == "__main__":
    # RFK fat gay kids
    import time

    video_urls = [
        "https://www.youtube.com/shorts/jEDcdCP-Psc",
        "https://www.youtube.com/shorts/52J14uYn2sk",
        "https://www.youtube.com/shorts/EaDxKdpvMhc", 
        "https://www.youtube.com/shorts/7cXrS2KqKMY",
        "https://www.youtube.com/shorts/l2UjV7QbUq0", 
        "https://www.youtube.com/shorts/HZ5V1oKRONQ", 
        "https://www.youtube.com/shorts/t4Sx9bxq9AU", 
        "https://www.youtube.com/shorts/4Q2ErSJjSIo"
    ]
    start = time.perf_counter()
    download_videos_batch(video_urls)
    end = time.perf_counter()
    print(f"Time taken: {end - start} seconds")