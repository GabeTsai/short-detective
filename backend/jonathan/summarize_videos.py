

def summarize_videos(paths: list[str]) -> str:
    return_dict = {}
    for path in paths:
        return_dict[path] = f"This video was fake, url is {path}"
    return return_dict