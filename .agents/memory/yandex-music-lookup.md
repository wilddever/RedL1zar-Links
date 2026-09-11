---
name: Yandex Music lookup
description: Environment-specific behavior of the Yandex Music search endpoint and its required fallback
---

The Yandex Music public search API may return HTTP 451 from the Replit runtime, including through regional API hostnames. Track lookup must therefore fail safely and expose the Yandex 404 URL instead of a generic search page.

**Why:** Repeated checks against the API and regional hostnames returned the same legal-region response, while the public search page remained reachable.

**How to apply:** Keep lookup server-side, use exact track matching when the API responds, and preserve `https://music.yandex.ru/404` as the unresolved-track destination.