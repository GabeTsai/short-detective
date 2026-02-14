from fastapi import FastAPI

app = FastAPI()


@app.post("/send_urls", status_code=204)
def send_urls(urls: list[str]):
    """Accepts a list of URL strings. Returns nothing."""
    pass


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
    uvicorn.run(app, host="0.0.0.0", port=8080)
