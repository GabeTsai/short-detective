import sys
from pathlib import Path

_backend_dir = str(Path(__file__).resolve().parent.parent)
if _backend_dir not in sys.path:
    sys.path.insert(0, _backend_dir)

from utils import LlmRequest, call_llm
from channel_scraper import check_channel_page
from semantic_analysis_real import analyze_video as semantic_analysis
from voice_to_text_real import voice_to_text
from extract_audio import extract_audio
from openai import OpenAI
import os
from pathlib import Path
from dotenv import load_dotenv
from concurrent.futures import ThreadPoolExecutor, TimeoutError, as_completed
from web_search_real import search_web_from_transcript_str
# Load .env from root folder
root_dir = Path(__file__).resolve().parent.parent.parent
load_dotenv(root_dir / ".env")


def _process_single_video(path: str, url: str, storage_dict: dict) -> tuple[str, str]:
    """Process a single video with parallelized subtasks."""

    def audio_and_transcription():
        audio_path = extract_audio(path)
        x = voice_to_text(audio_path, os.environ["TRANSCRIPTION_URL"])
        return search_web_from_transcript_str(x)

    def channel_info():
        return check_channel_page(url)

    def semantic_info():
        try:
            return semantic_analysis(path, os.environ["GOOGLE_API_KEY"])
        except Exception as e:
            print(e)
            return "None"

    # Run 3 subtasks in parallel
    with ThreadPoolExecutor(max_workers=3) as executor:
        transcription_future = executor.submit(audio_and_transcription)
        channel_future = executor.submit(channel_info)
        semantic_future = executor.submit(semantic_info)

        # Wait for all subtasks to complete (60s timeout each)
        try:
            transcription = transcription_future.result(timeout=60)
        except Exception as e:
            print(e)
            transcription = "Transcription timed out"

        try:
            channel_page_info = channel_future.result(timeout=60)
        except Exception as e:
            print(e)
            channel_page_info = "Channel info timed out"

        try:
            semantic_analysis_info = semantic_future.result(timeout=60)
        except Exception as e:
            print(e)
            semantic_analysis_info = "Semantic analysis timed out"

    system_prompt = """
    You are an assistant that provides facts and findings.  Give a view on the trustworthiness of the video,
    including any potential misrepresentations. Your inputs may be truncated. Do not talk down to the user; 
    your job is to find facts. Do not add any extra formatting like ** or anything like that. Just use plain text. 
    
    """

    message = f"""
    Given this information, tell users if this video is AI generated or contains misinformation.
    Mismatch level represents how well the content in the video matches the facts we found (think of it as video risk). 
    When giving explanation, donn't use anything like "Presentation risk explanation:". Simply jump straight into the explanation.
    Consider internal analyses as statements that are highly likely to be true. Refer to semantic analysis as Google Gemini's analysis, 
    and channel page info as the information found on the channel page. Do not refer to ambigious internal 
    terms, and only use the above terms when referring to the internal analyses. 
    Perplexity Results: {transcription[:10000]}
    Channel page info: {channel_page_info[:10000]}
    Semantic analysis: {semantic_analysis_info[:10000]}
    Your response should be formatted like this: 

    Mismatch level: [Low/Medium/High/Very High]
    Video Risk: [Low/Medium/High/Very High]
    Context Risk: [Low/Medium/High/Very High]
    Presentation Risk: [Low/Medium/High/Very High]


    [Explanation for how you got the video risk rating (is it AI generated, clips stitched together misleadingly, etc.). In this and following sections, give the actual explanation, not this exact text]
    [Explanation for context risk (what context do we need to know to understand the video? Are there any scientific studies taken out of context, misrepresentation of facts, etc.)]
    [Explanation for presentation risk (how is the video presented? Is there music that sets a specific mood, clickbait behavior, fear selling, etc.)]

    Learn more: 
    [Here, list all the links perplexity returned. After each link, add a short explanation of why it's relevant to the video. Use a numbered list for each link]
    """

    client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])

    stream = client.chat.completions.create(
        model="gpt-5.2-2025-12-11",
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
            [('videos/EaDxKdpvMhc.mp4', 'https://www.youtube.com/shorts/EaDxKdpvMhc'),],
            storage_dict,
        )
        print(result)

    t = threading.Thread(target=run)
    t.start()

    while t.is_alive():
        #print({path: "".join(chunks) for path, chunks in storage_dict.items()})
        time.sleep(3)

    print(time.perf_counter() - start)
