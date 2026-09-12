---
name: GitHub sync
description: Replit Git pane connections and shell Git authentication
---

The GitHub account connection shown in Replit may not provision credentials for direct shell `git push`. For a project connected through the editor, use the Git pane's repository selection and Auto-sync/Push flow for the first upload.

**Why:** A public repository can be read with HTTPS while an otherwise correct shell push fails with invalid username or token.

**How to apply:** Before asking for credentials, verify the repository is selected for the project in Tools → Git and let the editor perform the initial synchronization. Do not ask the user to paste a GitHub token into chat.