// API do Matemática 40. É o mesmo código no Cloudflare e no Node.
import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import {
  hashPassword, verifyPassword, safeEqual, randomId, randomToken, sha256, genPassword,
} from './lib/security.js';

// ===================== CONSTANTES =====================
const COOKIE = 'p40_sid';
const SESSION_DAYS = 7;
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;
const MAX_PDF = 10 * 1024 * 1024;
const USER_RE = /^[a-z0-9._-]{3,32}$/;
const ID_RE = /^[A-Za-z0-9-]{1,64}$/;
const EXAMS = ['enem', 'ufrgs'];
const LEVELS = ['facil', 'medio', 'dificil'];
const SHOW = ['after_submit', 'never'];
const LETTERS = ['A', 'B', 'C', 'D', 'E'];
const MIN_OPTS = 2; // mínimo de alternativas preenchidas por questão
const RETRY_ALL = false; // true = permite refazer também listas com "Nunca mostrar gabarito"

// Atribui a lista a todos os alunos que ainda não a têm
const ASSIGN_ALL_STUDENTS = `INSERT INTO assignments (list_id,student_id,assigned_at)
  SELECT ?, u.id, ? FROM users u
   WHERE u.role='student'
     AND NOT EXISTS (SELECT 1 FROM assignments a WHERE a.list_id=? AND a.student_id=u.id)`;
// Atribui todas as listas a um aluno
const ASSIGN_ALL_LISTS = `INSERT INTO assignments (list_id,student_id,assigned_at)
  SELECT l.id, ?, ? FROM lists l
   WHERE NOT EXISTS (SELECT 1 FROM assignments a WHERE a.list_id=l.id AND a.student_id=?)`;

// ===================== UTILITÁRIOS =====================
const now = () => Date.now();
const err = (c, msg, status = 400) => c.json({ error: msg }, status);
const safeJson = (s) => { try { return JSON.parse(s) || {}; } catch { return {}; } };

/** Valida um texto: devolve a string sem espaços nas pontas ou null se for inválida */
function text(v, max, min = 0) {
  if (v == null) v = '';
  if (typeof v !== 'string') return null;
  v = v.trim();
  return v.length >= min && v.length <= max ? v : null;
}

/** Lê o corpo JSON com segurança (só aceita objeto) */
async function body(c) {
  try {
    const b = await c.req.json();
    return b && typeof b === 'object' && !Array.isArray(b) ? b : null;
  } catch { return null; }
}

/** Extrai o ID de 11 caracteres de um link do YouTube (watch, youtu.be, embed, shorts, live) */
export function youtubeId(url) {
  if (!url || typeof url !== 'string') return null;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return null;
    const h = u.hostname.replace(/^(www\.|m\.)/, '');
    let id = null;
    if (h === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
    else if (h === 'youtube.com' || h === 'youtube-nocookie.com') {
      if (u.pathname === '/watch') id = u.searchParams.get('v');
      else {
        const m = u.pathname.match(/^\/(embed|shorts|live)\/([^/?]+)/);
        if (m) id = m[2];
      }
    }
    return /^[A-Za-z0-9_-]{11}$/.test(id || '') ? id : null;
  } catch { return null; }
}

/** Normaliza o link de vídeo: vazio vira null; link válido vira a URL canônica */
function videoField(v) {
  if (v == null || v === '') return { ok: true, val: null };
  const id = typeof v === 'string' ? youtubeId(v.trim()) : null;
  return id ? { ok: true, val: `https://www.youtube.com/watch?v=${id}` } : { ok: false };
}

/** Regras de senha por perfil */
function pwRule(role, pw) {
  if (typeof pw !== 'string') return 'Senha inválida.';
  if (role === 'student') {
    return pw.length < 4 || pw.length > 64 ? 'A senha do aluno deve ter entre 4 e 64 caracteres.' : null;
  }
  return pw.length < 10 || pw.length > 128 ? 'A senha do professor deve ter entre 10 e 128 caracteres.' : null;
}

/** Senha automática (aluno: 6 caracteres; professor: 12) ou manual */
function buildPassword(role, mode, pw) {
  if (mode === 'auto') return { pw: genPassword(role === 'student' ? 6 : 12), generated: true };
  if (mode !== 'manual') return { error: 'Escolha como definir a senha.' };
  const e = pwRule(role, pw);
  return e ? { error: e } : { pw, generated: false };
}

/** Formata a questão para a resposta. O gabarito só entra se withCorrect = true */
const qOut = (withCorrect) => (q) => ({
  id: q.id,
  position: q.position,
  statement: q.statement,
  options: { A: q.opt_a || '', B: q.opt_b || '', C: q.opt_c || '', D: q.opt_d || '', E: q.opt_e || '' },
  video_url: q.video_url,
  video_id: youtubeId(q.video_url),
  ...(withCorrect ? { correct: q.correct } : {}),
});

