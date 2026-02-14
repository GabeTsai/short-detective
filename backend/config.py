"""
Backend configuration. Loads .env from project root and defines constants
for voice-to-text (Voxtral/vLLM) and other agent backend services.
"""

import os
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv

# Load .env from project root (parent of backend/)
_PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(_PROJECT_ROOT / ".env")

# -----------------------------------------------------------------------------
# Voice-to-text / Voxtral (self-hosted vLLM on Modal)
# Using Voxtral Mini 3B for batch transcription
# See https://huggingface.co/mistralai/Voxtral-Mini-3B-2507
# Note: Use Voxtral-Mini-3B for batch, Voxtral-Mini-4B-Realtime for streaming
# -----------------------------------------------------------------------------

VOXTRAL_MODEL_ID: str = "mistralai/Voxtral-Mini-3B-2507"
"""Hugging Face model id for Voxtral Mini 3B (batch transcription).
Note: Use 3B for batch transcription, 4B-Realtime for streaming only."""

VOXTRAL_N_GPU: int = 1
"""Number of GPUs for vLLM (3B model needs ~10GB memory)."""

VOXTRAL_GPU_TYPE: str = "H100"
"""GPU type for Modal (e.g. H100, A100, A10G). 3B model can run on smaller GPUs.
Note: H100 recommended for best performance. A100, A10G also work well.
"""

VLLM_PORT: int = 8000
"""Port vLLM server listens on inside the container."""

SECONDS_PER_MINUTE: int = 60
"""Used to express timeouts in minutes."""

VOXTRAL_SERVER_TIMEOUT_MINUTES: int = 15
"""Modal function timeout (max time for a single request)."""

VOXTRAL_SCALEDOWN_WINDOW_MINUTES: int = 10
"""How long to keep the server up with no requests before scaling down."""

VOXTRAL_STARTUP_TIMEOUT_MINUTES: int = 15
"""Max time to wait for vLLM server to become ready."""

VOXTRAL_HEALTH_CHECK_RETRIES: int = 60
"""Number of health-check attempts before giving up."""

VOXTRAL_HEALTH_CHECK_INTERVAL_SECONDS: int = 10
"""Seconds between health-check attempts."""

VOXTRAL_HEALTH_CHECK_TIMEOUT_SECONDS: int = 5
"""Timeout for each health-check request."""

HF_CACHE_VOLUME_NAME: str = "huggingface-cache"
"""Modal Volume name for Hugging Face model cache."""

VLLM_CACHE_VOLUME_NAME: str = "vllm-cache"
"""Modal Volume name for vLLM cache."""

MODAL_APP_NAME_VOXTRAL: str = "voice-to-text-voxtral"
"""Modal App name for the Voxtral serving app."""

VOXTRAL_IMAGE_PYTHON: str = "3.12"
VOXTRAL_IMAGE_CUDA: str = "nvidia/cuda:12.9.0-devel-ubuntu22.04"
"""Container image for vLLM with audio support."""

# Use nightly vLLM build - fixes v1 engine sliding window bug with Voxtral
VOXTRAL_VLLM_NIGHTLY_INDEX: str = "https://wheels.vllm.ai/nightly/cu129"
VOXTRAL_VLLM_INSTALL: str = "vllm[audio]>=0.13.0"
VOXTRAL_HUB_INSTALL: str = "huggingface-hub>=0.36.0"

DEFAULT_TRANSCRIPTION_LANGUAGE: str = "en"
"""Default ISO language code for transcription."""

# -----------------------------------------------------------------------------
# Env-based settings (overridable via .env)
# -----------------------------------------------------------------------------

def get_transcription_url() -> Optional[str]:
    """URL of the deployed vLLM server (TRANSCRIPTION_URL). Empty = start server via modal run."""
    return os.environ.get("TRANSCRIPTION_URL") or None

# -----------------------------------------------------------------------------
# Semantic Video Analysis / Gemini API
# -----------------------------------------------------------------------------

GEMINI_MODEL_VIDEO: str = "gemini-2.0-flash-exp"
"""Gemini model for video analysis with multimodal support."""

SEMANTIC_ANALYSIS_PROMPT: str = """
Provide a detailed semantic analysis of this video, with a STRONG focus on detecting concerning content. Structure your response with the following sections:

## OVERVIEW
- Brief summary of what the video is about (2-3 sentences)
- Video type/genre (e.g., tutorial, vlog, advertisement, educational, entertainment, political commentary)
- Primary topic and target audience

## CONTENT INTEGRITY ASSESSMENT ⚠️
**This is the most important section. Carefully evaluate:**

### Misinformation & Factual Accuracy
- Are verifiable facts presented? Are they accurate or misleading?
- Any false claims, debunked information, or out-of-context statistics?
- Cherry-picking of data or selective presentation of evidence?
- Medical, scientific, or health misinformation?

### Propaganda & Manipulation Techniques
- Emotional manipulation (fear-mongering, outrage, sentimentalism)
- Loaded language or biased framing
- Us vs. them mentality or demonization of groups
- Oversimplification of complex issues
- Appeal to authority without credible sources

### Agenda-Pushing & Bias
- Clear political, ideological, or commercial agenda?
- One-sided presentation without acknowledging counterarguments?
- Attempting to radicalize or polarize viewers?
- Hidden sponsors or undisclosed conflicts of interest?

### Conspiracy Theories & Extremism
- Promotion of conspiracy theories (identify which ones)
- Anti-science or anti-establishment rhetoric
- Calls to action that could lead to harm
- Dog whistles or coded language for extremist views

### Source Credibility
- Are sources cited? Are they credible and verifiable?
- Expert credentials (if any) - are they legitimate?
- Quality of evidence presented (anecdotal vs. scientific)

## VISUAL & NARRATIVE ANALYSIS
- Key visual elements, text overlays, graphics
- Tone: calm/measured vs. sensationalist/alarmist
- Editing style: professional vs. amateur, fast-paced vs. deliberate
- Music/sound effects used for emotional manipulation

## KEY MOMENTS & RED FLAGS
- Specific timestamps where concerning content appears
- Most problematic claims or statements
- Any calls to action or directives to viewers

## OVERALL RISK ASSESSMENT
Rate the video on these dimensions (Low/Medium/High):
- **Misinformation Risk**: [Rating + brief explanation]
- **Propaganda/Manipulation**: [Rating + brief explanation]
- **Agenda-Pushing**: [Rating + brief explanation]
- **Conspiracy Theory Content**: [Rating + brief explanation]
- **Potential for Harm**: [Rating + brief explanation]

## SUMMARY
- Overall verdict: Is this content trustworthy, questionable, or problematic?
- Who might be vulnerable to this content?
- Recommended actions (verify claims, check sources, seek alternative perspectives, etc.)

Be thorough, specific, and critical, but limit your response to 15-20 sentences (around 300 words). 
If content appears benign, say so clearly. If it raises red flags, identify them explicitly with evidence.
"""

SEMANTIC_ANALYSIS_QUICK_PROMPT: str = """
Analyze this video and provide a FOCUSED assessment on potential concerns:

1. **Content Summary** (2-3 sentences): What is this video about?

2. **Red Flags** (if any):
   - Misinformation or false claims?
   - Propaganda techniques or emotional manipulation?
   - Conspiracy theories or extremist content?
   - Hidden agenda or bias?

3. **Risk Level**: Low / Medium / High - with brief justification

4. **Verdict**: Trustworthy, Questionable, or Problematic

Be concise but specific. If the content is benign, state that clearly.
"""

