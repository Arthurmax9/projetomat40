// public/pw-eye.js — botão de mostrar/ocultar senha
(() => {
  document.querySelectorAll('input[type="password"]').forEach((input) => {
    if (input.dataset.eye) return;
    input.dataset.eye = '1';

    const wrap = document.createElement('div');
    wrap.className = 'pw-wrap';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pw-eye';
    btn.setAttribute('aria-label', 'Mostrar senha');
    btn.textContent = '👁';
    wrap.appendChild(btn);

    btn.addEventListener('click', () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.setAttribute('aria-label', show ? 'Ocultar senha' : 'Mostrar senha');
      btn.classList.toggle('on', show);
    });
  });
})();
