"""Cassie's drawing book: the human heart in 3D, cut open from the front (as anatomy books show it). Made in Blender
(python3 heart.py with the bpy module). Seen from the front, the body's right side is on the viewer's left: the right
atrium and ventricle (blue: blood low in oxygen) on the left, the left atrium and ventricle (red: rich in oxygen) on the
right, the thick left ventricle wall and the septum between, the tricuspid and mitral valves with their chordae and
papillary muscles; the aorta arching over with its three branches, the pulmonary trunk and arteries, the venae cavae and
the pulmonary veins, all open tubes. Writes web/models/heart.glb."""
import math, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *

reset()
OUTER = material("heart outside", srgb("#c4423c"), 0.0, 0.42, coat=0.45, coat_rough=0.3)
CUT = material("heart wall cut", srgb("#ee9e8e"), 0.0, 0.62, coat=0.2)
RIGHT = material("right side lining", srgb("#2f58c0"), 0.0, 0.45, coat=0.35)
LEFT = material("left side lining", srgb("#b52235"), 0.0, 0.45, coat=0.35)
AORTA = material("aorta", srgb("#d8262b"), 0.0, 0.32, coat=0.5, coat_rough=0.2)
AORTA_IN = material("aorta inside", srgb("#8f1418"), 0.0, 0.6)
PULM = material("pulmonary artery", srgb("#8a58c4"), 0.0, 0.32, coat=0.5, coat_rough=0.2)
PULM_IN = material("pulmonary inside", srgb("#4a2c78"), 0.0, 0.6)
CAVA = material("vena cava", srgb("#2f86d6"), 0.0, 0.32, coat=0.5, coat_rough=0.2)
CAVA_IN = material("vena cava inside", srgb("#1a4a80"), 0.0, 0.6)
VALVE = material("valve", srgb("#f3c7c2"), 0.0, 0.5, coat=0.3)
CHORD = material("chordae", srgb("#f6efe6"), 0.0, 0.4)
PAPIL = material("papillary muscle", srgb("#c9606a"), 0.0, 0.5)

# ---------- the heart's body: one closed surface, a sphere bent into the heart's shape (atria bulging up at each side,
# the ventricles tapering to the apex, down and to the viewer's right)
def gauss(d, c, w):
    dot = sum(d[k] * c[k] for k in range(3)); return math.exp(-(1 - dot) / w)
RA_D, LA_D, APEX_D, BASE_D = norm((-0.75, 0.55, 0.15)), norm((0.75, 0.65, -0.2)), norm((0.45, -0.9, 0.0)), norm((0.0, 1.0, -0.2))
verts, faces = [], []
SEG, RINGS = 72, 54
for i in range(RINGS + 1):
    v = math.pi * i / RINGS
    for j in range(SEG):
        u = 2 * math.pi * j / SEG
        d = (math.sin(v) * math.cos(u), math.cos(v), math.sin(v) * math.sin(u))  # Cassie axes
        r = 1.0 + 0.42 * gauss(d, RA_D, 0.14) + 0.34 * gauss(d, LA_D, 0.13) + 0.7 * gauss(d, APEX_D, 0.18) - 0.1 * gauss(d, BASE_D, 0.1)
        x, y, z = d[0] * r * 1.45, d[1] * r * 1.35, d[2] * r * 0.92
        verts.append(T(x - 0.1, y + 0.05, z))
for i in range(RINGS):
    for j in range(SEG):
        a0, a1 = i * SEG + j, i * SEG + (j + 1) % SEG
        faces.append((a0, a0 + SEG, a1 + SEG, a1))
# weld the poles (a closed surface for the cuts)
me = bpy.data.meshes.new("heart"); me.from_pydata(verts, [], faces); me.update()
import bmesh as _bm
bm = _bm.new(); bm.from_mesh(me); _bm.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5); _bm.ops.recalc_face_normals(bm, faces=bm.faces); bm.to_mesh(me); bm.free()
body = bpy.data.objects.new("heart", me); bpy.context.collection.objects.link(body); me.materials.append(OUTER)
for p in me.polygons: p.use_smooth = True
xs = [v.co for v in me.vertices]
print('heart body', len(xs), 'x', round(min(v.x for v in xs), 2), round(max(v.x for v in xs), 2), 'up', round(min(v.z for v in xs), 2), round(max(v.z for v in xs), 2), 'depth', round(min(v.y for v in xs), 2), round(max(v.y for v in xs), 2))

# ---------- the chambers, hollowed out (each lined in its own colour), the valve openings between them
CAVITIES = []  # (centre, radii, rot, side): to colour each chamber's lining once it is cut
def cutter(name, c, r, mat, rot=0):
    CAVITIES.append((c, r, rot, 'R' if mat is RIGHT else 'L'))
    o = ellipsoid(name, c, r, mat, None, seg=48, rings=28, rot=rot)
    return o
