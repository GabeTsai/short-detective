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
      const keyCodeMap = { "ArrowDown": 40, "ArrowUp": 38 };
      const opts = {
        key, code: key,
        keyCode: keyCodeMap[key], which: keyCodeMap[key],
        bubbles: true, cancelable: true, view: window
      };
      const down = new KeyboardEvent("keydown", opts);
      const up = new KeyboardEvent("keyup", opts);
      // Dispatch to document + activeElement for broader compatibility
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

    // Focus player once so arrow keys work (no sleep, no click — instant)
    function focusPlayer() {
      const el = document.querySelector('ytd-shorts video')
              || document.querySelector('video')
              || document.body;
      try { el.focus(); } catch {}
    }

    // Collect the current URL if new
    function collectCurrentUrl() {
      const match = location.href.match(/\/shorts\/([^\/\?]+)/);
      if (!match) return;
      const videoId = match[1];
      if (!isValidYouTubeVideoId(videoId)) return;

      const canonicalUrl = `https://www.youtube.com/shorts/${videoId}`;
      const originalCanonical = canonicalShortsUrl(originalVideoUrl);
      if (canonicalUrl === originalCanonical || collectedUrls.has(canonicalUrl)) return;

      collectedUrls.add(canonicalUrl);
      collectedInThisCycle++;
      collectedUrlsInCycle.push(canonicalUrl);

      // Add to persistent log
      if (!allCollectedUrlsPersistent.includes(canonicalUrl)) {
        allCollectedUrlsPersistent.push(canonicalUrl);
        if (els.log) { els.log.value = allCollectedUrlsPersistent.join("\n"); els.log.scrollTop = els.log.scrollHeight; }
        if (els.count) { els.count.textContent = String(allCollectedUrlsPersistent.length); }
      }

      console.log(`[YTSS] ${collectedInThisCycle}/20: ${canonicalUrl}`);
      chrome.runtime.sendMessage({ type: "FOUND_URL", url: canonicalUrl }, (res) => {
        if (chrome.runtime.lastError) {
          console.error("[YTSS] Error sending URL:", chrome.runtime.lastError);
        } else if (res && res.ok) {
          updateDebug(`Collected ${collectedInThisCycle}/20: ${canonicalUrl.substring(0, 50)}...`);
        }
      });
    }

    // Wait for URL to change, polling every 50ms, max 1s
    async function waitForUrlChange(beforeUrl, maxMs = 1000) {
      const polls = Math.ceil(maxMs / 50);
      for (let i = 0; i < polls; i++) {
        await sleep(50);
        if (canonicalShortsUrl(location.href) !== beforeUrl) return true;
      }
      return false;
    }

    // Main scroll-and-collect loop (tight, focus once at the top)
    async function scrollAndCollect() {
      if (!isCollecting || !collectionRunning) return;

      // Focus once before the whole down-scroll phase
      focusPlayer();

      while (isCollecting && collectionRunning && collectedInThisCycle < 20) {
        collectCurrentUrl();

        // Handle preloading glitch at every 8th video
        if (collectedInThisCycle > 0 && collectedInThisCycle % 8 === 0) {
          console.log(`[YTSS] Preload bounce at ${collectedInThisCycle} videos`);
          updateDebug(`Preload bounce at ${collectedInThisCycle} videos...`);
          const beforeUp = canonicalShortsUrl(location.href);
          dispatchKey("ArrowUp");
          await waitForUrlChange(beforeUp, 1500);
          const beforeDown = canonicalShortsUrl(location.href);
          dispatchKey("ArrowDown");
          await waitForUrlChange(beforeDown, 1500);
        }

        // If we hit 20, break out to scroll back
        if (collectedInThisCycle >= 20) break;

        // Scroll down and wait for URL change (max 1s)
        scrollCount++;
        const before = canonicalShortsUrl(location.href);
        dispatchKey("ArrowDown");
        const changed = await waitForUrlChange(before);
        if (changed) {
          console.log(`[YTSS] ↓ ${scrollCount}: URL changed`);
        } else {
          console.log(`[YTSS] ↓ ${scrollCount}: URL didn't change after 1s`);
        }
      }

      // Collect the last URL after the loop ends
      collectCurrentUrl();

      if (collectedInThisCycle >= 20) {
        updateDebug(`Collected 20 URLs! Scrolling back...`);
        collectionRunning = false;

        const firstCollectedUrl = collectedUrlsInCycle.length > 0 ? collectedUrlsInCycle[0] : null;
        const nextBatchStartUrl = canonicalShortsUrl(location.href);
        console.log(`[YTSS] Next batch starts from: ${nextBatchStartUrl}`);

        await scrollBackToStart(firstCollectedUrl);

        originalVideoUrl = nextBatchStartUrl;
        collectedInThisCycle = 0;
        collectedUrls.clear();
        collectedUrlsInCycle.length = 0;

        setTimeout(() => startCollectionCycle(), 2000);
      }
    }

    // Scroll back up exactly 20 videos (focus once, 50ms polling)
    async function scrollBackToStart(firstCollectedUrl = null) {
      const targetUrl = firstCollectedUrl
        ? canonicalShortsUrl(firstCollectedUrl)
        : canonicalShortsUrl(originalVideoUrl);

      console.log(`[YTSS] Scrolling back to: ${targetUrl}`);
      updateDebug("Scrolling back...");

      // No focus/delay — start scrolling up immediately
      for (let i = 0; i < 20; i++) {
        const before = canonicalShortsUrl(location.href);
        dispatchKey("ArrowUp");
        const changed = await waitForUrlChange(before, 1500);
        console.log(`[YTSS] ↑ ${i + 1}/20: ${changed ? canonicalShortsUrl(location.href) : 'no change'}`);
        if (i > 0 && i % 5 === 0) updateDebug(`Scrolling back... ${i + 1}/20`);
      }

      const finalUrl = canonicalShortsUrl(location.href);
      if (finalUrl === targetUrl) {
        updateDebug("Returned to start ✓");
        console.log(`[YTSS] Perfect match after 20 scrolls!`);
        return true;
      }

      // Try up to 5 more scrolls if mismatch
      console.log(`[YTSS] Mismatch: expected ${targetUrl}, got ${finalUrl}`);
      for (let i = 0; i < 5; i++) {
        const before = canonicalShortsUrl(location.href);
        dispatchKey("ArrowUp");
        await waitForUrlChange(before, 1500);
        if (canonicalShortsUrl(location.href) === targetUrl) {
          updateDebug(`Found target after ${i + 1} extra scrolls!`);
          return true;
        }
      }

      updateDebug(`Warning: could not match start URL after 25 scrolls`);
      return false;
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
        
        focusPlayer();
        
        // Scroll forward until we reach the target
        let attempts = 0;
        const maxAttempts = 30;
        while (canonicalShortsUrl(location.href) !== targetCanonical && attempts < maxAttempts) {
          const before = canonicalShortsUrl(location.href);
          dispatchKey("ArrowDown");
          await waitForUrlChange(before, 1000);
          attempts++;
          
          if (canonicalShortsUrl(location.href) === targetCanonical) {
            console.log(`[YTSS] Reached batch start after ${attempts} scrolls`);
            break;
          }
        }
        
        if (attempts >= maxAttempts) {
          console.log(`[YTSS] Could not reach batch start, using current position`);
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
      focusPlayer();
      
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
