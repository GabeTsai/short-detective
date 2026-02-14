(function () {
  'use strict';

  const BACKEND_URL = 'http://localhost:8080';

  // Service worker (Manifest V3): runs in the background.

  chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
      console.log('Short Detective installed');
    } else if (details.reason === 'update') {
      console.log('Short Detective updated');
    }
  });

  // Handle messages from popup or content scripts
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'PING') {
      sendResponse({ ok: true });
      return true;
    }

    if (message.type === 'SEND_URLS') {
      // POST the list of URLs to the backend
      (async () => {
        try {
          const res = await fetch(`${BACKEND_URL}/send_urls`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(message.urls),
          });

          if (res.ok) {
            sendResponse({ ok: true });
          } else {
            sendResponse({
              ok: false,
              error: `Backend responded with status ${res.status}`,
            });
          }
        } catch (err) {
          sendResponse({
            ok: false,
            error: err.message || 'Network error reaching backend.',
          });
        }
      })();

      // Return true to keep the message channel open for async sendResponse
      return true;
    }

    return false;
  });
})();
