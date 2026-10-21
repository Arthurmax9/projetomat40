(() => {
  const { api, homeOf, safeNext, showAlert, hideAlert } = P40;
  const form = document.getElementById('loginForm');
  const msg = document.getElementById('msg');
  const next = safeNext(new URLSearchParams(location.search).get('next'));

  const go = (u) => {
    if (u.must_change) return location.replace('/conta.html?obrigatorio=1');
    const base = homeOf(u).replace(/\.html$/, ''); // aceita /professor e /professor.html
    location.replace(next && next.startsWith(base) ? next : homeOf(u));
  };

  // Quem já está logado vai direto para o painel
  api('/me').then((d) => go(d.user)).catch(() => {});

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideAlert(msg);
    const username = form.username.value.trim().toLowerCase();
    const password = form.password.value;
    if (!username || !password) return showAlert(msg, 'Informe usuário e senha.');

    const btn = form.querySelector('button[type=submit]') || form.querySelector('button');
    btn.disabled = true;
    btn.textContent = 'Entrando...';
    try {
      const { user } = await api('/auth/login', { method: 'POST', json: { username, password } });
      go(user);
    } catch (err) {
      showAlert(msg, err.message);
      form.password.value = '';
      form.password.focus();
      btn.disabled = false;
      btn.textContent = 'Entrar';
    }
  });
})();
