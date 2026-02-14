import sys
sys.path.insert(0, "..")

from utils import LlmRequest, call_llm
from nonexistent import semantic_analysis, check_channel_page, voice_to_text
from extract_audio import extract_audio


def summarize_videos(paths: list[str]) -> str:
    return_dict = {}
    for path in paths:
        audio_path = extract_audio(path)
        transcription = voice_to_text(audio_path)
        channel_page_info = check_channel_page(path)
        semantic_analysis_info = semantic_analysis(path)
        
        message = f"""
        Given this information, tell users if there is anything problematic about the video.
        Transcription: {transcription}
        Channel page info: {channel_page_info}
        Semantic analysis: {semantic_analysis_info}
        """
        
        
        client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
        system_prompt = """
        You are a helpful assistant that analyzes YouTube channel information for signs of 
        misinformation, scams, or suspicious activity. Be BRIEF and CONCISE. User input may be truncated. 
        Try to be barebones and only give the most important information. 
        """
        response = client.chat.completions.create(
            model="gpt-5-mini-2025-08-07",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"Analyze this YouTube channel and give a short summary of its trustworthiness:\n\n{json.dumps(channel_info, indent=2)[:5000]}"}
            ]
        )
        return_dict[path] = response.choices[0].message.content
    return return_dict

if __name__ == "__main__":
    x = summarize_videos(["videos/AVeuGFSSAxQ.mp4"])
    print(x)