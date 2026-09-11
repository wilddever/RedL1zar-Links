---
name: Workspace dependency installs
description: A package-install workflow quirk that can create unrelated workspace configuration diffs.
---

After adding a workspace dependency, inspect the diff for `pnpm-workspace.yaml` and other root configuration files before finishing.

**Why:** The available pnpm version rewrote YAML formatting and some override-key spellings during a filtered dependency install, creating unrelated changes even though the dependency itself was correct.

**How to apply:** Keep only the intended package manifest and lockfile changes; restore unrelated configuration changes before validation.