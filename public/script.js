// Sombra no cabeçalho, ano no rodapé e botões do portal que mudam conforme o login.
(() => {
  // Sombra ao rolar (funciona com o header antigo e com o novo)
  const header = document.querySelector('.topbar, .site-header');
  if (header) {
    const onScroll = () => header.classList.toggle('scrolled', window.scrollY > 8);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // Ano no rodapé
  const ano = document.getElementById('ano');
  if (ano) ano.textContent = new Date().getFullYear();

  // Se o usuário já está logado, os botões levam direto para o painel dele
  const navLogin = document.getElementById('navLogin');
  const portalLinks = document.querySelectorAll('[data-portal-link]');
  const chip = document.getElementById('userChip');
  const avatar = document.getElementById('userAvatar');

  if (!navLogin && !portalLinks.length) return;

  fetch('/api/me', { credentials: 'same-origin' })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      const u = d?.user;
      if (!u) return;

      const painel = u.role === 'teacher' ? '/professor.html' : '/aluno.html';

      if (navLogin) {
        navLogin.textContent = 'Meu painel';
        navLogin.href = painel;
      }
      portalLinks.forEach((a) => {
        a.textContent = 'Ir para o painel';
        a.href = painel;
      });

      if (chip && avatar) {
        const nome = String(u.name || u.username || '').trim();
        avatar.textContent = (nome[0] || 'A').toUpperCase();
        if (nome) chip.title = nome;
        chip.classList.remove('hidden');
      }
    })
    .catch(() => {});
})();
