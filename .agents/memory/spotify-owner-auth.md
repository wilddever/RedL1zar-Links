---
name: Spotify owner authorization
description: Security boundary for the private Spotify OAuth setup flow
---

The Spotify owner token is an unlock credential, not a URL parameter. Accept it only over same-origin HTTPS to mint a short-purpose HttpOnly owner session, then start the OAuth redirect from that session.

**Why:** Putting the token in a query string leaks it through browser history, copied links, referrers, and request logs.

**How to apply:** Keep the public now-playing endpoint credential-free, keep the owner session scoped to the Spotify routes, and do not add localStorage or URL-based token persistence.