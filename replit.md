# RedL1zar Personal Links

Личная страница RedL1zar с социальными ссылками и серверным блоком текущего трека Spotify.

## Run & Operate

- Replit Preview uses the managed workflows `artifacts/personal-links: web` and `artifacts/api-server: API Server`.
- `pnpm --filter @workspace/personal-links run dev` — run the frontend manually (requires `PORT` and `BASE_PATH`)
- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm --filter @workspace/db run push` — apply the development database schema
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string
- Spotify env: `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `SPOTIFY_REDIRECT_URI`, `SESSION_SECRET`, `SPOTIFY_OWNER_TOKEN`
- Sign moderation env (production secrets, never commit values): `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `SESSION_SECRET`, `PUBLIC_APP_ORIGIN=https://xn--d1ax3b.fun`, and the provisioned App Storage values `DEFAULT_OBJECT_STORAGE_BUCKET_ID`, `PRIVATE_OBJECT_DIR`, and `PUBLIC_OBJECT_SEARCH_PATHS`.
- Current published API: `https://red-l-1-zar-links-rusapi.replit.app`. Replit Git push updates the repository, but Replit Publishing must still be run to deploy a new production build unless a separate external CI/CD flow is configured.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/personal-links/src/App.tsx` — личная страница и блок Listening now
- `artifacts/api-server/src/lib/spotify.ts` — OAuth, обновление токенов и нормализация Spotify API
- `artifacts/api-server/src/routes/spotify.ts` — OAuth callback и публичный endpoint текущего трека
- `lib/db/src/schema/spotify.ts` — серверное хранение refresh token
- `lib/api-spec/openapi.yaml` — контракт публичного API Spotify

## Architecture decisions

- Spotify access token хранится только в памяти API-сервера и обновляется по refresh token.
- Refresh token хранится в PostgreSQL в singleton-строке; браузер получает только публичные данные трека.
- OAuth state подписывается `SESSION_SECRET` и дополнительно сверяется с HttpOnly cookie.
- OAuth-подключение владельца защищено `SPOTIFY_OWNER_TOKEN`: первый переход на `/api/spotify/auth?owner_token=...` выдаёт подписанную HttpOnly cookie, после чего токен в URL больше не нужен.
- Sign-карточки хранят метаданные и статусы в PostgreSQL, а PNG-файлы — только в Replit App Storage. Telegram moderation links are signed with `SESSION_SECRET`.

## Production cutover: VK frontend and sign API

1. Provision App Storage and confirm `PRIVATE_OBJECT_DIR` and `DEFAULT_OBJECT_STORAGE_BUCKET_ID` are present in the API deployment.
2. Set the production secrets above in the API deployment; generate a long random `SESSION_SECRET` and configure the Telegram bot/chat used for moderation.
3. Apply the database schema with `pnpm --filter @workspace/db run push` and verify `/api/healthz` on the published API domain.
4. Publish the API on Replit at `https://red-l-1-zar-links-rusapi.replit.app`, then attach `api.xn--d1ax3b.fun` as its custom domain when ready.
5. In Cloudflare DNS, remove the Worker custom-domain route for `api.xn--d1ax3b.fun` and add the DNS record Replit provides. Keep it DNS-only if Replit's domain verification requires direct resolution.
6. The VK-hosted frontend can keep its existing `https://api.xn--d1ax3b.fun` sign API URL; verify the raw `image/png` POST contract and CORS from `https://xn--d1ax3b.fun`.
7. Submit one test card, approve it from Telegram, verify the wall/image URL, then verify reject and delete remove the App Storage object before switching VK traffic.

## Product

- Страница показывает социальные ссылки RedL1zar и текущий Spotify-трек, если он доступен.
- Публичный блок корректно сообщает о паузе, отсутствии подключения и временной недоступности Spotify.

## User preferences

 - Общение с владельцем проекта — на русском языке.

## Gotchas

- В Spotify Developer Dashboard Redirect URI должен точно совпадать со значением `SPOTIFY_REDIRECT_URI` и вести на `/api/spotify/callback`.
- Для завершения подключения владелец открывает `/api/spotify/auth?owner_token=...`; посетителю не передаются credentials, owner token или Spotify-токены.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
