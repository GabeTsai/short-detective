// content.js — DOM-based URL collector (MV3)
// Extracts URLs from current tab's DOM - no prefetch tabs needed

(() => {
    // ---------- Guards ----------
    if (!location.pathname.startsWith("/shorts/")) return;
    if (window.__YT_SHORTS_SCROLLER__) return;
    window.__YT_SHORTS_SCROLLER__ = true;
  
    // ---------- Config ----------
    const CONFIG = {
      targetCount: 20,
      collectionPauseMs: 10000, // 10 second pause before starting
      scrollDelayMs: 300, // Delay between scrolls (ArrowDown)
      scrollBackDelayMs: 100, // Delay when scrolling back up
      viewerUrlPollMs: 200
    };
  
    // ---------- Utils ----------
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  
    function dispatchKey(key) {
      // Try multiple approaches for better compatibility
      const keyCodeMap = {
        "ArrowDown": 40,
        "ArrowUp": 38
      };
      
      const codeMap = {
        "ArrowDown": "ArrowDown",
        "ArrowUp": "ArrowUp"
      };
      
      const keyCode = keyCodeMap[key];
      const code = codeMap[key];
      
      // Create more complete keyboard events
      const eventOptions = {
        key: key,
        code: code,
        keyCode: keyCode,
        which: keyCode,
        bubbles: true,
        cancelable: true,
        view: window
      };
      
      const down = new KeyboardEvent("keydown", eventOptions);
      const up = new KeyboardEvent("keyup", eventOptions);
      
      // Try dispatching on multiple targets
      const targets = [
        document.activeElement,
        document.querySelector('ytd-shorts video'),
        document.querySelector('ytd-reel-video-renderer'),
        document.querySelector('#player'),
        document.body,
        document,
        window
      ].filter(Boolean);
      
      console.log(`[YTSS] Dispatching ${key} to ${targets.length} targets`);
      
      for (const target of targets) {
        try {
          target.dispatchEvent(down);
          target.dispatchEvent(up);
          console.log(`[YTSS] Dispatched to:`, target.tagName || target.constructor?.name);
        } catch (e) {
          console.log(`[YTSS] Failed to dispatch to target:`, e);
        }
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

    // Validate YouTube video ID (must be exactly 11 alphanumeric characters)
    function isValidYouTubeVideoId(id) {
      if (!id || typeof id !== 'string') return false;
      // YouTube video IDs are exactly 11 characters, alphanumeric with dashes/underscores
      return /^[a-zA-Z0-9_-]{11}$/.test(id);
    }

    // ---------- Intercept YouTube API Calls ----------
    let isCollecting = false;
    let apiInterceptionEnabled = false;

    function extractVideoIdsFromAPIResponse(data) {
      if (!isCollecting) return;
      
      const videoIds = new Set();
      
      function findVideoIds(obj, depth = 0) {
        if (depth > 20) return;
        if (!obj || typeof obj !== 'object') return;
        
        if (Array.isArray(obj)) {
          obj.forEach(item => findVideoIds(item, depth + 1));
          return;
        }
        
        // Look for videoId
        if (obj.videoId && isValidYouTubeVideoId(obj.videoId)) {
          videoIds.add(obj.videoId);
          console.log("Found videoId in API response:", obj.videoId);
        }
        
        // Look for navigationEndpoint
        if (obj.navigationEndpoint?.watchEndpoint?.videoId && 
            isValidYouTubeVideoId(obj.navigationEndpoint.watchEndpoint.videoId)) {
          videoIds.add(obj.navigationEndpoint.watchEndpoint.videoId);
          console.log("Found videoId in navigationEndpoint:", obj.navigationEndpoint.watchEndpoint.videoId);
        }
        
        // Look for items array (common in feed responses)
        if (obj.items && Array.isArray(obj.items)) {
          console.log("Found items array with", obj.items.length, "items");
          obj.items.forEach(item => findVideoIds(item, depth + 1));
        }
        
        // Look for contents array
        if (obj.contents && Array.isArray(obj.contents)) {
          console.log("Found contents array with", obj.contents.length, "items");
          obj.contents.forEach(item => findVideoIds(item, depth + 1));
        }
        
        // Recursively search
        for (const key in obj) {
          if (typeof obj[key] === 'object') {
            findVideoIds(obj[key], depth + 1);
          }
        }
      }
      
      findVideoIds(data);
      
      // Send found video IDs
      videoIds.forEach(videoId => {
        const url = `https://www.youtube.com/shorts/${videoId}`;
        const currentMatch = location.href.match(/\/shorts\/([^\/\?]+)/);
        const currentVideoId = currentMatch ? currentMatch[1] : null;
        
        if (videoId !== currentVideoId && !collectedUrls.has(url)) {
          collectedUrls.add(url);
          chrome.runtime.sendMessage({ type: "FOUND_URL", url }, (res) => {
            if (!chrome.runtime.lastError && res) {
              updateDebug(`Found URL #${res.size} from API: ${url.substring(0, 50)}...`);
            }
          });
        }
      });
    }

    function interceptYouTubeAPI() {
      if (apiInterceptionEnabled) return; // Already set up
      apiInterceptionEnabled = true;
      
      // Intercept fetch requests to YouTube's API
      const originalFetch = window.fetch;
      window.fetch = function(...args) {
        const url = args[0];
        if (typeof url === 'string' && url.includes('youtube.com/youtubei/v1/') && 
            (url.includes('reel') || url.includes('browse') || url.includes('next'))) {
          console.log("Intercepted YouTube API call:", url);
          
          return originalFetch.apply(this, args).then(response => {
            // Clone the response so we can read it
            const clonedResponse = response.clone();
            clonedResponse.json().then(data => {
              console.log("YouTube API response received");
              // Extract video IDs from the response
              extractVideoIdsFromAPIResponse(data);
            }).catch(() => {});
            return response;
          });
        }
        return originalFetch.apply(this, args);
      };

      // Also intercept XMLHttpRequest
      const originalXHROpen = XMLHttpRequest.prototype.open;
      const originalXHRSend = XMLHttpRequest.prototype.send;
      
      XMLHttpRequest.prototype.open = function(method, url, ...rest) {
        this._url = url;
        return originalXHROpen.apply(this, [method, url, ...rest]);
      };
      
      XMLHttpRequest.prototype.send = function(...args) {
        if (this._url && typeof this._url === 'string' && 
            this._url.includes('youtube.com/youtubei/v1/') && 
            (this._url.includes('reel') || this._url.includes('browse') || this._url.includes('next'))) {
          console.log("Intercepted XHR call:", this._url);
          
          this.addEventListener('load', function() {
            try {
              const data = JSON.parse(this.responseText);
              console.log("YouTube XHR response received");
              extractVideoIdsFromAPIResponse(data);
            } catch (e) {}
          });
        }
        return originalXHRSend.apply(this, args);
      };
    }

    // Find continuation tokens in YouTube's data
    function findAndUseContinuationToken() {
      try {
        if (window.ytInitialData) {
          function findContinuation(obj, depth = 0) {
            if (depth > 20) return null;
            if (!obj || typeof obj !== 'object') return null;
            
            if (obj.continuationEndpoint?.continuationCommand?.token) {
              return obj.continuationEndpoint.continuationCommand.token;
            }
            
            if (obj.continuationToken) {
              return obj.continuationToken;
            }
            
            if (Array.isArray(obj)) {
              for (const item of obj) {
                const token = findContinuation(item, depth + 1);
                if (token) return token;
              }
            } else {
              for (const key in obj) {
                if (typeof obj[key] === 'object') {
                  const token = findContinuation(obj[key], depth + 1);
                  if (token) return token;
                }
              }
            }
            return null;
          }
          
          const token = findContinuation(window.ytInitialData);
          if (token) {
            console.log("Found continuation token:", token.substring(0, 50) + "...");
            // Token found - YouTube uses this to fetch more videos
          }
        }
      } catch (e) {
        console.warn("Error finding continuation token:", e);
      }
    }
  
    // ---------- UI Injection ----------
    function injectUI() {
      // Check if already injected
      if (document.getElementById("ytss-root")) {
        console.warn("UI already injected, skipping");
        return document.getElementById("ytss-root");
      }

      console.log("Injecting UI...");
      const root = document.createElement("div");
      root.id = "ytss-root";
      root.innerHTML = `
        <div id="ytss-panel">
          <div id="ytss-tabs">
            <button class="ytss-tab ytss-tab-active" data-tab="collector">Collector</button>
            <button class="ytss-tab" data-tab="settings">Settings</button>
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
                <span>Buffered: </span><b id="ytss-count">0</b><span>/</span><b id="ytss-target">${CONFIG.targetCount}</b>
              </div>
              <div id="ytss-debug" style="font-size: 10px; color: #888; margin: 4px 0; min-height: 20px; padding: 4px; background: rgba(0,0,0,0.2); border-radius: 4px;">
                Debug: Initializing...
              </div>
              <textarea id="ytss-log" readonly placeholder="Next URLs will appear here..."></textarea>
              <div class="ytss-note" style="margin-top:8px;">
                After 10 second pause, extension will automatically scroll to collect next 20 URLs, then return to your current video. This repeats automatically.
              </div>
            </div>
  
            <div class="ytss-view ytss-hidden" data-view="settings">
              <div class="ytss-field">
                <label>Collection pause (ms)</label>
                <input id="ytss-collectionPause" type="number" min="5000" step="1000" value="${CONFIG.collectionPauseMs}"/>
              </div>
              <div class="ytss-field">
                <label>Scroll delay (ms)</label>
                <input id="ytss-scrollDelay" type="number" min="200" step="50" value="${CONFIG.scrollDelayMs}"/>
              </div>
              <div class="ytss-field">
                <label>Scroll back delay (ms)</label>
                <input id="ytss-scrollBackDelay" type="number" min="50" step="50" value="${CONFIG.scrollBackDelayMs}"/>
              </div>
              <div class="ytss-note">
                Collection pause: time before auto-scroll starts. Scroll delays control speed of collection.
              </div>
            </div>
  
            <div class="ytss-view ytss-hidden" data-view="export">
              <button id="ytss-copy">Copy URLs</button>
              <button id="ytss-clear">Clear (UI only)</button>
              <div class="ytss-note">Copy copies the buffer shown. Clear only clears this textbox.</div>
            </div>
          </div>
        </div>
      `;
      
      try {
      document.documentElement.appendChild(root);
        console.log("UI injected successfully");
        
        // Verify it's visible
        setTimeout(() => {
          const panel = document.getElementById("ytss-panel");
          if (panel) {
            const rect = panel.getBoundingClientRect();
            console.log("UI panel position:", { 
              visible: rect.width > 0 && rect.height > 0,
              top: rect.top,
              right: rect.right,
              width: rect.width,
              height: rect.height
            });
          } else {
            console.error("UI panel not found after injection!");
          }
        }, 100);
      } catch (e) {
        console.error("Failed to inject UI:", e);
      }
  
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
      target: ui.querySelector("#ytss-target"),
      log: ui.querySelector("#ytss-log"),
      debug: ui.querySelector("#ytss-debug"),
      collectionPause: ui.querySelector("#ytss-collectionPause"),
      scrollDelay: ui.querySelector("#ytss-scrollDelay"),
      scrollBackDelay: ui.querySelector("#ytss-scrollBackDelay"),
      copy: ui.querySelector("#ytss-copy"),
      clear: ui.querySelector("#ytss-clear")
    };
  
    // Verify all elements were found
    console.log("UI elements found:", {
      start: !!els.start,
      stop: !!els.stop,
      status: !!els.status,
      count: !!els.count,
      log: !!els.log,
      debug: !!els.debug
    });
  
    // ---------- State ----------
    let lastViewerHref = location.href;
    let queue = []; // Local queue cache
  
    // ---------- UI helpers ----------
    function setStatus(s) {
      els.status.textContent = s;
    }
  
    function renderQueue(queueArray) {
      // Keep local queue for reference
      queue = queueArray;
      
      // Add new URLs from background to persistent log (append, don't replace)
      let addedNew = false;
      for (const url of queueArray) {
        if (!allCollectedUrlsPersistent.includes(url)) {
          allCollectedUrlsPersistent.push(url);
          addedNew = true;
          console.log(`[YTSS] Added to persistent log: ${url}`);
        }
      }
      
      // Always display the persistent log (all URLs ever collected)
      if (els.log) {
        els.log.value = allCollectedUrlsPersistent.join("\n");
      els.log.scrollTop = els.log.scrollHeight;
      }
      
      // Show total collected count
      els.count.textContent = String(allCollectedUrlsPersistent.length);
      
      if (addedNew) {
        console.log(`[YTSS] Persistent log now has ${allCollectedUrlsPersistent.length} URLs`);
      }
    }

    // Debug update function
    function updateDebug(msg) {
      if (els.debug) {
        const time = new Date().toLocaleTimeString();
        els.debug.textContent = `[${time}] ${msg}`;
        console.log("DEBUG:", msg);
      } else {
        console.warn("Debug element not found:", msg);
      }
    }
  
    // ---------- Extract Upcoming Videos from YouTube's Queue ----------
    function extractUpcomingVideosFromQueue() {
      const urls = new Set();
      const currentUrl = location.href;
      const currentMatch = currentUrl.match(/\/shorts\/([^\/\?]+)/);
      const currentVideoId = currentMatch ? currentMatch[1] : null;
      
      console.log("=== Extracting upcoming videos from YouTube's queue ===");
      console.log("Current video ID:", currentVideoId);
      
      // Method 1: Access YouTube's reel player queue directly
      try {
        // YouTube stores reel queue in various places
        const player = document.querySelector('ytd-reel-video-renderer');
        if (player) {
          // Try to access internal properties
          const playerData = player.__data || player.data || player._data;
          if (playerData) {
            console.log("Found player data:", playerData);
            // Look for queue or playlist
            if (playerData.queue) {
              console.log("Found queue with", playerData.queue.length, "items");
              playerData.queue.forEach((item, idx) => {
                const videoId = item.videoId || item.id;
                if (videoId && isValidYouTubeVideoId(videoId) && videoId !== currentVideoId) {
                  urls.add(`https://www.youtube.com/shorts/${videoId}`);
                  console.log(`Queue item ${idx}: ${videoId}`);
                }
              });
            }
          }
        }
      } catch (e) {
        console.warn("Error accessing player queue:", e);
      }
      
      // Method 2: Look for YouTube's global player state
      try {
        // YouTube might store queue in window.ytplayer or similar
        if (window.ytplayer && window.ytplayer.config) {
          const config = window.ytplayer.config;
          console.log("Found ytplayer config");
          // Check for args which might contain queue info
          if (config.args && config.args.player_response) {
            const playerResponse = typeof config.args.player_response === 'string' 
              ? JSON.parse(config.args.player_response)
              : config.args.player_response;
            // Look for playlist or queue in player response
            if (playerResponse.playabilityStatus) {
              console.log("Found player response");
            }
          }
        }
      } catch (e) {
        console.warn("Error accessing ytplayer:", e);
      }
      
      // Method 3: Look for preloaded video elements in DOM (not visible yet)
      const allVideoContainers = document.querySelectorAll('ytd-reel-video-renderer, [id*="reel"], [class*="reel-video"]');
      console.log(`Found ${allVideoContainers.length} total video containers`);
      
      allVideoContainers.forEach((container, idx) => {
        // Check if container is visible (in viewport)
        const rect = container.getBoundingClientRect();
        const isVisible = rect.top < window.innerHeight && rect.bottom > 0;
        
        // Get video ID from container
        let videoId = null;
        
        // Try various methods to get video ID
        videoId = container.getAttribute('video-id') ||
                  container.getAttribute('data-video-id') ||
                  container.dataset.videoId;
        
        // Validate if we got one from attributes
        if (videoId && !isValidYouTubeVideoId(videoId)) {
          videoId = null;
        }
        
        // Also check for link inside
        const link = container.querySelector('a[href^="/shorts/"]');
        if (link) {
          const href = link.getAttribute('href');
          const match = href.match(/\/shorts\/([^\/\?]+)/);
          if (match && isValidYouTubeVideoId(match[1])) {
            videoId = match[1];
          }
        }
        
        // Check container's internal data
        try {
          const containerData = container.__data || container.data || container._data;
          if (containerData && containerData.videoId && isValidYouTubeVideoId(containerData.videoId)) {
            videoId = containerData.videoId;
          }
        } catch (e) {}
        
        if (videoId && isValidYouTubeVideoId(videoId) && videoId !== currentVideoId) {
          const url = `https://www.youtube.com/shorts/${videoId}`;
          urls.add(url);
          console.log(`Container ${idx} (visible: ${isVisible}): ${videoId}`);
        }
      });
      
      // Method 4: Look for feed continuation data in ytInitialData
      try {
        if (window.ytInitialData) {
          // Look for reel shelf renderer or continuation items
          const findReelQueue = (obj, depth = 0, path = '') => {
            if (depth > 20) return;
            if (!obj || typeof obj !== 'object') return;
            
            if (Array.isArray(obj)) {
              obj.forEach((item, idx) => findReelQueue(item, depth + 1, `${path}[${idx}]`));
              return;
            }
            
            // Look for reel shelf renderer (contains queue of reels)
            if (obj.reelShelfRenderer || obj.reelItemRenderer) {
              console.log(`Found reel renderer at ${path}`);
              const items = obj.reelShelfRenderer?.items || obj.reelItemRenderer ? [obj] : [];
              items.forEach((item, idx) => {
                const videoId = item.videoId || 
                              item.navigationEndpoint?.watchEndpoint?.videoId ||
                              item.reelItemRenderer?.videoId;
                if (videoId && isValidYouTubeVideoId(videoId) && videoId !== currentVideoId) {
                  urls.add(`https://www.youtube.com/shorts/${videoId}`);
                  console.log(`Reel item ${idx}: ${videoId}`);
                }
              });
            }
            
            // Look for continuation items (upcoming videos)
            if (obj.continuationItemRenderer) {
              console.log(`Found continuation at ${path}`);
              // Continuation might have preloaded items
            }
            
            for (const key in obj) {
              if (typeof obj[key] === 'object') {
                findReelQueue(obj[key], depth + 1, path ? `${path}.${key}` : key);
              }
            }
          };
          
          findReelQueue(window.ytInitialData);
        }
      } catch (e) {
        console.warn("Error finding reel queue:", e);
      }
      
      // Method 5: Look for YouTube's internal state object
      try {
        // YouTube might store state in window.__ytRIL__ or similar
        const possibleStateObjects = ['__ytRIL__', 'ytInitialData', 'ytInitialPlayerResponse', 'ytplayer'];
        possibleStateObjects.forEach(objName => {
          if (window[objName]) {
            console.log(`Checking ${objName} for queue data`);
            // Try to find queue/playlist in these objects
          }
        });
      } catch (e) {}
      
      // Filter out current video and limit to next 8
      const result = Array.from(urls).filter(url => {
        const match = url.match(/\/shorts\/([^\/]+)/);
        return match && match[1] !== currentVideoId;
      });
      
      // Sort and limit to next 8
      const limited = result.slice(0, 8);
      console.log(`=== Found ${limited.length} upcoming videos (out of ${result.length} total) ===`);
      return limited;
    }

    // ---------- DOM URL Extraction ----------
    function extractShortsUrlsFromDOM() {
      // First, try to get upcoming videos from queue (priority)
      const upcomingUrls = extractUpcomingVideosFromQueue();
      const urls = new Set(upcomingUrls);
      
      // Debug: Log what we're finding
      console.log("=== Starting DOM extraction ===");
      
      // Method 1: Look for links in the DOM
      const links = document.querySelectorAll('a[href^="/shorts/"]');
      console.log(`Found ${links.length} links with /shorts/`);
      links.forEach((link, idx) => {
        const href = link.getAttribute('href');
        console.log(`Link ${idx}: ${href}`);
        if (href && href !== '/shorts/' && href !== '/shorts') {
          try {
            const fullUrl = new URL(href, window.location.origin).toString();
            const canonical = canonicalShortsUrl(fullUrl);
            if (/^https:\/\/www\.youtube\.com\/shorts\/[^\/]+$/.test(canonical)) {
              const urlMatch = canonical.match(/\/shorts\/([^\/\?]+)/);
              if (urlMatch && isValidYouTubeVideoId(urlMatch[1])) {
                urls.add(canonical);
                console.log(`Added URL from link: ${canonical}`);
              }
            }
          } catch (e) {
            console.warn("Error processing link:", e);
          }
        }
      });

      // Method 2: Look for current video ID (already handled in extractUpcomingVideosFromQueue)
      // Skip adding current video - we only want upcoming videos

      // Method 3: Look in YouTube's internal data structures
      try {
        console.log("Checking ytInitialData:", !!window.ytInitialData);
        console.log("Checking ytInitialPlayerResponse:", !!window.ytInitialPlayerResponse);
        
        if (window.ytInitialData) {
          const extractFromData = (obj, depth = 0, path = '') => {
            if (depth > 15) return; // Prevent infinite recursion
            if (!obj || typeof obj !== 'object') return;
            if (Array.isArray(obj)) {
              obj.forEach((item, idx) => extractFromData(item, depth + 1, `${path}[${idx}]`));
              return;
            }
            for (const key in obj) {
              const currentPath = path ? `${path}.${key}` : key;
              if (key === 'videoId' && obj[key] && typeof obj[key] === 'string' && isValidYouTubeVideoId(obj[key])) {
                const url = `https://www.youtube.com/shorts/${obj[key]}`;
                urls.add(url);
                console.log(`Found videoId in ${currentPath}: ${obj[key]}`);
              }
              if (key === 'navigationEndpoint' && obj[key]?.watchEndpoint?.videoId) {
                const videoId = obj[key].watchEndpoint.videoId;
                if (isValidYouTubeVideoId(videoId)) {
                  const url = `https://www.youtube.com/shorts/${videoId}`;
                  urls.add(url);
                  console.log(`Found navigationEndpoint in ${currentPath}: ${videoId}`);
                }
              }
              if (key === 'watchEndpoint' && obj[key]?.videoId) {
                const videoId = obj[key].videoId;
                if (isValidYouTubeVideoId(videoId)) {
                  const url = `https://www.youtube.com/shorts/${videoId}`;
                  urls.add(url);
                  console.log(`Found watchEndpoint in ${currentPath}: ${videoId}`);
                }
              }
              // Look for items array (common in YouTube feeds)
              if (key === 'items' && Array.isArray(obj[key])) {
                console.log(`Found items array in ${currentPath} with ${obj[key].length} items`);
                obj[key].forEach((item, idx) => extractFromData(item, depth + 1, `${currentPath}[${idx}]`));
              }
              // Look for contents array
              if (key === 'contents' && Array.isArray(obj[key])) {
                console.log(`Found contents array in ${currentPath} with ${obj[key].length} items`);
                obj[key].forEach((item, idx) => extractFromData(item, depth + 1, `${currentPath}[${idx}]`));
              }
              if (typeof obj[key] === 'object') {
                extractFromData(obj[key], depth + 1, currentPath);
              }
            }
          };
          extractFromData(window.ytInitialData);
        }

        if (window.ytInitialPlayerResponse) {
          const extractFromData = (obj, depth = 0) => {
            if (depth > 15) return;
            if (!obj || typeof obj !== 'object') return;
            if (Array.isArray(obj)) {
              obj.forEach(item => extractFromData(item, depth + 1));
              return;
            }
            for (const key in obj) {
              if (key === 'videoId' && obj[key] && typeof obj[key] === 'string' && isValidYouTubeVideoId(obj[key])) {
                const url = `https://www.youtube.com/shorts/${obj[key]}`;
                urls.add(url);
                console.log(`Found videoId in ytInitialPlayerResponse: ${obj[key]}`);
              }
              if (typeof obj[key] === 'object') {
                extractFromData(obj[key], depth + 1);
              }
            }
          };
          extractFromData(window.ytInitialPlayerResponse);
        }
      } catch (e) {
        console.warn("Error extracting from YouTube data:", e);
      }

      // Method 4: Look for video elements and their data
      const videoElements = document.querySelectorAll('video, ytd-reel-video-renderer, ytd-shorts, [class*="reel"], [class*="shorts"]');
      console.log(`Found ${videoElements.length} video-related elements`);
      videoElements.forEach((video, idx) => {
        const link = video.closest('a[href^="/shorts/"]');
        if (link) {
          const href = link.getAttribute('href');
          if (href && href !== '/shorts/' && href !== '/shorts') {
            try {
              const fullUrl = new URL(href, window.location.origin).toString();
              const canonical = canonicalShortsUrl(fullUrl);
              if (/^https:\/\/www\.youtube\.com\/shorts\/[^\/]+$/.test(canonical)) {
                const urlMatch = canonical.match(/\/shorts\/([^\/\?]+)/);
                if (urlMatch && isValidYouTubeVideoId(urlMatch[1])) {
                  urls.add(canonical);
                  console.log(`Added URL from video element ${idx}: ${canonical}`);
                }
              }
            } catch (e) {}
          }
        }
        // Also check for data attributes
        const videoId = video.getAttribute('data-video-id') || 
                       video.getAttribute('video-id') ||
                       video.dataset.videoId;
        if (videoId && isValidYouTubeVideoId(videoId)) {
          const url = `https://www.youtube.com/shorts/${videoId}`;
          urls.add(url);
          console.log(`Found videoId in element ${idx}: ${videoId}`);
        }
      });

      // Method 5: Try to find next video buttons/links
      const nextButtons = document.querySelectorAll('[aria-label*="next"], [aria-label*="Next"], [title*="next"], [title*="Next"]');
      console.log(`Found ${nextButtons.length} next buttons`);
      nextButtons.forEach(btn => {
        const link = btn.closest('a[href^="/shorts/"]') || btn.querySelector('a[href^="/shorts/"]');
        if (link) {
          const href = link.getAttribute('href');
          if (href && href !== '/shorts/' && href !== '/shorts') {
            try {
              const fullUrl = new URL(href, window.location.origin).toString();
              const canonical = canonicalShortsUrl(fullUrl);
              if (/^https:\/\/www\.youtube\.com\/shorts\/[^\/]+$/.test(canonical)) {
                const urlMatch = canonical.match(/\/shorts\/([^\/\?]+)/);
                if (urlMatch && isValidYouTubeVideoId(urlMatch[1])) {
                  urls.add(canonical);
                  console.log(`Added URL from next button: ${canonical}`);
                }
              }
            } catch (e) {}
          }
        }
      });

      // Method 6: Look in shadow DOM (YouTube uses shadow DOM)
      function extractFromShadowDOM(root) {
        try {
          const links = root.querySelectorAll('a[href^="/shorts/"]');
          links.forEach(link => {
            const href = link.getAttribute('href');
            if (href && href !== '/shorts/' && href !== '/shorts') {
              try {
                const fullUrl = new URL(href, window.location.origin).toString();
                const canonical = canonicalShortsUrl(fullUrl);
                if (/^https:\/\/www\.youtube\.com\/shorts\/[^\/]+$/.test(canonical)) {
                  const urlMatch = canonical.match(/\/shorts\/([^\/\?]+)/);
                  if (urlMatch && isValidYouTubeVideoId(urlMatch[1])) {
                    urls.add(canonical);
                  }
                }
              } catch (e) {}
            }
          });
          
          // Recursively check shadow roots
          const elements = root.querySelectorAll('*');
          elements.forEach(el => {
            if (el.shadowRoot) {
              extractFromShadowDOM(el.shadowRoot);
            }
          });
        } catch (e) {
          // Shadow DOM access might fail
        }
      }
      
      try {
        extractFromShadowDOM(document);
      } catch (e) {
        console.warn("Error accessing shadow DOM:", e);
      }

      // Add fallback methods if we didn't get enough from queue
      if (urls.size < 8) {
        console.log(`Only found ${urls.size} from queue, trying fallback methods...`);
        
        // Fallback: Look for links in the DOM
        const links = document.querySelectorAll('a[href^="/shorts/"]');
        links.forEach(link => {
          const href = link.getAttribute('href');
          if (href && href !== '/shorts/' && href !== '/shorts') {
            try {
              const fullUrl = new URL(href, window.location.origin).toString();
              const canonical = canonicalShortsUrl(fullUrl);
              if (/^https:\/\/www\.youtube\.com\/shorts\/[^\/]+$/.test(canonical)) {
                const urlMatch = canonical.match(/\/shorts\/([^\/\?]+)/);
                if (urlMatch && isValidYouTubeVideoId(urlMatch[1])) {
                  urls.add(canonical);
                }
              }
            } catch (e) {}
          }
        });
      }
      
      const result = Array.from(urls);
      console.log(`=== Extraction complete: Found ${result.length} unique URLs ===`);
      // Limit to 8 upcoming videos (excluding current)
      const currentUrlMatch = location.href.match(/\/shorts\/([^\/\?]+)/);
      const currentVideoId = currentUrlMatch ? currentUrlMatch[1] : null;
      const filtered = result.filter(url => {
        const match = url.match(/\/shorts\/([^\/]+)/);
        return match && match[1] !== currentVideoId;
      });
      return filtered.slice(0, 8);
    }

    // ---------- Automatic Scroll Collection ----------
    let collectionRunning = false;
    let originalVideoUrl = null;
    let scrollCount = 0;
    let collectedInThisCycle = 0;
    const collectedUrls = new Set();
    const allCollectedUrlsPersistent = []; // PERSISTENT - never cleared, all URLs ever collected
    const collectedUrlsInCycle = []; // Track URLs collected in THIS cycle in order

    // Function to focus player so arrow keys work
    async function focusPlayer() {
      console.log("[YTSS] Attempting to focus player...");
      
      // Try multiple selectors
      const selectors = [
        'ytd-shorts video',
        'ytd-reel-video-renderer',
        '#player',
        'video',
        'ytd-shorts',
        '[id*="player"]'
      ];
      
      let focused = false;
      for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (element) {
          try {
            element.focus();
            element.click();
            // Also try focusing parent
            if (element.parentElement) {
              element.parentElement.focus();
            }
            console.log(`[YTSS] Focused: ${selector}`);
            focused = true;
          } catch (e) {
            console.log(`[YTSS] Failed to focus ${selector}:`, e);
          }
        }
      }
      
      if (!focused) {
        // Last resort: click body
        try {
          document.body.focus();
          document.body.click();
          console.log("[YTSS] Clicked body as fallback");
        } catch (e) {
          console.log("[YTSS] Failed to click body:", e);
        }
      }
      
      await sleep(300); // Give more time for focus to take effect
    }

    // Function to scroll and collect URLs
    async function scrollAndCollect() {
      if (!isCollecting || !collectionRunning) {
        console.log("[YTSS] Collection stopped, aborting scrollAndCollect");
        return;
      }
      
      const currentUrl = location.href;
      const match = currentUrl.match(/\/shorts\/([^\/\?]+)/);
      
      console.log(`[YTSS] scrollAndCollect: currentUrl=${currentUrl}, scrollCount=${scrollCount}, collectedInCycle=${collectedInThisCycle}`);
      
      if (match) {
        const videoId = match[1];
        if (isValidYouTubeVideoId(videoId)) {
          const url = `https://www.youtube.com/shorts/${videoId}`;
          const canonicalUrl = canonicalShortsUrl(url);
          
          // Only add if it's not the original video and we haven't collected it in this cycle
          const originalCanonical = canonicalShortsUrl(originalVideoUrl);
          if (canonicalUrl !== originalCanonical && !collectedUrls.has(canonicalUrl)) {
            collectedUrls.add(canonicalUrl);
            collectedInThisCycle++;
            
            // Track this URL in the cycle order
            collectedUrlsInCycle.push(canonicalUrl);
            console.log(`[YTSS] Cycle order: ${collectedUrlsInCycle.length}/20 - ${canonicalUrl}`);
            
            // Add to persistent log immediately (before sending to background)
            if (!allCollectedUrlsPersistent.includes(canonicalUrl)) {
              allCollectedUrlsPersistent.push(canonicalUrl);
              console.log(`[YTSS] Added to persistent log immediately. Total: ${allCollectedUrlsPersistent.length}`);
              
              // Update UI immediately
              if (els.log) {
                els.log.value = allCollectedUrlsPersistent.join("\n");
                els.log.scrollTop = els.log.scrollHeight;
              }
              if (els.count) {
                els.count.textContent = String(allCollectedUrlsPersistent.length);
              }
            }
            
            console.log(`[YTSS] Collected new URL: ${canonicalUrl}`);
            
            // Save URL to background script - ensure it's saved
            chrome.runtime.sendMessage({ type: "FOUND_URL", url: canonicalUrl }, (res) => {
              if (chrome.runtime.lastError) {
                console.error("[YTSS] Error sending URL:", chrome.runtime.lastError);
                updateDebug(`Error saving URL: ${chrome.runtime.lastError.message}`);
              } else if (res && res.ok) {
                updateDebug(`Collected ${collectedInThisCycle}/20: ${canonicalUrl.substring(0, 50)}...`);
              }
            });
          } else {
            console.log(`[YTSS] URL already collected or is original: ${canonicalUrl}`);
          }
        }
      }
      
      // Handle preloading glitch: when we reach 8th video, go back to 7th, then forward
      if (collectedInThisCycle > 0 && collectedInThisCycle % 8 === 0) {
        console.log(`[YTSS] Reached ${collectedInThisCycle} videos (8th in batch), handling preload...`);
        updateDebug(`Reached ${collectedInThisCycle} videos, handling preload...`);
        
        // Scroll back to previous video (7th)
        await focusPlayer();
        dispatchKey("ArrowUp");
        await sleep(500); // Wait for navigation
        
        // Then scroll forward again (back to 8th)
        await focusPlayer();
        dispatchKey("ArrowDown");
        await sleep(500); // Wait for navigation and preloading
        
        console.log(`[YTSS] Preload handled, continuing...`);
      }
      
      // If we've collected 20, scroll back up
      if (collectedInThisCycle >= 20) {
        updateDebug(`Collected 20 URLs! Scrolling back to start of this batch...`);
        collectionRunning = false;
        
        // Get the first URL we collected in this cycle (for verification)
        const firstCollectedUrl = collectedUrlsInCycle.length > 0 ? collectedUrlsInCycle[0] : null;
        console.log(`[YTSS] First URL collected in this cycle: ${firstCollectedUrl}`);
        console.log(`[YTSS] All URLs in cycle order:`, collectedUrlsInCycle);
        
        // Store the first video of the NEXT batch (current position after collecting 20)
        const nextBatchStartUrl = canonicalShortsUrl(location.href);
        console.log(`[YTSS] Next batch will start from: ${nextBatchStartUrl}`);
        
        // Scroll back to the start of THIS batch (exactly 20 scrolls)
        await scrollBackToStart(firstCollectedUrl);
        
        // Update originalVideoUrl to be the first video of the NEXT batch
        // This way, when we start the next cycle, we'll scroll forward to it first
        originalVideoUrl = nextBatchStartUrl;
        console.log(`[YTSS] Updated originalVideoUrl for next cycle: ${originalVideoUrl}`);
        
        // Reset and repeat (but keep allCollectedUrlsPersistent persistent)
        collectedInThisCycle = 0;
        collectedUrls.clear(); // Clear only the cycle tracking Set
        collectedUrlsInCycle.length = 0; // Clear the cycle order array
        // allCollectedUrlsPersistent is NOT cleared - it persists across cycles
        setTimeout(() => {
          startCollectionCycle();
        }, 2000); // Wait 2 seconds before next cycle
        return;
      }
      
      // Otherwise, scroll down to next video
      scrollCount++;
      console.log(`[YTSS] Scrolling down (attempt ${scrollCount})...`);
      
      // Re-focus before each scroll
      await focusPlayer();
      
      const scrollDelay = Number(els.scrollDelay?.value) || CONFIG.scrollDelayMs;
      const currentUrlBeforeScroll = canonicalShortsUrl(location.href);
      
      dispatchKey("ArrowDown");
      
      // Wait and check multiple times - YouTube might need time to navigate
      let urlChanged = false;
      let attempts = 0;
      const maxCheckAttempts = 5;
      
      while (!urlChanged && attempts < maxCheckAttempts) {
        await sleep(scrollDelay + (attempts * 100)); // Increasing delay each check
        const newUrl = canonicalShortsUrl(location.href);
        
        if (newUrl !== currentUrlBeforeScroll) {
          urlChanged = true;
          console.log(`[YTSS] URL changed! ${currentUrlBeforeScroll} -> ${newUrl}`);
          break;
        }
        attempts++;
      }
      
      if (!urlChanged) {
        // Final check with longer delay
        await sleep(scrollDelay * 2);
        const finalUrl = canonicalShortsUrl(location.href);
        if (finalUrl !== currentUrlBeforeScroll) {
          urlChanged = true;
          console.log(`[YTSS] URL changed on final check: ${finalUrl}`);
        } else {
          // Only log warning, don't show in UI unless it's a real problem
          console.log(`[YTSS] URL did not change after scroll attempt ${scrollCount} (checked ${maxCheckAttempts + 1} times)`);
          // Don't show warning in UI - might just be slow
        }
      }
      
      // Continue collecting regardless
      setTimeout(() => scrollAndCollect(), scrollDelay);
    }

    // Function to scroll back to the original video
    async function scrollBackToStart(firstCollectedUrl = null) {
      updateDebug("Scrolling back to original video...");
      
      // Use first collected URL if provided, otherwise use originalVideoUrl
      const targetUrl = firstCollectedUrl 
        ? canonicalShortsUrl(firstCollectedUrl) 
        : canonicalShortsUrl(originalVideoUrl);
      
      console.log(`[YTSS] Scrolling back to: ${targetUrl}`);
      console.log(`[YTSS] First collected URL in cycle: ${firstCollectedUrl || 'not provided'}`);
      
      // Focus player first
      await focusPlayer();
      
      console.log(`[YTSS] Starting position: ${canonicalShortsUrl(location.href)}`);
      console.log(`[YTSS] Will scroll up exactly 20 times`);
      
      // Scroll up exactly 20 times (one for each video we collected)
      for (let i = 0; i < 20; i++) {
        const urlBeforeScroll = canonicalShortsUrl(location.href);
        
        dispatchKey("ArrowUp");
        
        // Wait for URL to actually change (no fixed timer)
        let urlChanged = false;
        let waitAttempts = 0;
        const maxWaitAttempts = 50; // Max 5 seconds (50 * 100ms)
        
        while (!urlChanged && waitAttempts < maxWaitAttempts) {
          await sleep(100); // Small check interval
          const currentCanonical = canonicalShortsUrl(location.href);
          
          if (currentCanonical !== urlBeforeScroll) {
            urlChanged = true;
            console.log(`[YTSS] Scroll up ${i + 1}/20: ${currentCanonical} (URL changed)`);
            break;
          }
          
          waitAttempts++;
        }
        
        if (!urlChanged) {
          console.log(`[YTSS] Scroll up ${i + 1}/20: URL did not change after ${maxWaitAttempts * 100}ms, continuing anyway`);
        }
        
        // Small check to see if we're making progress
        if (i > 0 && i % 5 === 0) {
          updateDebug(`Scrolling back... ${i + 1}/20`);
        }
      }
      
      // After exactly 20 scrolls, check if we're at the target
      const finalCanonical = canonicalShortsUrl(location.href);
      console.log(`[YTSS] After 20 scrolls, final URL: ${finalCanonical}`);
      console.log(`[YTSS] Target URL (first collected): ${targetUrl}`);
      
      if (finalCanonical === targetUrl) {
        updateDebug("Successfully returned to first collected URL! ✓");
        console.log(`[YTSS] Perfect match after exactly 20 scrolls!`);
        return true; // Success
      } else {
        updateDebug(`Warning: After 20 scrolls, URL mismatch. Expected: ${targetUrl.substring(0, 50)}..., Got: ${finalCanonical.substring(0, 50)}...`);
        console.log(`[YTSS] URL mismatch! Expected: ${targetUrl}, Got: ${finalCanonical}`);
        
        // Try a few more scrolls if we're close but not exact
        let attempts = 0;
        const maxAdditionalAttempts = 5;
        while (finalCanonical !== targetUrl && attempts < maxAdditionalAttempts) {
          const urlBefore = canonicalShortsUrl(location.href);
          dispatchKey("ArrowUp");
          
          // Wait for URL to change
          let urlChanged = false;
          let waitAttempts = 0;
          while (!urlChanged && waitAttempts < 20) {
            await sleep(100);
            const newCanonical = canonicalShortsUrl(location.href);
            if (newCanonical !== urlBefore) {
              urlChanged = true;
              console.log(`[YTSS] Additional scroll ${attempts + 1}: ${newCanonical}`);
              if (newCanonical === targetUrl) {
                updateDebug(`Found target after ${attempts + 1} additional scrolls!`);
                console.log(`[YTSS] Found target after ${attempts + 1} additional scrolls`);
                return true; // Success
              }
            }
            waitAttempts++;
          }
          attempts++;
        }
        
        if (attempts >= maxAdditionalAttempts) {
          console.log(`[YTSS] Could not find exact match after 20 + ${maxAdditionalAttempts} scrolls`);
          updateDebug(`Failed to match first collected URL after 20 scrolls`);
          return false; // Failed
        }
      }
    }

    // Main collection cycle
    async function startCollectionCycle() {
      if (!isCollecting) return;
      
      // Check if we need to scroll forward to the first video of this batch
      const currentCanonical = canonicalShortsUrl(location.href);
      const targetCanonical = originalVideoUrl ? canonicalShortsUrl(originalVideoUrl) : null;
      
      // If we're not at the target (first video of this batch), scroll forward to it
      if (targetCanonical && currentCanonical !== targetCanonical) {
        console.log(`[YTSS] Not at batch start. Current: ${currentCanonical}, Target: ${targetCanonical}`);
        updateDebug(`Scrolling forward to start of next batch...`);
        
        await focusPlayer();
        
        // Scroll forward until we reach the target
        let attempts = 0;
        const maxAttempts = 30;
        while (canonicalShortsUrl(location.href) !== targetCanonical && attempts < maxAttempts) {
          dispatchKey("ArrowDown");
          await sleep(300);
          attempts++;
          
          if (canonicalShortsUrl(location.href) === targetCanonical) {
            console.log(`[YTSS] Reached batch start after ${attempts} scrolls`);
            break;
          }
        }
        
        if (attempts >= maxAttempts) {
          console.log(`[YTSS] Could not reach batch start, using current position`);
          // Use current position as the new batch start
          originalVideoUrl = currentCanonical;
        } else {
          originalVideoUrl = targetCanonical;
        }
      } else {
        // First cycle or already at the right position - set originalVideoUrl to current
        originalVideoUrl = currentCanonical;
      }
      
      scrollCount = 0;
      collectedInThisCycle = 0;
      collectionRunning = true;
      
      console.log(`[YTSS] Starting collection cycle from: ${originalVideoUrl}`);
      
      const pauseTime = Number(els.collectionPause?.value) || CONFIG.collectionPauseMs;
      const pauseSeconds = Math.round(pauseTime / 1000);
      updateDebug(`Starting collection cycle... (${pauseSeconds} second pause)`);
      
      // Pause with countdown
      for (let i = pauseSeconds; i > 0; i--) {
        if (!isCollecting) return;
        updateDebug(`Starting in ${i} seconds...`);
        await sleep(1000);
      }
      
      if (!isCollecting) return;
      
      updateDebug("Starting automatic scroll collection...");
      
      // Focus player so arrow keys work
      await focusPlayer();
      
      // Start scrolling and collecting
      await scrollAndCollect();
    }

    function startUrlCollection() {
      if (isCollecting) return; // Already collecting
      
      updateDebug("Collection will start in 10 seconds...");
      isCollecting = true;
      collectedUrls.clear();
      
      // Start the collection cycle
      startCollectionCycle();
    }

    function stopUrlCollection() {
      isCollecting = false;
      collectionRunning = false;
      updateDebug("Collection stopped");
    }

    // MutationObserver removed - using scroll-based collection instead
  
    // ---------- Messaging ----------
    function bootstrap() {
        updateDebug("Initializing...");
        chrome.runtime.sendMessage(
          { type: "BOOTSTRAP" },
          (res) => {
            if (chrome.runtime.lastError) {
              updateDebug("ERROR: " + chrome.runtime.lastError.message);
              console.error("Bootstrap error:", chrome.runtime.lastError);
              setStatus("error");
              return;
            }
            console.log("Bootstrap response received:", res);
            if (res && Array.isArray(res.queue)) {
              renderQueue(res.queue);
              setStatus("connected (" + res.queue.length + " URLs)");
              updateDebug("Connected! Queue: " + res.queue.length);
              
              // Start collecting if we need more
              if (res.queue.length < CONFIG.targetCount) {
                startUrlCollection();
              }
            } else {
              console.warn("Bootstrap response missing queue:", res);
              setStatus("connected (no queue)");
              updateDebug("Connected but no queue in response");
            }
          }
        );
    }
  
    // Receive queue updates (from background)
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg?.type === "QUEUE_UPDATE" && Array.isArray(msg.queue)) {
        renderQueue(msg.queue);
      }
    });
  
    // ---------- Viewer: mark watched on navigation ----------
    setInterval(() => {
      if (location.href !== lastViewerHref) {
        const prev = lastViewerHref;
        lastViewerHref = location.href;
  
        chrome.runtime.sendMessage({
          type: "WATCHED",
          url: canonicalShortsUrl(prev)
        });
      }
    }, CONFIG.viewerUrlPollMs);
  
    // ---------- Buttons ----------
    els.start.addEventListener("click", () => {
      console.log("Start button clicked");
      updateDebug("Start button clicked");
      els.start.disabled = true;
      els.stop.disabled = false;
      setStatus("collecting...");
      bootstrap();
      startUrlCollection();
    });
  
    els.stop.addEventListener("click", () => {
      els.start.disabled = false;
      els.stop.disabled = true;
      setStatus("stopped");
      stopUrlCollection();
      updateDebug("Collection stopped");
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
      // UI-only clear: doesn't clear background queue (by design)
      els.log.value = "";
      els.count.textContent = "0";
      setStatus("idle");
    });
  
    // Auto-bootstrap on load so it starts filling immediately when you open Shorts
    bootstrap();
  })();
