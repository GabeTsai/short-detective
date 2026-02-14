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
    const down = new KeyboardEvent("keydown", opts);
    const up = new KeyboardEvent("keyup", opts);
    document.dispatchEvent(down);
    document.dispatchEvent(up);
    if (document.activeElement && document.activeElement !== document) {
      document.activeElement.dispatchEvent(new KeyboardEvent("keydown", opts));
      document.activeElement.dispatchEvent(new KeyboardEvent("keyup", opts));
      }
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
  function createPopupOverlay() {
    const overlay = document.createElement("div");
    overlay.id = "ytss-popup-overlay";
    overlay.innerHTML = `
      <div id="ytss-popup-content">
        <div id="ytss-popup-title"></div>
        <div id="ytss-popup-subtitle"></div>
        <div id="ytss-popup-loader">
          <div class="ytss-spinner"></div>
          <span id="ytss-popup-progress"></span>
        </div>
      </div>
    `;
    document.documentElement.appendChild(overlay);
    return overlay;
  }

  const popupOverlay = createPopupOverlay();

  function showPopup(type, data = {}) {
    const title = popupOverlay.querySelector("#ytss-popup-title");
    const subtitle = popupOverlay.querySelector("#ytss-popup-subtitle");
    const progress = popupOverlay.querySelector("#ytss-popup-progress");

    if (type === "welcome") {
      title.textContent = "Welcome to Brainrot";
      subtitle.textContent = "Preparing your feed...";
      progress.textContent = "Collecting URLs...";
    } else if (type === "summary") {
      const seconds = Math.round((data.viewingTime || 0) / 1000);
      title.textContent = `${seconds}s`;
      subtitle.textContent = `You spent ${seconds} seconds on the last 8 reels`;
      progress.textContent = "Collecting next 8 URLs...";
    }

    popupOverlay.classList.add("ytss-popup-visible");
  }

  function updatePopupProgress(msg) {
    const progress = popupOverlay.querySelector("#ytss-popup-progress");
    if (progress) progress.textContent = msg;
  }

  function hidePopup() {
    popupOverlay.classList.remove("ytss-popup-visible");
    }

  // ---------- Analysis Panel ----------
  function createAnalysisPanel() {
    const root = document.createElement("div");
    root.id = "ytss-analysis-root";
    root.innerHTML = `
      <div id="ytss-analysis-panel">
        <div id="ytss-analysis-header">Analysis Results</div>
        <div id="ytss-analysis-body">
          <div class="ytss-analysis-empty">Analysis results will appear here after URLs are collected...</div>
        </div>
      </div>
    `;
    document.documentElement.appendChild(root);
    return root;
  }

  const analysisPanel = createAnalysisPanel();

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
      // Extract video ID for display
      const videoId = url.split("/shorts/").pop()?.split("?")[0] || url;
      const escapedAnalysis = analysis
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      html += `
        <div class="ytss-analysis-card">
          <div class="ytss-analysis-url">${videoId}</div>
          <div class="ytss-analysis-text">${escapedAnalysis}</div>
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
  
    // ---------- UI Injection ----------
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
  
    const ui = injectUI();
    const els = {
      start: ui.querySelector("#ytss-start"),
      stop: ui.querySelector("#ytss-stop"),
      status: ui.querySelector("#ytss-status"),
      count: ui.querySelector("#ytss-count"),
      log: ui.querySelector("#ytss-log"),
      debug: ui.querySelector("#ytss-debug"),
      copy: ui.querySelector("#ytss-copy"),
      clear: ui.querySelector("#ytss-clear")
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
  
    // ---------- UI helpers ----------
    function setStatus(s) {
      els.status.textContent = s;
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
      els.count.textContent = String(allCollectedUrlsPersistent.length);
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
          const originalCanonical = canonicalShortsUrl(originalVideoUrl);
    if (canonicalUrl === originalCanonical || collectedUrls.has(canonicalUrl))
      return;

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

      scrollCount++;
      const before = canonicalShortsUrl(location.href);
      dispatchKey("ArrowDown");
      const changed = await waitForUrlChange(before, 280);
      if (!changed)
        console.log(`[YTSS] ↓ ${scrollCount}: no change in 280ms`);
    }

    // Collect the last URL after loop ends
    collectCurrentUrl();

    if (collectedInThisCycle >= 8) {
      updateDebug("Collected 8 URLs! Scrolling back...");
      updatePopupProgress("Scrolling back...");

      // Keep collectionRunning=true during scroll-back so URL changes
      // don't trigger WATCHED messages or user scroll counts
      await scrollBackToStart();
      collectionRunning = false;

      // Send latest batch to backend and get analysis
      const latestBatch = allCollectedUrlsPersistent.slice(-8);
      updatePopupProgress("Sending to backend...");
      showAnalysisLoading();
      chrome.runtime.sendMessage(
        { type: "SEND_TO_BACKEND", urls: latestBatch },
        (res) => {
          hideAnalysisLoading();
          if (chrome.runtime.lastError) {
            console.error("[YTSS] Backend send error:", chrome.runtime.lastError);
          } else if (res?.ok && res.analysis) {
            console.log("[YTSS] ✓ Batch sent + analysis received");
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

    for (let i = 0; i < 12; i++) {
      // Check BEFORE scrolling
      if (canonicalShortsUrl(location.href) === targetUrl) {
        updateDebug("Returned to start ✓");
        return true;
      }

      const before = canonicalShortsUrl(location.href);
        dispatchKey("ArrowUp");
      const changed = await waitForUrlChange(before, 400);

      if (!changed) {
        console.log(`[YTSS] ⬆ ${i + 1}: no URL change — may be at top`);
        // If URL didn't change, check if we landed on target after the attempt
        if (canonicalShortsUrl(location.href) === targetUrl) {
          updateDebug("Returned to start ✓");
          return true;
        }
        break; // Can't scroll further up
      }
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
    // Add the starting video so it doesn't count
    userVisitedInPhase.add(canonicalShortsUrl(location.href));
    viewingStartTime = Date.now();
    trackingUserScrolls = true;
  }

  function onUserScroll() {
    if (!trackingUserScrolls || !isCollecting) return;

    const currentUrl = canonicalShortsUrl(location.href);

    // Only count if this is a NEW video we haven't visited in this phase
    if (userVisitedInPhase.has(currentUrl)) return;
    userVisitedInPhase.add(currentUrl);

    userScrollCount++;
    updateDebug(`Watching... (${userScrollCount}/8 scrolled)`);
    console.log(`[YTSS] User scroll ${userScrollCount}/8`);

    if (userScrollCount >= 8) {
      trackingUserScrolls = false;
      const viewingTime = Date.now() - viewingStartTime;
      console.log(
        `[YTSS] User watched 8 reels in ${Math.round(viewingTime / 1000)}s`
      );
      triggerNextCycle(viewingTime);
    }
  }

  // ---------- Cycle Management ----------
  function triggerNextCycle(viewingTime) {
    if (!isCollecting) return;

    // Show summary popup
    showPopup("summary", { viewingTime });

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
  
    // ---------- Buttons ----------
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
            renderAnalysisResults({ [currentUrl]: res.message });
          }
        }
      );
    }, 3000);
  }

  // Auto-bootstrap on load
    bootstrap();
  })();
