# Прокси обложек для VK Cloud

> Для текущего production frontend основной cover endpoint находится на уже
> опубликованном Replit API Server: `https://red-l-1-zar-links.replit.app`.
> Этот документ описывает исходную VK Cloud-схему и остаётся инструкцией для
> отдельного VK backend, если он когда-нибудь понадобится.

`api-server` уже содержит endpoint:

```text
GET /api/spotify/cover?url=https://i.scdn.co/image/...
```

Его можно запустить в VK Cloud как отдельный Node.js-сервис, не перенося туда
весь frontend. Object Storage остаётся статическим хранилищем страницы.

## 1. Запуск API-сервиса

Разместите корень проекта вместе с `artifacts/api-server` и `lib/` в выбранном
Node.js-сервисе VK Cloud. Сервис должен слушать переменную `PORT`.

Команды из корня проекта:

```bash
pnpm install --frozen-lockfile
pnpm --filter @workspace/api-server run build
PORT=8080 pnpm --filter @workspace/api-server run start
```

Для cover endpoint обязательны только сетевой доступ наружу и `PORT`. Остальные
секреты нужны только для других API-возможностей (`/api/spotify/currently-playing`,
сообщений и OAuth).

Подключите HTTPS-домен, например:

```text
https://cover-api.xn--d1ax3b.fun
```

Проверьте сервис:

```bash
curl -I 'https://cover-api.xn--d1ax3b.fun/api/spotify/cover?url=https%3A%2F%2Fi.scdn.co%2Fimage%2Fab67616d0000b273571cd5cb21a8f4fc16d992d3'
```

Ожидаются `200 OK`, `Content-Type: image/*` и `Content-Length` изображения.

## 2. Сборка frontend с VK-прокси

После появления HTTPS-домена соберите production frontend:

```bash
VITE_SPOTIFY_COVER_API_BASE_URL=https://cover-api.xn--d1ax3b.fun \
  pnpm --dir cloudflare run build
```

Загрузите содержимое `cloudflare/dist/` в bucket VK Cloud вместо текущих
`index.html` и `assets/`.

Остальные запросы страницы продолжат идти через текущий Cloudflare API.
Меняется только источник Spotify-обложек.

## 3. Резервный режим

Если `VITE_SPOTIFY_COVER_API_BASE_URL` не задан, frontend использует текущий
API base URL. Поэтому сборка без этой переменной остаётся совместимой с текущей
схемой и не ломает страницу до готовности VK Cloud-сервиса.