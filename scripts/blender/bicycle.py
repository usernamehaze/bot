"""Cassie's drawing book: a bicycle, made in Blender (python3 bicycle.py with the bpy module).
Parts and places match the book's 'bicycle' entry (drawbook.js): frame, frontw, rearw, fork, bars, saddle, crank, ring,
chain, cog, brakes. Writes web/models/bicycle.glb. Everything that turns is an empty with "spin" = "z" (Cassie's z is the
axle), so it turns about its own middle."""
import math, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *

reset()
RED = material("frame paint", srgb("#b8282a"), 0.0, 0.28, coat=0.9, coat_rough=0.08)
CHROME = material("chrome", (0.875, 0.875, 0.875), 1.0, 0.06)
ALU = material("aluminum", (0.913, 0.921, 0.925), 1.0, 0.3)
STEEL = material("steel", (0.56, 0.57, 0.58), 1.0, 0.42)
DARKSTEEL = material("dark steel", (0.22, 0.23, 0.25), 1.0, 0.45)
RUBBER = material("tyre rubber", (0.021, 0.021, 0.021), 0.0, 0.82)
GRIP = material("grip rubber", (0.03, 0.03, 0.032), 0.0, 0.75)
LEATHER = material("saddle leather", srgb("#3b2a22"), 0.0, 0.55, coat=0.2)
PAD = material("brake pad", srgb("#d9962a"), 0.0, 0.6)
BLACK = material("black plastic", (0.025, 0.025, 0.028), 0.0, 0.45)
Z = (0, -1, 0)  # Cassie's z (the axles) in Blender

# ---------- frame: welded tubes, bottom bracket shell and head tube
fr = part("frame")
BB, SEAT, HEAD_T, HEAD_B, REAR = (0, -0.1, 0), (-0.4, 1.15, 0), (1.18, 1.18, 0), (1.28, 0.9, 0), (-1.7, 0, 0)
tube("top tube", [SEAT, (1.2, 1.12, 0)], 0.045, RED, fr)
tube("down tube", [(1.26, 0.92, 0), BB], 0.055, RED, fr)
tube("seat tube", [BB, (-0.4, 1.2, 0)], 0.045, RED, fr, joints=False)
for z in (0.06, -0.06):
    tube(f"chainstay {z}", [(-0.05, -0.1, z * 0.6), (-1.7, 0, z)], 0.028, RED, fr, joints=False)
    tube(f"seatstay {z}", [(-0.38, 1.08, z * 0.4), (-1.7, 0.02, z)], 0.024, RED, fr, joints=False)
lathe("head tube", [(0, 0.06), (0.34, 0.06)], T(1.31, 0.86, 0), norm(sub3(T(1.2, 1.2, 0), T(1.31, 0.86, 0))), RED, fr, seg=28)
lathe("bottom bracket", [(0, 0.06), (0.2, 0.06)], T(0, -0.1, 0.1), Z, RED, fr, seg=28)
for z in (0.065, -0.065):
    lathe(f"dropout {z}", [(0, 0.035), (0.012, 0.035)], T(-1.7, 0, z), Z, STEEL, fr, seg=20)

# ---------- wheels: treaded tyres on box rims, 32 laced spokes from the hub flanges, the hub; each turns about its axle
def wheel(pid, cx):
    p = part(pid)
    w = empty(pid + " turning", p, T(cx, 0, 0), spin="z")
    torus(pid + " tyre", (0, 0, 0), Z, 0.92, 0.068, RUBBER, w, seg=96, tseg=14, ribs=96, rib_depth=0.008)
    torus(pid + " rim", (0, 0, 0), Z, 0.86, 0.026, ALU, w, seg=96, tseg=10)
    lathe(pid + " hub", [(-0.06, 0.0), (-0.06, 0.04), (-0.045, 0.045), (-0.045, 0.02), (0.045, 0.02), (0.045, 0.045), (0.06, 0.04), (0.06, 0.0)], (0, 0, 0), Z, ALU, w, seg=28, cap0=False, cap1=False)
    for k in range(32):  # two-cross lacing: half from each flange, alternating
        side = 1 if k % 2 else -1
        t0 = 2 * math.pi * k / 32
        t1 = t0 + side * 2 * math.pi * 2 / 32 * 0.5
        a = (0.042 * math.cos(t0), side * 0.045, 0.042 * math.sin(t0))
        b = (0.835 * math.cos(t1), side * 0.006, 0.835 * math.sin(t1))
        d = sub3(b, a)
        lathe(f"{pid} spoke {k}", [(0, 0.0045), (length(d), 0.0045)], a, norm(d), STEEL, w, seg=6, cap0=False, cap1=False)
    lathe(pid + " axle", [(0, 0.012), (0.16, 0.012)], (0, 0.08, 0), (0, -1, 0), STEEL, w, seg=12)
wheel("frontw", 1.7)
wheel("rearw", -1.7)

# ---------- fork: chrome blades from the crown to the front axle, the steerer through the head tube
fk = part("fork")
lathe("crown", [(0, 0.075), (0.05, 0.075)], T(1.3, 0.86, 0), norm(sub3(T(1.2, 1.2, 0), T(1.3, 0.86, 0))), CHROME, fk, seg=24)
for z in (0.07, -0.07):
    tube(f"blade {z}", [(1.29, 0.86, z * 0.85), (1.42, 0.55, z), (1.6, 0.18, z), (1.7, 0, z)], 0.024, CHROME, fk)

