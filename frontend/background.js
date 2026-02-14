(function () {
  'use strict';

  const BACKEND_URL = 'http://localhost:8080';
  // Match both reel_watch_sequence and reel_item_watch
  const SHORTS_API_PATTERN = /reel\/(reel_watch_sequence|reel_item_watch)/;

  // Cache of captured URLs per tab
  const capturedUrlsByTab = new Map();

  chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
      console.log('[Short Detective BG] ✓ Extension installed');
    } else if (details.reason === 'update') {
      console.log('[Short Detective BG] ✓ Extension updated');
    }
  });

  // Log when background script starts
  console.log('[Short Detective BG] 🚀 Background script loaded');

  // ─── Auto-attach Debugger to YouTube Shorts Tabs ─────────────────────

  // Listen for tab updates - attach debugger when user navigates to Shorts
  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    // Try to attach on both loading and complete to catch different timing scenarios
    if ((changeInfo.status === 'loading' || changeInfo.status === 'complete') && tab.url?.includes('youtube.com/shorts')) {
      console.log(`[Short Detective BG] Shorts page detected (${changeInfo.status}) on tab ${tabId}, attaching debugger`);
      await attachDebuggerToTab(tabId);
    }
  });

  async function attachDebuggerToTab(tabId) {
    const target = { tabId };
    
    try {
      // Check if already attached
      try {
        await chrome.debugger.sendCommand(target, 'Network.enable');
        console.log(`[Short Detective BG] Debugger already attached to tab ${tabId}`);
        return;
      } catch (_) {
        // Not attached, continue
      }
      
      // Attach and enable network
      await chrome.debugger.attach(target, '1.3');
      await chrome.debugger.sendCommand(target, 'Network.enable');
      
      console.log(`[Short Detective BG] ✓ Debugger attached to tab ${tabId}, network enabled`);
      
      // Initialize empty set for this tab
      if (!capturedUrlsByTab.has(tabId)) {
        capturedUrlsByTab.set(tabId, new Set());
      }
      
    } catch (err) {
      console.error(`[Short Detective BG] ✗ Failed to attach debugger to tab ${tabId}:`, err);
    }
  }

  // Track which requests are shorts API requests
  const pendingShortsRequests = new Map(); // requestId -> { tabId, url }

  // Listen for network responses
  chrome.debugger.onEvent.addListener(async (source, method, params) => {
    const tabId = source.tabId;
    
    // Step 1: Mark shorts API requests when we see the response headers
    if (method === 'Network.responseReceived') {
      const url = params.response?.url || '';
      const requestId = params.requestId;
      
      // Log if it's a YouTube API call
      if (url.includes('youtube.com/youtubei/')) {
        console.log(`[Short Detective BG] 📡 YouTube API detected on tab ${tabId}:`, url.substring(0, 100));
      }
      
      if (SHORTS_API_PATTERN.test(url)) {
        console.log(`[Short Detective BG] 🎯 SHORTS API MATCH on tab ${tabId}:`, url);
        pendingShortsRequests.set(requestId, { tabId, url });
      }
    }
    
    // Step 2: Get the response body when loading is finished
    if (method === 'Network.loadingFinished') {
      const requestId = params.requestId;
      
      if (pendingShortsRequests.has(requestId)) {
        const { tabId, url } = pendingShortsRequests.get(requestId);
        pendingShortsRequests.delete(requestId);
        
        console.log(`[Short Detective BG] 📥 Loading finished for shorts API on tab ${tabId}`);
        
        try {
          const { body } = await chrome.debugger.sendCommand(
            source,
            'Network.getResponseBody',
            { requestId }
          );
          
          const data = JSON.parse(body);
          const videoIds = extractVideoIds(data);
          
          console.log(`[Short Detective BG] ✓ Extracted ${videoIds.length} videoIds from API`);
          
          // Store URLs for this tab
          if (!capturedUrlsByTab.has(tabId)) {
            capturedUrlsByTab.set(tabId, new Set());
          }
          
          const urls = capturedUrlsByTab.get(tabId);
          videoIds.forEach(id => urls.add(`https://www.youtube.com/shorts/${id}`));
          
          console.log(`[Short Detective BG] 📦 Total cached for tab ${tabId}: ${urls.size} URLs`);
          
        } catch (err) {
          console.error('[Short Detective BG] ✗ Failed to process API response:', err);
        }
      }
    }
  });

  // Clean up when debugger detaches
  chrome.debugger.onDetach.addListener((source) => {
    console.log(`[Short Detective] Debugger detached from tab ${source.tabId}`);
  });

  // Clean up when tabs close
  chrome.tabs.onRemoved.addListener((tabId) => {
    capturedUrlsByTab.delete(tabId);
  });

  // Recursively extract all videoId values
  function extractVideoIds(obj) {
    const ids = new Set();

    function walk(node) {
      if (!node || typeof node !== 'object') return;

      if (typeof node.videoId === 'string' && node.videoId.length > 0) {
        ids.add(node.videoId);
      }

      if (Array.isArray(node)) {
        for (const item of node) walk(item);
      } else {
        for (const key of Object.keys(node)) {
          walk(node[key]);
        }
      }
    }

    walk(obj);
    return [...ids];
  }

  // ─── Handle SEND_URLS: Send to Backend ───────────────────────────────

  async function sendUrlsToBackend(urls) {
    try {
      const res = await fetch(`${BACKEND_URL}/send_urls`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(urls),
      });

      if (res.ok) {
        return { ok: true };
      } else {
        return {
          ok: false,
          error: `Backend responded with status ${res.status}`,
        };
      }
    } catch (err) {
      return {
        ok: false,
        error: err.message || 'Network error reaching backend.',
      };
    }
  }

  // ─── Message Router ──────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'PING') {
      sendResponse({ ok: true });
      return true;
    }

    if (message.type === 'CAPTURE_SHORTS') {
      const tabId = sender.tab?.id;
      if (!tabId) {
        sendResponse({ ok: false, error: 'No tab ID' });
        return true;
      }
      
      // Return cached URLs if we have them
      const cached = capturedUrlsByTab.get(tabId);
      if (cached && cached.size > 0) {
        const urls = [...cached];
        console.log(`[Short Detective] Returning ${urls.length} cached URLs for tab ${tabId}`);
        sendResponse({ ok: true, urls });
      } else {
        console.log(`[Short Detective] No cached URLs for tab ${tabId} - may need to scroll`);
        sendResponse({ ok: false, error: 'No shorts captured yet. Try scrolling through a few shorts first.' });
      }
      
      return true;
    }

    if (message.type === 'SEND_URLS') {
      sendUrlsToBackend(message.urls).then(sendResponse);
      return true; // async
    }

    return false;
  });
})();
