from fastapi import FastAPI, Body
from fastapi.middleware.cors import CORSMiddleware
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
    """Test endpoint. Accepts a string as input."""
    return {"message": f"This video was fake, url is {url}", "is_streaming": True}

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
