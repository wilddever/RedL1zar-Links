---
name: Russia frontend hosting
description: Deployment split for a Cloudflare API and a regional static frontend
---

For Russian reachability, serve the static frontend from a regional CDN or object-storage website and keep the existing Worker API on a separate `api` subdomain.

**Why:** Moving only the first-load assets avoids a full backend rewrite while removing the main page from the potentially throttled Cloudflare path. Cross-origin API calls require explicit CORS and an app-origin setting, and Spotify OAuth must redirect back to the frontend origin.

**How to apply:** Configure the frontend with a public API base URL only in production, allow that exact app origin in Worker CORS, use a separate API hostname for OAuth callbacks, and switch the root DNS record only after both hosts have been tested. Keep the API Worker name and custom-domain route in the deployment config; deploying a similarly named frontend Worker does not update the API hostname. Proxy third-party artwork through that API, cache it at the edge, and render a local UI fallback when an image still fails. For regional incidents, compare root/API/proxy/direct-CDN checks from a Russian probe and inspect the served frontend asset hash.

The workspace has no VK Cloud Object Storage credentials or upload command; Worker deploys are automated with Wrangler, while the current `dist/` must be uploaded to the VK bucket separately before the frontend verification can pass.

**Why:** The Worker and regional static host are separate deployment surfaces, and the repository's verification intentionally rejects a stale VK asset hash after a successful Worker deploy.

**How to apply:** Build the Cloudflare frontend, archive the contents of `cloudflare/dist/` with `index.html` at the archive root, upload it to the VK bucket, then run the deployment verification from `cloudflare`.

The VK Cloud root custom domain can serve `200 OK` over plain HTTP even when its HTTPS certificate is valid.

**Why:** A certificate only protects HTTPS; the direct object-storage endpoint does not automatically redirect HTTP, which can surface as an unsafe connection when a VPN or browser opens the HTTP variant.

**How to apply:** Enable HTTP-to-HTTPS redirect on the VK Cloud CDN custom domain (or put the root record behind an HTTPS edge proxy). Keep the early frontend redirect as a fallback, but do not treat it as a replacement for the CDN redirect.