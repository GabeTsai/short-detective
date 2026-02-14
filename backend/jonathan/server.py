from fastapi import FastAPI
from download_video import download_videos_batch
app = FastAPI()


@app.post("/send_urls", status_code=204)
def send_urls(urls: list[str]):
    print(urls)
    """Accepts a list of URL strings. Returns nothing."""
    paths = download_videos_batch(urls)
    print(paths)


@app.get("/")
def root():
    """Root endpoint."""
    return {"message": "Short Detective API"}


@app.get("/get-info")
def get_info(url: str):
    """Test endpoint. Accepts a string as input."""
    return {"message": f"This video was fake, url is {url}"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
