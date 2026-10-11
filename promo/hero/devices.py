# promo/hero/raw/*.png (from devices.cjs) → landing/hero/lx-*.webp for the landing page's laptop and phone
import glob, os
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__)); RAW = os.path.join(HERE, 'raw'); OUT = os.path.join(HERE, '../../landing/hero')
def save(src, dst, q, crop=None, size=None):
    im = Image.open(os.path.join(RAW, src)).convert('RGB')
    if crop: im = im.crop(crop)
    if size: im = im.resize(size, Image.LANCZOS)
    im.save(os.path.join(OUT, dst), 'WEBP', quality=q, method=6)
save('shelf.png', 'lx-labs.webp', 74, crop=(0, 0, 1600, 1560))  # (to where its cards end)
for f in sorted(glob.glob(os.path.join(RAW, 'body-*.png'))):
    n = os.path.basename(f)[:-4]
    save(n + '.png', 'lx-' + n + '.webp', 68)
    save(n + '.png', 'lx-' + n + '-s.webp', 70, size=(800, 500))  # (for phones)
for f in sorted(glob.glob(os.path.join(RAW, 'space-*.png'))):
    n = os.path.basename(f)[:-4]; save(n + '.png', 'lx-' + n + '.webp', 74)
for n in ['phone-labs', 'phone-body', 'phone-earth']: save(n + '.png', 'lx-' + n + '.webp', 72)
