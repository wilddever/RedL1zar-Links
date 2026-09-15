---
name: Replit Git publishing
description: Git push and Replit production publishing are separate steps for this API.
---

For this project, pushing the main branch updates source control but does not automatically publish a new Replit production build. Production changes require the Replit Publish action unless an external CI/CD pipeline is configured.

**Why:** Replit's current publishing setup reports Git synchronization and production publishing as separate operations; assuming push deploys can leave the live API on an older build.

**How to apply:** After verifying API changes, confirm the target published URL and ask the user to run Publish. Treat the live deployment as unchanged until its successful build reflects the new source.