/** Alternativas que existem (preenchidas) numa questão do banco */
const filledLetters = (q) => LETTERS.filter((L) => (q[`opt_${L.toLowerCase()}`] || '').trim() !== '');

const qInsert = (id, listId, pos, q) => [
  'INSERT INTO questions (id,list_id,position,statement,opt_a,opt_b,opt_c,opt_d,opt_e,correct,video_url) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
  [id, listId, pos, q.statement, q.opts.A, q.opts.B, q.opts.C, q.opts.D, q.opts.E, q.correct, q.video_url],
];

/** Valida o corpo completo de uma lista (criação e edição) */
function parseList(b) {
  if (!b) return { error: 'Dados inválidos.' };

  const title = text(b.title, 150, 3);
  if (!title) return { error: 'O título deve ter de 3 a 150 caracteres.' };

  const description = text(b.description, 5000);
  if (description === null) return { error: 'Descrição muito longa (máx. 5000 caracteres).' };

  if (!EXAMS.includes(b.exam)) return { error: 'Escolha a prova (ENEM ou UFRGS).' };

  const topic = text(b.topic, 60);
  if (topic === null) return { error: 'Tema muito longo (máx. 60 caracteres).' };

  let level = null;
  if (b.level) {
    if (!LEVELS.includes(b.level)) return { error: 'Nível inválido.' };
    level = b.level;
  }

  const position = Number(b.position);
  if (!Number.isInteger(position) || position < 1 || position > 999) {
    return { error: 'O número da lista deve estar entre 1 e 999.' };
  }

  const v = videoField(b.video_url);
  if (!v.ok) return { error: 'Link do YouTube da lista inválido.' };

  if (!SHOW.includes(b.show_answers)) return { error: 'Configuração de gabarito inválida.' };

  if (!Array.isArray(b.questions) || b.questions.length > 100) {
    return { error: 'Envie no máximo 100 questões.' };
  }

  const questions = [];
  for (const [i, q] of b.questions.entries()) {
    const n = i + 1;
    if (!q || typeof q !== 'object') return { error: `Questão ${n}: dados inválidos.` };
    const statement = text(q.statement, 5000, 1);
    if (!statement) return { error: `Questão ${n}: escreva o enunciado.` };
    const opts = {};
    for (const L of LETTERS) {
      const o = text(q.options && q.options[L], 1000); // alternativa vazia é permitida
      if (o === null) return { error: `Questão ${n}: alternativa ${L} muito longa (máx. 1000 caracteres).` };
      opts[L] = o;
    }
    if (LETTERS.filter((L) => opts[L]).length < MIN_OPTS) {
      return { error: `Questão ${n}: preencha pelo menos ${MIN_OPTS} alternativas.` };
    }
    if (!LETTERS.includes(q.correct)) return { error: `Questão ${n}: marque a alternativa correta.` };
    if (!opts[q.correct]) return { error: `Questão ${n}: a alternativa correta (${q.correct}) está vazia.` };
    const qv = videoField(q.video_url);
    if (!qv.ok) return { error: `Questão ${n}: link do YouTube inválido.` };
    questions.push({
      id: typeof q.id === 'string' && ID_RE.test(q.id) ? q.id : null,
      statement, opts, correct: q.correct, video_url: qv.val,
    });
  }

  return {
    list: {
      title, description, exam: b.exam, topic, level, position,
      video_url: v.val, is_public: b.is_public === true ? 1 : 0, show_answers: b.show_answers,
    },
    questions,
  };
}

/** Remove o registro do arquivo e o arquivo físico */
async function removeFile(d, fid) {
  const f = await d.db.first('SELECT storage_key FROM files WHERE id=?', [fid]);
  if (!f) return;
  await d.db.run('DELETE FROM files WHERE id=?', [fid]);
  await d.storage.delete(f.storage_key).catch(() => {});
}

/** Visão da lista para o aluno. Só revela o gabarito após o envio, se a lista permitir */
async function studentView(d, listId, sid) {
  const l = await d.db.first(
    `SELECT l.id,l.title,l.description,l.exam,l.topic,l.level,l.position,l.video_url,l.show_answers,
            l.pdf_file_id,f.name AS pdf_name
       FROM assignments a
       JOIN lists l ON l.id=a.list_id
       LEFT JOIN files f ON f.id=l.pdf_file_id
      WHERE a.list_id=? AND a.student_id=?`, [listId, sid]);
  if (!l) return null;

  const qs = await d.db.all('SELECT * FROM questions WHERE list_id=? ORDER BY position', [listId]);
  const s = await d.db.first(
    'SELECT answers,score,total,submitted_at FROM submissions WHERE list_id=? AND student_id=?', [listId, sid]);
  const reveal = !!s && l.show_answers === 'after_submit';
  const answers = s ? safeJson(s.answers) : {};

  return {
    list: {
      id: l.id, title: l.title, description: l.description, exam: l.exam, topic: l.topic,
      level: l.level, position: l.position, video_id: youtubeId(l.video_url),
      show_answers: l.show_answers,
      can_retry: RETRY_ALL || l.show_answers === 'after_submit',
      pdf: l.pdf_file_id ? { id: l.pdf_file_id, name: l.pdf_name } : null,
    },
    questions: qs.map((q) => ({
      ...qOut(reveal)(q),
      ...(s ? { chosen: answers[q.id] || null } : {}),
      ...(reveal ? { is_correct: answers[q.id] === q.correct } : {}),
    })),
    submission: s ? { score: s.score, total: s.total, submitted_at: s.submitted_at } : null,
  };
}

