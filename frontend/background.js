(function () {
  'use strict';

  // Service worker (Manifest V3): runs in the background.
  // Use for long-lived logic, messaging, or API calls.

  chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
      console.log('Short Detective installed');
    } else if (details.reason === 'update') {
      console.log('Short Detective updated');
    }
  });

  // Optional: handle messages from popup or content scripts
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'PING') {
      sendResponse({ ok: true });
      return true;
    }
    // TODO: handle other message types (e.g. analyze URL)
    return false;
  });
})();
