---
name: Replit production data
description: Existing production database rows are separate from development rows after publishing.
---

Publishing the API updates its code and schema, but existing rows added to the development PostgreSQL database do not automatically appear in an already provisioned production database.

**Why:** The live sign wall remained empty after the frontend and API build were updated, while the same row was present in development and absent from production.

**How to apply:** Treat production data migration as a separate owner-authorized operation. Do not assume a republish copies development records; use a supported production migration path or a protected application import flow.