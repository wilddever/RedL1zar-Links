import { createServer } from 'node:net';
import { execFile, spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const productionUrl = 'https://xn--d1ax3b.fun/';
const apiOrigin = 'https://api.xn--d1ax3b.fun';
const chromiumPath = process.env.CHROMIUM_PATH || '/repl/tools/bin/chromium';
const viewport = { width: 1440, height: 1000 };
const durationMs = Number(process.env.TASK40_DURATION_MS || 30 * 60 * 1000);
const sampleIntervalMs = 1_000;
const screenshotIntervalMs = 60_000;
const coverTimeoutMs = 6_000;
const outputDir = process.env.TASK40_OUTPUT_DIR || 'reports/task-40/observation';

if (!Number.isFinite(durationMs) || durationMs <= 0) {
  throw new Error('TASK40_DURATION_MS must be a positive number');
}

await mkdir(outputDir, { recursive: true });
const eventsPath = `${outputDir}/events.jsonl`;
const summaryPath = `${outputDir}/summary.json`;
const events = [];
const samples = [];
const networkRequests = new Map();
const trackChanges = [];
const incidents = [];
const errors = [];
const startTime = new Date();
let sequence = 0;
let lastTrackKey = null;
let lastUiSignature = null;
let lastScreenshotAt = 0;
let browserClient;

function now() {
  return new Date().toISOString();
}

async function record(type, payload = {}) {
  const event = { sequence: ++sequence, timestamp: now(), type, ...payload };
  events.push(event);
  await writeFile(eventsPath, `${events.map((item) => JSON.stringify(item)).join('\n')}\n`);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function waitForCdp(port, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      const page = targets.find((target) => target.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for Chromium: ${lastError?.message || 'unknown error'}`);
}

class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 0;
    this.pending = new Map();
    this.listeners = new Map();
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
        return;
      }
      for (const listener of this.listeners.get(message.method) || []) {
        listener(message.params);
      }
    });
  }

  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    return new CdpClient(socket);
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) || [];
    listeners.push(listener);
    this.listeners.set(method, listeners);
  }

  send(method, params = {}) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.socket.close();
  }
}

function isObservedApiRequest(url) {
  return /\/api\/spotify\/(currently-playing|cover)(?:\?|$)/.test(url);
}

function requestKind(url) {
  return url.includes('/api/spotify/cover') ? 'cover' : 'currently-playing';
}

function headerSubset(headers) {
  const selected = [
    'cache-control',
    'content-length',
    'content-type',
    'date',
    'etag',
    'vary',
    'x-content-type-options',
    'cf-cache-status',
    'server-timing',
  ];
  return Object.fromEntries(
    selected
      .map((name) => [name, headers[name] || headers[name.toLowerCase()]])
      .filter(([, value]) => value != null),
  );
}

async function evaluate(expression) {
  const result = await browserClient.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  return result.result.value;
}

async function snapshot() {
  return evaluate(`(() => {
    const card = document.querySelector('.now-playing-card');
    const image = document.querySelector('.now-playing-art:not(.now-playing-art--empty)');
    const liquid = document.querySelector('.now-playing-liquid-art');
    const cardRect = card?.getBoundingClientRect();
    const imageRect = image?.getBoundingClientRect();
    const insideCard = Boolean(cardRect && imageRect &&
      imageRect.left >= cardRect.left - 1 &&
      imageRect.top >= cardRect.top - 1 &&
      imageRect.right <= cardRect.right + 1 &&
      imageRect.bottom <= cardRect.bottom + 1);
    const cardCoverReady = Boolean(image?.complete && image.naturalWidth > 0 && image.naturalHeight > 0);
    const liquidCoverReady = Boolean(liquid?.complete && liquid.naturalWidth > 0 && liquid.naturalHeight > 0);
    const hasCardFallback = Boolean(document.querySelector('.now-playing-art--empty'));
    const hasLiquidFallback = Boolean(document.querySelector('.now-playing-liquid-fallback'));
    const title = document.querySelector('.now-playing-copy strong')?.textContent?.trim() || null;
    const artist = document.querySelector('.now-playing-copy > span:nth-of-type(2)')?.textContent?.trim() || null;
    const album = document.querySelector('.now-playing-copy small')?.textContent?.trim() || null;
    return {
      title,
      artist,
      album,
      trackKey: title && artist && album ? [title, artist, album].join(' — ') : null,
      card: Boolean(card),
      cardCoverReady,
      liquidCoverReady,
      cardCoverSrc: image?.src || null,
      liquidCoverSrc: liquid?.src || null,
      sharedCoverSrc: Boolean(image?.src && image.src === liquid?.src),
      hasCardFallback,
      hasLiquidFallback,
      insideCard,
      imageNaturalSize: image ? [image.naturalWidth, image.naturalHeight] : null,
      liquidNaturalSize: liquid ? [liquid.naturalWidth, liquid.naturalHeight] : null,
      imageRect: imageRect ? {
        left: imageRect.left, top: imageRect.top, right: imageRect.right, bottom: imageRect.bottom,
        width: imageRect.width, height: imageRect.height
      } : null,
      cardRect: cardRect ? {
        left: cardRect.left, top: cardRect.top, right: cardRect.right, bottom: cardRect.bottom,
        width: cardRect.width, height: cardRect.height
      } : null,
      viewport: [innerWidth, innerHeight],
      scrollY,
    };
  })()`);
}

function classifyUi(snapshotValue) {
  if (!snapshotValue?.card) return 'no-card';
  if (snapshotValue.hasCardFallback) return 'spotify-icon-fallback';
  if (!snapshotValue.cardCoverReady) return 'card-cover-incomplete';
  if (snapshotValue.hasLiquidFallback || !snapshotValue.liquidCoverReady) return 'liquid-glass-fallback';
  if (!snapshotValue.sharedCoverSrc) return 'card-liquid-source-mismatch';
  if (!snapshotValue.insideCard) return 'card-image-outside-card';
  return 'cover-success';
}

async function takeScreenshot(label) {
  const safeLabel = label.replace(/[^a-z0-9_-]+/gi, '-').slice(0, 80);
  const result = await browserClient.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
  });
  const path = `${outputDir}/screenshot-${String(sequence).padStart(5, '0')}-${safeLabel}.png`;
  await writeFile(path, Buffer.from(result.data, 'base64'));
  await record('screenshot', { path, label });
}

async function recordSnapshot(reason) {
  const value = await snapshot();
  const classification = classifyUi(value);
  const sample = { reason, classification, ...value };
  samples.push({ timestamp: now(), ...sample });
  await record('ui-snapshot', sample);

  if (value.trackKey && value.trackKey !== lastTrackKey) {
    const change = {
      from: lastTrackKey,
      to: value.trackKey,
      classification,
      cardCoverSrc: value.cardCoverSrc,
    };
    trackChanges.push({ timestamp: now(), ...change });
    await record('track-change', change);
    lastTrackKey = value.trackKey;
  }

  const signature = [
    classification,
    value.cardCoverSrc,
    value.liquidCoverSrc,
    value.trackKey,
  ].join('|');
  if (classification !== 'cover-success' && signature !== lastUiSignature) {
    const incident = { classification, ...value };
    incidents.push({ timestamp: now(), ...incident });
    await record('visual-incident', incident);
    await takeScreenshot(`incident-${classification}`);
  }
  lastUiSignature = signature;
  return value;
}

async function fetchBaseline() {
  const response = await fetch(productionUrl, {
    headers: { Accept: 'text/html', 'Cache-Control': 'no-cache' },
  });
  const html = await response.text();
  const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.(?:js|css))"/g)].map(
    (match) => match[1],
  );
  let browserVersion = 'unknown';
  try {
    browserVersion = (await execFileAsync(chromiumPath, ['--version'])).stdout.trim();
  } catch {
    // The running browser remains the source of the CDP evidence.
  }
  return {
    startedAt: startTime.toISOString(),
    productionUrl,
    apiOrigin,
    viewport,
    browserVersion,
    index: {
      status: response.status,
      contentType: response.headers.get('content-type'),
      cacheControl: response.headers.get('cache-control'),
      etag: response.headers.get('etag'),
      lastModified: response.headers.get('last-modified'),
      assets,
      assetHashes: assets
        .map((asset) => asset.match(/\/assets\/[^/]+-([A-Za-z0-9_-]+)\.(?:js|css)$/)?.[1])
        .filter(Boolean),
    },
  };
}

const baseline = await fetchBaseline();
await record('baseline', baseline);
const cdpPort = await freePort();
const browser = spawn(
  chromiumPath,
  [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--lang=ru-RU',
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=/tmp/task40-production-${process.pid}-${cdpPort}`,
    `--window-size=${viewport.width},${viewport.height}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);

try {
  const target = (await (async () => {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      try {
        const targets = await fetch(`http://127.0.0.1:${cdpPort}/json/list`).then((value) =>
          value.json(),
        );
        const page = targets.find((item) => item.type === 'page');
        if (page?.webSocketDebuggerUrl) return page;
      } catch {
        // Wait for Chromium's debugging endpoint.
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('Timed out waiting for Chromium debugging endpoint');
  })());
  browserClient = await CdpClient.connect(target.webSocketDebuggerUrl);
  browserClient.on('Network.requestWillBeSent', (payload) => {
    if (!isObservedApiRequest(payload.request.url)) return;
    networkRequests.set(payload.requestId, {
      requestId: payload.requestId,
      kind: requestKind(payload.request.url),
      url: payload.request.url,
      method: payload.request.method,
      startedAt: Date.now(),
      requestHeaders: headerSubset(payload.request.headers || {}),
    });
  });
  browserClient.on('Network.responseReceived', (payload) => {
    const request = networkRequests.get(payload.requestId);
    if (!request && payload.response.status >= 400) {
      void record('network-http-error', {
        url: payload.response.url,
        status: payload.response.status,
        mimeType: payload.response.mimeType,
        headers: headerSubset(payload.response.headers || {}),
        remoteAddress: payload.response.remoteIPAddress || null,
      });
      return;
    }
    if (!request) return;
    request.response = {
      status: payload.response.status,
      mimeType: payload.response.mimeType,
      headers: headerSubset(payload.response.headers || {}),
      remoteAddress: payload.response.remoteIPAddress || null,
      protocol: payload.response.protocol || null,
    };
  });
  browserClient.on('Network.loadingFailed', (payload) => {
    const request = networkRequests.get(payload.requestId);
    if (!request) return;
    const event = {
      ...request,
      durationMs: Date.now() - request.startedAt,
      failed: true,
      errorText: payload.errorText,
      canceled: payload.canceled || false,
    };
    networkRequests.delete(payload.requestId);
    errors.push(event);
    void record('network-failure', event);
    if (request.kind === 'cover') {
      void takeScreenshot('network-cover-failure');
    }
  });
  browserClient.on('Network.loadingFinished', (payload) => {
    const request = networkRequests.get(payload.requestId);
    if (!request) return;
    void (async () => {
      let body = null;
      if (request.kind === 'currently-playing') {
        try {
          body = (await browserClient.send('Network.getResponseBody', {
            requestId: payload.requestId,
          })).body;
        } catch {
          body = null;
        }
      }
      const event = {
        ...request,
        durationMs: Date.now() - request.startedAt,
        encodedDataLength: payload.encodedDataLength,
        body: body ? body.slice(0, 20_000) : undefined,
      };
      networkRequests.delete(payload.requestId);
      await record('network-response', event);
      if (request.kind === 'cover' && event.durationMs > coverTimeoutMs) {
        incidents.push({ timestamp: now(), classification: 'cover-timeout', network: event });
        await record('network-incident', {
          classification: 'cover-timeout',
          network: event,
        });
      }
    })().catch((error) => errors.push({ timestamp: now(), error: String(error) }));
  });
  browserClient.on('Runtime.exceptionThrown', (payload) => {
    const item = {
      text: payload.exceptionDetails?.text || 'runtime exception',
      description: payload.exceptionDetails?.exception?.description || null,
    };
    errors.push({ timestamp: now(), ...item });
    void record('runtime-exception', item);
  });
  browserClient.on('Log.entryAdded', (payload) => {
    if (payload.entry.level === 'error') {
      const item = { text: payload.entry.text, source: payload.entry.source };
      errors.push({ timestamp: now(), ...item });
      void record('browser-console-error', item);
    }
  });

  await browserClient.send('Network.enable');
  await browserClient.send('Runtime.enable');
  await browserClient.send('Log.enable');
  await browserClient.send('Page.enable');
  await browserClient.send('Emulation.setDeviceMetricsOverride', {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await browserClient.send('Page.navigate', { url: productionUrl });
  await record('browser-start', { productionUrl, viewport });
  await new Promise((resolve) => setTimeout(resolve, 2_500));
  await recordSnapshot('after-navigation');
  await takeScreenshot('start');

  const endAt = Date.now() + durationMs;
  while (Date.now() < endAt) {
    await new Promise((resolve) => setTimeout(resolve, sampleIntervalMs));
    const value = await recordSnapshot('interval');
    if (Date.now() - lastScreenshotAt >= screenshotIntervalMs) {
      await takeScreenshot(value ? classifyUi(value) : 'interval');
      lastScreenshotAt = Date.now();
    }
  }
} catch (error) {
  errors.push({ timestamp: now(), error: error.stack || String(error) });
  await record('observer-error', { error: error.stack || String(error) });
} finally {
  browserClient?.close();
  browser.kill('SIGTERM');
}

const endTime = new Date();
const summary = {
  ...baseline,
  endedAt: endTime.toISOString(),
  durationMs: endTime.getTime() - startTime.getTime(),
  sampleCount: samples.length,
  trackChangeCount: Math.max(0, trackChanges.length - 1),
  trackChanges,
  visualIncidentCount: incidents.length,
  visualIncidents: incidents,
  browserErrorCount: errors.length,
  browserErrors: errors,
  uiCounts: Object.fromEntries(
    [...new Set(samples.map((sample) => sample.classification))].map((classification) => [
      classification,
      samples.filter((sample) => sample.classification === classification).length,
    ]),
  ),
  networkResponseCounts: {
    currentlyPlaying: events.filter(
      (event) => event.type === 'network-response' && event.kind === 'currently-playing',
    ).length,
    cover: events.filter((event) => event.type === 'network-response' && event.kind === 'cover')
      .length,
  },
};
await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));