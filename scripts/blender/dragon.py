"""Cassie's drawing book: a dragon, made in Blender (python3 dragon.py with the bpy module). An original model: a
standing dragon with an S-shaped neck, a horned head, raised bat wings (finger bones and a scalloped membrane), four
clawed legs, spines along the back and a long tail with a spade tip. Bodies are skeletons of points with a thickness at
each (Blender's Skin modifier) smoothed by subdivision, the usual way to block out a creature; the underside is
lighter (belly scales). Parts match the book's 'dragon' 3D entry. Writes web/models/dragon.glb."""
import math, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *

reset()

def vmat(name, roughness=0.55, coat=0.15, sheen=0.0):
    """A material whose colour comes from the mesh's own colours (belly lighter than the back)."""
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; b = nt.nodes.get("Principled BSDF")
    ca = nt.nodes.new("ShaderNodeVertexColor"); ca.layer_name = "Col"
    nt.links.new(ca.outputs["Color"], b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = roughness
    if coat: b.inputs["Coat Weight"].default_value = coat; b.inputs["Coat Roughness"].default_value = 0.35
    if sheen: b.inputs["Sheen Weight"].default_value = sheen
    return m

SCALES = vmat("dragon scales", 0.5, 0.2)
MEMBRANE = vmat("wing membrane", 0.62, 0.05, 0.3)
HORN = material("horn", srgb("#e6dcc4"), 0.0, 0.35, coat=0.3)
EYE = material("eye", srgb("#f0a020"), 0.0, 0.05, coat=1.0, coat_rough=0.02, emission=srgb("#7a3c00"))

BACK, BELLY = srgb("#3d6a3a"), srgb("#cdb47a")
SPINE_C, MEM_C, MEM_EDGE = srgb("#2a4528"), srgb("#5e2f28"), srgb("#3d1c18")

def bake(ob):
    """Apply the modifiers (skin, subdivision) so the colours can be painted on the final shape."""
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    ob.modifiers.clear(); old = ob.data; ob.data = me; bpy.data.meshes.remove(old)
    for p in me.polygons: p.use_smooth = True
    return ob

def paint(ob, top, bottom, mode="belly", edge=None):
    me = ob.data
    if "Col" not in me.color_attributes: me.color_attributes.new("Col", 'FLOAT_COLOR', 'POINT')
    col = me.color_attributes["Col"]
    zs = [v.co.z for v in me.vertices]; z0, z1 = min(zs), max(zs)
    for v in me.vertices:
        if mode == "belly":
            k = max(0.0, min(1.0, (-v.normal.z - 0.15) / 0.6))  # faces looking down: the belly
        else:
            k = 0.0
        c = [top[i] * (1 - k) + bottom[i] * k for i in range(3)]
        col.data[v.index].color = (*c, 1.0)

def skin(name, chains, parent, mat, colours=(BACK, BELLY), sub=2):
    """chains: lists of (Cassie point, radius); each chain's first point continues from an existing point if shared."""
    verts, edges, radii, index = [], [], [], {}
    for chain in chains:
        prev = None
        for (p, r) in chain:
            key = tuple(round(x, 4) for x in p)
            if key in index:
                i = index[key]
            else:
                i = len(verts); verts.append(T(*p)); radii.append(r); index[key] = i
            if prev is not None: edges.append((prev, i))
            prev = i
    me = bpy.data.meshes.new(name); me.from_pydata(verts, edges, []); me.update()
    ob = bpy.data.objects.new(name, me); bpy.context.collection.objects.link(ob); ob.parent = parent
    sk = ob.modifiers.new("skin", "SKIN"); sk.use_smooth_shade = True
    for i, r in enumerate(radii):
        rr = r if isinstance(r, tuple) else (r, r)
        me.skin_vertices[0].data[i].radius = rr
    me.skin_vertices[0].data[0].use_root = True
    sd = ob.modifiers.new("sub", "SUBSURF"); sd.levels = sub; sd.render_levels = sub
    bake(ob); ob.data.materials.append(mat); paint(ob, *colours)
    return ob

def cone(name, base, tip, r, parent, mat, seg=14, colours=None):
    d = sub3(T(*tip), T(*base)); L = length(d)
    ob = lathe(name, [(0, r), (L * 0.55, r * 0.55, 1), (L, 0.002)], T(*base), norm(d), mat, parent, seg=seg)
    if colours: paint(ob, colours, colours, mode="flat")
    return ob

def bezier(p0, p1, p2, n):
    return [tuple((1 - t) ** 2 * p0[k] + 2 * (1 - t) * t * p1[k] + t * t * p2[k] for k in range(3)) for t in [i / n for i in range(n + 1)]]

# ---------- body: hips to chest
body = part("body")
torso = [((-1.0, 0.92, 0), (0.38, 0.44)), ((-0.6, 0.98, 0), (0.5, 0.52)), ((-0.15, 1.02, 0), (0.54, 0.56)), ((0.3, 1.08, 0), (0.52, 0.54)), ((0.62, 1.14, 0), (0.42, 0.44))]
skin("body", [torso], body, SCALES)

# ---------- neck: an S-curve up from the chest
nk = part("neck")
neck = [((0.62, 1.12, 0), 0.34), ((0.92, 1.42, 0), 0.27), ((1.06, 1.82, 0), 0.22), ((1.02, 2.18, 0), 0.19), ((1.1, 2.45, 0), 0.17)]
skin("neck", [neck], nk, SCALES)

# ---------- head: skull, snout, jaw; horns, brow ridges, eyes
hd = part("head")
skull = [((1.0, 2.56, 0), (0.21, 0.25)), ((1.22, 2.62, 0), (0.2, 0.23)), ((1.45, 2.56, 0), (0.15, 0.17)), ((1.68, 2.48, 0), (0.11, 0.12)), ((1.82, 2.44, 0), (0.08, 0.09))]
jaw = [((1.08, 2.42, 0), (0.15, 0.17)), ((1.38, 2.38, 0), (0.1, 0.12)), ((1.7, 2.34, 0), (0.065, 0.07))]
skin("head", [skull, jaw], hd, SCALES)
for z in (0.13, -0.13):
    ball(f"eye {z}", T(1.32, 2.68, z * 1.12), 0.048, EYE, hd)
    for (k, (b, mid, t, r)) in enumerate((((1.08, 2.7, z * 0.8), (0.82, 2.98, z * 1.25), (0.5, 3.05, z * 1.6), 0.055), ((1.0, 2.6, z * 1.1), (0.8, 2.72, z * 1.7), (0.6, 2.7, z * 2.0), 0.035))):
        pts = bezier(b, mid, t, 6)
        for i in range(len(pts) - 1):  # a curved horn, tapering to a point
            rr = r * (1 - i / (len(pts) - 1)) + 0.004
            cone(f"horn {z} {k} {i}", pts[i], pts[i + 1], rr, hd, HORN, seg=10)
    cone(f"brow {z}", (1.32, 2.72, z * 0.9), (1.18, 2.8, z * 1.1), 0.03, hd, HORN, seg=8)
for z in (0.04, -0.04):
    ball(f"nostril {z}", T(1.76, 2.49, z), 0.012, material("nostril", (0.02, 0.02, 0.02), 0, 0.6), hd)
for i in range(6):  # teeth along the jaw line
    x = 1.25 + i * 0.07
    for z in (0.06, -0.06):
        cone(f"tooth {i} {z}", (x, 2.43, z * (1 - i * 0.08)), (x + 0.01, 2.38, z * (1 - i * 0.08)), 0.012, hd, HORN, seg=6)

# ---------- tail: down and round, ending in a spade
tl = part("tail")
tail = [((-1.0, 0.92, 0), 0.32), ((-1.55, 0.7, 0.05), 0.25), ((-2.1, 0.42, 0.2), 0.18), ((-2.6, 0.2, 0.45), 0.12), ((-2.95, 0.1, 0.8), 0.08), ((-3.1, 0.08, 1.15), 0.05), ((-3.05, 0.08, 1.4), 0.035)]
skin("tail", [tail], tl, SCALES)
sp = [T(-3.05, 0.08, 1.4), T(-3.2, 0.09, 1.52), T(-3.04, 0.1, 1.75), T(-2.88, 0.09, 1.5)]
spade = mesh_obj("spade", sp, [(0, 1, 2, 3), (3, 2, 1, 0)], MEMBRANE, tl, smooth=False); paint(spade, SPINE_C, SPINE_C, "flat")

# ---------- legs: strong haunches behind, arms in front, each foot with three claws
fl = part("frontlegs"); hl = part("hindlegs")
for z in (0.32, -0.32):
    s = 1 if z > 0 else -1
    front = [((0.45, 1.02, z), 0.22), ((0.6, 0.58, z + 0.1 * s), 0.16), ((0.52, 0.18, z + 0.12 * s), 0.11), ((0.68, 0.06, z + 0.13 * s), 0.09)]
    skin(f"front leg {z}", [front], fl, SCALES)
    hind = [((-0.78, 1.0, z), 0.34), ((-0.42, 0.62, z + 0.14 * s), 0.26), ((-0.78, 0.28, z + 0.16 * s), 0.14), ((-0.6, 0.07, z + 0.17 * s), 0.1), ((-0.43, 0.05, z + 0.17 * s), 0.08)]
    skin(f"hind leg {z}", [hind], hl, SCALES)
    for (foot, grp) in (((0.72, 0.04, z + 0.13 * s), fl), ((-0.4, 0.04, z + 0.17 * s), hl)):
        for dz in (-0.06, 0, 0.06):
            cone(f"claw {foot[0]} {z} {dz}", (foot[0] + 0.04, 0.05, foot[2] + dz), (foot[0] + 0.22, 0.0, foot[2] + dz * 1.4), 0.035, grp, HORN, seg=8)

# ---------- wings: arm bones and four fingers from the wrist, a scalloped membrane between them, raised
wg = part("wings")
for z in (1, -1):
    root, elbow, wrist = (0.25, 1.38, 0.28 * z), (-0.05, 2.05, 1.0 * z), (0.25, 2.85, 1.5 * z)
    tips = [(-0.55, 3.15, 2.5 * z), (-1.15, 2.5, 2.75 * z), (-1.45, 1.75, 2.35 * z), (-1.2, 1.25, 1.6 * z)]
    body_end = (-0.7, 1.2, 0.36 * z)
    bone = [(root, 0.08), (elbow, 0.06), (wrist, 0.05)]
    skin(f"wing arm {z}", [bone] + [[(wrist, 0.045), (tuple(wrist[k] + (t[k] - wrist[k]) * 0.5 for k in range(3)), 0.028), (t, 0.012)] for t in tips], wg, SCALES, colours=(SPINE_C, SPINE_C), sub=1)
    cone(f"thumb {z}", wrist, (wrist[0] + 0.12, wrist[1] + 0.12, wrist[2] + 0.02 * z), 0.03, wg, HORN, seg=8)
    rays = tips + [body_end]
    verts, faces = [], []
    W = T(*wrist); n = 7
    def mid_edge(a, b, u, dip=0.28):  # the trailing edge between two finger tips curves in toward the wrist
        p = tuple(a[k] + (b[k] - a[k]) * u for k in range(3))
        return tuple(p[k] + (W[k] - p[k]) * dip * math.sin(math.pi * u) for k in range(3))
    for r in range(len(rays) - 1):
        A, B = T(*rays[r]), T(*rays[r + 1])
        base = len(verts)
        cols = 6
        for i in range(n + 1):  # rows from the wrist (i=0) to the trailing edge (i=n)
            t = i / n
            for j in range(cols + 1):
                u = j / cols
                e = mid_edge(A, B, u)
                p = tuple(W[k] + (e[k] - W[k]) * t for k in range(3))
                bil = 0.06 * math.sin(math.pi * u) * math.sin(math.pi * t)  # a little billow, as the membrane fills
                verts.append((p[0] - bil * 0.3, p[1] - bil * z * 0.6, p[2] - bil))
        for i in range(n):
            for j in range(cols):
                a0 = base + i * (cols + 1) + j
                faces.append((a0, a0 + 1, a0 + cols + 2, a0 + cols + 1))
    # the front membrane: from the shoulder to the wrist along the arm
    base = len(verts)
    for P in (root, elbow, wrist, (0.55, 1.6, 0.25 * z)):
        verts.append(T(*P))
    faces += [(base, base + 1, base + 3), (base + 1, base + 2, base + 3)]
    # and the back membrane: from the last finger to the body
    base = len(verts)
    for P in (wrist, rays[-1], root):
        verts.append(T(*P))
    faces.append((base, base + 1, base + 2))
    mem = mesh_obj(f"membrane {z}", verts, faces, MEMBRANE, wg); shade_auto(mem, 80)
    paint(mem, MEM_C, MEM_C, "flat")

# ---------- spines: a row of horn-like plates from the head down to the tail tip
spn = part("spines")
line = [(1.0, 2.62, 0), (0.98, 2.3, 0), (1.0, 1.95, 0), (0.88, 1.6, 0), (0.62, 1.38, 0), (0.25, 1.36, 0), (-0.15, 1.36, 0), (-0.55, 1.3, 0), (-0.95, 1.18, 0), (-1.45, 0.92, 0.05), (-1.95, 0.6, 0.18), (-2.4, 0.33, 0.38), (-2.75, 0.2, 0.65)]
for i, p in enumerate(line):
    h = 0.34 * (1 - abs(i - 6) / 9) + 0.1
    q = (p[0], p[1] + (0.5 if 4 <= i <= 8 else 0.16 if i < 4 else 0.1), p[2])  # (on the skin of the back, not inside it)
    cone(f"spine {i}", q, (q[0] - 0.14, q[1] + h, q[2]), 0.075 * (1 - i / 22), spn, HORN, seg=10, colours=None)
    bpy.data.objects[f"spine {i}"].data.materials[0] = material("spine", srgb("#2f4b2c"), 0.0, 0.4, coat=0.3)

export(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "web", "models", "dragon.glb"))
print("wrote dragon.glb")
