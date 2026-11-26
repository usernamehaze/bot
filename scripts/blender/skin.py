"""Cassie's drawing book: the layers of the skin in 3D, pulled apart (python3 skin.py with the bpy module). The
epidermis with hairs, the dermis with a hair follicle, oil (sebaceous) glands, a coiled sweat gland and blood vessels
(arteries red, veins blue) on its sides, the fat layer (hypodermis) of round fat cells, and the muscle under it.
Writes web/models/skin.glb."""
import math, os, sys, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *

reset(); random.seed(5)
EPI = material("epidermis", srgb("#f1a77a"), 0.0, 0.55, coat=0.25)
DERM = material("dermis", srgb("#ef9a6c"), 0.0, 0.6, coat=0.15)
HAIR = material("hair", srgb("#6b3a1e"), 0.0, 0.4, coat=0.4)
OIL = material("oil gland", srgb("#f2c04a"), 0.0, 0.45, coat=0.4)
SWEAT = material("sweat gland", srgb("#e89a8a"), 0.0, 0.5, coat=0.3)
ART = material("artery", srgb("#e0552e"), 0.0, 0.4, coat=0.4)
VEIN = material("vein", srgb("#8c95a6"), 0.0, 0.4, coat=0.4)
FAT = material("fat", srgb("#f2bd3e"), 0.0, 0.45, coat=0.35)
MUS = material("muscle", srgb("#e07a55"), 0.0, 0.6, coat=0.1)
S = 1.4  # half the width of the block

def slab(name, y0, y1, top, bottom, mat, parent, n=64):
    """(v321) a layer of the block whose top and bottom are not flat: top(x, z) and bottom(x, z) lift them, so the
    epidermis and dermis meet in the waves of the dermal papillae, as they do in real skin. Edges softly rounded."""
    xs = [-S + 2 * S * i / n for i in range(n + 1)]
    v, f = [], []
    for y, fn in ((y1, top), (y0, bottom)):
        for i in range(n + 1):
            for j in range(n + 1): v.append(T(xs[i], y + fn(xs[i], xs[j]), xs[j]))
    N = (n + 1) ** 2; at = lambda L, i, j: L * N + i * (n + 1) + j
    for i in range(n):
        for j in range(n):
            f.append((at(0, i, j), at(0, i, j + 1), at(0, i + 1, j + 1), at(0, i + 1, j)))
            f.append((at(1, i, j), at(1, i + 1, j), at(1, i + 1, j + 1), at(1, i, j + 1)))
    ring = [(i, 0) for i in range(n)] + [(n, j) for j in range(n)] + [(i, n) for i in range(n, 0, -1)] + [(0, j) for j in range(n, 0, -1)]
    for k in range(len(ring)):
        (i0, j0), (i1, j1) = ring[k], ring[(k + 1) % len(ring)]
        f.append((at(0, i0, j0), at(0, i1, j1), at(1, i1, j1), at(1, i0, j0)))
    ob = mesh_obj(name, v, f, mat, parent)
    weld(ob, 1e-6)
    m = ob.modifiers.new("bevel", "BEVEL"); m.width = 0.04; m.segments = 3; m.limit_method = "ANGLE"; m.angle_limit = math.radians(50)
    apply_mods(ob)
    for p in ob.data.polygons: p.use_smooth = True
    return ob
papillae = lambda x, z: 0.07 * (0.5 + 0.5 * math.sin(x * 6.2 + 0.7) * math.sin(z * 6.2 + 0.3))
wrinkles = lambda x, z: 0.005 * math.sin(x * 23 + z * 8) + 0.004 * math.sin(z * 31 - x * 5)
# ---------- epidermis on top, with hairs coming through it
ep = part("epidermis"); slab("epidermis", 2.23, 2.47, wrinkles, lambda x, z: papillae(x, z) - 0.02, EPI, ep)
hr = part("hair")
spots = [(-0.9, -0.6), (-0.3, 0.7), (0.5, -0.2), (0.95, 0.85), (-1.0, 0.9), (0.2, -1.0), (1.05, -0.9), (-0.45, -0.1)]
for (x, z) in spots:
    lean = random.uniform(-0.25, 0.25)
    sweep(f"hair {x} {z}", [(x, 2.3, z), (x + lean * 0.4, 2.75, z), (x + lean, 3.2 + random.uniform(-0.15, 0.2), z + 0.1)], lambda u: 0.028 * (1 - 0.85 * u), HAIR, hr, seg=8, per=5)
