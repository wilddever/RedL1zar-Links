---
name: Russia frontend hosting
description: Deployment split for a Cloudflare API and a regional static frontend
---

For Russian reachability, serve the static frontend from a regional CDN or object-storage website and keep the existing Worker API on a separate `api` subdomain.

**Why:** Moving only the first-load assets avoids a full backend rewrite while removing the main page from the potentially throttled Cloudflare path. Cross-origin API calls require explicit CORS and an app-origin setting, and Spotify OAuth must redirect back to the frontend origin.

**How to apply:** Configure the frontend with a public API base URL only in production, allow that exact app origin in Worker CORS, use a separate API hostname for OAuth callbacks, and switch the root DNS record only after both hosts have been tested. Keep the API Worker name and custom-domain route in the deployment config; deploying a similarly named frontend Worker does not update the API hostname. Proxy third-party artwork through that API, cache it at the edge, and render a local UI fallback when an image still fails. For regional incidents, compare root/API/proxy/direct-CDN checks from a Russian probe and inspect the served frontend asset hash.