def side_of(P):
    """Which chamber's lining a point (Blender coords) lies on: 'R', 'L' or None."""
    X, Y, Z = P[0], P[2], -P[1]  # back to Cassie axes
    for (c, r, rot, sd) in CAVITIES:
        a = math.radians(rot); dx, dy = X - c[0], Y - c[1]
        x, y = dx * math.cos(-a) - dy * math.sin(-a), dx * math.sin(-a) + dy * math.cos(-a)
        if (x / r[0]) ** 2 + (y / r[1]) ** 2 + ((Z - c[2]) / r[2]) ** 2 < 1.04 ** 2: return sd
    return None
cutters = [
    cutter("RA", (-1.0, 0.62, 0.0), (0.5, 0.5, 0.55), RIGHT),
    cutter("RV", (-0.42, -0.55, 0.0), (0.5, 1.0, 0.45), RIGHT, -22),
    cutter("LA", (0.85, 0.75, -0.05), (0.42, 0.38, 0.45), LEFT),
    cutter("LV", (0.5, -0.75, 0.0), (0.4, 1.12, 0.48), LEFT, -28),
    cutter("tricuspid opening", (-0.78, 0.15, 0.0), (0.26, 0.3, 0.3), RIGHT),
    cutter("mitral opening", (0.68, 0.32, 0.0), (0.22, 0.3, 0.3), LEFT),
]
# the front half taken away (sliced, and the slice filled with a flat face of cut heart wall, in pink)
import bmesh as _bm
me.materials.append(CUT)
bm = _bm.new(); bm.from_mesh(body.data)
geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
res = _bm.ops.bisect_plane(bm, geom=geom, dist=1e-6, plane_co=(0, 0, 0), plane_no=(0, 1, 0), clear_inner=True, clear_outer=False)
cut_edges = [e for e in res["geom_cut"] if isinstance(e, _bm.types.BMEdge)]
filled = _bm.ops.triangle_fill(bm, use_beauty=True, use_dissolve=False, edges=cut_edges)
for f in filled["geom"]:
    if isinstance(f, _bm.types.BMFace): f.material_index = 1; f.smooth = False
_bm.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
_bm.ops.recalc_face_normals(bm, faces=bm.faces)
print('open edges after the slice', sum(1 for e in bm.edges if len(e.link_faces) != 2), 'faces', len(bm.faces))
bm.to_mesh(body.data); bm.free(); body.data.update()
print('front cut: cap faces', sum(1 for p in body.data.polygons if p.material_index == 1), 'manifold', all(len(e.link_faces) == 2 for e in __import__('bmesh').from_edit_mesh if False) if False else '')
# each side's cavities first joined into one shape (atrium, valve opening, ventricle), then cut out once
RA_, RV_, LA_, LV_, TRI_, MIT_ = cutters
for (base, others) in ((RV_, (RA_, TRI_)), (LV_, (LA_, MIT_))):
    for o in others:
        boolean(base, o, op="UNION"); bpy.data.objects.remove(o)
    weld(base)
    lining = RIGHT if base is RV_ else LEFT  # (the joined shape keeps its side's lining colour)
    base.data.materials.clear(); base.data.materials.append(lining)
    for p in base.data.polygons: p.material_index = 0
    n0 = len(body.data.polygons); boolean(body, base); bpy.data.objects.remove(base)
    print('cut', len(body.data.polygons) - n0, 'faces; materials', [m.name for m in body.data.materials])

# colour the chambers' linings: blue on the right side of the heart, red on the left
mats_now = [m.name for m in body.data.materials]
for m in (RIGHT, LEFT):
    if m.name not in mats_now: body.data.materials.append(m)
idx = {m.name: i for i, m in enumerate(body.data.materials)}
for p in body.data.polygons:
    if body.data.materials[p.material_index].name == "heart wall cut": continue
    sd = side_of(p.center)
    if sd: p.material_index = idx["right side lining" if sd == 'R' else "left side lining"]
# split it into its named parts by colour: the wall (outside and cut), the right chambers, the left chambers
wall, rch, lch = part("wall"), part("rightside"), part("leftside")
mats = [m.name for m in body.data.materials]
names = {"heart outside": ("heart muscle outside", wall), "heart wall cut": ("heart muscle cut", wall), "right side lining": ("right chambers", rch), "left side lining": ("left chambers", lch)}
for o in split(body, [names[m][0] for m in mats], [names[m][1] for m in mats]):
    used = sorted(set(p.material_index for p in o.data.polygons)); print('part', o.name, len(o.data.polygons), [o.data.materials[i].name for i in used])

