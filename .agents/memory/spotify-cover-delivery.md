---
name: Spotify cover delivery
description: Reliability rule for delivering Spotify cover images through the existing proxy.
---

The browser should use the stable proxy URL directly as the image source. The proxy owns upstream validation, retry, and edge caching; the frontend should not add a second fetch-to-Blob/Object URL pipeline. When a new cover fails, retain the last successfully loaded cover and retry the new request with a bounded cache-busting attempt.

**Why:** A successful image response can still become a false fallback when browser fetch, Blob creation, object URL lifecycle, two image handlers, and a client timeout interact. Direct image loading leaves caching and image decoding to the browser and keeps the failure boundary at the actual image element.

**How to apply:** Keep the proxy URL stable and cacheable, use independent main/background image error states, retry only a small fixed number of times, and preserve the last good cover instead of immediately showing an empty Spotify fallback.