from fastapi import FastAPI, Body
from fastapi.middleware.cors import CORSMiddleware
from download_video import download_videos_batch, video_id_from_url
from summarize_videos import summarize_videos
import argparse
import json
import os
from fastapi.responses import StreamingResponse
import time
from fastapi import FastAPI, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import time


class SendUrlsBody(BaseModel):
    urls: list[str]


app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


#@app.post("/send_urls", status_code=204)
#def send_urls(urls: list[str]):
#    """Accepts a list of URL strings. Returns nothing."""
#    pass

@app.post("/send_urls", status_code=204)
def send_urls(urls: list[str] = Body(...)):
    """Accepts a list of URL strings from the Chrome extension."""
    print(f"\nReceived {len(urls)} URLs:")
    for i, url in enumerate(urls, 1):
        print(f"  {i}. {url}") 


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

def hi_stream():
    for i in range(10):
        yield "hi{i}\n"
        time.sleep(0.5)  # optional delay to show streaming

@app.get("/stream")
def stream(url: str):
    return StreamingResponse(hi_stream(), media_type="text/plain")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080)
