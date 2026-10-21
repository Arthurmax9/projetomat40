// public/js/api.js — utilitários do front (script comum, sem import/export)
(() => {
  const EXAM = { enem: 'ENEM', ufrgs: 'UFRGS' };
  const LEVEL = { facil: 'Fácil', medio: 'Médio', dificil: 'Difícil' };

  async function api(path, { method = 'GET', json, form } = {}) {
    const headers = { 'x-p40': '1' };
    let body;
    if (json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(json);
    } else if (form) {
      body = form;
    }
    const res = await fetch(`/api${path}`, { method, headers, body, credentials: 'same-origin' });
    let data = {};
    try { data = await res.json(); } catch { /* sem corpo */ }
    if (!res.ok) {
      const e = new Error(data.error || `Erro ${res.status}`);
      e.status = res.status;
      throw e;
    }
    return data;
  }

  const homeOf = (u) => (u && u.role === 'teacher' ? '/professor.html' : '/aluno.html');

  const safeNext = (n) =>
    typeof n === 'string' && n.startsWith('/') && !n.startsWith('//') ? n : null;

  async function requireUser(role) {
    try {
      const { user } = await api('/me');
      if (user.must_change && !location.pathname.startsWith('/conta')) {
        location.replace('/conta.html?obrigatorio=1');
        return null;
      }
      if (role && user.role !== role) {
        location.replace(homeOf(user));
        return null;
      }
      return user;
    } catch {
      location.replace(`/login.html?next=${encodeURIComponent(location.pathname + location.hash)}`);
      return null;
    }
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function showAlert(box, msg, type = 'error') {
    if (!box) return;
    box.className = `alert ${type}`;
    box.textContent = msg;
    box.classList.remove('hidden');
  }

  function hideAlert(box) {
    if (!box) return;
    box.classList.add('hidden');
    box.textContent = '';
  }

  const fmtDate = (ms) =>
    ms
      ? new Date(Number(ms)).toLocaleString('pt-BR', {
          day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
        })
      : '—';

  async function logout() {
    try { await api('/auth/logout', { method: 'POST' }); } catch { /* ignora */ }
    location.replace('/login.html');
  }

  window.P40 = { api, el, requireUser, showAlert, hideAlert, fmtDate, homeOf, safeNext, logout, LEVEL, EXAM };
})();
