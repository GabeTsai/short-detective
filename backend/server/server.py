from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from download_video import download_videos_batch, video_id_from_url
from summarize_videos import summarize_videos
import argparse
import json
import os
from fastapi.responses import StreamingResponse
import time

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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
                print(cache.keys())
        except Exception as e:
            print(f"Error loading cache: {e}")
            cache = {}
    else:
        raise
        cache = {}
    for raw_url in raw_urls:
        video_id = video_id_from_url(raw_url)

        if os.path.join("videos", video_id) not in cache.keys():
            uncached_urls.append(raw_url)
    paths = download_videos_batch(uncached_urls)
    summary_inputs = [(path, url) for path, url in zip(paths, uncached_urls)]
    summaries = summarize_videos(summary_inputs)
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
    video_id = os.path.join("videos", video_id)
    try:
        with open("cache.json", "r") as f:
            cache = json.load(f)
    except FileNotFoundError:
        return {"message": "Cache not found"}
    print(video_id)
    print(cache.keys())
    if video_id in cache:
        return {"message": cache[video_id]}
    else:
        return {"message": f"Video {video_id} not in cache"}

    return {"message": "Video not in cache", "is_streaming": True}


def hi_stream():
    for i in range(10):
        yield "hi{i}\n"
        time.sleep(0.5)  # optional delay to show streaming


@app.get("/stream")
def stream(url: str):
    return StreamingResponse(hi_stream(), media_type="text/plain")

if __name__ == "__main__":
    import uvicorn
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache", action="store_true", help="Enable caching")
    args = parser.parse_args()
    
    USE_CACHE = True
    uvicorn.run(app, host="0.0.0.0", port=8080)