# ---------- dermis: the thick middle layer
de = part("dermis"); slab("dermis", 0.15, 1.75, papillae, lambda x, z: 0.0, DERM, de)
# its hair follicle (a hair growing from a bulb deep in the dermis, through to the top), oil glands beside it
sweep("follicle hair", [(0.15, 0.3, 0.4), (0.3, 1.0, 0.35), (0.5, 2.25, 0.3)], lambda u: 0.06 - 0.03 * u, HAIR, hr, seg=12, per=6)
ball("hair bulb", T(0.14, 0.28, 0.4), 0.11, HAIR, hr)
gl = part("glands")
for (dx, dy) in ((-0.2, 1.05), (0.42, 1.2)):
    for j in range(3):
        ball(f"oil gland {dx} {j}", T(0.25 + dx + random.uniform(-0.05, 0.05), dy + j * 0.08, 0.6 + random.uniform(-0.05, 0.05)), 0.1, OIL, gl)
# a coiled sweat gland deep down, its duct rising to the surface
coil = [(-0.8 + 0.18 * math.cos(t), 0.35 + 0.03 * t, 0.5 + 0.18 * math.sin(t)) for t in [k * 0.5 for k in range(16)]]
sweep("sweat gland", coil + [(-0.8, 1.2, 0.5), (-0.78, 1.75, 0.5)], 0.035, SWEAT, gl, seg=10, per=4)
# blood vessels running over the front and side faces: arteries and veins, branching up toward the surface
vs = part("vessels")
for (name, mat, y0) in (("artery", ART, 0.35), ("vein", VEIN, 0.45)):
    pts = [(-S, y0 + 0.08 * math.sin(k), S + 0.02) for k in range(0)]
    sweep(f"{name} front", [(-S, y0, S + 0.02), (-0.4, y0 + 0.12, S + 0.02), (0.4, y0 - 0.06, S + 0.02), (S, y0 + 0.05, S + 0.02)], 0.035, mat, vs, seg=10)
    sweep(f"{name} side", [(S + 0.02, y0 + 0.05, S), (S + 0.02, y0 + 0.12, 0.3), (S + 0.02, y0 - 0.05, -0.5), (S + 0.02, y0, -S)], 0.035, mat, vs, seg=10)
    for k in range(5):  # small branches climbing toward the epidermis
        x = -1.1 + k * 0.55 + random.uniform(-0.1, 0.1)
        sweep(f"{name} branch {k}", [(x, y0 + 0.05, S + 0.02), (x + random.uniform(-0.15, 0.15), y0 + 0.6, S + 0.02), (x + random.uniform(-0.25, 0.25), y0 + 1.25, S + 0.02)], lambda u: 0.022 * (1 - 0.6 * u), mat, vs, seg=8)
        z = -1.1 + k * 0.55 + random.uniform(-0.1, 0.1)
        sweep(f"{name} side branch {k}", [(S + 0.02, y0 + 0.05, z), (S + 0.02, y0 + 0.6, z + random.uniform(-0.15, 0.15)), (S + 0.02, y0 + 1.25, z + random.uniform(-0.25, 0.25))], lambda u: 0.022 * (1 - 0.6 * u), mat, vs, seg=8)
# ---------- the fat layer: round fat cells packed together
ft = part("fat")
for i in range(150):
    x, z = random.uniform(-S + 0.12, S - 0.12), random.uniform(-S + 0.12, S - 0.12)
    ball(f"fat cell {i}", T(x, random.uniform(-0.65, -0.2), z), random.uniform(0.16, 0.24), FAT, ft, seg=14)
# ---------- the muscle under it all, with its vessels
mu = part("muscle"); box("muscle", T(0, -1.25, 0), (2 * S, 2 * S, 0.3), MUS, mu, bevel=0.04)
for k in range(4):
    z = -1.0 + k * 0.65
    sweep(f"muscle vessel {k}", [(-S + 0.1, -1.08, z), (0, -1.08, z + 0.25), (S - 0.1, -1.08, z - 0.1)], 0.03, ART, mu, seg=8)

tissue(lambda ob: None if "hair" in ob.name else "muscular" if ob.name == "muscle" else "cardiovascular" if ("artery" in ob.name or "vein" in ob.name) else "visceral", 0.004)
export(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "web", "models", "skin.glb"))
print("wrote skin.glb")
