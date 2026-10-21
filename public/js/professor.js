(async () => {
  const { api, el, requireUser, showAlert, hideAlert, fmtDate, LEVEL, EXAM } = P40;
  const me = await requireUser('teacher');
  if (!me) return;
  document.getElementById('userName').textContent = me.name;

  const $ = (id) => document.getElementById(id);
  const msg = $('msg');
  const LETTERS = ['A', 'B', 'C', 'D', 'E'];
  const views = { listas: $('vListas'), editor: $('vEditor'), resultados: $('vResultados'), users: $('vUsers') };
  let lists = [], users = [], usersRole = 'student', editingId = null, dirty = false;

  const btn = (txt, cls, fn) => {
    const b = el('button', `btn btn-sm ${cls || ''}`, txt);
    b.type = 'button';
    b.addEventListener('click', fn);
    return b;
  };
  const row = (cells, tag = 'td') => {
    const tr = el('tr');
    for (const c of cells) {
      const td = el(tag);
      c instanceof Node ? td.append(c) : (td.textContent = c ?? '');
      tr.append(td);
    }
    return tr;
  };
  const group = (...n) => { const d = el('div', 'actions'); d.append(...n); return d; };
  const ok = (m) => showAlert(msg, m, 'ok');
  const fail = (e) => showAlert(msg, e.message || String(e));

  function show(view, tab) {
    Object.values(views).forEach((v) => v.classList.add('hidden'));
    views[view].classList.remove('hidden');
    document.querySelectorAll('[data-tab]').forEach((a) =>
      a.classList.toggle('active', a.dataset.tab === tab));
  }

  // ===================== LISTAS =====================
  function renderLists() {
    const t = $('listsTable'), q = $('fQ').value.trim().toLowerCase(), ex = $('fExam').value;
    const items = lists.filter((l) => (!ex || l.exam === ex) &&
      (!q || `${l.title} ${l.topic || ''}`.toLowerCase().includes(q)));
    t.replaceChildren(el('thead'), el('tbody'));
    t.tHead.append(row(['Lista', 'Título', 'Tema / nível', 'Questões', 'Alunos', 'Envios', 'Visível', ''], 'th'));
    if (!items.length) {
      const tr = row([lists.length ? 'Nenhuma lista para este filtro.' : 'Nenhuma lista criada ainda.']);
      tr.firstChild.colSpan = 8; tr.firstChild.className = 'empty';
      return t.tBodies[0].append(tr);
    }
    for (const l of items) {
      const edit = el('a', 'btn btn-sm', 'Editar'); edit.href = `#editar=${encodeURIComponent(l.id)}`;
      const res = el('a', 'btn btn-sm btn-ghost', 'Resultados'); res.href = `#resultados=${encodeURIComponent(l.id)}`;
      const del = btn('Excluir', 'btn-danger', async () => {
        if (!confirm(`Excluir a lista "${l.title}"? As questões, os envios e o PDF também serão apagados.`)) return;
        try { ok((await api(`/lists/${encodeURIComponent(l.id)}`, { method: 'DELETE' })).message); loadLists(); }
        catch (e) { fail(e); }
      });
      t.tBodies[0].append(row([
        `${EXAM[l.exam]} ${l.position}`, l.title,
        [l.topic, LEVEL[l.level]].filter(Boolean).join(' · ') || '—',
        String(l.question_count), String(l.assigned_count), String(l.submission_count),
        (l.is_public ? '🌐 Pública' : '🔒 Privada') + (l.pdf_file_id ? ' · 📄' : ''),
        group(edit, res, del),
      ]));
    }
  }

  async function loadLists() {
    try { ({ lists } = await api('/lists')); renderLists(); } catch (e) { fail(e); }
  }
  $('fQ').addEventListener('input', renderLists);
  $('fExam').addEventListener('change', renderLists);

  // ===================== EDITOR =====================
  const qBox = $('qBox'), stBox = $('stBox'), form = $('listForm');

  function renumber() {
    [...qBox.children].forEach((fs, i) => { fs.querySelector('legend').textContent = `Questão ${i + 1}`; });
    $('qCount').textContent = `(${qBox.children.length})`;
  }

  function qBlock(q = {}) {
    const fs = el('fieldset', 'question q-edit');
    fs.dataset.id = q.id || '';
    const uid = Math.random().toString(36).slice(2);
    const tools = group(
      btn('↑', 'btn-ghost', () => { fs.previousElementSibling?.before(fs); renumber(); dirty = true; }),
      btn('↓', 'btn-ghost', () => { fs.nextElementSibling?.after(fs); renumber(); dirty = true; }),
      btn('Remover', 'btn-danger', () => {
        if (fs.dataset.id && !confirm('Remover esta questão? As respostas dos alunos para ela serão desconsideradas.')) return;
        fs.remove(); renumber(); dirty = true;
      }),
    );
    const st = el('textarea'); st.rows = 3; st.maxLength = 5000; st.dataset.k = 'st';
    st.placeholder = 'Enunciado'; st.value = q.statement || '';
    fs.append(el('legend'), tools, st);

    for (const L of LETTERS) {
      const lab = el('label', 'opt-edit');
      const r = el('input'); r.type = 'radio'; r.name = `c_${uid}`; r.value = L; r.checked = q.correct === L;
      r.title = `Marcar ${L} como correta`;
      const o = el('input'); o.maxLength = 1000; o.dataset.k = L; o.value = q.options?.[L] || '';
      o.placeholder = `Alternativa ${L}`;
      lab.append(r, el('b', null, `${L})`), o);
      fs.append(lab);
    }
    const v = el('input'); v.type = 'url'; v.dataset.k = 'video'; v.value = q.video_url || '';
    v.placeholder = 'Vídeo de resolução (YouTube, opcional)';
    fs.append(el('small', 'muted', 'Marque o círculo da alternativa correta.'), v);
    return fs;
  }

  function collectQuestions() {
    return [...qBox.children].map((fs) => ({
      id: fs.dataset.id || undefined,
      statement: fs.querySelector('[data-k="st"]').value,
      options: Object.fromEntries(LETTERS.map((L) => [L, fs.querySelector(`[data-k="${L}"]`).value])),
      correct: fs.querySelector('input[type=radio]:checked')?.value || null,
      video_url: fs.querySelector('[data-k="video"]').value.trim(),
    }));
  }

  async function renderStudents(selected) {
    const { users: st } = await api('/users?role=student');
    stBox.replaceChildren(...(st.length ? st.map((s) => {
      const lab = el('label', 'check');
      lab.dataset.search = `${s.name} ${s.username}`.toLowerCase();
      const c = el('input'); c.type = 'checkbox'; c.value = s.id; c.checked = selected.has(s.id);
      lab.append(c, el('span', null, `${s.name} (@${s.username})${s.active ? '' : ' · inativo'}`));
      return lab;
    }) : [el('p', 'muted', 'Nenhum aluno cadastrado. Cadastre na aba Alunos.')]));
  }
  $('stQ').addEventListener('input', () => {
    const q = $('stQ').value.trim().toLowerCase();
    stBox.querySelectorAll('label').forEach((l) => l.classList.toggle('hidden', !!q && !l.dataset.search.includes(q)));
  });
  const markAll = (v) => stBox.querySelectorAll('label:not(.hidden) input').forEach((c) => { c.checked = v; dirty = true; });
  $('stAll').addEventListener('click', () => markAll(true));
  $('stNone').addEventListener('click', () => markAll(false));

  function renderPdf(list) {
    const box = $('pdfBox');
    if (!editingId) return box.replaceChildren(el('p', 'muted', 'Salve a lista primeiro para anexar um PDF.'));
    const parts = [];
    if (list.pdf_file_id) {
      const a = el('a', 'btn btn-sm btn-outline', `📄 ${list.pdf_name}`);
      a.href = `/api/files/${encodeURIComponent(list.pdf_file_id)}`; a.target = '_blank'; a.rel = 'noopener';
      parts.push(a, btn('Remover PDF', 'btn-danger', async () => {
        if (!confirm('Remover o PDF desta lista?')) return;
        try { ok((await api(`/lists/${encodeURIComponent(editingId)}/pdf`, { method: 'DELETE' })).message); renderPdf({}); }
        catch (e) { fail(e); }
      }));
    }
    const inp = el('input'); inp.type = 'file'; inp.accept = 'application/pdf,.pdf';
    inp.addEventListener('change', async () => {
      const f = inp.files[0];
      if (!f) return;
      if (f.size > 10 * 1024 * 1024) { inp.value = ''; return fail(new Error('O PDF deve ter no máximo 10 MB.')); }
      const fd = new FormData(); fd.append('file', f);
      inp.disabled = true;
      try {
        const r = await api(`/lists/${encodeURIComponent(editingId)}/pdf`, { method: 'POST', form: fd });
        ok(r.message);
        renderPdf({ pdf_file_id: r.file.id, pdf_name: r.file.name });
      } catch (e) { fail(e); inp.disabled = false; }
    });
    const lab = el('label', 'field');
    lab.append(el('span', 'small', list.pdf_file_id ? 'Substituir PDF (máx. 10 MB)' : 'Enviar PDF (máx. 10 MB)'), inp);
    box.replaceChildren(group(...parts), lab);
  }

  async function openEditor(id) {
    show('editor', 'listas');
    editingId = id; dirty = false;
    form.reset(); qBox.replaceChildren(); stBox.replaceChildren(el('p', 'muted', 'Carregando...'));
    $('edTitle').textContent = id ? 'Editar lista' : 'Nova lista';
    $('topics').replaceChildren(...[...new Set(lists.map((l) => l.topic).filter(Boolean))].map((t) => {
      const o = el('option'); o.value = t; return o;
    }));
    try {
      let data = { list: {}, questions: [], student_ids: [] };
      if (id) data = await api(`/lists/${encodeURIComponent(id)}`);
      const L = data.list;
      if (id) {
        for (const k of ['title', 'description', 'exam', 'topic', 'position', 'video_url', 'show_answers']) form[k].value = L[k] ?? '';
        form.level.value = L.level || '';
        form.is_public.checked = !!L.is_public;
      } else {
        const ex = $('fExam').value || 'enem';
        form.exam.value = ex;
        form.position.value = Math.max(0, ...lists.filter((l) => l.exam === ex).map((l) => l.position)) + 1;
      }
      data.questions.forEach((q) => qBox.append(qBlock(q)));
      if (!id) qBox.append(qBlock());
      renumber();
      await renderStudents(new Set(data.student_ids));
      renderPdf(L);
    } catch (e) { fail(e); }
  }

  $('addQ').addEventListener('click', () => {
    const b = qBlock(); qBox.append(b); renumber(); dirty = true;
    b.querySelector('textarea').focus();
  });
  form.addEventListener('input', () => { dirty = true; });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideAlert(msg);
    const payload = {
      title: form.title.value, description: form.description.value, exam: form.exam.value,
      topic: form.topic.value, level: form.level.value || null, position: Number(form.position.value),
      video_url: form.video_url.value.trim(), is_public: form.is_public.checked,
      show_answers: form.show_answers.value, questions: collectQuestions(),
      student_ids: [...stBox.querySelectorAll('input:checked')].map((c) => c.value),
    };
    const sb = $('saveBtn'); sb.disabled = true;
    try {
      const r = editingId
        ? await api(`/lists/${encodeURIComponent(editingId)}`, { method: 'PUT', json: payload })
        : await api('/lists', { method: 'POST', json: payload });
      dirty = false;
      ok(r.message);
      await loadLists();
      if (location.hash !== `#editar=${r.id}`) location.hash = `editar=${r.id}`; // recarrega com IDs das questões
      else openEditor(r.id);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) { fail(err); window.scrollTo({ top: 0, behavior: 'smooth' }); }
    finally { sb.disabled = false; }
  });

  // ===================== RESULTADOS =====================
  async function openResults(id) {
    show('resultados', 'listas');
    const t = $('resTable');
    t.replaceChildren();
    const l = lists.find((x) => x.id === id);
    $('resTitle').textContent = l ? `Resultados: ${l.title}` : 'Resultados';
    try {
      const { questions, results } = await api(`/lists/${encodeURIComponent(id)}/results`);
      const done = results.filter((r) => r.submitted_at);
      const avg = done.length ? Math.round(done.reduce((s, r) => s + (r.total ? r.score / r.total : 0), 0) / done.length * 100) : 0;
      $('resSummary').textContent = `${done.length} de ${results.length} alunos enviaram` + (done.length ? ` · média ${avg}%` : '');

      t.append(el('thead'), el('tbody'));
      t.tHead.append(row(['Aluno', 'Nota', 'Enviado em', ...questions.map((q) => `Q${q.position}`), ''], 'th'));
      // Linha do gabarito
      t.tHead.append(row(['Gabarito', '', '', ...questions.map((q) => q.correct), ''], 'th'));
      if (!results.length) {
        const tr = row(['Nenhum aluno atribuído a esta lista.']);
        tr.firstChild.colSpan = questions.length + 4; tr.firstChild.className = 'empty';
        return t.tBodies[0].append(tr);
      }
      for (const r of results) {
        const cells = questions.map((q) => {
          const a = r.answers[q.id];
          const s = el('span', !r.submitted_at ? 'muted' : !a ? 'ans blank' : a === q.correct ? 'ans right' : 'ans wrong', r.submitted_at ? (a || '–') : '');
          return s;
        });
        const reset = r.submitted_at ? btn('Liberar refazer', 'btn-ghost', async () => {
          if (!confirm(`Apagar o envio de ${r.name}? O aluno poderá refazer a lista.`)) return;
          try {
            ok((await api(`/lists/${encodeURIComponent(id)}/submissions/${encodeURIComponent(r.id)}`, { method: 'DELETE' })).message);
            openResults(id); loadLists();
          } catch (e) { fail(e); }
        }) : '';
        t.tBodies[0].append(row([
          `${r.name} (@${r.username})`,
          r.submitted_at ? `${r.score}/${r.total} (${r.total ? Math.round(r.score / r.total * 100) : 0}%)` : '⏳ Pendente',
          r.submitted_at ? fmtDate(r.submitted_at) : '—',
          ...cells, reset,
        ]));
      }
    } catch (e) { fail(e); }
  }

  // ===================== USUÁRIOS =====================
  const uForm = $('userForm');
  $('uMode').addEventListener('change', () => $('uPwField').classList.toggle('hidden', $('uMode').value !== 'manual'));

  function showPassword(name, username, pw) {
    const box = $('pwOut');
    box.replaceChildren(
      el('strong', null, `Senha de ${name} (@${username}): `),
      el('code', 'pw', pw),
      el('p', 'small', 'Anote ou envie agora: ela não será exibida novamente.'),
      btn('Copiar', 'btn-ghost', () => navigator.clipboard?.writeText(`Usuário: ${username}\nSenha: ${pw}`).then(() => ok('Copiado.'))),
    );
    box.classList.remove('hidden');
  }

  function renderUsers() {
    const t = $('usersTable'), q = $('uQ').value.trim().toLowerCase();
    const items = users.filter((u) => !q || `${u.name} ${u.username}`.toLowerCase().includes(q));
    t.replaceChildren(el('thead'), el('tbody'));
    t.tHead.append(row(['Nome', 'Usuário', 'Status', 'Cadastro', ''], 'th'));
    if (!items.length) {
      const tr = row(['Nenhum usuário encontrado.']); tr.firstChild.colSpan = 5; tr.firstChild.className = 'empty';
      return t.tBodies[0].append(tr);
    }
    for (const u of items) {
      const self = u.id === me.id;
      const patch = async (json, done) => {
        try {
          const r = await api(`/users/${encodeURIComponent(u.id)}`, { method: 'PATCH', json });
          r.password ? showPassword(u.name, u.username, r.password) : ok(done || r.message);
          loadUsers();
        } catch (e) { fail(e); }
      };
      const acts = self ? el('span', 'muted small', 'Você') : group(
        btn(u.active ? 'Desativar' : 'Ativar', 'btn-ghost', () => {
          if (u.active && !confirm(`Desativar ${u.name}? A pessoa não conseguirá entrar.`)) return;
          patch({ active: !u.active });
        }),
        btn('Nova senha', 'btn-ghost', () => {
          if (confirm(`Gerar uma nova senha para ${u.name}? A senha atual deixará de funcionar.`)) patch({ passwordMode: 'auto' });
        }),
        btn('Excluir', 'btn-danger', async () => {
          if (!confirm(`Excluir ${u.name} definitivamente? Os envios dessa pessoa também serão apagados.`)) return;
          try { ok((await api(`/users/${encodeURIComponent(u.id)}`, { method: 'DELETE' })).message); loadUsers(); }
          catch (e) { fail(e); }
        }),
      );
      const status = !u.active ? '⛔ Inativo' : u.must_change ? '🔑 Senha provisória' : '✅ Ativo';
      t.tBodies[0].append(row([u.name, `@${u.username}`, status, fmtDate(u.created_at), acts]));
    }
  }

  async function loadUsers() {
    try { ({ users } = await api(`/users?role=${usersRole}`)); renderUsers(); } catch (e) { fail(e); }
  }
  $('uQ').addEventListener('input', renderUsers);

  function openUsers(role) {
    usersRole = role;
    show('users', role === 'student' ? 'alunos' : 'professores');
    const s = role === 'student';
    $('uTitle').textContent = s ? 'Alunos' : 'Professores';
    $('uFormTitle').textContent = s ? 'Cadastrar aluno' : 'Cadastrar professor';
    $('uPw').placeholder = s ? '4 a 64 caracteres' : '10 a 128 caracteres';
    $('pwOut').classList.add('hidden');
    uForm.reset(); $('uPwField').classList.add('hidden'); $('uQ').value = '';
    users = []; renderUsers(); loadUsers();
  }

  uForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideAlert(msg);
    const json = {
      role: usersRole, name: $('uName').value, username: $('uUser').value.trim().toLowerCase(),
      passwordMode: $('uMode').value, password: $('uPw').value,
    };
    const b = uForm.querySelector('button[type=submit]'); b.disabled = true;
    try {
      const r = await api('/users', { method: 'POST', json });
      r.password ? showPassword(r.user.name, r.user.username, r.password) : (ok(r.message), $('pwOut').classList.add('hidden'));
      uForm.reset(); $('uPwField').classList.add('hidden');
      loadUsers();
    } catch (err) { fail(err); }
    finally { b.disabled = false; }
  });

  // ===================== ROTEAMENTO =====================
  let lastHash = location.hash;
  async function route() {
    if (dirty && !views.editor.classList.contains('hidden') &&
        !confirm('Há alterações não salvas na lista. Sair mesmo assim?')) {
      history.replaceState(null, '', lastHash); return;
    }
    dirty = false;
    lastHash = location.hash;
    hideAlert(msg);
    const h = new URLSearchParams(location.hash.slice(1));
    if (h.has('editar')) return openEditor(h.get('editar'));
    if (h.has('nova')) return openEditor(null);
    if (h.has('resultados')) return openResults(h.get('resultados'));
    if (h.has('alunos')) return openUsers('student');
    if (h.has('professores')) return openUsers('teacher');
    show('listas', 'listas');
    loadLists();
  }
  window.addEventListener('hashchange', route);
  window.addEventListener('beforeunload', (e) => { if (dirty) e.preventDefault(); });

  await loadLists();
  route();
})();
