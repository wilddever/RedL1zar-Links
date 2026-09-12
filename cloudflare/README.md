# RedL1zar на Cloudflare

Этот пакет переносит сайт и его API в один Cloudflare Worker:

- React/Vite-страница отдаётся как static assets;
- `/api/spotify/*` — Spotify OAuth, текущий трек и proxy обложки;
- `/api/steam/currently-playing` — текущая игра Steam;
- `/api/yandex/track` — поиск трека в Яндекс Музыке;
- `/api/send` — анонимная отправка сообщения в Telegram;
- refresh token Spotify и короткий rate limit Telegram хранятся в Cloudflare KV.

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
npx wrangler deploy
```

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