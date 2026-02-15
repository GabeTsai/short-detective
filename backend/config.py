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

VOXTRAL_MAX_CONCURRENT_REQUESTS: int = 100
"""Maximum concurrent requests allowed per container. 
This enables vLLM batching - all requests hit the same GPU instead of spawning separate containers.
Set this high enough to handle your peak concurrent load."""

VOXTRAL_MIN_CONTAINERS: int = 1
"""Minimum number of containers to keep running at all times.
Prevents cold starts (1-2 min startup) by maintaining a floor of warm containers.

- 0: Scale to zero when idle (cheapest, but has 1-2 min cold starts)
- 1: Always keep 1 container running (recommended for production)
- 2+: Keep multiple containers for high availability

Cost: ~$4/hr per H100 container (~$96/day each)
"""

VOXTRAL_BUFFER_CONTAINERS: int = 0
"""Number of extra idle containers to keep ready during active periods.
These spin up when ANY container is active, ready to handle burst traffic.

- 0: No buffer (scale on-demand only)
- 1: Keep 1 extra container ready during active periods (recommended)
- 2+: More buffer for very bursty traffic

Example with min_containers=1, buffer_containers=1:
- Idle: 1 container running (min_containers)
- Request arrives: Still 1 container, but 1 more spins up as buffer
- Burst of requests: Buffer container instantly available, more scale up as needed
"""

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

GEMINI_MODEL_VIDEO: str = "gemini-3-flash-preview"
"""Gemini model for video analysis with multimodal support."""

SEMANTIC_ANALYSIS_PROMPT: str = """
Analyze the provided short-form vertical video using a forensic, evidence-based, multimodal approach.

This content format is optimized for rapid engagement and emotional impact.  
Your task is to detect misinformation, manipulation, agenda-pushing, or harmful framing — grounded strictly in observable audiovisual evidence.

Do not assume malicious intent unless clearly supported.

Limit your response to 12-18 sentences (~250-300 words). Prioritize integrity risks.

---

## 1. Overview (2-3 sentences)

- What is the core claim or message?
- What type of short is this (educational, promotional, political commentary, lifestyle advice, etc.)?
- Who appears to be the intended audience?

---

## 2. Hook and Framing Analysis (Critical for Short-Form)

- What is presented in the first 3-5 seconds?
- Does the opening rely on shock, urgency, outrage, or fear?
- Are bold text overlays or captions used to frame interpretation?
- Is context withheld to create suspense or emotional tension?

Describe specific on-screen text, tone, or editing cues.

---

## 3. Content Integrity Assessment

For each concern:
- Quote/paraphrase the claim OR describe the relevant visual/audio cue.
- Explain why it may be misleading, exaggerated, decontextualized, or unsupported.
- If insufficient evidence exists, state: "Insufficient evidence to assess."

### A. Factual Claims

- Are statistics or scientific/medical claims presented?
- Are claims compressed in a way that removes nuance?
- Are charts, headlines, or screenshots shown without sourcing?
- Are anecdotes presented as universal proof?

Distinguish clearly between:
- False claims  
- Misleading framing  
- Opinion  

---

### B. Emotional Manipulation Techniques

Assess whether the short uses:

- Dramatic music or sound effects  
- Rapid jump cuts or zooms to create urgency  
- Red warning text, capitalized words, or alarmist visuals  
- Simplified "you've been lied to" narratives  
- Us-vs-them framing  

Provide specific multimodal examples.

---

### C. Commercial or Ideological Incentives

- Is there a product, affiliate link, or brand promotion?
- Is political persuasion implied?
- Is there a call to action (e.g., “share before this gets deleted,” “wake up,” “buy now”)?

---

## 4. Key Red Flags

List the top 1-3 integrity concerns.  
If none, state: "No significant red flags detected."

---

## 5. Risk Ratings

- Misinformation Risk: [Low/Medium/High] - Brief justification  
- Manipulation Risk: [Low/Medium/High] - Brief justification  
- Agenda-Pushing Risk: [Low/Medium/High] - Brief justification  
- Potential for Harm: [Low/Medium/High] - Brief justification  

Overall Confidence in Assessment: [Low/Medium/High]

---

## 6. Final Verdict
- Trustworthy / Questionable / Problematic  
- Who might be most vulnerable?  
- Recommended next step (fact-check, seek full-length sources, verify claims, etc.)
---

### Evaluation Requirements
- Be concise but analytically rigorous.
- Ground all findings in observable multimodal evidence (visuals, music, pacing, captions, tone).
- Do not over-interpret neutral stylistic elements.
- Distinguish clearly between persuasive editing and factual inaccuracy.
- If the content appears benign, state that clearly.
- Do not speculate beyond what is shown.
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

