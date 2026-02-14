"""
Utils package. Use from any folder by adding backend to PYTHONPATH:

  PYTHONPATH=/path/to/short-detective/backend python your_script.py

Then::

  from utils import LlmRequest, call_llm
  # or
  from utils.llm_caller import LlmRequest, call_llm
"""

from .llm_caller import LlmRequest, call_llm

__all__ = ["LlmRequest", "call_llm"]
