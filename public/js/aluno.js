(async () => {
  const msg = document.getElementById('msg');
  const grid = document.getElementById('grid');

  // ---------- Base (usa o P40 se existir; senão, fallbacks) ----------
  const base = window.P40 || {};

  const el = base.el || ((tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  });

  // Sempre envia x-p40 (exigido pelo CSRF do backend)
  const api = async (path, opt = {}) => {
    const init = {
      method: opt.method || 'GET',
      credentials: 'include',
      headers: { 'x-p40': '1', Accept: 'application/json' },
    };
    if (opt.json !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opt.json);
    }
    const r = await fetch('/api' + path, init);
    const data = await r.json().catch(() => ({}));
    if (r.status === 401) { location.href = '/login.html'; throw new Error(data.error || 'Faça login para continuar.'); }
    if (!r.ok) throw new Error(data.error || data.message || `Erro ${r.status}`);
    return data;
  };

  const showAlert = (box, text, type = 'error') => {
    box.textContent = text || '';
    box.className = `alert ${type}`;
  };
  const hideAlert = (box) => { box.className = 'alert hidden'; box.textContent = ''; };

  const fmtDate = base.fmtDate || ((d) => {
    if (d == null || d === '') return '';
    const dt = new Date(typeof d === 'number' ? d : Number(d) || d);
    return isNaN(dt) ? String(d) : dt.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  });

  const video = base.video || ((id, title) => {
    const w = el('div', 'video');
    const f = el('iframe');
    f.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}`;
    f.title = title || 'Vídeo';
    f.loading = 'lazy';
    f.allowFullscreen = true;
    f.allow = 'accelerometer; encrypted-media; gyroscope; picture-in-picture';
    w.append(f);
    return w;
  });

  const LEVEL = base.LEVEL || { facil: 'Fácil', medio: 'Médio', dificil: 'Difícil' };
  const EXAM = base.EXAM || { enem: 'ENEM', ufrgs: 'UFRGS' };

  async function requireUser(role) {
    let user;
    try {
      ({ user } = await api('/me'));
    } catch { return null; } // 401 já redireciona
    if (!user) { location.href = '/login.html'; return null; }
    if (user.must_change) { location.href = '/conta.html'; return null; }
    if (role && user.role !== role) {
      location.href = user.role === 'teacher' ? '/professor.html' : '/';
      return null;
    }
    const n = document.getElementById('userName');
    const lb = document.getElementById('userLabel');
    const av = document.getElementById('userAvatar');
    if (n) n.textContent = user.name || user.username;
    if (lb) lb.textContent = 'Aluno';
    if (av) av.textContent = (user.name || user.username || '?')[0].toUpperCase();
    return user;
  }

  // Logout (caso o topbar.js não trate)
  document.querySelectorAll('[data-logout]').forEach((b) => {
    if (b.dataset.bound) return;
    b.dataset.bound = '1';
    b.addEventListener('click', async () => {
      try { await api('/auth/logout', { method: 'POST' }); } catch { /* ignora */ }
      location.href = '/login.html';
    });
  });

  const fail = (e) => {
    console.error(e);
    showAlert(msg, 'Erro: ' + (e?.message || e));
  };
  window.addEventListener('unhandledrejection', (e) => fail(e.reason));

  try {
    const user = await requireUser('student');
    if (!user) return;

    const viewLists = document.getElementById('viewLists');
    const viewList = document.getElementById('viewList');
    const fExam = document.getElementById('fExam');
    const fStatus = document.getElementById('fStatus');
    const head = document.getElementById('listHead');
    const quiz = document.getElementById('quiz');
    const LETTERS = ['A', 'B', 'C', 'D', 'E'];
    let lists = [];
    let dirty = false;

    const pct = (s, t) => (t ? Math.round((s / t) * 100) : 0);

    function badges(l) {
      const b = el('div', 'badges');
      b.append(el('span', 'badge', `${EXAM[l.exam] || l.exam || ''} · Lista ${l.position ?? ''}`));
      if (l.topic) b.append(el('span', 'badge', l.topic));
      if (l.level) b.append(el('span', `badge ${l.level}`, LEVEL[l.level] || l.level));
      return b;
    }

    async function resetList(id, btn) {
      if (!confirm('Suas respostas e a nota atual serão apagadas para você refazer a lista. Continuar?')) return;
      btn.disabled = true;
      hideAlert(msg);
      try {
        const res = await api(`/student/lists/${encodeURIComponent(id)}/reset`, { method: 'POST' });
        const target = `#lista=${encodeURIComponent(id)}`;
        if (location.hash !== target) location.hash = target; // route() renderiza
        else renderList(res);
        showAlert(msg, res.message || 'Lista reiniciada.', 'ok');
        window.scrollTo({ top: 0, behavior: 'smooth' });
        loadLists();
      } catch (e) {
        showAlert(msg, e.message);
        btn.disabled = false;
      }
    }

    // ---------- Visão 1: grade ----------
    function renderGrid() {
      const items = lists.filter((l) =>
        (!fExam.value || l.exam === fExam.value) &&
        (!fStatus.value || (fStatus.value === 'done') === !!l.submitted_at));

      if (!items.length) {
        grid.replaceChildren(el('p', 'empty',
          lists.length ? 'Nenhuma lista para este filtro.' : 'Nenhuma lista disponível ainda.'));
        return;
      }

      grid.replaceChildren(...items.map((l) => {
        const c = el('article', 'card');
        c.append(badges(l), el('h3', null, l.title || 'Sem título'));
        if (l.description) c.append(el('p', 'clamp', l.description));
        if (l.video_id) c.append(video(l.video_id, l.title));
        const qc = Number(l.question_count) || 0;
        c.append(el('small', 'muted', `${qc} ${qc === 1 ? 'questão' : 'questões'}`));
        c.append(l.submitted_at
          ? el('div', 'score', `✅ ${l.score}/${l.total} (${pct(l.score, l.total)}%) · enviada em ${fmtDate(l.submitted_at)}`)
          : el('div', 'score pending', '⏳ Pendente'));

        const act = el('div', 'card-actions');
        const a = el('a', 'btn btn-sm', l.submitted_at ? 'Ver resultado' : 'Resolver');
        a.href = `#lista=${encodeURIComponent(l.id)}`;
        act.append(a);
        if (l.submitted_at && l.can_retry) {
          const again = el('button', 'btn btn-sm btn-outline', '🔄 Refazer');
          again.type = 'button';
          again.onclick = () => resetList(l.id, again);
          act.append(again);
        }
        c.append(act);
        return c;
      }));
    }

    async function loadLists() {
      try {
        const data = await api('/student/lists');
        lists = Array.isArray(data) ? data : (data.lists || []);
        renderGrid();
      } catch (e) {
        console.error(e);
        grid.replaceChildren(el('p', 'empty', 'Erro: ' + e.message));
      }
    }

    // ---------- Visão 2: uma lista ----------
    function renderList(v) {
      const l = v.list || {};
      const questions = v.questions || [];
      const s = v.submission || null;
      const reveal = !!s && l.show_answers === 'after_submit';

      const h = el('div', 'list-head');
      h.append(badges(l), el('h1', null, l.title || ''));
      if (l.description) h.append(el('p', 'pre', l.description));
      if (l.video_id) h.append(video(l.video_id, l.title));
      if (l.pdf) {
        const a = el('a', 'btn btn-sm btn-outline', `📄 ${l.pdf.name}`);
        a.href = `/api/files/${encodeURIComponent(l.pdf.id)}`;
        a.target = '_blank';
        a.rel = 'noopener';
        const box = el('div', 'card-actions');
        box.append(a);
        h.append(box);
      }
      if (s) {
        const r = el('div', 'result-box');
        r.append(
          el('strong', null, `Resultado: ${s.score} de ${s.total} (${pct(s.score, s.total)}%)`),
          el('small', null, ` · enviada em ${fmtDate(s.submitted_at)}`));
        if (!reveal) r.append(el('p', 'small', 'O professor optou por não mostrar o gabarito desta lista.'));
        if (l.can_retry) {
          const again = el('button', 'btn btn-sm btn-outline', '🔄 Refazer lista');
          again.type = 'button';
          again.style.marginLeft = '1rem';
          again.onclick = () => resetList(l.id, again);
          r.append(again);
        }
        h.append(r);
      }
      head.replaceChildren(h);

      quiz.replaceChildren();
      quiz.onchange = quiz.onsubmit = null;
      if (!questions.length) {
        quiz.append(el('p', 'empty', 'Esta lista ainda não tem questões.'));
        return;
      }

      questions.forEach((q, i) => {
        const opts = q.options || {};
        const fs = el('fieldset', 'question');
        if (reveal) fs.classList.add(q.is_correct ? 'right' : 'wrong');
        fs.append(el('legend', null, `Questão ${i + 1}`), el('p', 'pre', q.statement || ''));

        for (const L of LETTERS) {
          const txt = String(opts[L] || '');
          if (!txt.trim()) continue;
          const lab = el('label', 'opt');
          const inp = el('input');
          inp.type = 'radio';
          inp.name = q.id;
          inp.value = L;
          if (s) {
            inp.disabled = true;
            inp.checked = q.chosen === L;
            if (reveal && q.correct === L) lab.classList.add('is-correct');
            if (reveal && q.chosen === L && q.correct !== L) lab.classList.add('is-wrong');
          }
          lab.append(inp, el('b', null, `${L})`), el('span', null, txt));
          fs.append(lab);
        }
        if (s && !q.chosen) fs.append(el('small', 'muted', 'Em branco'));
        if (reveal && q.video_id) {
          const d = el('details', 'resolution');
          d.append(el('summary', null, '🎥 Ver resolução em vídeo'),
            video(q.video_id, `Resolução da questão ${i + 1}`));
          fs.append(d);
        }
        quiz.append(fs);
      });

      if (s) return;

      const bar = el('div', 'submit-bar');
      const count = el('span', 'muted', `0 de ${questions.length} respondidas`);
      const btn = el('button', 'btn', 'Enviar respostas');
      btn.type = 'submit';
      bar.append(count, btn);
      quiz.append(bar);

      quiz.onchange = () => {
        dirty = true;
        count.textContent = `${[...new FormData(quiz).keys()].length} de ${questions.length} respondidas`;
      };

      quiz.onsubmit = async (e) => {
        e.preventDefault();
        hideAlert(msg);
        const answers = Object.fromEntries(new FormData(quiz));
        const blank = questions.length - Object.keys(answers).length;
        const lock = l.can_retry
          ? 'Você poderá refazer a lista depois.'
          : 'Depois de enviar não é possível alterar as respostas.';
        const ask = blank
          ? `Você deixou ${blank} questão(ões) em branco. ${lock} Enviar mesmo assim?`
          : `${lock} Confirmar envio?`;
        if (!confirm(ask)) return;

        btn.disabled = true;
        btn.textContent = 'Enviando...';
        try {
          const r = await api(`/student/lists/${encodeURIComponent(l.id)}/submit`,
            { method: 'POST', json: { answers } });
          dirty = false;
          renderList(r);
          showAlert(msg, r.message || 'Respostas enviadas!', 'ok');
          window.scrollTo({ top: 0, behavior: 'smooth' });
          loadLists();
        } catch (err) {
          showAlert(msg, err.message);
          btn.disabled = false;
          btn.textContent = 'Enviar respostas';
        }
      };
    }

    // ---------- Navegação por hash (#lista=ID) ----------
    async function route() {
      const id = new URLSearchParams(location.hash.slice(1)).get('lista');
      if (!id) {
        viewList.classList.add('hidden');
        viewLists.classList.remove('hidden');
        return;
      }
      viewLists.classList.add('hidden');
      viewList.classList.remove('hidden');
      head.replaceChildren(el('p', 'empty', 'Carregando...'));
      quiz.replaceChildren();
      try {
        renderList(await api(`/student/lists/${encodeURIComponent(id)}`));
      } catch (e) {
        head.replaceChildren();
        showAlert(msg, e.message);
      }
      window.scrollTo(0, 0);
    }

    document.getElementById('backLink').addEventListener('click', (e) => {
      e.preventDefault();
      if (dirty && !confirm('Suas respostas ainda não foram enviadas. Sair mesmo assim?')) return;
      dirty = false;
      hideAlert(msg);
      location.hash = '';
    });
    window.addEventListener('beforeunload', (e) => {
      if (dirty) { e.preventDefault(); e.returnValue = ''; }
    });
    window.addEventListener('hashchange', route);
    fExam.addEventListener('change', renderGrid);
    fStatus.addEventListener('change', renderGrid);

    await loadLists();
    route();
  } catch (e) {
    fail(e);
    grid.replaceChildren(el('p', 'empty', 'Erro ao carregar: ' + e.message));
  }
})();
