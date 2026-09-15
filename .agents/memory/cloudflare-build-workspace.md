---
name: Cloudflare build workspace dependencies
description: Cloudflare's npm build runs from cloudflare/ and cannot parse PNPM workspace protocols.
---

The Cloudflare build uses `npm ci` from the `cloudflare/` root, so that package must not declare `workspace:` dependencies. Shared source can be resolved through Vite aliases instead.

**Why:** npm aborts before installing when it encounters a dependency such as `workspace:*`, while the Cloudflare package already aliases the shared source directly.

**How to apply:** Keep Cloudflare's package manifest npm-compatible and test with `cd cloudflare && npm ci && npm run build` before retrying the remote build.