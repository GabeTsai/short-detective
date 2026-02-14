# Short Detective – Extension frontend

Chrome extension frontend (Manifest V3) for Short Detective.

## Structure

- **manifest.json** – Extension manifest (permissions, popup, content script, background)
- **popup.html / popup.js / popup.css** – Popup UI when clicking the extension icon
- **content.js** – Content script injected into web pages
- **background.js** – Service worker (background logic, messaging)
- **icons/** – Extension icons (see `icons/README.md`)

## Load in Chrome

1. Open `chrome://extensions/`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this `frontend` folder.

## Development

Edit the files and click the reload icon on the extension card in `chrome://extensions/` to apply changes.
