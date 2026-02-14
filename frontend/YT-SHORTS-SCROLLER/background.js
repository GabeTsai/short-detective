// background.js (MV3 service worker)
// DOM-based URL collection - no prefetch tabs needed

let queue = [];              // ordered upcoming urls
let seen = new Set();        // de-dup across sessions

const TARGET = 20;

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
  })();

  return true; // async response
});
