import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const wranglerCommand = path.resolve(
  scriptDirectory,
  '..',
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler',
);
const configPath = path.resolve(
  process.env.WRANGLER_CONFIG || path.join(scriptDirectory, '..', 'wrangler.toml'),
);
const expectedAppOrigin = 'https://xn--d1ax3b.fun';
const smokeTestSpotifyImage =
  'https://i.scdn.co/image/ab67616d0000b273571cd5cb21a8f4fc16d992d3';
const requestTimeoutMs = 15_000;

function readTomlString(source, key, section = '') {
  const sectionPattern = section
    ? new RegExp(
        `\\[\\[?${section.replace('.', '\\.')}\\]?\\][\\s\\S]*?(?=\\n\\[|$)`,
        '',
      )
    : null;
  const sectionSource = sectionPattern?.exec(source)?.[0] || source;
  const match = new RegExp(`^${key}\\s*=\\s*"([^"]+)"`, 'm').exec(
    sectionSource,
  );
  return match?.[1];
}

function readTomlBoolean(source, key, section) {
  const sectionPattern = new RegExp(
    `\\[\\[${section.replace('.', '\\.')}\\]\\][\\s\\S]*?(?=\\n\\[|$)`,
    '',
  );
  const sectionSource = sectionPattern.exec(source)?.[0] || '';
  return new RegExp(`^${key}\\s*=\\s*true`, 'm').test(sectionSource);
}

function fail(message) {
  throw new Error(`[Cloudflare deployment check] ${message}`);
}

function parseJsonOutput(output) {
  const trimmed = output.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start === -1 || end <= start) {
      fail('Wrangler не вернул JSON со списком deployment.');
    }
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      fail('Не удалось разобрать JSON со списком deployment Wrangler.');
    }
  }
}

function deploymentItems(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.deployments)) return payload.deployments;
  return [];
}

async function assertWorkerDeployment(workerName) {
  let output;
  try {
    ({ stdout: output } = await execFileAsync(
      wranglerCommand,
      [
        'deployments',
        'list',
        '--name',
        workerName,
        '--config',
        configPath,
        '--json',
      ],
      { cwd: process.cwd(), maxBuffer: 1024 * 1024 },
    ));
  } catch (error) {
    const details = error?.stderr?.trim() || error?.message || 'неизвестная ошибка';
    fail(`не удалось получить deployment Worker ${workerName}: ${details}`);
  }

  if (!deploymentItems(parseJsonOutput(output)).length) {
    fail(`для Worker ${workerName} не найдено ни одного deployment.`);
  }
}

async function fetchWithTimeout(url, init = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    const reason = error?.name === 'AbortError' ? 'таймаут' : error?.message;
    fail(`${init.method || 'GET'} ${url} не отвечает: ${reason || 'неизвестная ошибка'}`);
  } finally {
    clearTimeout(timeout);
  }
}

function assertCors(response, url, appOrigin) {
  const actualOrigin = response.headers.get('access-control-allow-origin');
  if (actualOrigin !== appOrigin) {
    fail(
      `${url} вернул Access-Control-Allow-Origin=${JSON.stringify(actualOrigin)}; ожидалось ${appOrigin}.`,
    );
  }
}

function assertAllowedValues(response, header, expectedValues, url) {
  const actual = response.headers.get(header);
  const allowed = new Set(
    (actual || '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
  const missing = expectedValues.filter((value) => !allowed.has(value));
  if (missing.length) {
    fail(
      `${url} не содержит ${header}: ${missing.join(', ')} (получено ${JSON.stringify(actual)}).`,
    );
  }
}

async function assertGet(url, appOrigin, validate) {
  const response = await fetchWithTimeout(url, {
    headers: {
      Accept: 'application/json',
      Origin: appOrigin,
    },
    cache: 'no-store',
  });
  assertCors(response, url, appOrigin);
  if (!response.ok) {
    fail(`${url} вернул HTTP ${response.status}, ожидался успешный GET.`);
  }
  await validate(response);
}

const configSource = await readFile(configPath, 'utf8');
const workerName = readTomlString(configSource, 'name');
const apiHost = readTomlString(configSource, 'pattern', 'routes');
const appOrigin = readTomlString(configSource, 'PUBLIC_APP_ORIGIN', 'vars');

if (!workerName) fail(`в ${configPath} не задано имя Worker.`);
if (!apiHost) fail(`в ${configPath} не найден custom domain в [[routes]].`);
if (!readTomlBoolean(configSource, 'custom_domain', 'routes')) {
  fail(`маршрут ${apiHost} в ${configPath} не помечен как custom_domain.`);
}
if (!appOrigin) fail(`в ${configPath} не задан PUBLIC_APP_ORIGIN.`);
if (appOrigin !== expectedAppOrigin) {
  fail(
    `PUBLIC_APP_ORIGIN в ${configPath} должен быть ${expectedAppOrigin}, получено ${appOrigin}.`,
  );
}

const apiOrigin = `https://${apiHost.replace(/^https?:\/\//, '').replace(/\/+$/, '')}`;
await assertWorkerDeployment(workerName);

await assertGet(`${apiOrigin}/api/healthz`, appOrigin, async (response) => {
  const body = await response.json().catch(() => null);
  if (body?.status !== 'ok') {
    fail(`/api/healthz вернул неожиданный ответ: ${JSON.stringify(body)}.`);
  }
});

await assertGet(
  `${apiOrigin}/api/spotify/currently-playing`,
  appOrigin,
  async (response) => {
    const body = await response.json().catch(() => null);
    if (!body || typeof body.status !== 'string') {
      fail(`/api/spotify/currently-playing вернул неожиданный ответ.`);
    }
  },
);

const coverUrl = `${apiOrigin}/api/spotify/cover?url=${encodeURIComponent(
  smokeTestSpotifyImage,
)}`;
const coverResponse = await fetchWithTimeout(coverUrl, {
  headers: {
    Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
    Origin: appOrigin,
  },
  cache: 'no-store',
});
assertCors(coverResponse, coverUrl, appOrigin);
if (!coverResponse.ok) {
  fail(`${coverUrl} вернул HTTP ${coverResponse.status}, ожидалась доступная обложка.`);
}
if (!coverResponse.headers.get('content-type')?.startsWith('image/')) {
  fail(
    `${coverUrl} вернул неожиданный Content-Type: ${JSON.stringify(
      coverResponse.headers.get('content-type'),
    )}.`,
  );
}
if (!coverResponse.headers.get('cache-control')?.includes('s-maxage=86400')) {
  fail(`${coverUrl} не содержит edge-кеширование на 24 часа.`);
}

const preflightUrl = `${apiOrigin}/api/send`;
const preflight = await fetchWithTimeout(preflightUrl, {
  method: 'OPTIONS',
  headers: {
    Origin: appOrigin,
    'Access-Control-Request-Method': 'POST',
    'Access-Control-Request-Headers': 'Content-Type',
  },
});
if (preflight.status !== 204) {
  fail(`${preflightUrl} вернул HTTP ${preflight.status}, ожидался 204.`);
}
assertCors(preflight, preflightUrl, appOrigin);
assertAllowedValues(
  preflight,
  'access-control-allow-methods',
  ['post', 'options'],
  preflightUrl,
);
assertAllowedValues(
  preflight,
  'access-control-allow-headers',
  ['content-type'],
  preflightUrl,
);

console.log(
  `Cloudflare deployment проверен: Worker ${workerName}, ${apiOrigin}, CORS, Spotify cover и OPTIONS /api/send работают.`,
);