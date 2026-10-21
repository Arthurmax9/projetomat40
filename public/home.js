// Carrega as listas públicas, monta os cards de ENEM e UFRGS com filtros e permite fazer a lista.
(() => {
  const LEVEL = { facil: 'Fácil', medio: 'Médio', dificil: 'Difícil' };
  const LETTERS = ['A', 'B', 'C', 'D', 'E'];

  const el = (tag, cls, txt) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  };

  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  // A miniatura só vira iframe ao clicar
  function video(id, title) {
    const box = el('div', 'video');
    const btn = el('button');
    btn.type = 'button';
    btn.setAttribute('aria-label', `Assistir vídeo: ${title}`);
    const img = el('img');
    img.src = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
    img.alt = '';
    img.loading = 'lazy';
    btn.append(img, el('span', 'play', '▶'));
    btn.addEventListener('click', () => {
      const f = document.createElement('iframe');
      f.src = `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`;
      f.title = title;
      f.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
      f.allowFullscreen = true;
      f.referrerPolicy = 'strict-origin-when-cross-origin';
      box.replaceChildren(f);
    }, { once: true });
    box.append(btn);
    return box;
  }

  // ---------- Fazer lista ----------
  async function openQuiz(x) {
    const dlg = el('dialog', 'quiz');
    const head = el('div', 'quiz-head');
    const close = el('button', 'quiz-close', '✕');
    close.type = 'button';
    close.setAttribute('aria-label', 'Fechar');
    close.addEventListener('click', () => dlg.close());
    head.append(el('h3', null, `Lista ${x.position} · ${x.title}`), close);
    const body = el('div', 'quiz-body');
    body.append(el('p', 'empty', 'Carregando...'));
    dlg.append(head, body);
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();

    try {
      const r = await fetch(`/api/public/lists/${encodeURIComponent(x.id)}`, { credentials: 'same-origin' });
      if (!r.ok) throw new Error();
      renderQuiz(body, x.id, (await r.json()).questions);
    } catch {
      body.replaceChildren(el('p', 'empty', 'Não foi possível carregar a lista.'));
    }
  }

  function renderQuiz(body, listId, questions) {
    const form = el('form', 'quiz-form');

    for (const q of questions) {
      const fs = el('fieldset', 'q');
      fs.dataset.q = q.id;
      fs.append(el('legend', null, `Questão ${q.position}`), el('p', 'q-st', q.statement));
      for (const L of LETTERS) {
        const lab = el('label', 'opt');
        lab.dataset.l = L;
        const r = el('input');
        r.type = 'radio';
        r.name = q.id;
        r.value = L;
        lab.append(r, el('b', null, `${L})`), el('span', null, q.options[L]));
        fs.append(lab);
      }
      form.append(fs);
    }

    const msg = el('p', 'quiz-msg');
    msg.setAttribute('aria-live', 'polite');
    const send = el('button', 'btn', 'Corrigir');
    send.type = 'submit';
    form.append(msg, send);

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const answers = Object.fromEntries(new FormData(form));
      if (!Object.keys(answers).length) { msg.textContent = 'Responda ao menos uma questão.'; return; }
      if (Object.keys(answers).length < questions.length &&
          !confirm('Há questões sem resposta. Corrigir mesmo assim?')) return;

      send.disabled = true;
      msg.textContent = 'Corrigindo...';
      try {
        const r = await fetch(`/api/public/lists/${encodeURIComponent(listId)}/check`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', 'x-p40': '1' },
          body: JSON.stringify({ answers }),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error);

        msg.textContent = `Você acertou ${d.score} de ${d.total}.`;
        form.querySelectorAll('input').forEach((i) => { i.disabled = true; });

        for (const res of d.results || []) {
          const fs = form.querySelector(`[data-q="${CSS.escape(res.id)}"]`);
          if (!fs) continue;
          fs.classList.add(res.is_correct ? 'ok' : 'wrong');
          fs.querySelector(`[data-l="${res.correct}"]`)?.classList.add('correct');
          if (res.chosen && !res.is_correct) fs.querySelector(`[data-l="${res.chosen}"]`)?.classList.add('chosen-wrong');
          if (res.video_id) fs.append(video(res.video_id, 'Resolução'));
        }

        const again = el('button', 'btn btn-outline', 'Refazer');
        again.type = 'button';
        again.addEventListener('click', () => renderQuiz(body, listId, questions));
        send.replaceWith(again);
        msg.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } catch (e) {
        msg.textContent = e.message || 'Erro ao corrigir. Tente novamente.';
        send.disabled = false;
      }
    });

    body.replaceChildren(form);
  }

  // ---------- Cards ----------
  function card(x) {
    const c = el('article', 'card');
    const badges = el('div', 'badges');
    badges.append(el('span', 'badge', `Lista ${x.position}`));
    if (x.topic) badges.append(el('span', 'badge', x.topic));
    if (x.level) badges.append(el('span', `badge ${x.level}`, LEVEL[x.level]));
    c.append(badges, el('h3', null, x.title));
    if (x.description) c.append(el('p', null, x.description));
    if (x.video_id) c.append(video(x.video_id, x.title));

    const act = el('div', 'card-actions');
    if (x.question_count > 0) {
      const b = el('button', 'btn btn-sm', `✏️ Fazer lista (${x.question_count})`);
      b.type = 'button';
      b.addEventListener('click', () => openQuiz(x));
      act.append(b);
    }
    for (const f of x.files || []) {
      const a = el('a', 'btn btn-sm btn-outline', '📄 Baixar PDF');
      a.href = `/api/files/${encodeURIComponent(f.id)}`;
      a.target = '_blank';
      a.rel = 'noopener';
      a.title = f.name;
      act.append(a);
    }
    if (act.children.length) c.append(act);
    return c;
  }

  function setup(section, items) {
    const grid = section.querySelector('[data-grid]');
    const fTopic = section.querySelector('[data-filter="topic"]');
    const fLevel = section.querySelector('[data-filter="level"]');
    const fQ = section.querySelector('[data-filter="q"]');

    const topics = [...new Set(items.map((i) => i.topic).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    for (const t of topics) {
      const o = el('option', null, t);
      o.value = t;
      fTopic.append(o);
    }

    const render = () => {
      const q = norm(fQ.value.trim());
      const list = items.filter((i) =>
        (!fTopic.value || i.topic === fTopic.value) &&
        (!fLevel.value || i.level === fLevel.value) &&
        (!q || norm(`${i.title} ${i.description} ${i.topic}`).includes(q)));
      grid.replaceChildren(...(list.length
        ? list.map(card)
        : [el('p', 'empty', items.length ? 'Nenhum resultado para este filtro.' : 'Em breve, novos conteúdos.')]));
    };

    fTopic.addEventListener('change', render);
    fLevel.addEventListener('change', render);
    let t;
    fQ.addEventListener('input', () => { clearTimeout(t); t = setTimeout(render, 200); });
    render();
  }

  const sections = document.querySelectorAll('section[data-exam]');

  fetch('/api/public/content', { credentials: 'same-origin' })
    .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
    .then(({ exercises }) => {
      sections.forEach((s) => setup(s, exercises.filter((e) => e.exam === s.dataset.exam)));
    })
    .catch(() => {
      sections.forEach((s) => s.querySelector('[data-grid]')
        .replaceChildren(el('p', 'empty', 'Não foi possível carregar os conteúdos. Atualize a página.')));
    });
})();
