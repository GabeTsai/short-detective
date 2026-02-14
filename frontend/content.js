(function () {
  'use strict';

  // ─── Constants ───────────────────────────────────────────────────────
  const PANEL_HOST_ID = 'short-detective-panel-host';

  // Persistent set of URLs captured from YouTube's API via the injected script
  const capturedUrls = new Set();

  // ─── Inject Page-Level Script ────────────────────────────────────────

  /**
   * Inject inject.js into the page's MAIN world so it can
   * monkey-patch fetch/XHR and read ytInitialData.
   */
  function injectPageScript() {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('inject.js');
    script.onload = () => script.remove(); // clean up the tag after execution
    // At document_start, <head> and <body> may not exist yet.
    // Append to documentElement (<html>) which always exists.
    (document.head || document.documentElement).appendChild(script);
  }

  // YouTube is a SPA — the content script only loads once.
  // Listen for soft navigations for debugging.
  function listenForSPANavigation() {
    window.addEventListener('yt-navigate-finish', () => {
      console.log('[Short Detective] SPA navigation detected');
    });
  }

  // ─── Listen for Intercepted URLs ─────────────────────────────────────

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.data?.type !== 'SHORT_DETECTIVE_URLS') return;

    const urls = event.data.urls;
    if (Array.isArray(urls)) {
      urls.forEach((url) => capturedUrls.add(url));
      console.log(
        `[Short Detective] Captured ${capturedUrls.size} total Shorts URLs`
      );
    }
  });

  // ─── URL Extraction ──────────────────────────────────────────────────

  /**
   * Combine intercepted API URLs with DOM-scraped URLs.
   * The API interception gives us ~20 preloaded shorts;
   * DOM scraping is kept as a fallback.
   */
  function extractShortsUrls() {
    const urls = new Set(capturedUrls);

    // Fallback: Pull videoId from Polymer data on each renderer
    document.querySelectorAll('ytd-reel-video-renderer').forEach((el) => {
      try {
        const videoId =
          el.data?.videoId ||
          el.data?.command?.reelWatchEndpoint?.videoId ||
          el.data?.navigationEndpoint?.reelWatchEndpoint?.videoId;
        if (videoId) {
          urls.add(`https://www.youtube.com/shorts/${videoId}`);
        }
      } catch (_) {
        // Polymer data access can throw; safe to ignore
      }
    });

    // Fallback: anchor tags with /shorts/ hrefs
    document.querySelectorAll('a[href*="/shorts/"]').forEach((a) => {
      try {
        const href = new URL(a.href, window.location.origin).href;
        if (href.includes('/shorts/')) {
          urls.add(href.split('?')[0]);
        }
      } catch (_) {
        // skip
      }
    });

    // Always include the current page URL if it's a short
    if (window.location.pathname.startsWith('/shorts/')) {
      urls.add(
        `https://www.youtube.com${window.location.pathname.split('?')[0]}`
      );
    }

    return [...urls];
  }

  // ─── Floating Overlay Panel ──────────────────────────────────────────

  /**
   * Create or update the floating overlay panel.
   * Uses Shadow DOM to isolate our styles from YouTube's CSS.
   */
  function showPanel(text) {
    let host = document.getElementById(PANEL_HOST_ID);

    if (!host) {
      host = document.createElement('div');
      host.id = PANEL_HOST_ID;
      document.body.appendChild(host);

      const shadow = host.attachShadow({ mode: 'open' });

      shadow.innerHTML = `
        <style>
          :host {
            all: initial;
            position: fixed;
            top: 80px;
            right: 24px;
            z-index: 999999;
            font-family: system-ui, -apple-system, sans-serif;
          }
          .panel {
            width: 300px;
            max-height: 70vh;
            background: rgba(24, 24, 27, 0.92);
            color: #f4f4f5;
            border-radius: 12px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
            overflow: hidden;
            display: flex;
            flex-direction: column;
          }
          .panel-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 12px 16px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
          }
          .panel-header h2 {
            margin: 0;
            font-size: 14px;
            font-weight: 600;
            letter-spacing: 0.02em;
          }
          .close-btn {
            background: none;
            border: none;
            color: #a1a1aa;
            font-size: 18px;
            cursor: pointer;
            padding: 0 4px;
            line-height: 1;
          }
          .close-btn:hover {
            color: #f4f4f5;
          }
          .panel-body {
            padding: 16px;
            font-size: 13px;
            line-height: 1.5;
            overflow-y: auto;
            white-space: pre-wrap;
          }
        </style>
        <div class="panel">
          <div class="panel-header">
            <h2>Short Detective</h2>
            <button class="close-btn" title="Close">&times;</button>
          </div>
          <div class="panel-body"></div>
        </div>
      `;

      shadow
        .querySelector('.close-btn')
        .addEventListener('click', () => host.remove());
    }

    const shadow = host.shadowRoot;
    shadow.querySelector('.panel-body').textContent = text;
  }

  // ─── Message Listener ────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type !== 'START') return false;

    (async () => {
      try {
        // 1. Extract captured + DOM-scraped Shorts URLs
        const urls = extractShortsUrls();

        if (urls.length === 0) {
          sendResponse({ ok: false, error: 'No Shorts URLs found on this page.' });
          return;
        }

        // 2. Send URLs to the background service worker → backend
        const bgResponse = await chrome.runtime.sendMessage({
          type: 'SEND_URLS',
          urls,
        });

        if (!bgResponse?.ok) {
          sendResponse({
            ok: false,
            error: bgResponse?.error || 'Failed to send URLs to backend.',
          });
          return;
        }

        // 3. Show floating overlay with placeholder text
        showPanel('Analysis results will appear here...');

        sendResponse({ ok: true, urlCount: urls.length });
      } catch (err) {
        sendResponse({ ok: false, error: err.message || 'Content script error.' });
      }
    })();

    // Return true to indicate we will call sendResponse asynchronously
    return true;
  });

  // ─── Bootstrap ───────────────────────────────────────────────────────

  // Inject the fetch/XHR/ytInitialData interceptor into the page's JS context
  injectPageScript();
  listenForSPANavigation();
})();
