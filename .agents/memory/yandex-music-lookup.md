---
name: Yandex Music lookup
description: Environment-specific behavior of the Yandex Music search endpoint and its required fallback
---

The Yandex Music public search API may return HTTP 451 from the Replit runtime, including through regional API hostnames. For valid track metadata, lookup must therefore fall back to the Yandex Music web search URL with the title, artist, and album; reserve the Yandex 404 URL for missing metadata.

**Why:** Repeated checks against the API and regional hostnames returned the same legal-region response, while the public search page remained reachable and accepted the encoded query.

**How to apply:** Keep lookup server-side, use exact track matching when the API responds, and return a web search URL rather than 404 when a valid track cannot be resolved directly.