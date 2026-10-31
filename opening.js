// "Open Cassie" on the website: pressed, it stays clearly visible and says it's opening (a small spinner and
// "Opening…") until the app loads, so nobody wonders whether it worked. Back from the app, it reads as before.
(() => {
  const OPEN = 'a[href="start.html"].btn, a[href="start.html"].rs-open';
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest(OPEN);
    if (!a || e.defaultPrevented || e.button > 0 || e.metaKey || e.ctrlKey || e.shiftKey || a.classList.contains('opening')) return;
    a.dataset.label = a.textContent; a.style.minWidth = a.getBoundingClientRect().width + 'px'; // (it keeps its size)
    a.classList.add('opening'); a.setAttribute('aria-busy', 'true'); a.textContent = 'Opening…';
  });
  window.addEventListener('pageshow', () => document.querySelectorAll('.opening').forEach((a) => {
    a.classList.remove('opening'); a.removeAttribute('aria-busy'); a.style.minWidth = ''; if (a.dataset.label) a.textContent = a.dataset.label;
  }));
})();
