# Bundle worker.src.js + dashboard.html + ../care.js → worker.js (the single file you paste into Cloudflare).
html = open('dashboard.html').read().replace('\\', '\\\\').replace('`', '\\`').replace('${', '\\${')
src = open('worker.src.js').read()
assert '__DASHBOARD_HTML__' in src and '/*__CARE_JS__*/' in src
# Cassie's care response is one file for the app, the extension and the server (../care.js)
care = open('../care.js').read()
open('worker.js', 'w').write(src.replace('/*__CARE_JS__*/', care).replace('__DASHBOARD_HTML__', html))
print('wrote worker.js')
