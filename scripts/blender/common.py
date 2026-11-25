"""Helpers for Cassie's Blender models (run with Blender's Python: bpy 5.x, headless).
Cassie's 3D world is three.js's: x along the model, y up, z sideways. Blender is z up; the glTF exporter turns
Blender (x, y, z) into three.js (x, z, -y), so a point Cassie means as (X, Y, Z) is made in Blender at (X, -Z, Y): T(X, Y, Z).
Each part is an empty named with the part's id in Cassie's drawing book; its meshes are its children. A mesh that spins
carries the custom property "spin" = "x" | "y" | "z" (Cassie's axis), exported as extras (three.js userData).
Material values follow the Blender skills pack's PBR table (realistic-style/references/pbr-values.md)."""
import math
import bpy
import bmesh

def T(X, Y, Z):
    return (X, -Z, Y)

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)

def material(name, color, metallic=0.0, roughness=0.5, coat=0.0, coat_rough=0.1, transmission=0.0, ior=1.45, emission=None, alpha=1.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (*color, 1.0)
    b.inputs["Metallic"].default_value = metallic
    b.inputs["Roughness"].default_value = roughness
    if coat:
        b.inputs["Coat Weight"].default_value = coat
        b.inputs["Coat Roughness"].default_value = coat_rough
    if transmission:
        b.inputs["Transmission Weight"].default_value = transmission
        b.inputs["IOR"].default_value = ior
    if emission:
        b.inputs["Emission Color"].default_value = (*emission, 1.0)
        b.inputs["Emission Strength"].default_value = 1.0
    if alpha < 1:
        b.inputs["Alpha"].default_value = alpha
    return m

def srgb(h):
    """'#rrggbb' to linear RGB (Blender's colours are linear)."""
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(((v + 0.055) / 1.055) ** 2.4 if v > 0.04045 else v / 12.92 for v in c)

def part(pid):
    e = bpy.data.objects.new(pid, None)
    bpy.context.collection.objects.link(e)
    return e

def mesh_obj(name, verts, faces, mat, parent, smooth=True, spin=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.validate()
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    ob.data.materials.append(mat)
    if smooth:
        for p in me.polygons:
            p.use_smooth = True
        # crisp where a real edge is (over 40 degrees), smooth everywhere else
    ob.parent = parent
    if spin:
        ob["spin"] = spin
    return ob

def shade_auto(ob, angle=40):
    try:
        bpy.context.view_layer.objects.active = ob
        ob.select_set(True)
        bpy.ops.object.shade_auto_smooth(angle=math.radians(angle))
        ob.select_set(False)
    except Exception:
        pass

def lathe(name, profile, axis_from, axis_dir, mat, parent, seg=48, cap0=True, cap1=True, spin=None, center_fn=None):
    """A turned body: profile [(s, r)] along the axis from axis_from (Blender coords) in direction axis_dir (unit).
    center_fn(s) -> extra (dx, dy, dz) offset of the ring centre (a tail cone that sweeps up)."""
    a = axis_dir
    ref = (0, 0, 1) if abs(a[2]) < 0.9 else (1, 0, 0)
    u = norm(cross(ref, a))
    v = cross(a, u)
    verts, faces = [], []
    for (s, r) in profile:
        c = [axis_from[k] + a[k] * s for k in range(3)]
        if center_fn:
            d = center_fn(s)
            c = [c[k] + d[k] for k in range(3)]
        for j in range(seg):
            t = 2 * math.pi * j / seg
            verts.append(tuple(c[k] + r * (math.cos(t) * u[k] + math.sin(t) * v[k]) for k in range(3)))
    n = len(profile)
    for i in range(n - 1):
        for j in range(seg):
            a0, a1 = i * seg + j, i * seg + (j + 1) % seg
            faces.append((a0, a1, a1 + seg, a0 + seg))
    if cap0:
        c0 = len(verts)
        s, r = profile[0]
        cc = [axis_from[k] + a[k] * s for k in range(3)]
        if center_fn:
            d = center_fn(s); cc = [cc[k] + d[k] for k in range(3)]
        verts.append(tuple(cc))
        for j in range(seg):
            faces.append((c0, (j + 1) % seg, j))
    if cap1:
        c1 = len(verts)
        s, r = profile[-1]
        cc = [axis_from[k] + a[k] * s for k in range(3)]
        if center_fn:
            d = center_fn(s); cc = [cc[k] + d[k] for k in range(3)]
        verts.append(tuple(cc))
        base = (n - 1) * seg
        for j in range(seg):
            faces.append((c1, base + j, base + (j + 1) % seg))
    ob = mesh_obj(name, verts, faces, mat, parent, spin=spin)
    shade_auto(ob, 50)
    return ob

def naca(x, t, m=0.02, p=0.4):
    yt = 5 * t * (0.2969 * math.sqrt(x) - 0.1260 * x - 0.3516 * x ** 2 + 0.2843 * x ** 3 - 0.1015 * x ** 4)
    yc = m / p ** 2 * (2 * p * x - x ** 2) if x < p else m / (1 - p) ** 2 * ((1 - 2 * p) + 2 * p * x - x ** 2)
    return yc + yt, yc - yt

def surface(name, stations, mat, parent, chord_pts=24, vertical=False, camber=0.02, side_y=0.0):
    """A lofted wing: stations [(le_x, span, height, chord, thickness)] in Blender coords; chord runs toward -x.
    vertical: a fin (span is height, thickness sideways)."""
    xs = [0.5 * (1 - math.cos(math.pi * k / (chord_pts - 1))) for k in range(chord_pts)]
    verts, faces = [], []
    ring = 2 * chord_pts - 2
    for (le, sp, h, c, t) in stations:
        top, bot = [], []
        for x in xs:
            up, lo = naca(x, t, camber if not vertical else 0.0)
            top.append((le - x * c, up * c)); bot.append((le - x * c, lo * c))
        loop = top + bot[-2:0:-1]
        for (px, off) in loop:
            verts.append((px, side_y + off, sp + h) if vertical else (px, sp, h + off))  # (vertical: span is height above h, at y = side_y)
    for i in range(len(stations) - 1):
        for j in range(ring):
            a0, a1 = i * ring + j, i * ring + (j + 1) % ring
            faces.append((a0, a1, a1 + ring, a0 + ring))
    for k in (0, len(stations) - 1):
        faces.append(tuple(range(k * ring, k * ring + ring))[::(1 if k else -1)])
    ob = mesh_obj(name, verts, faces, mat, parent)
    shade_auto(ob, 30)
    return ob

def box(name, center, size, mat, parent, bevel=0.0):
    x, y, z = center; a, b, c = size[0] / 2, size[1] / 2, size[2] / 2
    v = [(x - a, y - b, z - c), (x + a, y - b, z - c), (x + a, y + b, z - c), (x - a, y + b, z - c), (x - a, y - b, z + c), (x + a, y - b, z + c), (x + a, y + b, z + c), (x - a, y + b, z + c)]
    f = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    ob = mesh_obj(name, v, f, mat, parent, smooth=False)
    if bevel:
        m = ob.modifiers.new("bevel", "BEVEL"); m.width = bevel; m.segments = 3
    return ob

def cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])

