import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
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
const expectedFrontendIndexPath = path.resolve(
  scriptDirectory,
  '..',
  'dist',
  'index.html',
);
const smokeTestSpotifyImage =
  'https://i.scdn.co/image/ab67616d0000b273571cd5cb21a8f4fc16d992d3';
const requestTimeoutMs = 15_000;
const probeResultTimeoutMs = 45_000;
const probePollIntervalMs = 1_000;
const russianProbeApiOrigin = (
  process.env.RUSSIAN_PROBE_API_ORIGIN || 'https://check-host.net'
).replace(/\/+$/, '');
const russianProbeNodes = (
  process.env.RUSSIAN_PROBE_NODES ||
  'ru2.node.check-host.net,ru3.node.check-host.net'
)
  .split(',')
  .map((node) => node.trim())
  .filter(Boolean);
const maxRussianProbeResponseMs = Number(
  process.env.RUSSIAN_PROBE_MAX_RESPONSE_MS || 5_000,
);

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

function parseAssetReferences(html) {
  return [
    ...html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.(?:js|css))"/g),
  ].map((match) => match[1]);
}

function assetHash(assetPath) {
  return assetPath.match(/\/assets\/[^/]+-([A-Za-z0-9_-]+)\.(?:js|css)$/)?.[1];
}

function responseContentType(response) {
  return response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
}

