// inject.js — Runs in the PAGE's JS context (MAIN world).
// Intercepts YouTube Shorts data from three sources:
//   1. window.ytInitialData (embedded in HTML on first load)
//   2. XMLHttpRequest responses (YouTube Polymer uses XHR)
//   3. fetch() responses (safety net)

(function () {
  'use strict';

  const SHORTS_API_PATTERN = /reel\/reel_watch_sequence/;
  const MESSAGE_TYPE = 'SHORT_DETECTIVE_URLS';

  // ─── Utility: extract all videoId values from a nested object ────────

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

  function postUrls(videoIds) {
    if (videoIds.length > 0) {
      const urls = videoIds.map(
        (id) => `https://www.youtube.com/shorts/${id}`
      );
      window.postMessage({ type: MESSAGE_TYPE, urls }, '*');
    }
  }

  // ─── Source 1: Parse ytInitialData (embedded in page HTML) ───────────

  function parseInitialData() {
    try {
      if (window.ytInitialData) {
        const ids = extractVideoIds(window.ytInitialData);
        postUrls(ids);
        return;
      }
    } catch (_) {
      // not available yet
    }

    // ytInitialData might not be set yet; retry a few times
    let attempts = 0;
    const interval = setInterval(() => {
      attempts++;
      try {
        if (window.ytInitialData) {
          clearInterval(interval);
          const ids = extractVideoIds(window.ytInitialData);
          postUrls(ids);
        } else if (attempts >= 20) {
          clearInterval(interval);
        }
      } catch (_) {
        clearInterval(interval);
      }
    }, 500);
  }

  // ─── Source 2: Intercept XMLHttpRequest ──────────────────────────────

  const xhrOpen = XMLHttpRequest.prototype.open;
  const xhrSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url) {
    this._sdUrl = typeof url === 'string' ? url : String(url);
    return xhrOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function () {
    if (this._sdUrl && SHORTS_API_PATTERN.test(this._sdUrl)) {
      this.addEventListener('load', function () {
        try {
          const data = JSON.parse(this.responseText);
          const ids = extractVideoIds(data);
          postUrls(ids);
        } catch (_) {
          // response wasn't JSON or parse failed; ignore
        }
      });
    }
    return xhrSend.apply(this, arguments);
  };

  // ─── Source 3: Intercept fetch() (safety net) ────────────────────────

  const originalFetch = window.fetch;

  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);

    try {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';

      if (SHORTS_API_PATTERN.test(url)) {
        const clone = response.clone();
        clone.json().then((data) => {
          const ids = extractVideoIds(data);
          postUrls(ids);
        }).catch(() => {});
      }
    } catch (_) {
      // never break the page
    }

    return response;
  };

  // ─── Bootstrap ───────────────────────────────────────────────────────

  parseInitialData();

  // YouTube is a SPA — re-parse ytInitialData on navigation
  // (yt-navigate-finish fires when YouTube's soft-router completes)
  window.addEventListener('yt-navigate-finish', () => {
    parseInitialData();
  });
})();
