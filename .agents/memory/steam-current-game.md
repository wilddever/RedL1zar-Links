---
name: Steam current-game detection
description: Steam profile XML may omit currentGame while the public HTML profile still exposes the active game.
---

Steam's public XML profile is not a complete source for presence: it can contain online and library data without a currentGame block even while the HTML profile shows "Currently In-Game". Use the HTML profile as a fallback for the active game name, and enrich it from XML metadata when possible.

**Why:** The XML endpoint returned no currentGame for an actively running game, while the public profile page showed the active title.

**How to apply:** Preserve both sources in Steam polling and treat a missing XML currentGame as inconclusive rather than proof that no game is running.