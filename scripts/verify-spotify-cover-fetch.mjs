import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const repoRoot = new URL('..', import.meta.url).pathname;
const chromiumPath = process.env.CHROMIUM_PATH || '/repl/tools/bin/chromium';
const coverImage = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

const variants = [
  {
    name: 'personal-links',
    command: 'pnpm',
    args: ['--filter', '@workspace/personal-links', 'run', 'dev'],
    env: { BASE_PATH: '/' },
  },
  {
    name: 'cloudflare',
    command: 'pnpm',
    args: ['--dir', 'cloudflare', 'exec', 'vite', '--host', '127.0.0.1'],
    env: {},
  },
];

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close((error) => {
        if (error) reject(error);
        else resolve(address.port);
      });
    });
  });
}

async function waitForHttp(url, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status === 404) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError?.message ?? 'unknown error'}`);
}

function writeJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  response.end(body);
}

function createApiProxy(vitePort, coverMode) {
  let coverRequests = 0;
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');

    if (url.pathname === '/api/spotify/currently-playing') {
      writeJson(response, 200, {
        status: 'playing',
        track: {
          title: 'Regression Signal',
          artist: 'Cover Request Test',
          album: 'One Fetch',
          imageUrl: 'https://i.scdn.co/image/regression-cover',
          spotifyUrl: 'https://open.spotify.com/track/regression',
        },
        message: 'browser regression test',
      });
      return;
    }

    if (url.pathname === '/api/spotify/cover') {
      coverRequests += 1;
      if (coverMode === 'error') {
        response.writeHead(502);
        response.end();
      } else if (coverMode === 'timeout') {
        setTimeout(() => {
          if (!response.destroyed) response.end(coverImage);
        }, 7_000);
      } else {
        response.writeHead(200, {
          'Cache-Control': 'no-store',
          'Content-Type': 'image/png',
          'Content-Length': coverImage.byteLength,
        });
        response.end(coverImage);
      }
      return;
    }

    if (url.pathname === '/api/yandex/track') {
      writeJson(response, 200, { url: 'https://music.yandex.ru/track/regression' });
      return;
    }

    if (url.pathname === '/api/steam/currently-playing') {
      writeJson(response, 200, {
        status: 'not_playing',
        game: null,
        message: 'browser regression test',
      });
      return;
    }

    const upstream = httpRequest(
      {
        hostname: '127.0.0.1',
        port: vitePort,
        path: request.url,
        method: request.method,
        headers: { ...request.headers, host: `127.0.0.1:${vitePort}` },
      },
      (upstreamResponse) => {
        response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
        upstreamResponse.pipe(response);
      },
    );
    upstream.on('error', () => {
      if (!response.headersSent) response.writeHead(502);
      response.end();
    });
    request.pipe(upstream);
  });

  return {
    server,
    get coverRequests() {
      return coverRequests;
    },
  };
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function closeServer(server) {
  return new Promise((resolve) => {
    server.close(() => resolve());
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
    await delay(100);
  }
  throw new Error(`Timed out waiting for Chromium: ${lastError?.message ?? 'unknown error'}`);
}

class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 0;
    this.pending = new Map();
  }

  static connect(url) {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      socket.addEventListener('open', () => resolve(new CdpClient(socket)));
      socket.addEventListener('error', reject, { once: true });
    });
  }

  send(method, params = {}) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  start() {
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }

  close() {
    this.socket.close();
  }
}

async function evaluate(client, expression) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  return result.result.value;
}

async function waitForPage(client, expression, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(client, expression)) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for page condition: ${expression}`);
}

async function runBrowserCheck(url, coverMode, expectedCoverRequests) {
  const cdpPort = await getFreePort();
  const browser = spawn(
    chromiumPath,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=/tmp/spotify-cover-check-${process.pid}-${cdpPort}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  try {
    const socketUrl = await waitForCdp(cdpPort);
    const client = await CdpClient.connect(socketUrl);
    client.start();
    await client.send('Runtime.enable');
    await client.send('Page.enable');
    await client.send('Page.navigate', { url });

    const waitMs = coverMode === 'timeout' ? 8_000 : 4_000;
    if (coverMode === 'success') {
      await waitForPage(
        client,
        `document.querySelectorAll('.now-playing-art:not(.now-playing-art--empty), .now-playing-liquid-art').length === 2`,
        waitMs,
      );
      await delay(250);
      const state = await evaluate(
        client,
        `(() => {
          const images = [...document.querySelectorAll('.now-playing-art, .now-playing-liquid-art')];
          return {
            sources: images.map((image) => image.getAttribute('src')),
            hasFallback: Boolean(document.querySelector('.now-playing-art--empty, .now-playing-liquid-fallback')),
          };
        })()`,
      );
      assert.equal(state.sources.length, 2, `${coverMode}: expected two cover images`);
      assert.ok(state.sources.every((source) => source?.startsWith('blob:')), `${coverMode}: expected blob URLs`);
      assert.equal(new Set(state.sources).size, 1, `${coverMode}: card and background must share one object URL`);
      assert.equal(state.hasFallback, false, `${coverMode}: successful cover should not show fallback`);
    } else {
      await waitForPage(
        client,
        `Boolean(document.querySelector('.now-playing-art--empty')) && Boolean(document.querySelector('.now-playing-liquid-fallback'))`,
        waitMs,
      );
      const state = await evaluate(
        client,
        `({
          cardFallback: Boolean(document.querySelector('.now-playing-art--empty')),
          liquidFallback: Boolean(document.querySelector('.now-playing-liquid-fallback')),
          renderedImages: document.querySelectorAll('.now-playing-art:not(.now-playing-art--empty), .now-playing-liquid-art').length
        })`,
      );
      assert.equal(state.cardFallback, true, `${coverMode}: card fallback is missing`);
      assert.equal(state.liquidFallback, true, `${coverMode}: liquid fallback is missing`);
      assert.equal(state.renderedImages, 0, `${coverMode}: failed cover must not render an image`);
    }
    assert.equal(expectedCoverRequests(), 1, `${coverMode}: expected exactly one cover request`);
    client.close();
  } finally {
    browser.kill('SIGTERM');
  }
}

async function runVariant(variant) {
  const vitePort = await getFreePort();
  const args =
    variant.name === 'cloudflare'
      ? [...variant.args, '--port', String(vitePort)]
      : variant.args;
  const vite = spawn(variant.command, args, {
    cwd: repoRoot,
    env: { ...process.env, ...variant.env, PORT: String(vitePort) },
    stdio: 'ignore',
  });

  try {
    await waitForHttp(`http://127.0.0.1:${vitePort}/`);
    for (const coverMode of ['success', 'error', 'timeout']) {
      const apiProxy = createApiProxy(vitePort, coverMode);
      const proxyPort = await listen(apiProxy.server);
      try {
        await runBrowserCheck(
          `http://127.0.0.1:${proxyPort}/`,
          coverMode,
          () => apiProxy.coverRequests,
        );
      } finally {
        await closeServer(apiProxy.server);
      }
    }
    console.log(`✓ ${variant.name}: one request, error fallback, and timeout fallback`);
  } finally {
    vite.kill('SIGTERM');
  }
}

for (const variant of variants) {
  await runVariant(variant);
}

console.log('Spotify cover browser regression passed for both frontend versions.');