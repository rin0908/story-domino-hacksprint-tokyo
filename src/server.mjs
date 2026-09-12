import http from 'node:http';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createApplication } from './application.mjs';
import { createServices } from './services.mjs';
import { safeError } from './config.mjs';

const headers = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
};
const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/setup', ['setup.html', 'text/html; charset=utf-8']],
  ['/setup.js', ['setup.js', 'text/javascript; charset=utf-8']],
]);

export function createServer(app) {
  return http.createServer(async (req, res) => {
    const json = (status, data) => { res.writeHead(status, { ...headers, 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
    try {
      const host = req.headers.host || '';
      if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return json(403, { error: safeError('request', 'FORBIDDEN') });
      const path = new URL(req.url, `http://${host}`).pathname;
      if (req.method === 'GET' && files.has(path)) {
        const [name, type] = files.get(path);
        const content = await readFile(new URL(`../public/${name}`, import.meta.url));
        res.writeHead(200, { ...headers, 'Content-Type': type });
        return res.end(content);
      }
      if (!path.startsWith('/api/')) return json(404, { error: safeError('request', 'INVALID_REQUEST') });
      let body = {};
      if (req.method === 'POST') {
        const origin = req.headers.origin;
        if ((origin && origin !== `http://${host}`) || req.headers['sec-fetch-site'] === 'cross-site') return json(403, { error: safeError('request', 'FORBIDDEN') });
        if (!req.headers['content-type']?.startsWith('application/json')) return json(415, { error: safeError('request', 'INVALID_REQUEST') });
        let bytes = 0;
        const chunks = [];
        for await (const chunk of req) {
          bytes += chunk.length;
          if (bytes > 2048) return json(413, { error: safeError('request', 'INVALID_REQUEST') });
          chunks.push(chunk);
        }
        try { body = JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch { return json(400, { error: safeError('request', 'INVALID_REQUEST') }); }
        if (!body || Array.isArray(body) || typeof body !== 'object') return json(400, { error: safeError('request', 'INVALID_REQUEST') });
      }
      if (path === '/api/setup/daytona-key') {
        // A local-only write surface: no GET, no read-back, no credential logging.
        if (req.method !== 'POST' || req.headers.origin !== `http://${host}`) return json(403, { error: safeError('request', 'FORBIDDEN') });
        if (typeof body.apiKey !== 'string' || !/^[A-Za-z0-9._~=-]{16,512}$/.test(body.apiKey.trim())) return json(400, { error: { code: 'INVALID_KEY', message: 'APIキーの形式を確認してください。' } });
        const envPath = new URL('../.env', import.meta.url);
        const pending = new URL('../.env.pending', import.meta.url);
        const content = await readFile(envPath, 'utf8').catch(() => '');
        const entry = `DAYTONA_API_KEY=${JSON.stringify(body.apiKey.trim())}`;
        const next = /^DAYTONA_API_KEY=.*$/m.test(content) ? content.replace(/^DAYTONA_API_KEY=.*$/m, () => entry) : `${content}\n${entry}\n`;
        await writeFile(pending, next, { mode: 0o600 });
        await rename(pending, envPath);
        return json(200, { saved: true, message: '保存しました。サーバーを再起動すると反映されます。' });
      }
      const result = await app.dispatch(req.method, path, body);
      json(200, result);
    } catch (error) {
      // Never log or serialize raw errors: SDKs may include credentials and URLs.
      json(error.status || 500, { error: safeError(error.stage, error.code) });
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const services = createServices(process.env);
  const app = createApplication({ services });
  const server = createServer(app);
  const port = Number(process.env.PORT || 3210);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT must be an integer from 1024 to 65535');
  server.requestTimeout = 180000;
  server.headersTimeout = 10000;
  server.on('error', () => { console.error('ローカルサーバーを起動できません。PORTの使用状況を確認してください。'); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`物語のドミノ: http://127.0.0.1:${port}`));
  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    server.close(async () => { await services.close(); process.exit(0); });
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
