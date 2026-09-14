---
name: API CORS origins
description: The VK Cloud frontend is reachable over both HTTP and HTTPS, so browser API calls need matching CORS origins until HTTPS-only access is configured.
---

Cloudflare API CORS must allow both `http://xn--d1ax3b.fun` and `https://xn--d1ax3b.fun` while the VK Cloud domain serves HTTP without redirecting.

**Why:** `curl` received successful API responses over HTTPS, but browsers opened from the HTTP site blocked Spotify, Steam, and send responses as cross-origin requests.

**How to apply:** If VK Cloud starts enforcing HTTPS, remove the temporary HTTP origins from the Worker only after verifying the redirect and the HTTPS frontend.