import sys
from pathlib import Path

_backend_dir = str(Path(__file__).resolve().parent.parent)
if _backend_dir not in sys.path:
    sys.path.insert(0, _backend_dir)

from utils import LlmRequest, call_llm
from channel_scraper import check_channel_page
from semantic_analysis import analyze_video as semantic_analysis
from voice_to_text import voice_to_text
from extract_audio import extract_audio
from openai import OpenAI
import os
from pathlib import Path
from dotenv import load_dotenv
from concurrent.futures import ThreadPoolExecutor, as_completed

# Load .env from root folder
root_dir = Path(__file__).resolve().parent.parent.parent
load_dotenv(root_dir / ".env")


def _process_single_video(path: str, url: str, storage_dict: dict) -> tuple[str, str]:
    """Process a single video with parallelized subtasks."""

    def audio_and_transcription():
        audio_path = extract_audio(path)
        return voice_to_text(audio_path)

    def channel_info():
        return check_channel_page(url)

    def semantic_info():
        return semantic_analysis(path)

    # Run 3 subtasks in parallel
    with ThreadPoolExecutor(max_workers=3) as executor:
        transcription_future = executor.submit(audio_and_transcription)
        channel_future = executor.submit(channel_info)
        semantic_future = executor.submit(semantic_info)

        # Wait for all subtasks to complete
        transcription = transcription_future.result()
        channel_page_info = channel_future.result()
        semantic_analysis_info = semantic_future.result()

    system_prompt = """
    Here is some research on the youtube video and channel. Give a view on the trustworthiness of the video,
    including any potential misrepresentations. Your inputs may be truncated.
    """

    message = f"""
    Given this information, tell users if there is anything problematic about the video.
    Transcription: {transcription[:10000]}
    Channel page info: {channel_page_info[:10000]}
    Semantic analysis: {semantic_analysis_info[:10000]}
    Your message should start with "This video appears"...
    """

    client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])

    stream = client.chat.completions.create(
        model="gpt-5-mini-2025-08-07",
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": message}
        ],
        stream=True,
    )

    chunks = []
    storage_dict[path] = chunks
    for chunk in stream:
        delta = chunk.choices[0].delta
        if delta.content:
            chunks.append(delta.content)
    
    return path, "".join(chunks)


def summarize_videos(paths: list[tuple[str, str]], storage_dict) -> dict:
    print(paths)
    return_dict = {}

    # Process all videos in parallel with 16 threads
    with ThreadPoolExecutor(max_workers=16) as executor:
        futures = {
            executor.submit(_process_single_video, path, url, storage_dict): path
            for path, url in paths
        }

        # Wait for all to complete and collect results
        for future in as_completed(futures):
            try:
                path, result = future.result()
                return_dict[path] = result
            except Exception as e:
                path = futures[future]
                print(f"Error processing {path}: {e}")
                return_dict[path] = f"Error: {e}"

    return return_dict

if __name__ == "__main__":
    import time

    import threading

    start = time.perf_counter()
    storage_dict = {}
    result = {}

    def run():
        result = summarize_videos(
            [('videos/35KWWdck7zM.mp4', 'https://www.youtube.com/shorts/AVeuGFSSAxQ'),
             ('videos/AVeuGFSSAxQ.mp4', 'https://www.youtube.com/shorts/35KWWdck7zM')],
            storage_dict,
        )

    t = threading.Thread(target=run)
    t.start()

    while t.is_alive():
        print({path: "".join(chunks) for path, chunks in storage_dict.items()})
        time.sleep(3)

    print(time.perf_counter() - start)
