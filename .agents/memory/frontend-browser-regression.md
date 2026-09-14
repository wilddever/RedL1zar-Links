---
name: Frontend browser regression checks
description: Local browser checks must proxy API routes and start each frontend with its own Vite command.
---

Frontend variants should be tested through a small local API proxy so the same Spotify response, cover failure, and timeout can be exercised against both bundles. The personal-links Vite config requires `PORT` and `BASE_PATH`; the Cloudflare variant should receive its port through direct Vite CLI arguments rather than a `pnpm run` separator.

**Why:** The two frontends use different API-client wiring and Vite startup conventions, so checking only one dev server can miss a regression or silently test the wrong port.

**How to apply:** Keep cross-frontend browser regression checks dependency-free where possible and run them against fresh proxy/browser sessions for each scenario.