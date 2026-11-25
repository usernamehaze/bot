"""Cassie's drawing book: an airliner, made in Blender (run: python3 airplane.py with the bpy module, or blender -b -P).
Parts and sizes match the book's 'airplane' entry (drawbook.js): fuselage, cockpit, wings, engines, tailplane, fin, gear.
Writes web/models/airplane.glb."""
import math, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *

reset()
# materials (Blender skills pack, realistic-style PBR values)
PAINT = material("white paint", srgb("#eef1f5"), 0.0, 0.32, coat=0.8, coat_rough=0.12)
GREY = material("wing grey", srgb("#c3cad3"), 0.0, 0.4, coat=0.4)
ALU = material("polished aluminum", (0.913, 0.921, 0.925), 1.0, 0.18)
TITAN = material("fan titanium", (0.42, 0.44, 0.47), 1.0, 0.3)
RED = material("tail red", srgb("#d1383a"), 0.0, 0.3, coat=0.8, coat_rough=0.1)
GLASS = material("cockpit glass", (0.02, 0.03, 0.045), 0.0, 0.04, coat=1.0, coat_rough=0.02)
WINDOW = material("cabin window", (0.015, 0.02, 0.03), 0.0, 0.08)
RUBBER = material("tyre rubber", (0.021, 0.021, 0.021), 0.0, 0.8)
CHROME = material("strut chrome", (0.875, 0.875, 0.875), 1.0, 0.06)
DARK = material("intake dark", (0.03, 0.03, 0.035), 0.3, 0.6)

# ---------- fuselage: a smooth body, its tail cone sweeping up; a row of cabin windows each side
fus = part("fuselage")
def fr(x):  # radius along the body (Cassie's x)
    if x > 2.3: return 0.4 * math.sqrt(max(0.0, 1 - ((x - 2.3) / 0.76) ** 2)) + 0.005
    if x < -1.6: return 0.4 - 0.33 * ((-1.6 - x) / 1.45) ** 1.3
    return 0.4
xs = [3.06 - 0.76 * (1 - math.cos(math.pi / 2 * k / 14)) for k in range(15)][::-1]  # fine at the nose
body = sorted(set([round(x, 4) for x in xs] + [round(2.3 - 3.9 * k / 30, 4) for k in range(31)] + [round(-1.6 - 1.45 * k / 14, 4) for k in range(15)]))
prof = [(x + 3.05, fr(x)) for x in body]
lift = lambda s: (0, 0, 0.22 * max(0.0, (-1.6 - (s - 3.05)) / 1.45) ** 1.6)  # (the tail cone rises toward the fin)
lathe("fuselage body", prof, (-3.05, 0, 0), (1, 0, 0), PAINT, fus, seg=56, center_fn=lift)
for side in (1, -1):  # cabin windows: small dark ovals on the surface, 22 a side
    for k in range(22):
        x = -1.45 + k * 0.165
        y = side * 0.398
        v = []; f = []
        for j in range(12):
            t = 2 * math.pi * j / 12
            v.append((x + 0.03 * math.cos(t), y + side * 0.004, 0.13 + 0.042 * math.sin(t)))
        v.append((x, y + side * 0.006, 0.13))
        f = [(12, j, (j + 1) % 12) if side > 0 else (12, (j + 1) % 12, j) for j in range(12)]
        mesh_obj(f"window {side} {k}", v, f, WINDOW, fus, smooth=False)

# ---------- cockpit: the tinted windscreen, wrapped round the nose
ck = part("cockpit")
v, f = [], []
xs = [2.45 + 0.07 * i for i in range(5)]; ang = [math.radians(a) for a in range(-55, 56, 10)]
for x in xs:
    r = fr(x) + 0.006
    for a in ang:
        v.append((x, r * math.sin(a), 0.06 + r * math.cos(a) * 0.62 + 0.11))
na = len(ang)
for i in range(len(xs) - 1):
    for j in range(na - 1):
        f.append((i * na + j, i * na + j + 1, (i + 1) * na + j + 1, (i + 1) * na + j))
o = mesh_obj("windscreen", v, f, GLASS, ck); shade_auto(o, 60)

# ---------- wings: real airfoils, swept, with dihedral and winglets (Cassie's wing: root chord 1.1 at z 0.3, tip 0.4 at z 3.2, y -0.12)
wg = part("wings")
for side in (1, -1):
    st = []
    for k in range(9):
        u = k / 8
        le = 0.75 + (-0.75 - 0.75) * u
        ch = 1.1 + (0.4 - 1.1) * u
        span = 0.3 + (3.2 - 0.3) * u
        st.append((le, -side * span, -0.16 + 0.25 * u, ch, 0.13 - 0.03 * u))
    surface(f"wing {side}", st, GREY, wg)
    # winglet: a small canted fin at the tip
    tip = st[-1]
    surface(f"winglet {side}", [(tip[0] - 0.02, 0.0, tip[2] + 0.01, 0.36, 0.09), (tip[0] - 0.16, 0.0, tip[2] + 0.3, 0.16, 0.08)], GREY, wg, vertical=True, side_y=tip[1])

