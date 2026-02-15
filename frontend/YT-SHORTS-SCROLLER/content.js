// content.js — YT Shorts URL Collector with Popup Overlay (MV3)
// Scrolls to collect 8 URLs, returns to user's video, tracks user viewing time.
// Popup covers screen during auto-scroll, shows summary between cycles.

(() => {
    // ---------- Guards ----------
    if (!location.pathname.startsWith("/shorts/")) return;
    if (window.__YT_SHORTS_SCROLLER__) return;
    window.__YT_SHORTS_SCROLLER__ = true;
  
    // ---------- Config ----------
    const CONFIG = {
    targetCount: 8,
      viewerUrlPollMs: 200
    };
  
    // ---------- Utils ----------
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  
    function dispatchKey(key) {
    const keyCodeMap = { "ArrowDown": 40, "ArrowUp": 38 };
    const opts = {
      key, code: key,
      keyCode: keyCodeMap[key], which: keyCodeMap[key],
      bubbles: true, cancelable: true, view: window
    };
    // Dispatch to ONE target only — bubbles:true ensures document handlers see it.
    // Previously we dispatched to BOTH document AND activeElement, which caused
    // YouTube to receive 2 keydown events and scroll TWICE per call.
    const target = document.activeElement || document.body || document;
    target.dispatchEvent(new KeyboardEvent("keydown", opts));
    target.dispatchEvent(new KeyboardEvent("keyup", opts));
    }
  
    function canonicalShortsUrl(href) {
      try {
        const u = new URL(href);
        u.search = "";
        u.hash = "";
        return u.toString();
      } catch {
        return href;
      }
    }

    function isValidYouTubeVideoId(id) {
    if (!id || typeof id !== "string") return false;
      return /^[a-zA-Z0-9_-]{11}$/.test(id);
    }

  // ---------- Popup Overlay ----------
  const TIPS = [
    "Verify claims using multiple credible, independent sources.",
    "Check the original source, not just reposted snippets.",
    "Look for emotional manipulation or outrage-driven language.",
    "Examine dates to avoid outdated information reshared misleadingly.",
    "Investigate the author's credentials and potential conflicts.",
    "Beware of headlines that oversimplify complex issues.",
    "Reverse-search images to detect altered or reused media.",
    "Pause before sharing; accuracy matters more than speed."
  ];
  let tipInterval = null;
  let tipIndex = 0;

  function createPopupOverlay() {
    const overlay = document.createElement("div");
    overlay.id = "ytss-popup-overlay";
    overlay.innerHTML = `
      <div id="ytss-popup-content">
        <div id="ytss-popup-title"></div>
        <div id="ytss-popup-chart"></div>
        <div id="ytss-popup-tips"></div>
        <div id="ytss-popup-loader">
          <div class="ytss-spinner"></div>
        </div>
      </div>
    `;
    document.documentElement.appendChild(overlay);
    return overlay;
  }

  const popupOverlay = createPopupOverlay();

  function startTipRotation() {
    const tipsContainer = popupOverlay.querySelector("#ytss-popup-tips");
    tipIndex = 0;

    // Show first tip immediately
    tipsContainer.innerHTML = "";
    const firstTip = document.createElement("span");
    firstTip.className = "ytss-tip ytss-tip-active";
    firstTip.textContent = TIPS[0];
    tipsContainer.appendChild(firstTip);

    tipInterval = setInterval(() => {
      tipIndex = (tipIndex + 1) % TIPS.length;
      const current = tipsContainer.querySelector(".ytss-tip-active");

      // Create the incoming tip
      const next = document.createElement("span");
      next.className = "ytss-tip";
      next.textContent = TIPS[tipIndex];
      tipsContainer.appendChild(next);

      // Trigger exit on current, enter on next
      requestAnimationFrame(() => {
        if (current) {
          current.classList.remove("ytss-tip-active");
          current.classList.add("ytss-tip-exit");
        }
        requestAnimationFrame(() => {
          next.classList.add("ytss-tip-active");
        });
      });

      // Clean up exited tip after transition
      setTimeout(() => {
        if (current && current.parentNode) current.remove();
      }, 500);
    }, 2500);
  }

  function stopTipRotation() {
    if (tipInterval) {
      clearInterval(tipInterval);
      tipInterval = null;
    }
  }

  function buildBarChart(shortTimes) {
    if (!shortTimes || shortTimes.length === 0) return "";

    const maxSec = Math.max(...shortTimes.map(s => s.seconds), 1);
    const chartHeight = 160; // px

    let barsHtml = "";
    for (let i = 0; i < shortTimes.length; i++) {
      const { url, seconds } = shortTimes[i];
      const level = mismatchLevels.get(url);
      const color = level ? levelColor(level) : "#555";
      const barHeight = Math.max(4, Math.round((seconds / maxSec) * chartHeight));

      barsHtml += `
        <div style="display: flex; flex-direction: column; align-items: center; gap: 4px; flex: 1;">
          <span style="font-family: 'Libre Baskerville', Georgia, serif; font-size: 11px; color: rgba(255,255,255,0.6);">${seconds}s</span>
          <div style="width: 28px; height: ${barHeight}px; background: ${color}; border-radius: 4px 4px 0 0; transition: height 0.3s ease;"></div>
          <span style="font-family: 'Libre Baskerville', Georgia, serif; font-size: 10px; color: rgba(255,255,255,0.35);">${i + 1}</span>
        </div>`;
    }

    return `
      <div style="display: flex; align-items: flex-end; justify-content: center; gap: 8px; margin-top: 16px; margin-bottom: 12px; height: ${chartHeight + 40}px;">
        ${barsHtml}
      </div>`;
  }

  let wasMutedBeforePopup = false;

  function showPopup(type, data = {}) {
    // Mute all videos during overlay
    const videos = document.querySelectorAll("video");
    wasMutedBeforePopup = false;
    videos.forEach(v => {
      if (!v.muted) wasMutedBeforePopup = false;
      v.muted = true;
    });

    const title = popupOverlay.querySelector("#ytss-popup-title");
    const chart = popupOverlay.querySelector("#ytss-popup-chart");

    if (type === "welcome") {
      title.textContent = "Sauce, Please?";
      title.style.color = "#fff";
      chart.innerHTML = "";
      startTipRotation();
    } else if (type === "summary") {
      const seconds = Math.round((data.viewingTime || 0) / 1000);
      title.textContent = `${seconds}s on the last 8 reels`;

      // Color title by the mismatch level with the most cumulative time
      const timeByLevel = {};
      for (const { url, seconds: sec } of (data.shortTimes || [])) {
        const level = mismatchLevels.get(url) || "unknown";
        timeByLevel[level] = (timeByLevel[level] || 0) + sec;
      }
      let maxLevel = null, maxTime = 0;
      for (const [level, time] of Object.entries(timeByLevel)) {
        if (time > maxTime && level !== "unknown") {
          maxTime = time;
          maxLevel = level;
        }
      }
      title.style.color = maxLevel ? levelColor(maxLevel) : "#fff";

      chart.innerHTML = buildBarChart(data.shortTimes || []);
      startTipRotation();
    }

    popupOverlay.classList.add("ytss-popup-visible");
  }

  function updatePopupProgress(msg) {
    // progress element removed — no-op
  }

  function hidePopup() {
    popupOverlay.classList.remove("ytss-popup-visible");
    stopTipRotation();
    // Restore video mute state on all videos
    const videos = document.querySelectorAll("video");
    videos.forEach(v => v.muted = wasMutedBeforePopup);
    }

  // ---------- Analysis Panel ----------
  function createAnalysisPanel() {
    const root = document.createElement("div");
    root.id = "ytss-analysis-root";
    root.innerHTML = `
      <div id="ytss-drawer-handle" title="Toggle panel">&#8249;</div>
      <div id="ytss-analysis-panel">
        <div id="ytss-analysis-header">
          <span>Sauce, Please?</span>
          <button id="ytss-toggle" title="Start collection">&#9654;</button>
        </div>
        <div id="ytss-analysis-body">
          <div class="ytss-analysis-empty">Press play to start collecting and analyzing shorts...</div>
        </div>
      </div>
    `;
    document.documentElement.appendChild(root);

    // Drawer handle — width-based resize
    const handle = root.querySelector("#ytss-drawer-handle");
    const panel = root.querySelector("#ytss-analysis-panel");
    const MAX_WIDTH = 460;    // fully open
    const MIN_WIDTH = 120;    // minimum visible width before collapse
    let currentWidth = MAX_WIDTH;
    let collapsed = false;
    let dragging = false;
    let hasDragged = false;
    let dragStartX = 0;
    let dragStartWidth = 0;

    function setWidth(w, animate) {
      if (animate) {
        panel.style.transition = "width 0.3s ease";
      } else {
        panel.style.transition = "none";
      }
      panel.style.width = w + "px";
      currentWidth = w;
      collapsed = (w === 0);
      handle.innerHTML = collapsed ? "&#8249;" : "&#8250;";
    }

    handle.addEventListener("mousedown", (e) => {
      e.preventDefault();
      dragging = true;
      hasDragged = false;
      dragStartX = e.clientX;
      dragStartWidth = currentWidth;
      panel.style.transition = "none";  // disable transition during drag
      document.body.style.cursor = "ew-resize";
      document.body.style.userSelect = "none";
    });

    document.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      hasDragged = true;
      const dx = e.clientX - dragStartX;
      // Dragging RIGHT (positive dx) = shrinking panel
      // Dragging LEFT (negative dx) = expanding panel
      let newWidth = dragStartWidth - dx;
      newWidth = Math.max(0, Math.min(MAX_WIDTH, newWidth));
      panel.style.width = newWidth + "px";
      currentWidth = newWidth;
      handle.innerHTML = newWidth < MIN_WIDTH ? "&#8249;" : "&#8250;";
    });

    document.addEventListener("mouseup", (e) => {
      if (!dragging) return;
      dragging = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";

      if (!hasDragged || Math.abs(e.clientX - dragStartX) < 5) {
        // Click — toggle between full open and collapsed
        if (collapsed) {
          setWidth(MAX_WIDTH, true);
        } else {
          setWidth(0, true);
        }
      } else {
        // Drag release — if below MIN_WIDTH, collapse fully; otherwise stay
        if (currentWidth < MIN_WIDTH) {
          setWidth(0, true);
        } else {
          // Stay at current width, just re-enable transitions
          panel.style.transition = "width 0.3s ease";
          collapsed = false;
        }
      }
    });

    // Toggle button — start/stop collection
    let running = false;
    const toggleBtn = root.querySelector("#ytss-toggle");
    toggleBtn.addEventListener("click", () => {
      if (!running) {
        running = true;
        toggleBtn.innerHTML = "&#9632;";  // ■ stop icon
        toggleBtn.title = "Stop collection";
        toggleBtn.classList.add("ytss-toggle-active");
        bootstrap();
        startAnalysisPolling();
        startUrlCollection();
        // --- Dummy test (commented out) ---
        // renderAnalysisResults(DUMMY_RESULTS);
      } else {
        running = false;
        toggleBtn.innerHTML = "&#9654;";  // ▶ play icon
        toggleBtn.title = "Start collection";
        toggleBtn.classList.remove("ytss-toggle-active");
        stopUrlCollection();
      }
    });

    return root;
  }

  const analysisPanel = createAnalysisPanel();

  // ---- Dummy test data (commented out — uncomment to test UI without server) ----
  /*
  const DUMMY_RESULTS = {
    "dummy": `<div style="margin-bottom: 6px; position: relative;">
  <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 0;">
    <span style="font-family: 'Libre Baskerville', Georgia, serif; font-size: 15px; font-weight: 700; color: #000;">Mismatch Level</span>
    <span class="ytss-info-btn" style="display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; border-radius: 50%; background: #e0e0e0; color: #666; font-size: 11px; font-weight: 700; cursor: pointer; position: relative; user-select: none;" onclick="(function(el){var tip=el.querySelector('.ytss-info-tooltip');if(tip.style.display==='block'){tip.style.display='none';}else{tip.style.display='block';}})(this)">?<span class="ytss-info-tooltip" style="display: none; position: absolute; top: -8px; left: 26px; width: 220px; background: #555; color: #fff; font-size: 12px; font-weight: 400; padding: 10px 12px; border-radius: 8px; line-height: 1.5; z-index: 10; font-family: 'Libre Baskerville', Georgia, serif; box-shadow: 0 2px 8px rgba(0,0,0,0.18);">We judged the mismatch level with xyz procedures.</span></span>
  </div>
  <div style="font-family: 'Libre Baskerville', Georgia, serif; font-size: 26px; font-weight: 700; color: #e6b800; margin-top: 0;">Moderate</div>
</div>

<div style="display: flex; align-items: center; gap: 6px; margin: 8px 0 4px 0;">
  <span style="color: #1a1a1a; font-size: 17px; font-family: 'Libre Baskerville', Georgia, serif; font-weight: 700;">Engagement Patterns</span>
  <span class="ytss-info-btn" style="display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; border-radius: 50%; background: #e0e0e0; color: #666; font-size: 11px; font-weight: 700; cursor: pointer; position: relative; user-select: none;" onclick="(function(el){var tip=el.querySelector('.ytss-info-tooltip');if(tip.style.display==='block'){tip.style.display='none';}else{tip.style.display='block';}})(this)">?<span class="ytss-info-tooltip" style="display: none; position: absolute; top: -8px; left: 26px; width: 220px; background: #555; color: #fff; font-size: 12px; font-weight: 400; padding: 10px 12px; border-radius: 8px; line-height: 1.5; z-index: 10; font-family: 'Libre Baskerville', Georgia, serif; box-shadow: 0 2px 8px rgba(0,0,0,0.18);">Analysis of viewer engagement tactics and patterns used in this short.</span></span>
</div>
The video employs several proven engagement tactics commonly seen in high-performing Shorts content.

<div style="display: flex; align-items: center; gap: 6px; margin: 8px 0 4px 0;">
  <span style="color: #1a1a1a; font-size: 17px; font-family: 'Libre Baskerville', Georgia, serif; font-weight: 700;">Content Quality</span>
  <span class="ytss-info-btn" style="display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; border-radius: 50%; background: #e0e0e0; color: #666; font-size: 11px; font-weight: 700; cursor: pointer; position: relative; user-select: none;" onclick="(function(el){var tip=el.querySelector('.ytss-info-tooltip');if(tip.style.display==='block'){tip.style.display='none';}else{tip.style.display='block';}})(this)">?<span class="ytss-info-tooltip" style="display: none; position: absolute; top: -8px; left: 26px; width: 220px; background: #555; color: #fff; font-size: 12px; font-weight: 400; padding: 10px 12px; border-radius: 8px; line-height: 1.5; z-index: 10; font-family: 'Libre Baskerville', Georgia, serif; box-shadow: 0 2px 8px rgba(0,0,0,0.18);">Assessment of production value, lighting, audio, and visual elements.</span></span>
</div>
Production quality is above average for the Shorts format.

<div style="display: flex; align-items: center; gap: 6px; margin: 8px 0 4px 0;">
  <span style="color: #1a1a1a; font-size: 17px; font-family: 'Libre Baskerville', Georgia, serif; font-weight: 700;">Audience & Reach</span>
  <span class="ytss-info-btn" style="display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; border-radius: 50%; background: #e0e0e0; color: #666; font-size: 11px; font-weight: 700; cursor: pointer; position: relative; user-select: none;" onclick="(function(el){var tip=el.querySelector('.ytss-info-tooltip');if(tip.style.display==='block'){tip.style.display='none';}else{tip.style.display='block';}})(this)">?<span class="ytss-info-tooltip" style="display: none; position: absolute; top: -8px; left: 26px; width: 220px; background: #555; color: #fff; font-size: 12px; font-weight: 400; padding: 10px 12px; border-radius: 8px; line-height: 1.5; z-index: 10; font-family: 'Libre Baskerville', Georgia, serif; box-shadow: 0 2px 8px rgba(0,0,0,0.18);">Target demographics, comment engagement, and content distribution strategy.</span></span>
</div>
Based on the content style and hashtags used, this Short targets a demographic of eighteen to thirty-four year olds.

<div style="display: flex; align-items: center; gap: 6px; margin: 8px 0 4px 0;">
  <span style="color: #1a1a1a; font-size: 17px; font-family: 'Libre Baskerville', Georgia, serif; font-weight: 700;">Recommendations</span>
  <span class="ytss-info-btn" style="display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; border-radius: 50%; background: #e0e0e0; color: #666; font-size: 11px; font-weight: 700; cursor: pointer; position: relative; user-select: none;" onclick="(function(el){var tip=el.querySelector('.ytss-info-tooltip');if(tip.style.display==='block'){tip.style.display='none';}else{tip.style.display='block';}})(this)">?<span class="ytss-info-tooltip" style="display: none; position: absolute; top: -8px; left: 26px; width: 220px; background: #555; color: #fff; font-size: 12px; font-weight: 400; padding: 10px 12px; border-radius: 8px; line-height: 1.5; z-index: 10; font-family: 'Libre Baskerville', Georgia, serif; box-shadow: 0 2px 8px rgba(0,0,0,0.18);">Actionable takeaways and suggestions for content creators.</span></span>
</div>
This content represents a well-executed example of trend-based Shorts creation.`
  };
  */

  // ---------- Analysis Formatter ----------
  const LEVEL_COLORS = {
    "low": "#2ecc71",
    "moderate": "#e6b800",
    "medium": "#e6b800",
    "high": "#cc0000",
    "very high": "#8b0000"
  };

  function levelColor(level) {
    return LEVEL_COLORS[level.toLowerCase()] || "#1a1a1a";
  }

  function linkifyUrls(text) {
    return text.replace(
      /(https?:\/\/[^\s<]+)/g,
      '<a href="$1" target="_blank" rel="noopener" style="color: #3498db; text-decoration: underline; word-break: break-all;">$1</a>'
    );
  }

  function infoBubble(tip) {
    return `<span class="ytss-info-btn" style="display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; border-radius: 50%; background: #e0e0e0; color: #666; font-size: 11px; font-weight: 700; cursor: pointer; position: relative; user-select: none;" onclick="(function(el){var tip=el.querySelector('.ytss-info-tooltip');if(tip.style.display==='block'){tip.style.display='none';}else{tip.style.display='block';}})(this)">?<span class="ytss-info-tooltip" style="display: none; position: absolute; top: -8px; left: 26px; width: 220px; background: #555; color: #fff; font-size: 12px; font-weight: 400; padding: 10px 12px; border-radius: 8px; line-height: 1.5; z-index: 10; font-family: 'Libre Baskerville', Georgia, serif; box-shadow: 0 2px 8px rgba(0,0,0,0.18);">${tip}</span></span>`;
  }

  function formatAnalysis(text) {
    if (!text || typeof text !== "string") return text || "";

    const lines = text.split("\n");

    // Try to match the structured format
    const mismatchMatch = lines[0]?.match(/^Mismatch level:\s*(.+)/i);
    const videoMatch    = lines[1]?.match(/^Video Risk:\s*(.+)/i);
    const contextMatch  = lines[2]?.match(/^Context Risk:\s*(.+)/i);
    const presentMatch  = lines[3]?.match(/^Presentation Risk:\s*(.+)/i);

    // If not our format, return as-is
    if (!mismatchMatch) return linkifyUrls(text.replace(/</g, "&lt;").replace(/>/g, "&gt;"));

    const mLevel = mismatchMatch[1].trim();
    const vLevel = videoMatch?.[1]?.trim() || "";
    const cLevel = contextMatch?.[1]?.trim() || "";
    const pLevel = presentMatch?.[1]?.trim() || "";

    // Everything after the 4 header lines, split into paragraphs
    const bodyText = lines.slice(4).join("\n").trim();
    const paragraphs = bodyText.split(/\n\n+/);

    // Mismatch Level header
    let html = `<div style="margin-bottom: 6px; position: relative;">
  <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 0;">
    <span style="font-family: 'Libre Baskerville', Georgia, serif; font-size: 15px; font-weight: 700; color: #000;">Mismatch Level</span>
    ${infoBubble("Assessed by comparing the video's content with its implied claims to determine if the footage matches what it represents.")}
  </div>
  <div style="font-family: 'Libre Baskerville', Georgia, serif; font-size: 26px; font-weight: 700; color: ${levelColor(mLevel)}; margin-top: 0;">${mLevel}</div>
</div>`;

    // Section headers paired with paragraphs
    const sections = [
      ["Video Risk",        vLevel, paragraphs[0] || "", "Determined by evaluating signs of manipulation, deepfakes, fabricated claims, or harmful misinformation."],
      ["Context Risk",      cLevel, paragraphs[1] || "", "Based on whether missing background information could distort meaning or mislead viewers."],
      ["Presentation Risk", pLevel, paragraphs[2] || "", "Evaluated by analyzing editing style, tone, and framing for manipulative intent."]
    ];

    for (const [label, level, para, tooltip] of sections) {
      const escapedPara = linkifyUrls(para.replace(/</g, "&lt;").replace(/>/g, "&gt;"));
      html += `
<div style="display: flex; align-items: center; gap: 6px; margin: 8px 0 4px 0;">
  <span style="color: #1a1a1a; font-size: 17px; font-family: 'Libre Baskerville', Georgia, serif; font-weight: 700;">${label}: <span style="color: ${levelColor(level)};">${level}</span></span>
  ${infoBubble(tooltip)}
</div>
<div style="margin-bottom: 4px;">${escapedPara}</div>`;
    }

    // If there are extra paragraphs beyond the 3 expected, append them
    if (paragraphs.length > 3) {
      for (let i = 3; i < paragraphs.length; i++) {
        const extra = linkifyUrls(paragraphs[i].replace(/</g, "&lt;").replace(/>/g, "&gt;"));
        html += `<div style="margin-top: 8px;">${extra}</div>`;
      }
    }

    return html;
  }

  function renderAnalysisResults(results) {
    const body = analysisPanel.querySelector("#ytss-analysis-body");
    if (!body) return;

    // results is an object: { url: analysisText, ... }
    const entries = Object.entries(results);
    if (entries.length === 0) {
      body.innerHTML = `<div class="ytss-analysis-empty">No analysis available yet.</div>`;
      return;
    }

    let html = "";
    for (const [url, analysis] of entries) {
      const formatted = formatAnalysis(analysis);
      html += `
        <div class="ytss-analysis-card">
          <div class="ytss-analysis-text">${formatted}</div>
        </div>
      `;
    }
    body.innerHTML = html;
  }

  function showAnalysisLoading() {
    const body = analysisPanel.querySelector("#ytss-analysis-body");
    if (!body) return;
    // Add a loading indicator at the top
    const existing = body.querySelector(".ytss-analysis-loading");
    if (!existing) {
      const loader = document.createElement("div");
      loader.className = "ytss-analysis-loading";
      loader.innerHTML = `<div class="ytss-spinner"></div><span>Analyzing videos...</span>`;
      body.prepend(loader);
    }
  }

  function hideAnalysisLoading() {
    const body = analysisPanel.querySelector("#ytss-analysis-body");
    if (!body) return;
    const loader = body.querySelector(".ytss-analysis-loading");
    if (loader) loader.remove();
    }
  
    // ==========================================================
    // COMMENTED OUT: Left debug panel (collector UI)
    // This was used for debugging. Kept here for reference.
    // ==========================================================
    /*
    function injectUI() {
      if (document.getElementById("ytss-root")) {
        return document.getElementById("ytss-root");
      }

      const root = document.createElement("div");
      root.id = "ytss-root";
      root.innerHTML = `
        <div id="ytss-panel">
          <div id="ytss-tabs">
            <button class="ytss-tab ytss-tab-active" data-tab="collector">Collector</button>
            <button class="ytss-tab" data-tab="export">Export</button>
          </div>
          <div id="ytss-body">
            <div class="ytss-view" data-view="collector">
              <div class="ytss-row">
                <button id="ytss-start">Start</button>
                <button id="ytss-stop" disabled>Stop</button>
                <span id="ytss-status">idle</span>
              </div>
              <div class="ytss-row">
              <span>Collected: </span><b id="ytss-count">0</b>
              </div>
            <div id="ytss-debug" style="font-size:10px;color:#888;margin:4px 0;min-height:20px;padding:4px;background:rgba(0,0,0,0.2);border-radius:4px;">
                Debug: Initializing...
              </div>
            <textarea id="ytss-log" readonly placeholder="Collected URLs appear here..."></textarea>
              </div>
            <div class="ytss-view ytss-hidden" data-view="export">
              <button id="ytss-copy">Copy URLs</button>
              <button id="ytss-clear">Clear (UI only)</button>
              <div class="ytss-note">Copy copies the buffer shown. Clear only clears this textbox.</div>
            </div>
          </div>
        </div>
      `;
      
      document.documentElement.appendChild(root);
  
      // Tabs
      root.querySelectorAll(".ytss-tab").forEach((btn) => {
        btn.addEventListener("click", () => {
          root.querySelectorAll(".ytss-tab").forEach((b) => b.classList.remove("ytss-tab-active"));
          btn.classList.add("ytss-tab-active");
          const tab = btn.dataset.tab;
          root.querySelectorAll(".ytss-view").forEach((v) => v.classList.add("ytss-hidden"));
          root.querySelector(`.ytss-view[data-view="${tab}"]`).classList.remove("ytss-hidden");
        });
      });
  
      return root;
    }
    */
    // END COMMENTED OUT: Left debug panel
    // ==========================================================

    // Null-safe stubs so the rest of the code doesn't crash
    const els = {
      start: null, stop: null, status: null,
      count: null, log: null, debug: null,
      copy: null, clear: null
    };
  
    // ---------- State ----------
  let isCollecting = false;
  let collectionRunning = false;
  let originalVideoUrl = null;
  let scrollCount = 0;
  let collectedInThisCycle = 0;
  const collectedUrls = new Set();
  const allCollectedUrlsPersistent = [];
  const collectedUrlsInCycle = [];
  let isFirstCycle = true;
    let lastViewerHref = location.href;
  let queue = [];

  // Timer & user scroll tracking
  let userScrollCount = 0;
  let viewingStartTime = null;
  let trackingUserScrolls = false;
  let userVisitedInPhase = new Set();

  // Per-short time tracking for bar chart
  let perShortTimes = [];    // array of { url, seconds }
  let lastScrollTime = null;
  let lastScrollUrl = null;

  // Mismatch level cache (url -> "Low"|"Medium"|"High"|"Very High")
  const mismatchLevels = new Map();

  function extractAndCacheMismatch(url, text) {
    if (!text || typeof text !== "string") return;
    const match = text.match(/^Mismatch level:\s*(.+)/im);
    if (match) mismatchLevels.set(url, match[1].trim());
  }
  
    // ---------- UI helpers ----------
    function setStatus(s) {
      if (els.status) els.status.textContent = s;
    }
  
    function renderQueue(queueArray) {
      queue = queueArray;
      for (const url of queueArray) {
        if (!allCollectedUrlsPersistent.includes(url)) {
          allCollectedUrlsPersistent.push(url);
        }
      }
      if (els.log) {
        els.log.value = allCollectedUrlsPersistent.join("\n");
      els.log.scrollTop = els.log.scrollHeight;
      }
      if (els.count) els.count.textContent = String(allCollectedUrlsPersistent.length);
    }

    function updateDebug(msg) {
      if (els.debug) {
        const time = new Date().toLocaleTimeString();
        els.debug.textContent = `[${time}] ${msg}`;
    }
    console.log(`[YTSS] ${msg}`);
  }

  // ---------- Focus & Collect ----------
  function focusPlayer() {
    const el =
      document.querySelector("ytd-shorts video") ||
      document.querySelector("video") ||
      document.body;
    try {
      el.focus();
    } catch {}
  }

  function collectCurrentUrl() {
    const match = location.href.match(/\/shorts\/([^\/\?]+)/);
    if (!match) return;
        const videoId = match[1];
    if (!isValidYouTubeVideoId(videoId)) return;
          
    const canonicalUrl = `https://www.youtube.com/shorts/${videoId}`;
    if (collectedUrls.has(canonicalUrl)) return;

            collectedUrls.add(canonicalUrl);
            collectedInThisCycle++;
            collectedUrlsInCycle.push(canonicalUrl);
            
    // Add to persistent log
            if (!allCollectedUrlsPersistent.includes(canonicalUrl)) {
              allCollectedUrlsPersistent.push(canonicalUrl);
              if (els.log) {
                els.log.value = allCollectedUrlsPersistent.join("\n");
                els.log.scrollTop = els.log.scrollHeight;
              }
              if (els.count) {
                els.count.textContent = String(allCollectedUrlsPersistent.length);
              }
            }
            
    console.log(`[YTSS] ${collectedInThisCycle}/8: ${canonicalUrl}`);
    updatePopupProgress(`Collecting ${collectedInThisCycle}/8...`);
            
    chrome.runtime.sendMessage(
      { type: "FOUND_URL", url: canonicalUrl },
      (res) => {
              if (chrome.runtime.lastError) {
                console.error("[YTSS] Error sending URL:", chrome.runtime.lastError);
        }
      }
    );
  }

  // Wait for URL to change, polling every 10ms
  async function waitForUrlChange(beforeUrl, maxMs = 280) {
    const polls = Math.ceil(maxMs / 10);
    for (let i = 0; i < polls; i++) {
      await sleep(10);
      if (canonicalShortsUrl(location.href) !== beforeUrl) return true;
    }
    return false;
  }

  // ---------- Scroll Down & Collect ----------
  async function scrollAndCollect() {
    if (!isCollecting || !collectionRunning) return;

    focusPlayer();

    while (isCollecting && collectionRunning && collectedInThisCycle < 8) {
      collectCurrentUrl();
      if (collectedInThisCycle >= 8) break;

      const before = canonicalShortsUrl(location.href);
      dispatchKey("ArrowDown");
      const changed = await waitForUrlChange(before, 280);
      if (changed) {
        scrollCount++;
      } else {
        console.log(`[YTSS] ↓ scroll attempt: no change in 280ms`);
      }
    }

    if (collectedInThisCycle >= 8) {
      updateDebug("Collected 8 URLs! Scrolling back...");
      updatePopupProgress("Scrolling back...");

      // Keep collectionRunning=true during scroll-back so URL changes
      // don't trigger WATCHED messages or user scroll counts
      await scrollBackToStart();
      collectionRunning = false;

      // Send latest batch to backend and get analysis
      const latestBatch = allCollectedUrlsPersistent.slice(-8);
      showAnalysisLoading();

      // Safety timeout: hide loading spinner after 15s no matter what
      const loadingTimeout = setTimeout(() => {
        hideAnalysisLoading();
        console.log("[YTSS] Loading spinner timed out after 15s");
      }, 15000);

      chrome.runtime.sendMessage(
        { type: "SEND_TO_BACKEND", urls: latestBatch },
        (res) => {
          clearTimeout(loadingTimeout);
          hideAnalysisLoading();
          if (chrome.runtime.lastError) {
            console.error("[YTSS] Backend send error:", chrome.runtime.lastError);
          } else if (res?.ok && res.analysis) {
            console.log("[YTSS] ✓ Batch sent + analysis received");
            for (const [url, text] of Object.entries(res.analysis)) {
              extractAndCacheMismatch(url, text);
            }
            renderAnalysisResults(res.analysis);
          } else if (res?.ok) {
            console.log("[YTSS] ✓ Batch sent (no analysis returned)");
        } else {
            console.log("[YTSS] Backend unavailable:", res?.error || "unknown");
          }
        }
      );

      // Reset cycle-specific state
        collectedInThisCycle = 0;
      collectedUrls.clear();
      collectedUrlsInCycle.length = 0;

      // Hide popup, start tracking user scrolls
      hidePopup();
      startUserScrollTracking();

      if (isFirstCycle) isFirstCycle = false;
      updateDebug("Watching... (0/8 scrolled)");
    } else {
      // Didn't collect enough — still need to clean up
      console.log(`[YTSS] Only collected ${collectedInThisCycle}/8 — ending cycle`);
      collectionRunning = false;
      hidePopup();
      startUserScrollTracking();
    }
  }

  // ---------- Scroll Back — stop when originalVideoUrl reached ----------
  async function scrollBackToStart() {
    const targetUrl = canonicalShortsUrl(originalVideoUrl);
      console.log(`[YTSS] Scrolling back to: ${targetUrl}`);

    let consecutiveFails = 0;

    for (let i = 0; i < 16; i++) {
      // Check BEFORE scrolling
      if (canonicalShortsUrl(location.href) === targetUrl) {
        updateDebug("Returned to start ✓");
        return true;
      }

      focusPlayer();
      const before = canonicalShortsUrl(location.href);
        dispatchKey("ArrowUp");
      const changed = await waitForUrlChange(before, 1200);

      if (!changed) {
        consecutiveFails++;
        console.log(`[YTSS] ⬆ ${i + 1}: no URL change (fail ${consecutiveFails}/3)`);

        if (canonicalShortsUrl(location.href) === targetUrl) {
          updateDebug("Returned to start ✓");
          return true;
        }

        // Only give up after 3 consecutive failures, not 1
        if (consecutiveFails >= 3) {
          console.log(`[YTSS] 3 consecutive up-scroll failures — stopping`);
            break;
          }
          
        // Wait and retry instead of immediately breaking
        await sleep(300);
        continue;
      }

      // Successful scroll — reset fail counter
      consecutiveFails = 0;
      await sleep(200);
    }

    // Final check
    if (canonicalShortsUrl(location.href) === targetUrl) {
      updateDebug("Returned to start ✓");
      return true;
    }

    updateDebug("Warning: could not match start URL");
    console.log(
      `[YTSS] Mismatch: expected ${targetUrl}, got ${canonicalShortsUrl(location.href)}`
    );
    return false;
  }

  // ---------- User Scroll Tracking ----------
  function startUserScrollTracking() {
    userScrollCount = 0;
    userVisitedInPhase.clear();
    perShortTimes = [];
    const startUrl = canonicalShortsUrl(location.href);
    // Add the starting video so it doesn't count as a scroll
    userVisitedInPhase.add(startUrl);
    viewingStartTime = Date.now();
    lastScrollTime = Date.now();
    lastScrollUrl = startUrl;
    trackingUserScrolls = true;
  }

  function onUserScroll() {
    if (!trackingUserScrolls || !isCollecting) return;

    const currentUrl = canonicalShortsUrl(location.href);

    // Only count if this is a NEW video we haven't visited in this phase
    if (userVisitedInPhase.has(currentUrl)) return;
    userVisitedInPhase.add(currentUrl);

    // Record time spent on the previous short
    const now = Date.now();
    if (lastScrollUrl) {
      perShortTimes.push({
        url: lastScrollUrl,
        seconds: Math.round((now - lastScrollTime) / 1000)
      });
    }
    lastScrollTime = now;
    lastScrollUrl = currentUrl;

    userScrollCount++;
    updateDebug(`Watching... (${userScrollCount}/8 scrolled)`);
    console.log(`[YTSS] User scroll ${userScrollCount}/8`);

    if (userScrollCount >= 8) {
      trackingUserScrolls = false;
      // Record time on the final (8th) short
      perShortTimes.push({
        url: lastScrollUrl,
        seconds: Math.round((Date.now() - lastScrollTime) / 1000)
      });
      const viewingTime = Date.now() - viewingStartTime;
      console.log(
        `[YTSS] User watched 8 reels in ${Math.round(viewingTime / 1000)}s`
      );
      triggerNextCycle(viewingTime, perShortTimes);
    }
  }

  // ---------- Cycle Management ----------
  function triggerNextCycle(viewingTime, shortTimes = []) {
      if (!isCollecting) return;
      
    // Show summary popup with per-short data
    showPopup("summary", { viewingTime, shortTimes });

    // Start collection from user's current position
    originalVideoUrl = canonicalShortsUrl(location.href);
      scrollCount = 0;
      collectedInThisCycle = 0;
    collectedUrls.clear();
    collectedUrlsInCycle.length = 0;
      collectionRunning = true;
      
    updateDebug("Starting next collection cycle...");
    focusPlayer();
    scrollAndCollect().catch((e) => {
      console.error("[YTSS] Collection error:", e);
      updateDebug("Error during collection");
      collectionRunning = false;
      hidePopup();
    });
  }

  function startFirstCycle() {
      if (!isCollecting) return;
      
    isFirstCycle = true;
    showPopup("welcome");

    originalVideoUrl = canonicalShortsUrl(location.href);
    scrollCount = 0;
    collectedInThisCycle = 0;
    collectedUrls.clear();
    collectedUrlsInCycle.length = 0;
    collectionRunning = true;

    updateDebug("Starting first collection...");
    focusPlayer();
    scrollAndCollect().catch((e) => {
      console.error("[YTSS] Collection error:", e);
      updateDebug("Error during collection");
      collectionRunning = false;
      hidePopup();
    });
    }

    function startUrlCollection() {
    if (isCollecting) return;
      isCollecting = true;
    startFirstCycle();
    }

    function stopUrlCollection() {
      isCollecting = false;
      collectionRunning = false;
    trackingUserScrolls = false;
    hidePopup();
      updateDebug("Collection stopped");
    }

  // ---------- URL Change Detection (viewer poll) ----------
  setInterval(() => {
    if (location.href !== lastViewerHref) {
      const prev = lastViewerHref;
      lastViewerHref = location.href;

      // Mark watched in background
      chrome.runtime.sendMessage({
        type: "WATCHED",
        url: canonicalShortsUrl(prev)
      });

      // Track user scrolls (only when NOT auto-collecting)
      if (!collectionRunning) {
        onUserScroll();
      }
    }
  }, CONFIG.viewerUrlPollMs);
  
    // ---------- Messaging ----------
    function bootstrap() {
        updateDebug("Initializing...");
    chrome.runtime.sendMessage({ type: "BOOTSTRAP" }, (res) => {
            if (chrome.runtime.lastError) {
              updateDebug("ERROR: " + chrome.runtime.lastError.message);
              setStatus("error");
              return;
            }
            if (res && Array.isArray(res.queue)) {
              renderQueue(res.queue);
              setStatus("connected (" + res.queue.length + " URLs)");
              updateDebug("Connected! Queue: " + res.queue.length);
      }
    });
  }

    chrome.runtime.onMessage.addListener((msg) => {
      if (msg?.type === "QUEUE_UPDATE" && Array.isArray(msg.queue)) {
        renderQueue(msg.queue);
      }
    });
  
    // ==========================================================
    // COMMENTED OUT: Button event listeners for left debug panel
    // ==========================================================
    /*
    els.start.addEventListener("click", () => {
      els.start.disabled = true;
      els.stop.disabled = false;
      setStatus("collecting...");
      bootstrap();
      startAnalysisPolling();
      startUrlCollection();
    });
  
    els.stop.addEventListener("click", () => {
      els.start.disabled = false;
      els.stop.disabled = true;
      setStatus("stopped");
      stopUrlCollection();
    });
  
    els.copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(els.log.value.trim());
        setStatus("copied");
        setTimeout(() => setStatus("idle"), 800);
      } catch {
        setStatus("copy failed");
      }
    });
  
    els.clear.addEventListener("click", () => {
      els.log.value = "";
      els.count.textContent = "0";
      setStatus("idle");
    });
    */
    // END COMMENTED OUT: Button event listeners
    // ==========================================================

    // Collection is started/stopped via the toggle button in the analysis panel header
  
  // ---------- Analysis Polling (every 3s) ----------
  let lastAnalysisUrl = null;
  let analysisPollingActive = false;

  function startAnalysisPolling() {
    if (analysisPollingActive) return;
    analysisPollingActive = true;

    setInterval(() => {
      if (!isCollecting) return;       // only poll when active
      if (collectionRunning) return;   // skip during auto-scroll

      const currentUrl = canonicalShortsUrl(location.href);
      // Skip if same URL as last poll
      if (currentUrl === lastAnalysisUrl) return;

      chrome.runtime.sendMessage(
        { type: "GET_INFO", url: currentUrl },
        (res) => {
          if (chrome.runtime.lastError) return;
          if (res?.ok && res.message) {
            lastAnalysisUrl = currentUrl;
            extractAndCacheMismatch(currentUrl, res.message);
            renderAnalysisResults({ [currentUrl]: res.message });
          }
        }
      );
    }, 3000);
  }

  // ---------- URL Watcher: hide UI when not on /shorts/ ----------
  let wasOnShorts = true;
  setInterval(() => {
    const onShorts = location.pathname.startsWith("/shorts/");
    if (onShorts && !wasOnShorts) {
      // Returned to shorts — show UI
      analysisPanel.style.display = "";
      popupOverlay.style.display = "";
      wasOnShorts = true;
    } else if (!onShorts && wasOnShorts) {
      // Left shorts — hide UI and stop collection if running
      analysisPanel.style.display = "none";
      popupOverlay.style.display = "none";
      hidePopup();
      wasOnShorts = false;
    }
  }, 500);

  })();
