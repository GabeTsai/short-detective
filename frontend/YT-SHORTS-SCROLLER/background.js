// background.js (MV3 service worker)
// DOM-based URL collection - no prefetch tabs needed

let queue = [];              // ordered upcoming urls
let seen = new Set();        // de-dup across sessions

const TARGET = 20;
const BACKEND_URL = "http://localhost:8080";

function norm(url) {
  try {
    const u = new URL(url);
    u.search = ""; u.hash = "";
    return u.toString();
  } catch { return url; }
}

function broadcastQueue() {
  chrome.tabs.query({}, (tabs) => {
    for (const t of tabs) {
      if (t.url && t.url.includes("youtube.com/shorts/")) {
        chrome.tabs.sendMessage(t.id, { type: "QUEUE_UPDATE", queue }).catch(() => {});
      }
    }
  });
}

function trimQueue() {
  // Don't trim - keep ALL URLs ever collected
  // if (queue.length > TARGET) queue = queue.slice(0, TARGET);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg.type === "BOOTSTRAP") {
      broadcastQueue();
      sendResponse({ ok: true, queue });
      return;
    }

    if (msg.type === "FOUND_URL") {
      const u = norm(msg.url);
      if (!seen.has(u) && !queue.includes(u)) {
        seen.add(u);
        queue.push(u);
        trimQueue();
        broadcastQueue();
      }
      sendResponse({ ok: true, size: queue.length });
      return;
    }

    if (msg.type === "WATCHED") {
      const watched = norm(msg.url);
      queue = queue.filter(x => x !== watched);
      broadcastQueue();
      sendResponse({ ok: true, queue });
      return;
    }

    if (msg.type === "SEND_TO_BACKEND") {
      const urls = msg.urls || [];
      console.log(`[YTSS BG] Sending ${urls.length} URLs to backend...`);
      try {
        const res = await fetch(`${BACKEND_URL}/send_urls`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(urls)
        });
        if (res.ok) {
          console.log("[YTSS BG] ✓ URLs sent to backend");
          sendResponse({ ok: true });
        } else {
          console.error(`[YTSS BG] ✗ Backend responded ${res.status}`);
          sendResponse({ ok: false, error: `Backend status ${res.status}` });
        }
      } catch (err) {
        console.error("[YTSS BG] ✗ Backend unreachable:", err.message);
        sendResponse({ ok: false, error: err.message });
      }
      return;
    }
  })();

  return true; // async response
});