# ---------- valves: three flaps on the right (tricuspid), two on the left (mitral), tied by chordae to papillary muscles
vl = part("valves")
def flaps(cx, cy, n, r, down):
    for k in range(n):
        a = math.pi * (0.15 + 0.7 * k / max(1, n - 1))
        x0, z0 = cx + r * math.cos(a) * 0.9, -0.05 - r * math.sin(a) * 0.35
        top = [(x0 - 0.1, cy, z0), (x0 + 0.1, cy, z0)]
        tip = (x0 + (cx - x0) * 0.3, cy - down, z0 - 0.05)
        v = [T(*top[0]), T(*top[1]), T(tip[0] + 0.05, tip[1], tip[2]), T(tip[0] - 0.05, tip[1], tip[2])]
        o = mesh_obj(f"flap {cx} {k}", v, [(0, 1, 2, 3), (3, 2, 1, 0)], VALVE, vl, smooth=False)
        pap = (tip[0] + (0.08 if k % 2 else -0.08), tip[1] - down * 1.4, -0.3)
        for j in (-0.03, 0.03):  # two chordae from the flap's edge down to its papillary muscle
            sweep(f"chorda {cx} {k} {j}", [(tip[0] + j, tip[1], tip[2]), ((tip[0] + pap[0]) / 2 + j, (tip[1] + pap[1]) / 2, -0.18), (pap[0], pap[1] + 0.12, pap[2])], 0.008, CHORD, vl, seg=6, per=4)
        sweep(f"papillary {cx} {k}", [(pap[0], pap[1] + 0.14, pap[2]), (pap[0], pap[1] - 0.06, pap[2] - 0.05)], lambda u: 0.02 + 0.07 * u, PAPIL, vl, seg=12, per=3)
flaps(-0.78, 0.12, 3, 0.26, 0.42)
flaps(0.68, 0.3, 2, 0.22, 0.5)

# ---------- the great vessels: open tubes you can see into
ao = part("aorta")
sweep("aorta", [(0.18, 0.35, -0.28), (0.05, 1.35, -0.05), (0.2, 2.35, -0.12), (0.85, 2.72, -0.42), (1.38, 2.25, -0.72), (1.5, 0.6, -0.95), (1.45, -2.4, -0.95)], 0.36, AORTA, ao, seg=40, hollow=0.06, inner_mat=AORTA_IN)
for (x, h) in ((0.32, 0.0), (0.72, 0.12), (1.08, 0.0)):  # the three arteries to the head and arms
    sweep(f"arch branch {x}", [(x, 2.6, -0.3 - x * 0.25), (x + 0.02, 3.1 + h, -0.35 - x * 0.25), (x + 0.06, 3.45 + h, -0.38 - x * 0.25)], 0.12, AORTA, ao, seg=20, hollow=0.03, inner_mat=AORTA_IN)
pa = part("pulmonary")
sweep("pulmonary trunk", [(-0.15, 0.7, -0.1), (0.15, 1.35, 0.12), (0.55, 1.72, 0.12)], 0.33, PULM, pa, seg=36, hollow=0.05, inner_mat=PULM_IN)
sweep("left pulmonary artery", [(0.5, 1.72, 0.3), (1.3, 1.82, 0.15), (2.35, 1.9, 0.0)], 0.22, PULM, pa, seg=28, hollow=0.04, inner_mat=PULM_IN)
sweep("right pulmonary artery", [(0.5, 1.72, 0.25), (-0.3, 1.9, -0.55), (-1.6, 1.95, -0.6), (-2.4, 2.0, -0.55)], 0.2, PULM, pa, seg=28, hollow=0.04, inner_mat=PULM_IN)
vc = part("venacava")
sweep("superior vena cava", [(-1.3, 0.75, -0.45), (-1.38, 2.0, -0.5), (-1.4, 3.35, -0.5)], 0.3, CAVA, vc, seg=32, hollow=0.05, inner_mat=CAVA_IN)
sweep("inferior vena cava", [(-1.15, -0.2, -0.5), (-1.25, -1.5, -0.55), (-1.25, -2.9, -0.55)], 0.32, CAVA, vc, seg=32, hollow=0.05, inner_mat=CAVA_IN)
pv = part("pulmveins")
for (a, b) in (((1.35, 0.95, -0.3), (2.45, 1.05, -0.3)), ((1.35, 0.6, -0.35), (2.45, 0.55, -0.35)), ((-1.5, 0.35, -0.55), (-2.55, 0.4, -0.55)), ((-1.5, 0.0, -0.55), (-2.55, -0.05, -0.55))):
    sweep(f"pulmonary vein {a[0]} {a[1]}", [a, ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + 0.05, a[2]), b], 0.14, AORTA, pv, seg=24, hollow=0.03, inner_mat=AORTA_IN)

export(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "web", "models", "heart.glb"))
print("wrote heart.glb")
