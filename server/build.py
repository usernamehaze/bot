# Bundle worker.src.js + dashboard.html → worker.js (the single file you paste into Cloudflare).
html = open('dashboard.html').read().replace('\\', '\\\\').replace('`', '\\`').replace('${', '\\${')
src = open('worker.src.js').read()
assert '__DASHBOARD_HTML__' in src
open('worker.js', 'w').write(src.replace('__DASHBOARD_HTML__', html))
print('wrote worker.js')
