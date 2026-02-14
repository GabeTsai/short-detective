import sys
from pathlib import Path

_backend_dir = Path(__file__).resolve().parent.parent
if str(_backend_dir) not in sys.path:
    sys.path.insert(0, str(_backend_dir))

from utils import LlmRequest, call_llm


def summarize_videos(paths: list[str]) -> str:
    return_dict = {}
    for path in paths:
        return_dict[path] = f"This video was fake, url is {path}"
    return return_dict