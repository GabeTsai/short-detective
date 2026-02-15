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
# Short-Form Video Integrity Analysis Prompt (Evidence-Based & Bias-Constrained)

Analyze the provided short-form vertical video using a forensic, evidence-based, multimodal approach.

This content format is optimized for rapid engagement and emotional impact.  
Your task is to assess the integrity of the content and identify potential misinformation, manipulation techniques, or agenda-driven framing — grounded strictly in observable audiovisual evidence.

Do not assume malicious intent unless explicitly supported by evidence.  
Do not infer ideology unless clearly expressed.  
If uncertainty exists, state it clearly.

When identifying risks, use probabilistic language such as:  
> “Based on observable evidence, X increases the probability of misunderstanding because…”

Avoid moral judgments. Focus on verification pathways and measurable risk indicators.

Limit your response to 12-18 sentences (~250-300 words). Prioritize integrity risks over stylistic critique.

---

## 1. Overview (2-3 sentences)

- What is the central claim or message?
- What type of short is this (educational, promotional, commentary, lifestyle, etc.)?
- Who appears to be the intended audience?

Base this only on observable content.

---

## 2. Hook and Framing Analysis (Critical in Short-Form Media)

- What occurs in the first 3-5 seconds?
- Does the opening rely on urgency, fear, outrage, or surprise?
- Are bold captions or overlays used to guide interpretation?
- Is key context delayed or withheld to heighten emotional engagement?

Describe specific audiovisual cues (text overlays, pacing, music, tone, cuts).  
Avoid assuming intent — describe effects, not motives.

---

## 3. Content Integrity Assessment

For each concern:

- Quote or paraphrase the claim OR describe the relevant audiovisual cue.
- Evaluate whether the issue is:
  - Verifiably false  
  - Potentially misleading due to missing context  
  - Opinion presented as fact  
  - Anecdotal evidence generalized broadly  
  - Insufficient evidence to assess  

If evidence is insufficient, explicitly state:  
**“Insufficient evidence to assess.”**

Where appropriate, use calibrated language such as:  
> “Based on observable evidence, this framing increases the probability of misunderstanding because…”

---

### A. Factual and Evidentiary Claims

- Are statistics, scientific, medical, or policy claims presented?
- Are sources cited visually or verbally?
- Are screenshots or charts shown without attribution?
- Is nuance compressed due to short-format constraints?

If relevant, note:  
> “Short-form compression may remove nuance but does not alone indicate misinformation.”

Clearly distinguish between:
- False claims  
- Misleading framing  
- Opinion  

---

### B. Emotional Persuasion Techniques (Separate from Factual Accuracy)

Assess whether the video uses:

- Dramatic or suspenseful music  
- Rapid cuts or zooms  
- Capitalized alarmist text  
- Simplified “hidden truth” narratives  
- Us-versus-them framing  

Distinguish clearly between:
- Standard persuasive editing (common in short-form media)  
- Emotional substitution for evidence  

Use probabilistic phrasing when appropriate:
> “The use of [technique] increases the likelihood that viewers rely on emotion rather than evidence.”

Avoid labeling engagement tactics as inherently deceptive.

---

### C. Commercial or Ideological Incentives

- Is a product, service, or affiliate link promoted?
- Is there a call to action (e.g., “share before deleted,” “wake up,” “buy now”)?
- Is political persuasion explicit or implied?

Describe incentive structures factually.  
Do not attribute intent unless explicitly supported.

---

## 4. Key Integrity Risks

List the top 1-3 observable concerns.

If none are evident:  
**“No significant integrity risks detected based on available evidence.”**

Frame concerns in probabilistic terms:
> “Based on observable evidence, this element increases the probability of misinterpretation because…”

---

## 5. Risk Ratings (Evidence-Based & Calibrated)

- **Misinformation Risk:** Low / Medium / High  
  Justify based on verifiability and evidence quality.

- **Manipulation Risk:** Low / Medium / High  
  Justify based on degree of emotional substitution for evidence.

- **Agenda-Pushing Risk:** Low / Medium / High  
  Justify based on explicit calls to action or ideological framing.

