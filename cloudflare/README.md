# RedL1zar на Cloudflare

Этот пакет переносит сайт и его API в Cloudflare Worker:

- React/Vite-страница отдаётся как static assets;
- `/api/spotify/*` — Spotify OAuth, текущий трек и proxy обложки;
- `/api/steam/currently-playing` — текущая игра Steam;
- `/api/yandex/track` — поиск трека в Яндекс Музыке;
- `/api/send` — анонимная отправка сообщения в Telegram;
- refresh token Spotify и короткий rate limit Telegram хранятся в Cloudflare KV.

Sign-карточки обслуживаются отдельным Replit API:

```text
https://red-l-1-zar-links-rusapi.replit.app/api/sign/*
```

Production frontend выбирает этот адрес автоматически. Переменная
`VITE_SIGN_API_BASE_URL` позволяет переопределить его при сборке.

## Рекомендуемая схема для пользователей из России

Чтобы не отдавать первый экран через Cloudflare, frontend можно разместить в
VK Cloud Object Storage/CDN, а Worker оставить API:

```text
https://xn--d1ax3b.fun       → VK Cloud CDN / Object Storage
https://api.xn--d1ax3b.fun   → Cloudflare Worker
```

Frontend автоматически использует `api.xn--d1ax3b.fun` на production-домене.
Для локальной разработки остаются относительные `/api/*`-пути.

### 1. Сначала подключить API-поддомен

В Cloudflare Dashboard откройте Worker `redl1zar-personal-links` → **Settings
→ Domains & Routes → Add → Custom Domain** и добавьте:

```text
api.xn--d1ax3b.fun
```

После этого проверьте:

```bash
curl -i https://api.xn--d1ax3b.fun/api/healthz
```

В Spotify Developer Dashboard замените Redirect URI на:

```text
https://api.xn--d1ax3b.fun/api/spotify/callback
```

И обновите production secret `SPOTIFY_REDIRECT_URI` тем же значением.

### 2. Загрузить frontend в VK Cloud

В VK Cloud:

1. Создайте bucket в VK Cloud Object Storage и включите публичное чтение
   объектов либо настройте CDN-origin с доступом к bucket.
2. Выполните `npm run build`, затем загрузите **содержимое** каталога `dist/`
   в корень bucket. Файл должен находиться как `index.html`, а не
   `dist/index.html`; каталог `assets/` загрузите целиком.
3. Создайте ресурс VK Cloud CDN с bucket как origin и включите отдачу
   `index.html` для корневого URL.
4. Добавьте к CDN custom domain `xn--d1ax3b.fun`.
5. Выпустите или подключите TLS-сертификат для `xn--d1ax3b.fun`.
6. В DNS Cloudflare добавьте запись, которую выдаст VK Cloud CDN, для корневого
   домена и оставьте её **DNS only**, без проксирования Cloudflare.
7. В настройках custom domain/CDN включите обязательный редирект `HTTP → HTTPS`.
   Одного TLS-сертификата недостаточно: без этого `http://xn--d1ax3b.fun`
   может продолжать отдавать страницу без шифрования. Если домен обслуживается
   через Cloudflare Proxy вместо DNS only, включите также zone setting
   `Always Use HTTPS`.

До переключения DNS проверьте CDN на выданном VK Cloud тестовом адресе. После
переключения `https://xn--d1ax3b.fun` должен отдавать `index.html`, а
запросы frontend к `/api/*` будут уходить на `api.xn--d1ax3b.fun`.

Для хешированных файлов из `dist/assets/` установите в CDN длительный cache:

```text
Cache-Control: public, max-age=31536000, immutable
```

Для `index.html` оставьте короткий cache или revalidation, чтобы новые версии
сайта появлялись сразу после загрузки.

После загрузки frontend и переключения DNS выполните обязательную внешнюю
проверку из каталога `cloudflare`:

```bash
npm run verify:deployment
```

Проверка использует российские узлы Check-Host (по умолчанию Москва и
Санкт-Петербург) и дважды запрашивает корневой сайт, API и `/api/spotify/cover`:
первый запрос прогревает кеш, второй проверяет HTTP 200 и время ответа.
Дополнительно она проверяет `Content-Type: image/*` у обложки и сравнивает
хешированные JS/CSS-файлы live `index.html` с только что собранной `dist/`.
Поэтому запускайте её **после** загрузки текущей `dist/` в VK Cloud: старый
frontend или устаревший asset hash остановит публикацию с ошибкой.

Если нужны другие доступные российские узлы или другой предел времени ответа:

```bash
RUSSIAN_PROBE_NODES=ru2.node.check-host.net,ru3.node.check-host.net \
RUSSIAN_PROBE_MAX_RESPONSE_MS=5000 \
npm run verify:deployment
```

