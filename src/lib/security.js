// Segurança: senhas (PBKDF2), tokens, IDs e geração de senhas.
// Usa apenas Web Crypto, que funciona no Cloudflare Workers e no Node 20+.
const enc = new TextEncoder();

const b64 = (buf) => {
  let s = '';
  for (const byte of new Uint8Array(buf)) s += String.fromCharCode(byte);
  return btoa(s);
};
const unb64 = (s) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));

/** Gera o hash no formato: pbkdf2$iterações$salt$hash */
export async function hashPassword(pw, iter = 100000, salt = crypto.getRandomValues(new Uint8Array(16))) {
  const key = await crypto.subtle.importKey('raw', enc.encode(String(pw)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter },
    key,
    256
  );
  return `pbkdf2$${iter}$${b64(salt)}$${b64(bits)}`;
}

/** Compara a senha com o hash salvo, em tempo constante */
export async function verifyPassword(pw, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iter = Number(parts[1]);
  if (!Number.isInteger(iter) || iter < 1000 || iter > 10000000) return false;
  let salt;
  try { salt = unb64(parts[2]); } catch { return false; }
  const again = await hashPassword(pw, iter, salt);
  return safeEqual(again, stored);
}

/** Comparação de strings em tempo constante (dificulta ataques de tempo) */
export function safeEqual(a, b) {
  a = String(a);
  b = String(b);
  let r = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) r |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return r === 0;
}

/** ID único (UUID v4) */
export const randomId = () => crypto.randomUUID();

/** Token de sessão: 32 bytes aleatórios em base64url */
export function randomToken() {
  return b64(crypto.getRandomValues(new Uint8Array(32)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** SHA-256 em hexadecimal (o banco guarda só o hash do token) */
export async function sha256(s) {
  const h = await crypto.subtle.digest('SHA-256', enc.encode(String(s)));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Alfabeto sem caracteres ambíguos (0/o, 1/l/i): 31 símbolos.
// Bytes >= 248 são descartados para não haver viés (248 = 31 × 8).
const ALPHA = 'abcdefghjkmnpqrstuvwxyz23456789';

/** Gera uma senha aleatória com n caracteres */
export function genPassword(n) {
  let out = '';
  while (out.length < n) {
    for (const b of crypto.getRandomValues(new Uint8Array(n * 2))) {
      if (b < 248 && out.length < n) out += ALPHA[b % 31];
    }
  }
  return out;
}
