"""Cassie's drawing book: the human eye in 3D, cut open (python3 eye.py with the bpy module). The white sclera, the dark
choroid and the orange retina cut away in a wedge so the inside shows, the retina's blood vessels branching from the
optic disc, the clear cornea, the coloured iris round the pupil, the clear lens, the optic nerve to the brain, and four
of the muscles that turn the eye. Its front faces Cassie's +x. Writes web/models/eye.glb."""
import math, os, sys, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *

reset(); random.seed(3)
SCLERA = material("sclera", srgb("#f2ece2"), 0.0, 0.45, coat=0.4)
SCLERA_IN = material("sclera inside", srgb("#e8dccb"), 0.0, 0.6)
RIM = material("cut wall", srgb("#e9c9b8"), 0.0, 0.6)
CHOROID = material("choroid", srgb("#5a2c22"), 0.0, 0.6)
RETINA = material("retina", srgb("#d9822f"), 0.0, 0.5, coat=0.3)
VESSEL = material("retinal vessel", srgb("#9c1a1a"), 0.0, 0.4, coat=0.3)
CORNEA = material("cornea", (0.9, 0.95, 1.0), 0.0, 0.02, coat=1.0, coat_rough=0.02, transmission=0.95, ior=1.376)
LENS = material("lens", (0.96, 0.95, 0.88), 0.0, 0.03, coat=1.0, coat_rough=0.02, transmission=0.92, ior=1.41)
NERVE = material("optic nerve", srgb("#e8d39a"), 0.0, 0.5, coat=0.2)
MUSCLE = material("eye muscle", srgb("#b0473b"), 0.0, 0.55, coat=0.15)
IRIS = vertex_material("iris", 0.4, coat=0.6)
DISC = material("optic disc", srgb("#f3d58a"), 0.0, 0.5)

R = 1.2
CUT = (1.75, 3.35)  # the wedge taken away, about the eye's axis: the top front quarter, as in the books
sc = part("sclera"); shell("sclera", R, R - 0.06, SCLERA, sc, axis=(1, 0, 0), th=(0.38, math.pi), cut=CUT, inner_mat=SCLERA_IN, rim_mat=RIM)
ch = part("choroid"); shell("choroid", R - 0.065, R - 0.095, CHOROID, ch, axis=(1, 0, 0), th=(0.45, math.pi), cut=CUT)
rt = part("retina"); shell("retina", R - 0.1, R - 0.12, RETINA, rt, axis=(1, 0, 0), th=(0.5, math.pi), cut=CUT)
# the optic disc and the retinal vessels branching out from it over the inside of the retina
DISC_T = math.pi - 0.28  # (just off the back, toward the nose)
def on_retina(t, p, r=R - 0.125):
    return (r * math.cos(t), r * math.sin(t) * math.cos(p), r * math.sin(t) * math.sin(p))
ball("optic disc", T(*on_retina(DISC_T, 0.0, R - 0.13)), 0.07, DISC, rt, seg=16)
def vessel(t, p, dt, dp, steps, rad, depth):
    pts = []
    for i in range(steps):
        pts.append(on_retina(t, p)); t += dt + random.uniform(-0.01, 0.01); p += dp + random.uniform(-0.03, 0.03)
        if t < 0.55: break
    if len(pts) > 2:
        sweep(f"vessel {t:.2f} {p:.2f} {depth}", pts, rad, VESSEL, rt, seg=8, per=3)
        if depth > 0:
            m = pts[len(pts) // 2]
            vessel(t - dt * steps / 2, p - dp * steps / 2, dt * 0.9, dp + random.choice((-0.12, 0.12)), steps // 2, rad * 0.7, depth - 1)
for p0 in (0.4, 1.4, 2.6, 3.6, 4.6, 5.6):
    vessel(DISC_T, p0, -0.11, 0.05, 14, 0.012, 2)
# the cornea: a clear dome in front; the iris round the pupil behind it; the lens behind the iris
co = part("cornea"); shell("cornea", 0.62, 0.59, CORNEA, co, centre=(0.66, 0, 0), axis=(1, 0, 0), th=(0.0, 0.95), seg=48, rings=16)
ir = part("iris")
v, f = [], []
for i in range(9):
    rr = 0.16 + (0.5 - 0.16) * i / 8
    for j in range(64):
        a = 2 * math.pi * j / 64; v.append(T(0.98 - 0.02 * (i / 8), rr * math.cos(a), rr * math.sin(a)))
for i in range(8):
    for j in range(64):
        a0, a1 = i * 64 + j, i * 64 + (j + 1) % 64
        f += [(a0, a1, a1 + 64, a0 + 64), (a0, a0 + 64, a1 + 64, a1)]
iris = mesh_obj("iris", v, f, IRIS, ir)
def iris_colour(P):
    rr = math.sqrt(P[1] ** 2 + P[2] ** 2); a = math.atan2(P[2], P[1])
    streak = 0.5 + 0.5 * math.sin(a * 40 + rr * 30)
    if rr < 0.24: return tuple(c * (0.7 + 0.3 * streak) for c in srgb("#9a6a2a"))  # the warm ring by the pupil
    base = srgb("#3f7aa8"); dark = srgb("#24405e")
    return tuple(base[k] * (0.75 + 0.35 * streak) * (1 - 0.4 * max(0.0, (rr - 0.44) / 0.06)) + dark[k] * 0.1 for k in range(3))
colour_by(iris, iris_colour)
ln = part("lens")
lathe("lens", [(0, 0.004), (0.04, 0.2, 1), (0.13, 0.36, 1), (0.22, 0.32, 1), (0.28, 0.16, 1), (0.31, 0.004)], T(0.9, 0, 0), (-1, 0, 0), LENS, ln, seg=48)
# the optic nerve to the brain, and four eye muscles along the outside
on = part("opticnerve")
sweep("optic nerve", [on_retina(math.pi - 0.28, 0.0, R - 0.02), (-1.55, -0.12, 0.0), (-2.45, -0.18, 0.0)], 0.2, NERVE, on, seg=28)
mu = part("muscles")
for p in (math.pi / 2, math.pi, 3 * math.pi / 2, 0.0):
    if CUT[0] <= p <= CUT[1]: continue  # (none over the cut-away part)
    pts = [tuple(c * 1.06 for c in on_retina(t, p, R)) for t in (0.75, 1.3, 1.9, 2.4)] + [(-2.1, 0.45 * math.cos(p), 0.45 * math.sin(p))]
    sweep(f"muscle {p:.2f}", pts, lambda u: 0.1 + 0.05 * math.sin(math.pi * u), MUSCLE, mu, seg=16)

export(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "web", "models", "eye.glb"))
print("wrote eye.glb")
