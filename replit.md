# RedL1zar Personal Links

Личная страница RedL1zar с социальными ссылками и серверным блоком текущего трека Spotify.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string
- Spotify env: `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `SPOTIFY_REDIRECT_URI`, `SESSION_SECRET`

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

## Product

- Страница показывает социальные ссылки RedL1zar и текущий Spotify-трек, если он доступен.
- Публичный блок корректно сообщает о паузе, отсутствии подключения и временной недоступности Spotify.

## User preferences

 - Общение с владельцем проекта — на русском языке.

## Gotchas

- В Spotify Developer Dashboard Redirect URI должен точно совпадать со значением `SPOTIFY_REDIRECT_URI` и вести на `/api/spotify/callback`.
- Для завершения подключения владелец открывает `/api/spotify/auth`; посетителю не передаются credentials или токены.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
