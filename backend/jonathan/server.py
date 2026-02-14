from fastapi import FastAPI
from download_video import download_videos_batch, video_id_from_url
from summarize_videos import summarize_videos
import argparse
import json

app = FastAPI()
global USE_CACHE
USE_CACHE = False


@app.post("/send_urls", status_code=204)
def send_urls(raw_urls: list[str]):
    print(raw_urls)
    uncached_urls = []
    if USE_CACHE:
        try:
            with open("cache.json", "r") as f:
                cache = json.load(f)
        except exception as e:
            print(f"Error loading cache: {e}")
            cache = {}
    else:
        cache = {}
    for raw_url in raw_urls:
        video_id = video_id_from_url(raw_url)
        if video_id not in cache:
            uncached_urls.append(raw_url)
    paths = download_videos_batch(uncached_urls)
    summaries = summarize_videos(paths)
    for path in summaries.keys():
        # path is "VIDEO_ID.mp4", extract video_id
        video_id = path.removesuffix(".mp4")
        cache[video_id] = summaries[path]
    if USE_CACHE:
        with open("cache.json", "w") as f:
            json.dump(cache, f, indent=2)
    else:
        print(cache)


@app.get("/")
def root():
    """Root endpoint."""
    return {"message": "Short Detective API"}


@app.get("/get-info")
def get_info(url: str):
    """Get cached info for a video URL."""
    video_id = video_id_from_url(url)
    try:
        with open("cache.json", "r") as f:
            cache = json.load(f)
    except FileNotFoundError:
        return {"message": "Cache not found"}

    if video_id in cache:
        return {"message": cache[video_id]}
    else:
        return {"message": f"Video {video_id} not in cache"}


if __name__ == "__main__":
    import uvicorn
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache", action="store_true", help="Enable caching")
    args = parser.parse_args()
    
    USE_CACHE = args.cache
    uvicorn.run(app, host="0.0.0.0", port=8080)
