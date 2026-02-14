(function () {
  'use strict';

  // ─── Constants ───────────────────────────────────────────────────────
  const PANEL_HOST_ID = 'short-detective-panel-host';

  // ─── Extract Current Video ID ────────────────────────────────────────

  function getCurrentVideoId() {
    const videoId = window.location.pathname.split('/shorts/')[1]?.split('?')[0];
    if (!videoId) {
      throw new Error('Not on a Shorts page with a video ID');
    }
    return videoId;
  }

  // ─── Floating Overlay Panel ──────────────────────────────────────────

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

  console.log('[Short Detective Content] 🚀 Content script loaded');

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type !== 'START') return false;

    (async () => {
      try {
        // 1. Get current video ID
        const videoId = getCurrentVideoId();
        console.log('[Short Detective] Current video:', videoId);

        // 2. Ask background to capture shorts URLs via debugger
        const bgResponse = await chrome.runtime.sendMessage({
          type: 'CAPTURE_SHORTS',
          videoId
        });

        if (!bgResponse?.ok) {
          sendResponse({
            ok: false,
            error: bgResponse?.error || 'Failed to capture shorts.',
          });
          return;
        }

        const urls = bgResponse.urls || [];

        if (urls.length === 0) {
          sendResponse({ ok: false, error: 'No Shorts URLs captured.' });
          return;
        }

        // 3. Send URLs to backend
        const backendResponse = await chrome.runtime.sendMessage({
          type: 'SEND_URLS',
          urls,
        });

        if (!backendResponse?.ok) {
          sendResponse({
            ok: false,
            error: backendResponse?.error || 'Failed to send URLs to backend.',
          });
          return;
        }

        // 4. Show floating overlay
        showPanel('Analysis results will appear here...');

        sendResponse({ ok: true, urlCount: urls.length });
      } catch (err) {
        console.error('[Short Detective] Error:', err);
        sendResponse({ ok: false, error: err.message || 'Content script error.' });
      }
    })();

    return true; // async response
  });
})();
