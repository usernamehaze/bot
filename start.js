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
  setTimeout(function () { var h = document.getElementById('hint'); if (h) h.classList.add('show'); }, 1400);
  document.body.addEventListener('click', go);
  setTimeout(go, 3900); // one full highlight-and-click, then in
})();
