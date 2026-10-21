// Entrada Node.js: VPS, Docker, Render, Railway etc.
// Rode a partir da pasta raiz do projeto: npm start
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createApp } from './app.js';
import { sqliteAdapter } from './adapters/sqlite.js';
import { fsStorage } from './adapters/fs-storage.js';

const DB_FILE = resolve(process.env.DB_FILE || './data/matematica40.db');
const UPLOAD_DIR = resolve(process.env.UPLOAD_DIR || './data/uploads');
mkdirSync(dirname(DB_FILE), { recursive: true });
mkdirSync(UPLOAD_DIR, { recursive: true });

const migration = readFileSync(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8');

const deps = {
  db: sqliteAdapter(DB_FILE, migration),
  storage: fsStorage(UPLOAD_DIR),
  cfg: {
    bootstrapSecret: process.env.BOOTSTRAP_SECRET || '',
    cookieSecure: process.env.COOKIE_SECURE !== 'false',
    iter: Number(process.env.PBKDF2_ITERATIONS) || 100000,
  },
};

// Mesmos cabeçalhos de segurança do public/_headers (Cloudflare)
const SEC = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; " +
    "font-src https://fonts.gstatic.com; img-src 'self' data: https://i.ytimg.com; " +
    "frame-src https://www.youtube-nocookie.com; connect-src 'self'; object-src 'none'; " +
    "base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
};

const app = new Hono();

app.use('*', async (c, next) => {
  await next();
  for (const [k, v] of Object.entries(SEC)) {
    if (!c.res.headers.has(k)) c.res.headers.set(k, v);
  }
});

app.route('/', createApp(() => deps));                                    // API em /api/*
app.all('/api/*', (c) => c.json({ error: 'Rota não encontrada.' }, 404)); // API inexistente devolve JSON
app.use('/*', serveStatic({ root: './public' }));                         // site (index.html em /)
app.notFound((c) => c.text('Página não encontrada.', 404));

const port = Number(process.env.PORT) || 8787;
serve({ fetch: app.fetch, port }, (i) => {
  console.log(`✅ Matemática 40 rodando em http://localhost:${i.port}`);
});
