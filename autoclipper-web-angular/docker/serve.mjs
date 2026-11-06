import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';

const port = Number(process.env.PORT ?? 4200);
const root = resolve(process.env.STATIC_ROOT ?? '/app/browser');
const apiBaseUrl = new URL(process.env.PUBLIC_API_BASE_URL ?? 'http://localhost:3005/v1');

if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
if (!['http:', 'https:'].includes(apiBaseUrl.protocol) || apiBaseUrl.username || apiBaseUrl.password || apiBaseUrl.search || apiBaseUrl.hash) {
  throw new Error('PUBLIC_API_BASE_URL must be a public HTTP(S) URL without credentials, query, or fragment');
}

const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'], ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'], ['.jpeg', 'image/jpeg'], ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'], ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'], ['.svg', 'image/svg+xml'], ['.webp', 'image/webp'],
  ['.woff', 'font/woff'], ['.woff2', 'font/woff2'],
]);

function headers(response) {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'no-referrer');
}

function sendJson(request, response, status, value) {
  headers(response);
  response.writeHead(status, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' });
  response.end(request.method === 'HEAD' ? undefined : JSON.stringify(value));
}

async function resolveFile(pathname) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return null; }
  if (decoded.includes('\0') || decoded.includes('\\')) return null;

  const candidate = resolve(root, `.${decoded}`);
  if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) return null;
  try {
    const info = await stat(candidate);
    if (info.isFile()) return { path: candidate, info };
    if (info.isDirectory()) {
      const index = resolve(candidate, 'index.html');
      const indexInfo = await stat(index);
      if (indexInfo.isFile()) return { path: index, info: indexInfo };
    }
  } catch { /* Fall through to the SPA route or 404. */ }
  return null;
}

const server = createServer(async (request, response) => {
  headers(response);
  if (!['GET', 'HEAD'].includes(request.method ?? '')) {
    response.writeHead(405, { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' }).end();
    return;
  }

  let pathname;
  try { pathname = new URL(request.url ?? '/', 'http://localhost').pathname; }
  catch { sendJson(request, response, 400, { error: 'Invalid request path' }); return; }

  if (pathname === '/health/ready') {
    sendJson(request, response, 200, { status: 'ready' });
    return;
  }
  if (pathname === '/config.json') {
    sendJson(request, response, 200, { apiBaseUrl: apiBaseUrl.href.replace(/\/$/, '') });
    return;
  }

  let file = await resolveFile(pathname);
  if (!file && !extname(pathname)) file = await resolveFile('/index.html');
  if (!file) { sendJson(request, response, 404, { error: 'Not found' }); return; }

  const isHtml = extname(file.path) === '.html';
  const hashedAsset = /\.[a-f0-9]{8,}\./i.test(file.path);
  response.writeHead(200, {
    'Cache-Control': isHtml ? 'no-cache' : hashedAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
    'Content-Length': file.info.size,
    'Content-Type': contentTypes.get(extname(file.path)) ?? 'application/octet-stream',
  });
  if (request.method === 'HEAD') { response.end(); return; }
  const stream = createReadStream(file.path);
  stream.on('error', () => { if (!response.headersSent) response.writeHead(500); response.end(); });
  stream.pipe(response);
});

server.listen(port, '0.0.0.0');
