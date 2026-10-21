// Uso: node scripts/create-teacher.js "Nome do Professor" usuario
import 'dotenv/config';
import crypto from 'node:crypto';
import { db } from '../src/db.js';              // ajuste ao seu módulo
import { hashPassword } from '../src/auth.js';  // ajuste ao seu módulo

const [name, username] = process.argv.slice(2);
if (!name || !/^[a-z0-9._-]{3,32}$/.test(username || '')) {
  console.error('Uso: node scripts/create-teacher.js "Nome" usuario');
  process.exit(1);
}
if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) {
  console.error('Esse usuário já existe.');
  process.exit(1);
}

const password = crypto.randomBytes(12).toString('base64url');
db.prepare(`INSERT INTO users (id, name, username, password_hash, role, active, must_change, created_at)
            VALUES (?, ?, ?, ?, 'teacher', 1, 1, ?)`)
  .run(crypto.randomUUID(), name.trim(), username, await hashPassword(password), Date.now());

console.log(`Professor criado.\nUsuário: ${username}\nSenha provisória: ${password}\nTroque no primeiro login.`);
