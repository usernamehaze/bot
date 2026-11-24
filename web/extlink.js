/* Get the extension: from the browser's own store, in one click on its Add button (no download,
   no unzipping, and it keeps itself up to date). A website can't add an extension by itself.
   Links marked data-ext go to the right store for this browser; data-ext="label" also says its
   name ("Add to Edge") and [data-ext-name] inside a link is the browser's name.
   Until Cassie is listed in a browser's own store: Edge, Brave and Opera add her from the
   Chrome Web Store, and Firefox is told she's coming. Paste a store's link below once it's live. */
(function () {
  const STORES = {
    chrome: 'https://chromewebstore.google.com/detail/hnafgijhojdheggkcjliffbgpdhikbpj',
    edge: '',    // Microsoft Edge Add-ons
    opera: '',   // Opera add-ons
    firefox: '', // Firefox Add-ons
  };
  const NAMES = { chrome: 'Chrome', edge: 'Edge', opera: 'Opera', firefox: 'Firefox', brave: 'Brave' };
  function browser(ua = navigator.userAgent) {
    if (/Firefox\//.test(ua)) return 'firefox';
    if (/Edg\//.test(ua)) return 'edge';
    if (/OPR\//.test(ua)) return 'opera';
    if (navigator.brave) return 'brave';
    return 'chrome';
  }
  function info(b = browser()) {
    const own = STORES[b === 'brave' ? 'chrome' : b];
    if (own) return { href: own, name: NAMES[b], ready: true };
    if (b === 'firefox') return { href: 'support.html#firefox', name: NAMES[b], ready: false };
    return { href: STORES.chrome, name: NAMES[b], ready: true };
  }
  function fix(root = document) {
    const i = info();
    root.querySelectorAll('a[data-ext]').forEach((a) => {
      a.href = i.href;
      a.removeAttribute('download');
      if (i.ready) { a.target = '_blank'; a.rel = 'noopener'; } else a.removeAttribute('target');
      if (a.dataset.ext === 'label') a.textContent = i.ready ? 'Add to ' + i.name : 'Coming to Firefox';
      a.querySelectorAll('[data-ext-name]').forEach((n) => { n.textContent = i.name; });
    });
  }
  window.CassieExt = { STORES, browser, info, fix };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => fix());
  else fix();
})();
