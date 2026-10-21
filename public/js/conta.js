(async () => {
  const { api, requireUser, homeOf, showAlert, hideAlert } = P40;
  const user = await requireUser();
  if (!user) return;

  const min = user.role === 'student' ? 4 : 10;
  const max = user.role === 'student' ? 64 : 128;
  document.getElementById('who').textContent = `${user.name} (@${user.username})`;
  document.getElementById('rule').textContent = `Entre ${min} e ${max} caracteres.`;
  const back = document.getElementById('back');
  back.href = homeOf(user);
  if (user.must_change) {
    document.getElementById('forced').classList.remove('hidden');
    back.classList.add('hidden');
  }

  const form = document.getElementById('pwForm');
  const msg = document.getElementById('msg');
  const $v = (id) => document.getElementById(id).value;
  let sending = false;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (sending) return;
    hideAlert(msg);
    const current = $v('current'), n1 = $v('new1'), n2 = $v('new2');
    if (!current || !n1) return showAlert(msg, 'Preencha todos os campos.');
    if (n1.length < min || n1.length > max) return showAlert(msg, `A nova senha deve ter entre ${min} e ${max} caracteres.`);
    if (n1 !== n2) return showAlert(msg, 'As novas senhas não conferem.');
    if (n1 === current) return showAlert(msg, 'A nova senha deve ser diferente da atual.');

    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    sending = true;
    try {
      const r = await api('/auth/password', { method: 'POST', json: { current, new: n1 } });
      form.reset();
      showAlert(msg, r.message + ' Redirecionando...', 'ok');
      setTimeout(() => location.replace(homeOf(user)), 1200);
    } catch (err) {
      showAlert(msg, err.message);
      btn.disabled = false;
      sending = false;
    }
  });
})();
