// public/js/topbar.js — avatar, nome, "Minha conta" e "Sair"
(() => {
  if (!window.P40) return console.error('topbar.js: carregue api.js antes.');
  const { api, logout } = P40;

  const byText = (txt) =>
    [...document.querySelectorAll('button, a')].find((b) => b.textContent.trim() === txt);

  const btnSair = document.getElementById('logoutBtn') || byText('Sair');
  const btnConta = document.getElementById('accountBtn') || byText('Minha conta');
  const avatar = document.getElementById('avatar') || document.querySelector('.avatar');
  const nameEl = document.getElementById('userName') || document.querySelector('.user-name');

  if (btnSair) {
    btnSair.addEventListener('click', async (e) => {
      e.preventDefault();
      btnSair.disabled = true;
      await logout();
    });
  }

  if (btnConta) {
    btnConta.addEventListener('click', (e) => {
      e.preventDefault();
      location.href = '/conta.html';
    });
  }

  api('/me')
    .then(({ user }) => {
      if (nameEl) nameEl.textContent = user.name;
      if (avatar) {
        const ini = user.name.trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
        avatar.textContent = ini || '·';
        avatar.title = `${user.name} (@${user.username})`;
      }
    })
    .catch(() => { /* a página trata o redirecionamento */ });
})();
