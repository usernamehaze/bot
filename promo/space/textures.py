"""Makes the planet pictures for the 3D solar system (labs/tex/*.webp).

   python3 promo/space/textures.py <folder with the downloaded maps>

Real maps (public domain): NASA 3D Resources (github.com/nasa/NASA-3D-Resources) for Mars,
Jupiter, Saturn, Neptune, Pluto and the Hipparcos star map; the Earth (day, night lights,
clouds, oceans) and Moon maps that ship with three.js (examples/textures/planets).
Made here, because there's no free map to use: Mercury (craters, with a bump map so they
catch the light), Venus as you'd see it (cloud tops, not the radar map of the ground),
Uranus, the Sun's surface is drawn live in the app, and Saturn's rings from their measured
layout (C ring, B ring, Cassini Division, A ring, Encke Gap).
"""
import os, sys
import numpy as np
from PIL import Image, ImageFilter

SRC = sys.argv[1] if len(sys.argv) > 1 else '.'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'labs', 'tex')
os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(7)


def save(im, name, w=None, q=82):
    if w and im.width != w:
        im = im.resize((w, w // 2), Image.LANCZOS)
    im.save(os.path.join(OUT, name), quality=q, method=6)
    print(name, im.size, os.path.getsize(os.path.join(OUT, name)) // 1024, 'KB')


def src(name):
    return Image.open(os.path.join(SRC, name))


# ---------- real maps ----------
save(src('earth_atmos_2048.jpg').convert('RGB'), 'earth-day.webp', 2048)
save(src('earth_lights_2048.png').convert('RGB'), 'earth-night.webp', 1024)
save(src('earth_clouds_1024.png').convert('RGBA').getchannel('A'), 'earth-clouds.webp', 1024)  # the clouds are in the transparency
save(src('earth_specular_2048.jpg').convert('L'), 'earth-ocean.webp', 1024)
save(src('moon_1024.jpg').convert('RGB'), 'moon.webp', 1024)
save(src('Mars.jpg').convert('RGB'), 'mars.webp', 1440)
save(src('Jupiter.jpg').convert('RGB'), 'jupiter.webp')
save(src('Neptune.jpg').convert('RGB'), 'neptune.webp')
save(src('Pluto.jpg').convert('RGB'), 'pluto.webp')
# NASA's Saturn map is very saturated; real Saturn is a pale butterscotch
sat = np.asarray(src('Saturn.jpg').convert('RGB')).astype(float)
grey = sat.mean(2, keepdims=True)
sat = grey + (sat - grey) * 0.45
sat = sat * np.array([1.0, 0.93, 0.78]) * 0.92
save(Image.fromarray(np.clip(sat, 0, 255).astype(np.uint8)), 'saturn.webp')

# the night sky from the real star map: the 9,000 brightest stars, each kept as a point
# (direction, brightness, colour) so they stay sharp at any zoom
from PIL import ImageFilter as IF
hip = src('Hipparcos Star Map.jpg').convert('RGB')
A = np.asarray(hip).astype(float)
lum = A.mean(2)
peak = np.asarray(Image.fromarray(lum.astype(np.uint8)).filter(IF.MaxFilter(5))).astype(float)
ys, xs = np.where((lum >= peak) & (lum > 40))
order = np.argsort(-lum[ys, xs])[:9000]
ys, xs = ys[order], xs[order]
Hh, Ww = lum.shape
rec = np.zeros(len(xs), dtype=[('u', '<u2'), ('v', '<u2'), ('b', 'u1'), ('r', 'u1'), ('g', 'u1'), ('bl', 'u1')])
rec['u'] = ((xs + 0.5) / Ww * 65535).astype(np.uint16)
rec['v'] = ((1 - (ys + 0.5) / Hh) * 65535).astype(np.uint16)  # 0 at the bottom, like a texture
rec['b'] = np.clip(lum[ys, xs], 0, 255).astype(np.uint8)
for ch, k in (('r', 0), ('g', 1), ('bl', 2)):
    rec[ch] = np.clip(A[ys, xs, k] / np.maximum(lum[ys, xs], 1) * 200, 0, 255).astype(np.uint8)
rec.tofile(os.path.join(OUT, 'stars.bin'))
print('stars.bin', len(rec), 'stars', os.path.getsize(os.path.join(OUT, 'stars.bin')) // 1024, 'KB')

# ---------- made here ----------
W, H = 1024, 512
lon = (np.arange(W) + 0.5) / W * 2 * np.pi
lat = (0.5 - (np.arange(H) + 0.5) / H) * np.pi
LON, LAT = np.meshgrid(lon, lat)
P = np.stack([np.cos(LAT) * np.cos(LON), np.cos(LAT) * np.sin(LON), np.sin(LAT)], -1)  # points on the sphere


def fbm(scale, octaves=5, seed=0):
    """smooth noise on the sphere (no seam): a sum of random waves in 3D"""
    r = np.random.default_rng(seed)
    out = np.zeros((H, W))
    amp = 1.0
    for o in range(octaves):
        for _ in range(6):
            d = r.normal(size=3); d /= np.linalg.norm(d)
            out += amp * np.sin((P @ d) * scale * (2 ** o) + r.uniform(0, 6.28))
        amp *= 0.5
    return (out - out.min()) / (out.max() - out.min())


# Mercury: grey-brown rock, thousands of craters (some young and bright, with rays)
height = fbm(3, 5, 1) * 0.25
albedo = 0.42 + fbm(2, 4, 2) * 0.16
LATC = lat[:, None]
for k in range(7000):
    c = rng.normal(size=3); c /= np.linalg.norm(c)
    rad = min(0.009 + rng.pareto(1.7) * 0.007, 0.1)
    clat, clon = np.arcsin(c[2]), np.arctan2(c[1], c[0]) % (2 * np.pi)
    reach = rad * 6 if k % 11 == 0 else rad * 2.2
    rows = np.where(np.abs(lat - clat) < reach)[0]   # only the rows (and columns) it can touch
    if not len(rows):
        continue
    cosl = max(np.cos(clat) - reach, 0.05)
    half = min(np.pi, reach / cosl)
    dl = np.abs(((lon - clon + np.pi) % (2 * np.pi)) - np.pi)
    cols = np.where(dl < half)[0]
    sub = P[rows[:, None], cols[None, :]]
    d = np.arccos(np.clip(sub @ c, -1, 1)) / rad
    bowl = np.where(d < 1, (d ** 2 - 1) * 0.7, 0) + np.exp(-((d - 1) ** 2) / 0.03) * 0.3
    bowl[d > 2.2] = 0
    height[rows[:, None], cols[None, :]] += bowl * np.sqrt(rad) * 0.25
    if k % 11 == 0 and rad < 0.03:  # a young crater: bright, with bright rays around it
        albedo[rows[:, None], cols[None, :]] += np.exp(-d * 0.9) * 0.1
height = (height - height.min()) / (height.max() - height.min())
alb = np.clip(albedo + (height - 0.5) * 0.12, 0, 1)
merc = np.stack([alb * 205, alb * 195, alb * 182], -1)
save(Image.fromarray(merc.astype(np.uint8)), 'mercury.webp')
save(Image.fromarray((height * 255).astype(np.uint8)), 'mercury-bump.webp')

# Venus: thick pale-yellow clouds, faint streaks and the sideways "Y" pattern
sw = fbm(2.5, 4, 3)
streak = np.sin(LAT * 9 + sw * 5 + np.sin(LON * 1 + LAT * 3) * 1.2) * 0.5 + 0.5
v = 0.72 * fbm(4, 5, 4) + 0.28 * streak
ven = np.stack([222 + v * 30, 196 + v * 34, 138 + v * 40], -1)
save(Image.fromarray(np.clip(ven, 0, 255).astype(np.uint8)), 'venus.webp')

# Uranus: almost featureless pale cyan, faint bands, a slightly brighter pole
band = np.sin(LAT * 14 + fbm(2, 3, 5) * 2) * 0.5 + 0.5
u = 0.85 + band * 0.05 + np.clip(LAT, 0, None) * 0.06
ura = np.stack([168 * u, 222 * u, 228 * u], -1)
save(Image.fromarray(np.clip(ura, 0, 255).astype(np.uint8)), 'uranus.webp')

# Saturn's rings: one row from the inner edge (1.11 Saturn radii) to the outer (2.33)
R0, R1, N = 1.11, 2.33, 2048
r = R0 + (np.arange(N) + 0.5) / N * (R1 - R0)
col = np.zeros((N, 4))
grain = np.random.default_rng(9).random(N)
grain = np.convolve(grain, np.ones(5) / 5, 'same')


def zone(a, b, bright, alpha, tint=(1, 0.93, 0.8)):
    m = (r >= a) & (r < b)
    col[m, :3] = np.array(tint) * bright
    col[m, 3] = alpha


zone(1.11, 1.24, 0.35, 0.05)                      # D ring (very faint)
zone(1.24, 1.53, 0.55, 0.28, (0.85, 0.8, 0.72))   # C ring (thin, greyish)
zone(1.53, 1.95, 1.00, 0.92)                      # B ring (brightest, almost solid)
zone(1.95, 2.03, 0.35, 0.10)                      # Cassini Division
zone(2.03, 2.27, 0.85, 0.72)                      # A ring
zone(2.21, 2.218, 0.2, 0.02)                      # Encke Gap
zone(2.32, 2.33, 0.9, 0.45)                       # F ring
col[:, :3] *= (0.85 + grain[:, None] * 0.3)
col[:, 3] *= (0.8 + grain * 0.4)
ring = np.clip(col, 0, 1)
ring = np.repeat(ring[None], 4, 0)
Image.fromarray((ring * 255).astype(np.uint8), 'RGBA').save(os.path.join(OUT, 'saturn-ring.png'))
print('saturn-ring.png')
