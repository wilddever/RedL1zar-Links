---
name: Sign submission rate limit
description: Public sign submissions are intentionally unlimited; idempotency remains enabled.
---

The Replit sign API intentionally does not enforce an IP-based hourly submission limit. Duplicate retries are still controlled by the requestId idempotency path.

**Why:** The IP limit blocked legitimate retries and caused Telegram notifications never to be attempted while returning 429.

**How to apply:** Do not restore the hourly IP limiter unless the product decision changes. If abuse protection is needed later, add a non-blocking or owner-configurable control without breaking requestId retries.