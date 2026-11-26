"""Cassie's drawing book: the lungs in 3D (python3 lungs.py with the bpy module). The trachea with its cartilage rings,
the two main bronchi branching three more times into bronchioles that end in clusters of air sacs (alveoli), the right
lung (three lobes) and the left lung (two lobes, with the notch for the heart), see-through so the airways show, over
the dome of the diaphragm. Seen from the front: the body's right lung is on the viewer's left. Writes web/models/lungs.glb."""
import math, os, sys, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *

reset(); random.seed(7)
TRACH = material("trachea", srgb("#e0a090"), 0.0, 0.45, coat=0.3)
RING = material("cartilage ring", srgb("#f2d2c4"), 0.0, 0.4, coat=0.4)
BRONCH = material("bronchi", srgb("#8cc4e8"), 0.0, 0.35, coat=0.5)
ALV = material("alveoli", srgb("#f3a6a6"), 0.0, 0.5, coat=0.3)
LUNG = see_through(material("lung tissue", srgb("#e58a86"), 0.0, 0.5, coat=0.4), 0.42)
DIA = material("diaphragm", srgb("#b8443c"), 0.0, 0.55, coat=0.2)

# ---------- trachea with its C-shaped cartilage rings
tr = part("trachea")
sweep("trachea", [(0, 1.55, 0), (0, 2.4, 0.02), (0, 3.25, 0.05)], 0.22, TRACH, tr, seg=28, hollow=0.04)
for k in range(12):
    y = 1.65 + k * 0.13
    torus(f"ring {k}", T(0, y, 0.01 + 0.04 * (y - 1.55)), (0, 0, 1), 0.225, 0.03, RING, tr, seg=40, tseg=8)
# ---------- the bronchial tree: each branch splits in two, three times, and ends in a cluster of air sacs
br = part("bronchi"); al = part("alveoli")
def branch(p, d, length, r, depth, side):
    q = tuple(p[k] + d[k] * length for k in range(3))
    mid = tuple((p[k] + q[k]) / 2 + random.uniform(-0.04, 0.04) for k in range(3))
    sweep(f"bronchus {depth} {p[0]:.2f} {p[1]:.2f}", [p, mid, q], lambda u: r * (1 - 0.25 * u), BRONCH, br, seg=14, per=4)
    if depth == 0:
        for j in range(6):  # the air sacs: a small grape-like cluster
            o = tuple(q[k] + random.uniform(-0.06, 0.06) + d[k] * 0.06 for k in range(3))
            ball(f"alveolus {q[0]:.2f} {q[1]:.2f} {j}", T(*o), 0.045, ALV, al, seg=10)
        return
    for turn in (-1, 1):
        a = math.radians(32 * turn + random.uniform(-8, 8))
        nd = (d[0] * math.cos(a) - d[1] * math.sin(a), d[0] * math.sin(a) + d[1] * math.cos(a), d[2] + random.uniform(-0.35, 0.35))
        l = math.sqrt(sum(x * x for x in nd)); nd = tuple(x / l for x in nd)
        branch(q, nd, length * 0.78, r * 0.68, depth - 1, side)
for side in (1, -1):  # the main bronchi, to each lung (the right one shorter and steeper)
    d = (side * 0.62, -0.78, 0.0); l = math.sqrt(d[0] ** 2 + d[1] ** 2); d = (d[0] / l, d[1] / l, 0)
    branch((0, 1.55, 0), d, 0.78 if side < 0 else 0.9, 0.16, 3, side)
# ---------- the lungs, see-through: rounded at the top (apex), wide and hollowed at the base over the diaphragm
for side, pid in ((-1, "rightlung"), (1, "leftlung")):
    pt = part(pid)
    def bumps(u, v, side=side):
        x, y = math.sin(v) * math.cos(u), math.cos(v)
        k = 1.0 - 0.2 * max(0.0, -y) ** 3  # the base, hollowed over the diaphragm
        if side > 0: k -= 0.22 * math.exp(-(((x + 0.9) ** 2) + (y + 0.25) ** 2) / 0.08)  # the cardiac notch on the left lung
        return k
    ellipsoid(pid, (side * 1.08, 0.3, 0.0), (1.05, 1.72, 0.9), LUNG, pt, seg=56, rings=40, bumps=bumps)
# ---------- the diaphragm: a muscle dome under both lungs
dp = part("diaphragm")
shell("diaphragm", 2.4, 2.32, DIA, dp, centre=(0, -3.62, 0), axis=(0, 1, 0), th=(0.0, 0.78), seg=64, rings=16)

export(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "web", "models", "lungs.glb"))
print("wrote lungs.glb")