def norm(a):
    l = math.sqrt(sum(x * x for x in a)) or 1
    return tuple(x / l for x in a)

def export(path):
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_extras=True, export_apply=True, export_yup=True, export_cameras=False, export_lights=False)

def sub3(a, b):
    return tuple(a[k] - b[k] for k in range(3))

def length(a):
    return math.sqrt(sum(x * x for x in a))

def tube(name, pts, r, mat, parent, seg=20, joints=True):
    """A tube through Cassie points [(X, Y, Z)]: one straight piece per leg, a ball at each bend (a weld or a bend)."""
    bp = [T(*p) for p in pts]
    for i in range(len(bp) - 1):
        a, b = bp[i], bp[i + 1]
        d = sub3(b, a); L = length(d)
        if L < 1e-6:
            continue
        lathe(f"{name} {i}", [(0, r), (L, r)], a, norm(d), mat, parent, seg=seg)
    if joints:
        for i, p in enumerate(bp[1:-1]):
            ball(f"{name} joint {i}", p, r * 1.02, mat, parent)

def ball(name, centre, r, mat, parent, seg=24):
    prof = [(r - r * math.cos(math.pi * k / 12), r * math.sin(math.pi * k / 12) + 1e-4, 1) for k in range(1, 12)]
    lathe(name, [(s, rr) for (s, rr, _) in prof], (centre[0] - r, centre[1], centre[2]), (1, 0, 0), mat, parent, seg=seg)

def torus(name, centre, axis, R, r, mat, parent, seg=72, tseg=16, ribs=0, rib_depth=0.0):
    """A ring round `axis` (Blender unit vector) at `centre`; ribs: a tread of that many bumps on its outside."""
    a = axis
    ref = (0, 0, 1) if abs(a[2]) < 0.9 else (1, 0, 0)
    u = norm(cross(ref, a)); v = cross(a, u)
    verts, faces = [], []
    for i in range(seg):
        t = 2 * math.pi * i / seg
        radial = tuple(math.cos(t) * u[k] + math.sin(t) * v[k] for k in range(3))
        for j in range(tseg):
            q = 2 * math.pi * j / tseg
            rr = r + (rib_depth * max(0.0, math.cos(q)) * (0.5 + 0.5 * math.cos(ribs * t)) if ribs else 0.0)
            verts.append(tuple(centre[k] + radial[k] * (R + rr * math.cos(q)) + a[k] * rr * math.sin(q) for k in range(3)))
    for i in range(seg):
        for j in range(tseg):
            a0 = i * tseg + j; a1 = i * tseg + (j + 1) % tseg
            b0 = ((i + 1) % seg) * tseg + j; b1 = ((i + 1) % seg) * tseg + (j + 1) % tseg
            faces.append((a0, b0, b1, a1))
    ob = mesh_obj(name, verts, faces, mat, parent)
    shade_auto(ob, 60)
    return ob

def empty(name, parent, at=(0, 0, 0), spin=None):
    e = bpy.data.objects.new(name, None); bpy.context.collection.objects.link(e); e.parent = parent; e.location = at
    if spin:
        e["spin"] = spin
    return e
