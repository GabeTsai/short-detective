from pytubefix import YouTube
from pytubefix.exceptions import VideoUnavailable, AgeRestrictedError
import os
from concurrent.futures import ThreadPoolExecutor, as_completed

def download_video_max_720p(url, download_path="videos"):
    """
    Downloads a video, searching only for progressive streams
    (audio+video together), at 180p / lowest resolution for fastest download.
    """
    try:
        # 1. Ensure the download directory exists
        if not os.path.exists(download_path):
            os.makedirs(download_path)
            print(f"Directory created: {download_path}")

        # 2. Get the YouTube object
        video = YouTube(url)
        print(f"\nSearching (180p / lowest): {video.title}")

        # 3. Select lowest resolution progressive stream (180p, 144p, or 240p typically)
        stream = video.streams.filter(
            progressive=True,
            file_extension='mp4'
        ).order_by('resolution').asc().first()

        if stream:
            print(f"Stream found: {stream.resolution} (Progressive, with audio)")
            print("Starting download...")
            stream.download(output_path=download_path)
            print(f"Download complete! Saved in '{download_path}'")
            return stream.default_filename
        else:
            print("Error: No progressive stream found (mp4 with audio and video).")
            return None

    except AgeRestrictedError:
        print(f"Error: The video is age-restricted and cannot be downloaded.")
        return None
    except VideoUnavailable:
        print(f"Error: The video is unavailable, private, or has been deleted.")
        return None
    except Exception as e:
        print(f"An unexpected error occurred: {type(e).__name__} - {e}")
        return None


def download_videos_batch(urls, download_path="videos", n=10):
    """
    Downloads multiple videos in parallel (180p / lowest resolution) using n threads.
    Returns a list of downloaded filenames (None for failures).
    """
    filenames = []
    with ThreadPoolExecutor(max_workers=n) as executor:
        futures = {
            executor.submit(download_video_max_720p, url, download_path): url
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