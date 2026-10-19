/* The loading screen: go into the app after one loop, or on a tap (moved out of start.html so the site can forbid inline scripts). */
(function () {
  // Cloudflare Pages serves HTML at its extensionless clean URL and
  // 308-redirects /app.html -> /app; GitHub Pages needs the .html. Pick the
  // right target per host so navigation never hits a redirect.
  function target() {
    var h = location.hostname;
    if (h.indexOf('github.io') !== -1) return 'app.html';
    if (h === 'localhost' || h === '127.0.0.1' || location.protocol === 'file:') return 'app.html';
    return 'app';
  }
  var done = false;
  function go() { if (done) return; done = true; window.location.href = target(); }
  // (the app's own background: Monochrome's greys, or cream when Blush & Sage is picked in Appearance)
  try { var st = JSON.parse(localStorage.getItem('cassie.v2') || '{}'); if (String(st.accent || '').toLowerCase() === 'cassie') document.documentElement.classList.add('cassie'); } catch (e) { /* ignore */ }
  document.body.addEventListener('click', go);
  // a small spinner only if the app is slow to arrive (on a fast connection nothing shows at all)
  setTimeout(function () { var s = document.querySelector('.spin'); if (s) s.classList.add('on'); }, 700);
  setTimeout(go, 400); // a moment, then in (a first visit gets the app's own Welcome next)
})();
