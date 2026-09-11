---
name: Spotify polling
description: Non-obvious reliability and security constraints for the server-side Spotify now-playing integration.
---

Public now-playing responses should be sent with `Cache-Control: no-store` and the server should back off after Spotify returns `429`.

**Why:** The generated API fetch treats HTTP 304 as a failed response, and polling through a shared proxy can otherwise turn conditional requests or rate limits into false unavailable states.

**How to apply:** Keep Spotify credentials and refresh tokens in the API service only; return normalized metadata and stable user-facing states to the browser.