/** Lê as respostas enviadas e corrige. Rejeita letras de alternativas vazias */
function grade(qs, raw) {
  const answers = {};
  let score = 0;
  for (const q of qs) {
    const a = raw[q.id];
    if (a == null || a === '') continue;
    if (!filledLetters(q).includes(a)) return { error: 'Resposta inválida.' };
    answers[q.id] = a;
    if (a === q.correct) score++;
  }
  return { answers, score };
}

// ===================== APLICAÇÃO =====================
export function createApp(getDeps) {
  const app = new Hono().basePath('/api');

  // Hash "falso" usado quando o usuário não existe, para o tempo de resposta ser igual
  const dummyHashes = new Map();
  const dummy = async (iter) => {
    if (!dummyHashes.has(iter)) dummyHashes.set(iter, await hashPassword('dummy-password-p40', iter));
    return dummyHashes.get(iter);
  };

  async function createSession(c, d, userId) {
    const token = randomToken();
    await d.db.run(
      'INSERT INTO sessions (id_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)',
      [await sha256(token), userId, now() + SESSION_DAYS * 864e5, now()]);
    setCookie(c, COOKIE, token, {
      httpOnly: true, secure: d.cfg.cookieSecure, sameSite: 'Lax', path: '/', maxAge: SESSION_DAYS * 86400,
    });
  }

  // ---------- Middleware 1: dependências e cabeçalhos ----------
  app.use('*', async (c, next) => {
    c.set('d', getDeps(c));
    await next();
    const h = c.res.headers;
    if (!h.has('Cache-Control')) h.set('Cache-Control', 'no-store');
    h.set('X-Content-Type-Options', 'nosniff');
    h.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    h.set('X-Frame-Options', 'DENY');
  });

  // ---------- Middleware 2: proteção CSRF ----------
  app.use('*', async (c, next) => {
    const m = c.req.method;
    if (m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS') {
      if (c.req.header('x-p40') !== '1') return err(c, 'Requisição inválida.', 403);
      const origin = c.req.header('origin');
      if (origin) {
        let ok = false;
        try { ok = new URL(origin).host === new URL(c.req.url).host; } catch { /* inválida */ }
        if (!ok) return err(c, 'Origem não permitida.', 403);
      }
    }
    await next();
  });

  // ---------- Middleware 3: carrega o usuário da sessão ----------
  app.use('*', async (c, next) => {
    c.set('user', null);
    const t = getCookie(c, COOKIE);
    if (t && t.length < 100) {
      const u = await c.get('d').db.first(
        `SELECT u.id,u.name,u.username,u.role,u.must_change
           FROM sessions s JOIN users u ON u.id=s.user_id
          WHERE s.id_hash=? AND s.expires_at>? AND u.active=1`,
        [await sha256(t), now()]);
      if (u) c.set('user', u);
    }
    await next();
  });

  // ---------- Guardas de permissão ----------
  const auth = (role) => async (c, next) => {
    const u = c.get('user');
    if (!u) return err(c, 'Faça login para continuar.', 401);
    if (role && u.role !== role) return err(c, 'Acesso não permitido para este perfil.', 403);
    await next();
  };
  const A = auth();            // qualquer usuário logado
  const T = auth('teacher');   // só professor
  const S = auth('student');   // só aluno

  app.get('/health', (c) => c.json({ ok: true }));

  // ================= AUTENTICAÇÃO =================

  // Cria o 1º professor (só funciona enquanto não houver nenhum)
  app.post('/bootstrap', async (c) => {
    const d = c.get('d');
    const secret = d.cfg.bootstrapSecret;
    if (!secret || secret.length < 8 || !safeEqual(c.req.header('x-bootstrap-secret') || '', secret)) {
      return err(c, 'Não autorizado.', 403);
    }
    if (await d.db.first("SELECT id FROM users WHERE role='teacher' LIMIT 1")) {
      return err(c, 'Já existe um professor. Use o painel.', 409);
    }
    const b = await body(c);
    const name = text(b?.name, 100, 2);
    const username = typeof b?.username === 'string' ? b.username.trim().toLowerCase() : '';
    if (!name) return err(c, 'Nome inválido.');
    if (!USER_RE.test(username)) return err(c, 'Usuário inválido (3–32: a-z, 0-9, . _ -).');
    const e = pwRule('teacher', b?.password);
    if (e) return err(c, e);
    await d.db.run(
      'INSERT INTO users (id,name,username,role,password_hash,must_change,active,created_at) VALUES (?,?,?,?,?,0,1,?)',
      [randomId(), name, username, 'teacher', await hashPassword(b.password, d.cfg.iter), now()]);
    return c.json({ message: 'Professor criado. Faça login em /login.html.' }, 201);
  });

  app.post('/auth/login', async (c) => {
    const d = c.get('d');
    const b = await body(c);
    const username = typeof b?.username === 'string' ? b.username.trim().toLowerCase() : '';
    const password = typeof b?.password === 'string' ? b.password : '';
    if (!username || !password || username.length > 32 || password.length > 128) {
      return err(c, 'Informe usuário e senha.');
    }

    const att = await d.db.first('SELECT fails, locked_until FROM login_attempts WHERE username=?', [username]);
    if (att && att.locked_until > now()) {
      const min = Math.ceil((att.locked_until - now()) / 60000);
      return err(c, `Muitas tentativas incorretas. Tente novamente em ${min} min.`, 429);
    }

    const u = await d.db.first(
      'SELECT id,name,username,role,must_change,active,password_hash FROM users WHERE username=?', [username]);
    const ok = await verifyPassword(password, u ? u.password_hash : await dummy(d.cfg.iter));

    if (!u || !ok) {
      const fails = (att?.fails || 0) + 1;
      const lock = fails >= MAX_FAILS;
      await d.db.run(
        `INSERT INTO login_attempts (username,fails,locked_until) VALUES (?,?,?)
         ON CONFLICT(username) DO UPDATE SET fails=excluded.fails, locked_until=excluded.locked_until`,
        [username, lock ? 0 : fails, lock ? now() + LOCK_MS : 0]);
      return lock
        ? err(c, 'Muitas tentativas incorretas. Conta bloqueada por 15 minutos.', 429)
        : err(c, 'Usuário ou senha incorretos.', 401);
    }
    if (!u.active) return err(c, 'Conta desativada. Fale com o professor.', 403);

    await d.db.batch([
      ['DELETE FROM login_attempts WHERE username=?', [username]],
      ['DELETE FROM sessions WHERE expires_at<?', [now()]],
    ]);
    await createSession(c, d, u.id);
    return c.json({
      user: { id: u.id, name: u.name, username: u.username, role: u.role, must_change: u.must_change },
    });
  });

  app.post('/auth/logout', async (c) => {
    const d = c.get('d');
    const t = getCookie(c, COOKIE);
    if (t && t.length < 100) await d.db.run('DELETE FROM sessions WHERE id_hash=?', [await sha256(t)]);
    deleteCookie(c, COOKIE, { path: '/', secure: d.cfg.cookieSecure });
    return c.json({ message: 'Sessão encerrada.' });
  });

  app.get('/me', A, (c) => c.json({ user: c.get('user') }));

  app.post('/auth/password', A, async (c) => {
    const d = c.get('d'), me = c.get('user');
    const b = await body(c);
    if (typeof b?.current !== 'string' || typeof b?.new !== 'string') return err(c, 'Preencha todos os campos.');
    const row = await d.db.first('SELECT password_hash FROM users WHERE id=?', [me.id]);
    if (!row || !(await verifyPassword(b.current, row.password_hash))) return err(c, 'Senha atual incorreta.');
    const e = pwRule(me.role, b.new);
    if (e) return err(c, e);
    if (b.new === b.current) return err(c, 'A nova senha deve ser diferente da atual.');
    await d.db.batch([
      ['UPDATE users SET password_hash=?, must_change=0 WHERE id=?', [await hashPassword(b.new, d.cfg.iter), me.id]],
      ['DELETE FROM sessions WHERE user_id=?', [me.id]],
    ]);
    await createSession(c, d, me.id);
    return c.json({ message: 'Senha alterada com sucesso.' });
  });

  // ================= USUÁRIOS (professor) =================
  app.get('/users', T, async (c) => {
    const role = c.req.query('role');
    if (!['student', 'teacher'].includes(role)) return err(c, 'Perfil inválido.');
    const users = await c.get('d').db.all(
      'SELECT id,name,username,role,active,must_change,created_at FROM users WHERE role=? ORDER BY name', [role]);
    return c.json({ users });
  });

  app.post('/users', T, async (c) => {
    const d = c.get('d');
    const b = await body(c);
    if (!b) return err(c, 'Dados inválidos.');
    if (!['student', 'teacher'].includes(b.role)) return err(c, 'Perfil inválido.');
    const name = text(b.name, 100, 2);
    if (!name) return err(c, 'Informe o nome (2 a 100 caracteres).');
    const username = typeof b.username === 'string' ? b.username.trim().toLowerCase() : '';
    if (!USER_RE.test(username)) {
      return err(c, 'Usuário deve ter 3 a 32 caracteres: letras minúsculas, números, ponto, hífen ou sublinhado.');
    }
    if (await d.db.first('SELECT 1 AS x FROM users WHERE username=?', [username])) {
      return err(c, 'Este nome de usuário já está em uso.', 409);
    }
    const p = buildPassword(b.role, b.passwordMode, b.password);
    if (p.error) return err(c, p.error);

    const id = randomId(), t = now();
    const stmts = [[
      'INSERT INTO users (id,name,username,role,password_hash,must_change,active,created_at) VALUES (?,?,?,?,?,?,1,?)',
      [id, name, username, b.role, await hashPassword(p.pw, d.cfg.iter), b.role === 'teacher' ? 1 : 0, t],
    ]];
    if (b.role === 'student') stmts.push([ASSIGN_ALL_LISTS, [id, t, id]]); // aluno novo recebe todas as listas
    try {
      await d.db.batch(stmts);
    } catch {
      return err(c, 'Este nome de usuário já está em uso.', 409); // corrida entre dois cadastros
    }
    return c.json({
      message: b.role === 'student' ? 'Aluno cadastrado com sucesso.' : 'Professor cadastrado com sucesso.',
      user: { id, name, username, role: b.role },
      password: p.generated ? p.pw : null, // a senha gerada aparece só nesta resposta
    }, 201);
  });

  app.patch('/users/:id', T, async (c) => {
    const d = c.get('d'), me = c.get('user'), id = c.req.param('id');
    const u = await d.db.first('SELECT id,role,username FROM users WHERE id=?', [id]);
    if (!u) return err(c, 'Usuário não encontrado.', 404);
    const b = await body(c);
    if (!b) return err(c, 'Dados inválidos.');

    const sets = [], params = [];
    let generated = null;

    if (b.name !== undefined) {
      const n = text(b.name, 100, 2);
      if (!n) return err(c, 'Nome inválido.');
      sets.push('name=?'); params.push(n);
    }
    if (b.active !== undefined) {
      if (typeof b.active !== 'boolean') return err(c, 'Status inválido.');
      if (id === me.id && !b.active) return err(c, 'Você não pode desativar a própria conta.');
      sets.push('active=?'); params.push(b.active ? 1 : 0);
    }
    if (b.passwordMode !== undefined) {
      if (id === me.id) return err(c, 'Para mudar sua senha use "Minha conta".');
      const p = buildPassword(u.role, b.passwordMode, b.password);
      if (p.error) return err(c, p.error);
      sets.push('password_hash=?', 'must_change=?');
      params.push(await hashPassword(p.pw, d.cfg.iter), u.role === 'teacher' ? 1 : 0);
      if (p.generated) generated = p.pw;
    }
    if (!sets.length) return err(c, 'Nada para atualizar.');

    const stmts = [[`UPDATE users SET ${sets.join(',')} WHERE id=?`, [...params, id]]];
    if (b.passwordMode !== undefined || b.active === false) {
      stmts.push(['DELETE FROM sessions WHERE user_id=?', [id]]);
    }
    if (b.passwordMode !== undefined) {
      stmts.push(['DELETE FROM login_attempts WHERE username=?', [u.username]]);
    }
    await d.db.batch(stmts);
    return c.json({ message: 'Usuário atualizado.', password: generated });
  });

  app.delete('/users/:id', T, async (c) => {
    const d = c.get('d'), id = c.req.param('id');
    if (id === c.get('user').id) return err(c, 'Você não pode excluir a própria conta.');
    const r = await d.db.run('DELETE FROM users WHERE id=?', [id]);
    if (!r.changes) return err(c, 'Usuário não encontrado.', 404);
    return c.json({ message: 'Usuário excluído.' });
  });

  // ================= LISTAS (professor) =================
  app.get('/lists', T, async (c) => {
    const lists = await c.get('d').db.all(
      `SELECT l.*, f.name AS pdf_name,
              (SELECT COUNT(*) FROM questions q   WHERE q.list_id=l.id) AS question_count,
              (SELECT COUNT(*) FROM assignments a WHERE a.list_id=l.id) AS assigned_count,
              (SELECT COUNT(*) FROM submissions s WHERE s.list_id=l.id) AS submission_count
         FROM lists l LEFT JOIN files f ON f.id=l.pdf_file_id
        ORDER BY l.exam, l.position, l.created_at`);
    return c.json({ lists });
  });

  app.get('/lists/:id', T, async (c) => {
    const d = c.get('d'), id = c.req.param('id');
    const list = await d.db.first(
      'SELECT l.*, f.name AS pdf_name FROM lists l LEFT JOIN files f ON f.id=l.pdf_file_id WHERE l.id=?', [id]);
    if (!list) return err(c, 'Lista não encontrada.', 404);
    const questions = (await d.db.all('SELECT * FROM questions WHERE list_id=? ORDER BY position', [id])).map(qOut(true));
    return c.json({ list, questions });
  });

  app.post('/lists', T, async (c) => {
    const d = c.get('d');
    const p = parseList(await body(c));
    if (p.error) return err(c, p.error);
    const id = randomId(), t = now(), L = p.list;

    const stmts = [[
      `INSERT INTO lists (id,title,description,exam,topic,level,position,video_url,is_public,show_answers,created_by,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, L.title, L.description, L.exam, L.topic, L.level, L.position, L.video_url, L.is_public, L.show_answers, c.get('user').id, t, t],
    ]];
    p.questions.forEach((q, i) => stmts.push(qInsert(randomId(), id, i + 1, q)));
    stmts.push([ASSIGN_ALL_STUDENTS, [id, t, id]]); // libera para todos os alunos

    await d.db.batch(stmts);
    return c.json({ message: 'Lista criada e liberada para todos os alunos.', id }, 201);
  });

  app.put('/lists/:id', T, async (c) => {
    const d = c.get('d'), id = c.req.param('id');
    if (!(await d.db.first('SELECT id FROM lists WHERE id=?', [id]))) return err(c, 'Lista não encontrada.', 404);
    const p = parseList(await body(c));
    if (p.error) return err(c, p.error);
    const t = now(), L = p.list;

    const existing = new Set((await d.db.all('SELECT id FROM questions WHERE list_id=?', [id])).map((r) => r.id));

    const stmts = [[
      `UPDATE lists SET title=?,description=?,exam=?,topic=?,level=?,position=?,video_url=?,is_public=?,show_answers=?,updated_at=?
        WHERE id=?`,
      [L.title, L.description, L.exam, L.topic, L.level, L.position, L.video_url, L.is_public, L.show_answers, t, id],
    ]];

    // Questões que já existiam são atualizadas (o ID é mantido para não perder respostas); as novas são inseridas
    const keep = new Set();
    p.questions.forEach((q, i) => {
      if (q.id && existing.has(q.id) && !keep.has(q.id)) {
        keep.add(q.id);
        stmts.push([
          'UPDATE questions SET position=?,statement=?,opt_a=?,opt_b=?,opt_c=?,opt_d=?,opt_e=?,correct=?,video_url=? WHERE id=? AND list_id=?',
          [i + 1, q.statement, q.opts.A, q.opts.B, q.opts.C, q.opts.D, q.opts.E, q.correct, q.video_url, q.id, id],
        ]);
      } else {
        stmts.push(qInsert(randomId(), id, i + 1, q));
      }
    });
    for (const old of existing) if (!keep.has(old)) stmts.push(['DELETE FROM questions WHERE id=?', [old]]);

    stmts.push([ASSIGN_ALL_STUDENTS, [id, t, id]]); // garante que todos os alunos tenham a lista

    await d.db.batch(stmts);
    return c.json({ message: 'Lista atualizada com sucesso.', id });
  });

  app.delete('/lists/:id', T, async (c) => {
    const d = c.get('d'), id = c.req.param('id');
    const l = await d.db.first('SELECT pdf_file_id FROM lists WHERE id=?', [id]);
    if (!l) return err(c, 'Lista não encontrada.', 404);
    await d.db.run('DELETE FROM lists WHERE id=?', [id]);
    if (l.pdf_file_id) await removeFile(d, l.pdf_file_id);
    return c.json({ message: 'Lista excluída.' });
  });

  // ---------- PDF da lista ----------
  app.post('/lists/:id/pdf', T, async (c) => {
    const d = c.get('d'), id = c.req.param('id');
    const l = await d.db.first('SELECT id,pdf_file_id FROM lists WHERE id=?', [id]);
    if (!l) return err(c, 'Lista não encontrada.', 404);
    if (Number(c.req.header('content-length') || 0) > MAX_PDF + 65536) {
      return err(c, 'O PDF deve ter no máximo 10 MB.', 413);
    }

    let form;
    try { form = await c.req.formData(); } catch { return err(c, 'Envio inválido.'); }
    const file = form.get('file');
    if (!file || typeof file === 'string') return err(c, 'Selecione um arquivo PDF.');
    if (file.size > MAX_PDF) return err(c, 'O PDF deve ter no máximo 10 MB.', 413);

    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length < 5 || String.fromCharCode(...bytes.slice(0, 5)) !== '%PDF-') {
      return err(c, 'O arquivo não é um PDF válido.');
    }

    let name = String(file.name || 'material.pdf').replace(/[\\/\x00-\x1f"<>|:*?]/g, '_').slice(0, 120);
    if (!/\.pdf$/i.test(name)) name += '.pdf';

    const fid = randomId(), key = `pdf/${fid}.pdf`;
    await d.storage.put(key, bytes, 'application/pdf');
    try {
      await d.db.batch([
        ['INSERT INTO files (id,storage_key,name,mime,size,created_at) VALUES (?,?,?,?,?,?)',
          [fid, key, name, 'application/pdf', bytes.length, now()]],
        ['UPDATE lists SET pdf_file_id=?, updated_at=? WHERE id=?', [fid, now(), id]],
      ]);
    } catch (e) {
      await d.storage.delete(key).catch(() => {});
      throw e;
    }
    if (l.pdf_file_id) await removeFile(d, l.pdf_file_id);
    return c.json({ message: 'PDF enviado.', file: { id: fid, name } });
  });

  app.delete('/lists/:id/pdf', T, async (c) => {
    const d = c.get('d'), id = c.req.param('id');
    const l = await d.db.first('SELECT pdf_file_id FROM lists WHERE id=?', [id]);
    if (!l) return err(c, 'Lista não encontrada.', 404);
    if (l.pdf_file_id) {
      await d.db.run('UPDATE lists SET pdf_file_id=NULL, updated_at=? WHERE id=?', [now(), id]);
      await removeFile(d, l.pdf_file_id);
    }
    return c.json({ message: 'PDF removido.' });
  });

  // ---------- Resultados ----------
  app.get('/lists/:id/results', T, async (c) => {
    const d = c.get('d'), id = c.req.param('id');
    if (!(await d.db.first('SELECT id FROM lists WHERE id=?', [id]))) return err(c, 'Lista não encontrada.', 404);
    const questions = await d.db.all('SELECT id,position,correct FROM questions WHERE list_id=? ORDER BY position', [id]);
    const rows = await d.db.all(
      `SELECT u.id,u.name,u.username,s.score,s.total,s.submitted_at,s.answers
         FROM assignments a
         JOIN users u ON u.id=a.student_id
         LEFT JOIN submissions s ON s.list_id=a.list_id AND s.student_id=a.student_id
        WHERE a.list_id=? ORDER BY u.name`, [id]);
    return c.json({
      questions,
      results: rows.map((r) => ({ ...r, answers: r.answers ? safeJson(r.answers) : {} })),
    });
  });

  app.delete('/lists/:id/submissions/:sid', T, async (c) => {
    const r = await c.get('d').db.run(
      'DELETE FROM submissions WHERE list_id=? AND student_id=?', [c.req.param('id'), c.req.param('sid')]);
    if (!r.changes) return err(c, 'Envio não encontrado.', 404);
    return c.json({ message: 'Envio removido. O aluno pode refazer a lista.' });
  });

  // ================= ALUNO =================
  app.get('/student/lists', S, async (c) => {
    const rows = await c.get('d').db.all(
      `SELECT l.id,l.title,l.description,l.exam,l.topic,l.level,l.position,l.video_url,l.show_answers,
              (SELECT COUNT(*) FROM questions q WHERE q.list_id=l.id) AS question_count,
              s.score,s.total,s.submitted_at
         FROM assignments a
         JOIN lists l ON l.id=a.list_id
         LEFT JOIN submissions s ON s.list_id=l.id AND s.student_id=a.student_id
        WHERE a.student_id=? ORDER BY l.exam, l.position`, [c.get('user').id]);
    const lists = rows.map(({ video_url, ...r }) => ({
      ...r, video_id: youtubeId(video_url), can_retry: RETRY_ALL || r.show_answers === 'after_submit',
    }));
    return c.json({ lists });
  });

  app.get('/student/lists/:id', S, async (c) => {
    const v = await studentView(c.get('d'), c.req.param('id'), c.get('user').id);
    return v ? c.json(v) : err(c, 'Lista não encontrada ou não atribuída a você.', 404);
  });

  app.post('/student/lists/:id/submit', S, async (c) => {
    const d = c.get('d'), me = c.get('user'), id = c.req.param('id');
    const v = await studentView(d, id, me.id);
    if (!v) return err(c, 'Lista não encontrada ou não atribuída a você.', 404);
    if (v.submission) return err(c, 'Você já enviou esta lista.', 409);

    const qs = await d.db.all('SELECT id,correct,opt_a,opt_b,opt_c,opt_d,opt_e FROM questions WHERE list_id=?', [id]);
    if (!qs.length) return err(c, 'Esta lista não tem questões para corrigir.');

    const b = await body(c);
    const raw = b && b.answers && typeof b.answers === 'object' && !Array.isArray(b.answers) ? b.answers : null;
    if (!raw) return err(c, 'Respostas inválidas.');

    const g = grade(qs, raw);
    if (g.error) return err(c, g.error);

    try {
      await d.db.run(
        'INSERT INTO submissions (id,list_id,student_id,answers,score,total,submitted_at) VALUES (?,?,?,?,?,?,?)',
        [randomId(), id, me.id, JSON.stringify(g.answers), g.score, qs.length, now()]);
    } catch {
      return err(c, 'Você já enviou esta lista.', 409);
    }
    return c.json({ message: 'Respostas enviadas e corrigidas.', ...(await studentView(d, id, me.id)) });
  });

  app.post('/student/lists/:id/reset', S, async (c) => {
    const d = c.get('d'), me = c.get('user'), id = c.req.param('id');
    const l = await d.db.first(
      `SELECT l.show_answers FROM assignments a JOIN lists l ON l.id=a.list_id
        WHERE a.list_id=? AND a.student_id=?`, [id, me.id]);
    if (!l) return err(c, 'Lista não encontrada ou não atribuída a você.', 404);
    if (!RETRY_ALL && l.show_answers !== 'after_submit') return err(c, 'Esta lista não permite refazer.', 403);
    const r = await d.db.run('DELETE FROM submissions WHERE list_id=? AND student_id=?', [id, me.id]);
    if (!r.changes) return err(c, 'Você ainda não enviou esta lista.', 404);
    return c.json({ message: 'Lista reiniciada. Bons estudos!', ...(await studentView(d, id, me.id)) });
  });

  // ================= PÚBLICO =================
  app.get('/public/content', async (c) => {
    const rows = await c.get('d').db.all(
      `SELECT l.id,l.title,l.description,l.exam,l.topic,l.level,l.position,l.video_url,l.pdf_file_id,f.name AS pdf_name,
              (SELECT COUNT(*) FROM questions q WHERE q.list_id=l.id) AS question_count
         FROM lists l LEFT JOIN files f ON f.id=l.pdf_file_id
        WHERE l.is_public=1 ORDER BY l.exam, l.position, l.created_at`);
    c.header('Cache-Control', 'public, max-age=60');
    return c.json({
      exercises: rows.map((r) => ({
        id: r.id, title: r.title, description: r.description, exam: r.exam, topic: r.topic,
        level: r.level, position: r.position, video_id: youtubeId(r.video_url),
        question_count: r.question_count,
        files: r.pdf_file_id ? [{ id: r.pdf_file_id, name: r.pdf_name }] : [],
      })),
    });
  });

  app.get('/public/lists/:id', async (c) => {
    const d = c.get('d'), id = c.req.param('id');
    const l = await d.db.first(
      'SELECT id,title,description,exam,topic,level,position,show_answers FROM lists WHERE id=? AND is_public=1', [id]);
    if (!l) return err(c, 'Lista não encontrada.', 404);
    const qs = await d.db.all('SELECT * FROM questions WHERE list_id=? ORDER BY position', [id]);
    return c.json({
      list: l,
      questions: qs.map((q) => {
        const { video_url, video_id, ...rest } = qOut(false)(q);
        return rest;
      }),
    });
  });

  app.post('/public/lists/:id/check', async (c) => {
    const d = c.get('d'), id = c.req.param('id');
    const l = await d.db.first('SELECT show_answers FROM lists WHERE id=? AND is_public=1', [id]);
    if (!l) return err(c, 'Lista não encontrada.', 404);
    const qs = await d.db.all(
      'SELECT id,position,correct,video_url,opt_a,opt_b,opt_c,opt_d,opt_e FROM questions WHERE list_id=? ORDER BY position', [id]);
    if (!qs.length) return err(c, 'Esta lista não tem questões.');

    const b = await body(c);
    const raw = b && b.answers && typeof b.answers === 'object' && !Array.isArray(b.answers) ? b.answers : null;
    if (!raw) return err(c, 'Respostas inválidas.');

    const g = grade(qs, raw);
    if (g.error) return err(c, g.error);
    const results = qs.map((q) => {
      const chosen = g.answers[q.id] || null;
      return { id: q.id, chosen, correct: q.correct, is_correct: chosen === q.correct, video_id: youtubeId(q.video_url) };
    });
    return c.json({
      score: g.score, total: qs.length,
      results: l.show_answers === 'after_submit' ? results : null,
    });
  });

  app.get('/files/:id', async (c) => {
    const d = c.get('d'), u = c.get('user');
    const f = await d.db.first(
      `SELECT f.storage_key,f.name,l.id AS list_id,l.is_public
         FROM files f JOIN lists l ON l.pdf_file_id=f.id WHERE f.id=?`, [c.req.param('id')]);
    if (!f) return err(c, 'Arquivo não encontrado.', 404);

    let ok = f.is_public === 1 || u?.role === 'teacher';
    if (!ok && u?.role === 'student') {
      ok = !!(await d.db.first('SELECT 1 AS x FROM assignments WHERE list_id=? AND student_id=?', [f.list_id, u.id]));
    }
    if (!ok) {
      return u ? err(c, 'Sem permissão para este arquivo.', 403) : err(c, 'Faça login para acessar este arquivo.', 401);
    }

    const obj = await d.storage.get(f.storage_key);
    if (!obj) return err(c, 'Arquivo não encontrado.', 404);
    return new Response(obj.body, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(f.name)}`,
        'Cache-Control': f.is_public === 1 ? 'public, max-age=300' : 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  });

  // ================= ERROS =================
  app.notFound((c) => err(c, 'Rota não encontrada.', 404));
  app.onError((e, c) => {
    console.error('[API]', e);
    return err(c, 'Erro interno. Tente novamente.', 500);
  });

  return app;
}
