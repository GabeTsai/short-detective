# Extension icons (optional)

To use a custom icon, add these PNGs and then add to `manifest.json`:

- `icon16.png` – 16×16 px (toolbar)
- `icon48.png` – 48×48 px (extension management)
- `icon128.png` – 128×128 px (Chrome Web Store / install)

In `manifest.json`, add under `"action"`: `"default_icon": { "16": "icons/icon16.png", "48": "icons/icon48.png", "128": "icons/icon128.png" }` and a top-level `"icons"` object with the same paths. Without these, Chrome uses the default puzzle-piece icon.
