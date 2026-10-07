/* Loads the 3D Cassie after the app is ready (moved out of app.html so the site can forbid inline scripts). */
// Lazy-load the 3D bundle (the felt Cassie + the living gradient) after the tutor
// is interactive so it never blocks the app. Without WebGL the SVG mascot and
// the plain background stay.
(function () {
  function hasWebGL() {
    try {
      var c = document.createElement('canvas');
      return !!(c.getContext('webgl') || c.getContext('experimental-webgl'));
    } catch (e) { return false; }
  }
  function load3D() {
    if (window.CASSIE_LITE || !hasWebGL()) return; // Lite mode: keep the light SVG Cassie
    var s = document.createElement('script');
    s.src = 'mascot3d/cassie-3d.js';
    s.async = true;
    s.onload = function () { window.dispatchEvent(new Event('cassie3d-loaded')); };
    document.body.appendChild(s);
  }
  // when the 3D bot signals ready, switch the mascot from SVG to 3D
  window.addEventListener('cassie3d-ready', function () {
    var m = document.getElementById('mascot');
    if (m) m.classList.add('has3d');
  });
  if (document.readyState === 'complete') setTimeout(load3D, 400);
  else window.addEventListener('load', function () { setTimeout(load3D, 400); });
})();
