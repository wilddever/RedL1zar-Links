---
name: Spotify OAuth callback
description: Cloudflare KV fallback and diagnostics for Spotify authorization-code callbacks
---

The Spotify callback must persist a short-lived access token when the provider omits a refresh token, and it must leave a non-secret callback status when token exchange fails.

**Why:** Spotify can omit a refresh token during a repeat authorization even though the authorization code exchange succeeds. Treating that response as a total failure makes the public player appear disconnected, while swallowing callback errors makes Redirect URI and provider failures indistinguishable.

**How to apply:** Prefer the refresh token for long-term polling, use the KV access-token fallback until it expires when no refresh token is returned, and expose only coarse non-secret status messages for callback failures.