# ---------- engines: nacelles under the wings, polished lips, fan blades that spin, cones, pylons
en = part("engines")
for z in (1.25, -1.25):
    cx = 0.25
    o = (cx + 0.47, -z, -0.42)  # front of the nacelle (Blender coords)
    lathe(f"nacelle {z}", [(0, 0.17), (0.03, 0.2), (0.12, 0.215), (0.5, 0.205), (0.8, 0.165), (0.9, 0.14)], o, (-1, 0, 0), PAINT, en, seg=48, cap0=False, cap1=False)
    lathe(f"lip {z}", [(-0.005, 0.16), (0.0, 0.172), (0.035, 0.2), (0.06, 0.205)], o, (-1, 0, 0), ALU, en, seg=48, cap0=False, cap1=False)
    lathe(f"intake {z}", [(0.0, 0.165), (0.09, 0.17)], o, (-1, 0, 0), DARK, en, seg=40, cap0=False, cap1=False)
    lathe(f"exhaust {z}", [(0.0, 0.135), (0.2, 0.06), (0.25, 0.005)], (o[0] - 0.88, o[1], o[2]), (-1, 0, 0), TITAN, en, seg=32, cap1=False)
    # the fan: 20 twisted blades round a polished spinner, turning about Cassie's x
    fan = bpy.data.objects.new(f"fan {z}", None); bpy.context.collection.objects.link(fan); fan.parent = en; fan["spin"] = "x"
    fan.location = (o[0] - 0.1, o[1], o[2])
    lathe(f"spinner {z}", [(0, 0.005), (0.03, 0.04), (0.07, 0.06), (0.1, 0.062)], (0.03, 0, 0), (-1, 0, 0), ALU, fan, seg=32, cap0=False)
    for b in range(20):
        t = 2 * math.pi * b / 20
        bl = []
        for (rr, tw) in ((0.06, 0.6), (0.162, 0.25)):
            for (w, d) in ((-0.022, -0.01), (0.022, 0.01)):
                ca, sa = math.cos(t), math.sin(t)
                yy, zz = rr * ca, rr * sa
                ty, tz = -sa, ca  # tangent
                bl.append((d * math.cos(tw) - w * math.sin(tw), yy + ty * (w * math.cos(tw)), zz + tz * (w * math.cos(tw))))
        mesh_obj(f"blade {z} {b}", bl, [(0, 1, 3, 2)], TITAN, fan, smooth=False)
    # pylon: a slim fairing from the nacelle top up to the wing
    box(f"pylon {z}", (cx + 0.12, -z, -0.24), (0.55, 0.05, 0.2), PAINT, en, bevel=0.02)

# ---------- tailplane and fin (on the raised tail)
tp = part("tailplane")
for side in (1, -1):
    st = []
    for k in range(5):
        u = k / 4
        st.append((-2.25 + (-2.8 + 2.25) * u, -side * (0.12 + (1.15 - 0.12) * u), 0.2 + 0.06 * u, 0.5 + (0.25 - 0.5) * u, 0.1))
    surface(f"tailplane {side}", st, GREY, tp)
fn = part("fin")
st = []
for k in range(6):
    u = k / 5
    st.append((-2.1 + (-2.75 + 2.1) * u, 0, 0.3 + (1.35 - 0.3) * u, 0.75 + (0.35 - 0.75) * u, 0.11))
surface("fin", st, RED, fn, vertical=True)

# ---------- landing gear: chrome struts, rubber tyres on aluminium hubs (they turn about Cassie's z)
gr = part("gear")
def wheel(name, cx, cy, cz):  # Blender coords of the hub centre; axle along Blender y (Cassie's z)
    w = bpy.data.objects.new(name, None); bpy.context.collection.objects.link(w); w.parent = gr; w["spin"] = "z"; w.location = (cx, cy, cz)
    tyre = [(-0.035, 0.07), (-0.04, 0.09), (-0.025, 0.105), (0.025, 0.105), (0.04, 0.09), (0.035, 0.07)]
    lathe(name + " tyre", tyre, (0, 0, 0), (0, 1, 0), RUBBER, w, seg=40, cap0=False, cap1=False)
    lathe(name + " hub", [(-0.036, 0.0), (-0.036, 0.07), (0.036, 0.07), (0.036, 0.0)], (0, 0, 0), (0, 1, 0), ALU, w, seg=32, cap0=False, cap1=False)
for (x, z) in ((2.2, 0.0), (-0.15, 0.55), (-0.15, -0.55)):
    lathe(f"strut {x} {z}", [(0, 0.022), (0.36, 0.022)], (x, -z, -0.35), (0, 0, -1), CHROME, gr, seg=16)
    for dz in ((-0.06, 0.06) if x > 0 else (-0.07, 0.07)):
        wheel(f"wheel {x} {z} {dz}", x, -(z + dz), -0.74)

export(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "web", "models", "airplane.glb"))
print("wrote airplane.glb")
