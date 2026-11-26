# Scene mockups

`scenes.html` is a self-contained, fictional DSH-style scene used to render the two preview images in `docs/images/`. It reuses the plugin's own stylesheet (the same CSS the client ships), so the nodes, hover card, expanded list and sidebar cards look exactly like the real surface. It is not a screenshot and contains no real session data, account, or conversation.

- `scene-progress.png` — open `scenes.html?scene=rail`
- `scene-completed.png` — open `scenes.html?scene=completed`

Render at 1600 × 1000 CSS pixels with a 2× device scale for a 3200 × 2000 image (for example a headless Chromium `--force-device-scale-factor=2 --window-size=1600,1092` screenshot, then crop to the first 3200 × 2000 pixels).
