#!/usr/bin/env node
// Tiny local server: serves the app and keeps the current job in a file so a
// phone on the same Wi-Fi sees the same job as the computer.
// No dependencies, no accounts, nothing leaves your network.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(ROOT, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const PORT = Number(process.env.PORT) || 5173;
const HOST = process.env.HOST || '0.0.0.0';
const MAX_BODY = 8 * 1024 * 1024;

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
};
// only the app itself is served — not tests, data, or anything else in the folder
const PUBLIC = [/^\/index\.html$/, /^\/styles\.css$/, /^\/cabinet-optimizer\.html$/, /^\/src\/(engine|ui)\/[\w.-]+\.js$/];

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers });
  res.end(body);
}

function handleState(req, res) {
  const headers = { 'x-cabinet-optimizer': '1', 'content-type': 'application/json; charset=utf-8' };
  if (req.method === 'GET') {
    fs.readFile(STATE_FILE, (err, buf) => (err ? send(res, 204, '', headers) : send(res, 200, buf, headers)));
    return;
  }
  if (req.method === 'PUT') {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { send(res, 413, '{"error":"too large"}', headers); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (res.writableEnded) return;
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        const parsed = JSON.parse(text);
        if (!parsed || typeof parsed !== 'object' || !parsed.job) throw new Error('not a job');
        fs.mkdirSync(DATA_DIR, { recursive: true });
        const tmp = `${STATE_FILE}.tmp`;
        fs.writeFileSync(tmp, text);
        fs.renameSync(tmp, STATE_FILE);
        send(res, 200, '{"ok":true}', headers);
      } catch {
        send(res, 400, '{"error":"invalid job"}', headers);
      }
    });
    return;
  }
  send(res, 405, '{"error":"method not allowed"}', headers);
}

const server = http.createServer((req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { return send(res, 400, 'Bad request'); }
  if (pathname === '/api/state') return handleState(req, res);
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
  if (pathname === '/') pathname = '/index.html';
  if (!PUBLIC.some((re) => re.test(pathname))) return send(res, 404, 'Not found');
  const file = path.join(ROOT, pathname);
  if (!file.startsWith(ROOT + path.sep)) return send(res, 404, 'Not found');
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, 'Not found');
    send(res, 200, req.method === 'HEAD' ? '' : buf, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
  });
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') console.error(`Port ${PORT} is already in use. Try:  PORT=${PORT + 1} npm start`);
  else console.error(err.message);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  const lan = Object.values(os.networkInterfaces()).flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  console.log('\n  Woodworking Material Optimizer is running.\n');
  console.log(`  On this computer:   http://localhost:${PORT}`);
  if (HOST === '0.0.0.0') for (const ip of lan) console.log(`  On your phone:      http://${ip}:${PORT}   (same Wi-Fi)`);
  console.log(`\n  Your job is saved in ${path.relative(process.cwd(), STATE_FILE) || STATE_FILE}`);
  console.log('  Press Ctrl+C to stop.\n');
});
