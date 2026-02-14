import sys
sys.path.insert(0, "..")

from utils import LlmRequest, call_llm
from nonexistent import semantic_analysis, check_channel_page, voice_to_text

def summarize_videos(paths: list[str]) -> str:
    return_dict = {}
    for path in paths:
        transcription = voice_to_text(path)
        channel_page_info = check_channel_page(path)
        semantic_analysis_info = semantic_analysis(path)
        message = f"""
        Given this information, tell users if there is anything problematic about the video.
        Transcription: {transcription}
        Channel page info: {channel_page_info}
        Semantic analysis: {semantic_analysis_info}
        """
        return_dict[path] = message
        return_dict[path] = f"This video was fake, url is {path}"
        
    return return_dict