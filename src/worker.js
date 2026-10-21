import { createApp } from './app.js';
import { d1Adapter } from './adapters/d1.js';
import { kvAdapter } from './adapters/kv.js';

export default createApp((c) => ({
  db: d1Adapter(c.env.DB),
  storage: kvAdapter(c.env.FILES_KV),

  cfg: {
    bootstrapSecret: c.env.BOOTSTRAP_SECRET || '',
    cookieSecure: c.env.COOKIE_SECURE !== 'false',
    iter: Number(c.env.PBKDF2_ITERATIONS) || 100000,
  },
}));