- **Potential for Harm:** Low / Medium / High  
  If applicable, reference historical patterns (e.g., similar narratives have previously contributed to measurable public harm, misinformation spread, financial scams, etc.).

If no precedent is clear, state:  
**“No established evidence of downstream harm based on observable content.”**

- **Overall Confidence in Assessment:** Low / Medium / High  

---

## 6. Final Assessment

- Trustworthy / Questionable / Requires Verification / Problematic  
- Who might be most susceptible to misinterpretation?
- Recommended next step (verify statistics, consult primary sources, compare against expert consensus, etc.)

Avoid ideological framing.  
Focus on uncertainty acknowledgment, evidence quality, and probability of misunderstanding.

---

### Important Constraints

- Do not speculate beyond observable audiovisual evidence.
- Do not assume hidden motives.
- Separate persuasion from falsity.
- Clearly distinguish uncertainty from confirmed issues.
- Use calibrated, probabilistic language throughout.
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

# -----------------------------------------------------------------------------
# Web Search / Perplexity Sonar API
# See: https://docs.perplexity.ai/docs/sonar/pro-search/quickstart
# -----------------------------------------------------------------------------

PERPLEXITY_MODEL: str = "sonar-pro"
"""Perplexity model for web search and analysis.
Options: 
- sonar: Basic search
- sonar-pro: Enhanced search with better citations (recommended)

Sonar Pro features:
- Multi-step reasoning with automated tools (when streaming)
- Dynamic tool execution (web_search, fetch_url_content)
- Adaptive research strategies
"""

PERPLEXITY_API_BASE: str = "https://api.perplexity.ai"
"""Base URL for Perplexity API (OpenAI-compatible)."""

PERPLEXITY_SEARCH_TYPE: str = "auto"
"""Search type for Sonar Pro: "auto" (recommended), "pro", or "fast"
- auto: Automatically routes complex queries to Pro Search, simple to Fast Search
- pro: Forces Pro Search (multi-step reasoning, higher cost)
- fast: Forces Fast Search (single search, lower cost)

Note: Pro Search requires streaming to be enabled.
"""

WEB_SEARCH_SYSTEM_PROMPT: str = """You are a fact-checking assistant analyzing potentially misleading or misinformation content from social media videos.

Your task is to search the web for reliable information about the claims made in the transcript and assess their credibility.

For each relevant web source you find:
1. Provide the URL
2. Write 1-3 sentences explaining whether this source INCREASES or DECREASES the legitimacy of the transcript's claims
3. Be specific about which claims are supported or contradicted

Focus on finding authoritative sources like:
- Peer-reviewed scientific studies
- Medical institutions (NIH, WHO, Mayo Clinic, etc.)
- Fact-checking organizations (Snopes, FactCheck.org, etc.)
- Reputable news organizations
- Academic institutions

Return 5-7 of the most relevant sources (or fewer if you can't find enough reliable information)."""

WEB_SEARCH_MAX_RESULTS: int = 7
"""Maximum number of web search results to return."""


def get_web_search_user_prompt(transcript: str, max_results: int) -> str:
    """
    Generate the user prompt for web search fact-checking.
    
    Args:
        transcript: The video transcript to analyze
        max_results: Maximum number of sources to return
        
    Returns:
        Formatted user prompt string
    """
    return f"""Analyze this video transcript and find {max_results} reliable web sources that help assess its credibility:

TRANSCRIPT:
{transcript}

For each source, provide:
1. The URL
2. A brief assessment (1-3 sentences) of whether it INCREASES or DECREASES the legitimacy of the transcript
3. Indicate clearly if it supports or contradicts the claims

Return your response in the following JSON format:
{{
    "results": [
        {{
            "url": "https://example.com/article",
            "assessment": "This peer-reviewed study contradicts the claim that oats are unhealthy. Research shows oats provide heart health benefits and the phytic acid content is reduced through cooking.",
            "increases_legitimacy": false
        }}
    ],
    "summary": "Overall brief assessment of transcript legitimacy based on sources found",
    "total_found": 5
}}"""