# ---------- handlebars: stem, bar, rubber grips with end caps, brake levers
br = part("bars")
tube("stem", [(1.2, 1.2, 0), (1.14, 1.42, 0)], 0.026, ALU, br, joints=False)
lathe("bar", [(0, 0.022), (0.66, 0.022)], T(1.1, 1.44, 0.33), Z, ALU, br, seg=20)
for z in (0.26, -0.26):
    lathe(f"grip {z}", [(0, 0.03), (0.005, 0.034), (0.13, 0.034), (0.14, 0.03)], T(1.1, 1.44, z + (0.07 if z > 0 else -0.07)), (0, 1 if z > 0 else -1, 0), GRIP, br, seg=24)
    box(f"lever {z}", T(1.17, 1.43, z * 0.72), (0.16, 0.025, 0.02), BLACK, br, bevel=0.006)

# ---------- saddle: a shaped leather seat on two rails, on the seat post
sd = part("saddle")
tube("seat post", [(-0.4, 1.15, 0), (-0.47, 1.38, 0)], 0.026, ALU, sd, joints=False)
v, f = [], []
xs = [-0.66 + 0.04 * i for i in range(10)]  # from the wide back to the narrow nose
ring_n = 16
for x in xs:
    u = (x + 0.66) / 0.36
    hw = 0.12 * (1 - u) ** 0.6 + 0.025
    hh = 0.035 + 0.01 * (1 - u)
    for j in range(ring_n):
        t = 2 * math.pi * j / ring_n
        v.append(T(x, 1.46 + hh * math.sin(t) * (1.0 if math.sin(t) > 0 else 0.35), hw * math.cos(t)))
for i in range(len(xs) - 1):
    for j in range(ring_n):
        f.append((i * ring_n + j, i * ring_n + (j + 1) % ring_n, (i + 1) * ring_n + (j + 1) % ring_n, (i + 1) * ring_n + j))
f.append(tuple(range(ring_n))[::-1]); f.append(tuple(range((len(xs) - 1) * ring_n, len(xs) * ring_n)))
o = mesh_obj("seat", v, f, LEATHER, sd); shade_auto(o, 70)
for z in (0.03, -0.03):
    tube(f"rail {z}", [(-0.6, 1.43, z * 1.6), (-0.47, 1.4, z), (-0.32, 1.43, z * 0.6)], 0.006, STEEL, sd, joints=False)

# ---------- cranks and pedals: they turn about the bottom bracket
ck = part("crank")
cw = empty("crank turning", ck, T(0, -0.1, 0), spin="z")
lathe("spindle", [(0, 0.016), (0.4, 0.016)], (0, 0.2, 0), (0, -1, 0), STEEL, cw, seg=12)
for (z, sgn) in ((0.19, 1), (-0.19, -1)):
    d = (0.12 * sgn, 0, -0.35 * sgn)  # Blender: arm toward the pedal
    box(f"arm {z}", (d[0] / 2, -z, d[2] / 2), (0.05, 0.022, 0.4), ALU, cw, bevel=0.01)
    ped = (d[0], -(z + 0.07 * sgn), d[2])
    box(f"pedal {z}", ped, (0.18, 0.1, 0.035), BLACK, cw, bevel=0.008)
    box(f"pedal cage {z}", (ped[0], ped[1], ped[2] + 0.02), (0.19, 0.11, 0.006), DARKSTEEL, cw)

# ---------- chainring: a toothed ring on a spider; it turns with the cranks
rg = part("ring")
rw = empty("ring turning", rg, T(0, -0.1, 0.12), spin="z")
torus("chainring", (0, 0, 0), Z, 0.245, 0.012, ALU, rw, seg=96, tseg=8)
for k in range(44):
    t = 2 * math.pi * k / 44
    box(f"tooth {k}", (0.262 * math.cos(t), 0, 0.262 * math.sin(t)), (0.016, 0.01, 0.016), ALU, rw)
for k in range(5):
    t = 2 * math.pi * k / 5
    d = (0.24 * math.cos(t), 0, 0.24 * math.sin(t))
    lathe(f"spider {k}", [(0, 0.012), (0.24, 0.008)], (0, 0, 0), norm(d), ALU, rw, seg=8)

# ---------- rear gear (cog): small toothed sprocket at the rear hub
cg = part("cog")
gw = empty("cog turning", cg, T(-1.7, 0, 0.12), spin="z")
lathe("cog body", [(0, 0.11), (0.02, 0.11)], (0, 0.01, 0), (0, -1, 0), STEEL, gw, seg=40)
for k in range(18):
    t = 2 * math.pi * k / 18
    box(f"cog tooth {k}", (0.122 * math.cos(t), 0, 0.122 * math.sin(t)), (0.016, 0.018, 0.016), STEEL, gw)

# ---------- chain: real links along both runs
ch = part("chain")
def run(a, b, n):
    for k in range(n):
        u = (k + 0.5) / n
        p = tuple(a[i] + (b[i] - a[i]) * u for i in range(3))
        d = norm(sub3(T(*b), T(*a)))
        box(f"link {a[1]} {k}", T(*p), (0.035, 0.012, 0.016), DARKSTEEL if k % 2 else STEEL, ch)
run((0, 0.15, 0.12), (-1.7, 0.115, 0.12), 60)
run((0, -0.35, 0.12), (-1.7, -0.115, 0.12), 60)

# ---------- brakes: calipers astride the tyre tops, with their pads
bk = part("brakes")
for (x, y) in ((1.62, 0.9), (-1.5, 0.84)):
    box(f"caliper {x}", T(x, y + 0.03, 0), (0.05, 0.06, 0.2), CHROME, bk, bevel=0.01)
    for z in (0.08, -0.08):
        box(f"pad {x} {z}", T(x - 0.01, y - 0.02, z), (0.06, 0.03, 0.018), PAD, bk, bevel=0.004)

export(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "web", "models", "bicycle.glb"))
print("wrote bicycle.glb")