async function assertFrontendVersion() {
  let expectedIndex;
  try {
    expectedIndex = await readFile(expectedFrontendIndexPath, 'utf8');
  } catch {
    fail(
      `не найден ${expectedFrontendIndexPath}; сначала выполните npm run build перед проверкой frontend.`,
    );
  }

  const expectedAssets = parseAssetReferences(expectedIndex);
  if (!expectedAssets.length) {
    fail(`в ${expectedFrontendIndexPath} не найдены хешированные assets.`);
  }

  const frontendResponse = await fetchWithTimeout(`${expectedAppOrigin}/`, {
    headers: { Accept: 'text/html' },
    cache: 'no-store',
  });
  if (!frontendResponse.ok) {
    fail(
      `${expectedAppOrigin}/ вернул HTTP ${frontendResponse.status}, ожидался HTTP 200.`,
    );
  }
  if (responseContentType(frontendResponse) !== 'text/html') {
    fail(
      `${expectedAppOrigin}/ вернул неожиданный Content-Type: ${JSON.stringify(
        frontendResponse.headers.get('content-type'),
      )}.`,
    );
  }

  const liveIndex = await frontendResponse.text();
  const liveAssets = parseAssetReferences(liveIndex);
  const missingAssets = expectedAssets.filter((asset) => !liveAssets.includes(asset));
  if (missingAssets.length) {
    const expectedHashes = expectedAssets.map(assetHash).filter(Boolean);
    const liveHashes = liveAssets.map(assetHash).filter(Boolean);
    fail(
      `VK Cloud отдаёт неактуальный frontend: ожидались assets ${expectedHashes.join(
        ', ',
      )}, получены ${liveHashes.join(', ') || 'без хешированных assets'}.`,
    );
  }

  for (const assetPath of expectedAssets) {
    const expectedAsset = await readFile(
      path.resolve(scriptDirectory, '..', 'dist', assetPath.replace(/^\//, '')),
    );
    const liveAssetResponse = await fetchWithTimeout(
      new URL(assetPath, expectedAppOrigin),
      { headers: { Accept: '*/*' }, cache: 'no-store' },
    );
    if (!liveAssetResponse.ok) {
      fail(
        `${new URL(assetPath, expectedAppOrigin)} вернул HTTP ${
          liveAssetResponse.status
        }, ожидался HTTP 200.`,
      );
    }
    const liveAsset = Buffer.from(await liveAssetResponse.arrayBuffer());
    const expectedDigest = createHash('sha256').update(expectedAsset).digest('hex');
    const liveDigest = createHash('sha256').update(liveAsset).digest('hex');
    if (expectedDigest !== liveDigest) {
      fail(
        `frontend asset ${assetPath} имеет другой hash: ожидался ${expectedDigest}, получен ${liveDigest}.`,
      );
    }
  }

  console.log(
    `Frontend проверен: ${expectedAssets
      .map((asset) => `${asset} (${assetHash(asset) || 'без hash'})`)
      .join(', ')}.`,
  );
}

function parseProbeResult(payload, node) {
  const result = payload?.[node];
  const sample = Array.isArray(result?.[0]) ? result[0] : result;
  if (!Array.isArray(sample)) return null;

  const [ok, elapsedSeconds, message, status] = sample;
  return {
    ok: ok === 1,
    elapsedMs: Number(elapsedSeconds) * 1_000,
    message,
    status: status == null ? null : String(status),
  };
}

async function startRussianHttpProbe(url) {
  const probeUrl = new URL(`${russianProbeApiOrigin}/check-http`);
  probeUrl.searchParams.set('host', url);
  for (const node of russianProbeNodes) {
    probeUrl.searchParams.append('node', node);
  }

  const response = await fetchWithTimeout(probeUrl, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!response.ok) {
    fail(
      `российская probe-точка ${probeUrl.origin} вернула HTTP ${response.status}.`,
    );
  }
  const payload = await response.json().catch(() => null);
  if (payload?.ok !== 1 || !payload.request_id) {
    fail(`probe ${probeUrl} вернул неожиданный ответ: ${JSON.stringify(payload)}.`);
  }
  const returnedNodes = Object.keys(payload.nodes || {});
  const missingNodes = russianProbeNodes.filter(
    (node) => !returnedNodes.includes(node),
  );
  if (missingNodes.length) {
    fail(
      `probe ${probeUrl} не принял российские узлы: ${missingNodes.join(', ')}.`,
    );
  }
  const nonRussianNodes = russianProbeNodes.filter(
    (node) => payload.nodes[node]?.[0] !== 'ru',
  );
  if (nonRussianNodes.length) {
    fail(
      `probe ${probeUrl} вернул не российские узлы: ${nonRussianNodes.join(', ')}.`,
    );
  }
  return payload.request_id;
}

async function waitForRussianHttpProbe(requestId) {
  const deadline = Date.now() + probeResultTimeoutMs;
  let payload;
  while (Date.now() <= deadline) {
    const response = await fetchWithTimeout(
      `${russianProbeApiOrigin}/check-result/${encodeURIComponent(requestId)}`,
      {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      },
    );
    if (!response.ok) {
      fail(
        `результат российской probe-проверки ${requestId} вернул HTTP ${response.status}.`,
      );
    }
    payload = await response.json().catch(() => null);
    if (
      russianProbeNodes.every((node) => {
        const result = parseProbeResult(payload, node);
        return result && Number.isFinite(result.elapsedMs);
      })
    ) {
      return payload;
    }
    await new Promise((resolve) => setTimeout(resolve, probePollIntervalMs));
  }

  fail(
    `российская probe-проверка ${requestId} не завершилась за ${
      probeResultTimeoutMs / 1_000
    } с: ${JSON.stringify(payload)}.`,
  );
}

function assertRussianProbeResults(url, payload, phase) {
  for (const node of russianProbeNodes) {
    const result = parseProbeResult(payload, node);
    if (!result) {
      fail(`${url} (${phase}) не вернул результат узла ${node}.`);
    }
    if (!result.ok || result.status !== '200') {
      fail(
        `${url} (${phase}) через ${node} вернул HTTP ${
          result.status || 'без статуса'
        } (${result.message || 'без сообщения'}).`,
      );
    }
    if (!Number.isFinite(result.elapsedMs)) {
      fail(`${url} (${phase}) через ${node} не вернул время ответа.`);
    }
    if (phase === 'после прогрева' && result.elapsedMs > maxRussianProbeResponseMs) {
      fail(
        `${url} (${phase}) через ${node} отвечал ${Math.round(
          result.elapsedMs,
        )} мс, максимум ${maxRussianProbeResponseMs} мс.`,
      );
    }
  }
}

async function assertRussianReachability(url) {
  const warmupRequestId = await startRussianHttpProbe(url);
  const warmupResults = await waitForRussianHttpProbe(warmupRequestId);
  assertRussianProbeResults(url, warmupResults, 'прогрев');

  const measuredRequestId = await startRussianHttpProbe(url);
  const measuredResults = await waitForRussianHttpProbe(measuredRequestId);
  assertRussianProbeResults(url, measuredResults, 'после прогрева');

  const timings = russianProbeNodes.map((node) => {
    const result = parseProbeResult(measuredResults, node);
    return `${node}=${Math.round(result.elapsedMs)} мс`;
  });
  console.log(`Российские probe-точки: ${url} — ${timings.join(', ')}.`);
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

if (!russianProbeNodes.length) {
  fail('не заданы российские probe-точки в RUSSIAN_PROBE_NODES.');
}
if (!Number.isFinite(maxRussianProbeResponseMs) || maxRussianProbeResponseMs <= 0) {
  fail('RUSSIAN_PROBE_MAX_RESPONSE_MS должен быть положительным числом.');
}

await assertRussianReachability(expectedAppOrigin);
await assertRussianReachability(`${apiOrigin}/api/healthz`);

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
await assertRussianReachability(coverUrl);
await assertFrontendVersion();

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
  `Cloudflare deployment проверен: Worker ${workerName}, ${apiOrigin}, российские probe-точки, frontend hash, CORS, Spotify cover и OPTIONS /api/send работают.`,
);