Секреты в архив не включены. Их нужно добавить через `wrangler secret put`.

## 1. Подготовить компьютер

Нужен Node.js 20 или новее:

```bash
npm install
npx wrangler login
```

## 2. Создать KV namespace

Из каталога этого пакета выполните:

```bash
npx wrangler kv namespace create SPOTIFY_KV
```

Команда выведет `id`. Откройте `wrangler.toml` и замените значение:

```toml
id = "REPLACE_WITH_KV_NAMESPACE_ID"
```

на настоящий ID namespace.

## 3. Добавить секреты

Для production выполните команды по очереди:

```bash
npx wrangler secret put SPOTIFY_CLIENT_ID
npx wrangler secret put SPOTIFY_CLIENT_SECRET
npx wrangler secret put SPOTIFY_REDIRECT_URI
npx wrangler secret put SPOTIFY_OWNER_TOKEN
npx wrangler secret put SESSION_SECRET
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID
```

Значения вводятся в интерактивном режиме и не должны попадать в ZIP, Git или чат.

`SESSION_SECRET` должен быть длинной случайной строкой. `SPOTIFY_REDIRECT_URI`
заполняется после выбора домена:

```text
https://YOUR-DOMAIN.example/api/spotify/callback
```

В Spotify Developer Dashboard этот же адрес нужно добавить в Redirect URIs
без отличий в протоколе, домене и пути.

## 4. Проверить сборку и задеплоить Worker

```bash
npm install
npm run typecheck
npm run build
npm run deploy
```

`npm run deploy` после публикации автоматически проверяет Worker из
`wrangler.toml`: наличие deployment, ответ `/api/healthz`, CORS у GET-запросов
и preflight `OPTIONS /api/send`. Реальный `POST /api/send` и сообщение в
Telegram при этой проверке не выполняются. Если проверка не проходит, команда
завершается с ошибкой.

После публикации Wrangler покажет адрес вида `*.workers.dev`.

## 5. Подключить уже имеющийся домен

### Если домен уже находится в Cloudflare

1. Откройте Cloudflare Dashboard.
2. Перейдите в **Workers & Pages** и выберите Worker `redl1zar-personal-links`.
3. Откройте **Settings → Domains & Routes**.
4. Нажмите **Add → Custom Domain**.
5. Выберите нужный домен или поддомен и подтвердите подключение.

Cloudflare сам настроит маршрут Worker и TLS-сертификат.

### Если домен зарегистрирован у другого провайдера

1. Добавьте домен в Cloudflare как сайт.
2. На странице Cloudflare будут показаны два nameserver.
3. У регистратора замените текущие nameserver на эти два значения.
4. Перед заменой сохраните существующие DNS-записи. Особенно не удаляйте `MX`,
   `TXT`, `DKIM`, `SPF` и записи сторонней почты.
5. После активации зоны повторите шаг **Если домен уже находится в Cloudflare**.

Если на корневом домене уже работает другой сайт, подключение Worker к этому
домену заменит его маршрут. Безопаснее сначала проверить Worker на поддомене,
например `links.YOUR-DOMAIN.example`, а затем переключить основной домен.

## 6. Один раз подключить Spotify

Refresh token из PostgreSQL Replit автоматически в Cloudflare KV не переносится.
После публикации нужно выполнить OAuth-подключение один раз.

Откройте специальную страницу подключения. Она отправляет owner token обычным
POST-запросом по HTTPS, создаёт HttpOnly-сессию владельца и не помещает token
в URL:

```text
https://YOUR-DOMAIN.example/?spotify=owner
```

Введите token в форме и нажмите кнопку. Браузер получит одноразовую OAuth-ссылку
от Worker и перейдёт на Spotify. После разрешения Spotify вернёт на сайт и
сохранит refresh token в KV. Сам owner token не вставляйте в адресную строку и
не отправляйте в чат.

## 7. Быстрая проверка

```bash
curl -i https://YOUR-DOMAIN.example/api/healthz
curl -i https://YOUR-DOMAIN.example/api/spotify/currently-playing
curl -i https://YOUR-DOMAIN.example/api/steam/currently-playing
```

Ожидаемый ответ health endpoint:

```json
{"status":"ok"}
```

## Локальная проверка Worker

Скопируйте пример локальных переменных и заполните его только на своём
компьютере:

```bash
cp .dev.vars.example .dev.vars
npx wrangler dev
```

Локальный сайт будет доступен на `http://localhost:8787`. Для локального
Spotify в Developer Dashboard временно добавьте:

```text
http://localhost:8787/api/spotify/callback
```

Файл `.dev.vars` не коммитьте.