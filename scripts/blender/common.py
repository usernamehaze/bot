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
    profile = [(q[0], q[1]) for q in profile]  # (a third value, the "smooth" mark, is for shading only)
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

# ---------- (anatomy) smooth tubes, shells, booleans, splitting by material

def frames(pts):
    """Parallel-transport frames along a polyline (Blender coords): [(tangent, normal, binormal)]."""
    n = len(pts); out = []
    t0 = norm(sub3(pts[1], pts[0]))
    ref = (0, 0, 1) if abs(t0[2]) < 0.9 else (1, 0, 0)
    nrm = norm(cross(ref, t0))
    for i in range(n):
        t = norm(sub3(pts[min(i + 1, n - 1)], pts[max(i - 1, 0)]))
        nrm = norm(sub3(nrm, tuple(t[k] * sum(nrm[j] * t[j] for j in range(3)) for k in range(3))))
        out.append((t, nrm, cross(t, nrm)))
    return out

def smooth_path(cpts, per=8):
    """Catmull-Rom through control points (Blender coords)."""
    if len(cpts) < 3:
        return [tuple(cpts[0][k] + (cpts[1][k] - cpts[0][k]) * i / per for k in range(3)) for i in range(per + 1)]
    P = [cpts[0]] + list(cpts) + [cpts[-1]]; out = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        for s in range(per):
            t = s / per; t2, t3 = t * t, t * t * t
            out.append(tuple(0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3) for k in range(3)))
    out.append(cpts[-1]); return out

def sweep(name, cpts, radius, mat, parent, seg=20, hollow=0.0, per=8, caps=True, inner_mat=None):
    """A smooth tube through Cassie points; radius a number or f(u) (0..1 along); hollow: wall thickness (an open
    vessel you can see into, its inside in inner_mat)."""
    pts = smooth_path([T(*p) for p in cpts], per)
    F = frames(pts); n = len(pts)
    rad = radius if callable(radius) else (lambda u: radius)
    verts, faces = [], []
    def ring(r):
        for i, p in enumerate(pts):
            t, nn, b = F[i]; rr = r(i / (n - 1))
            for j in range(seg):
                a = 2 * math.pi * j / seg
                verts.append(tuple(p[k] + rr * (math.cos(a) * nn[k] + math.sin(a) * b[k]) for k in range(3)))
    ring(rad); base_in = len(verts)
    if hollow:
        ring(lambda u: max(0.002, rad(u) - hollow))
    for i in range(n - 1):
        for j in range(seg):
            a0, a1 = i * seg + j, i * seg + (j + 1) % seg
            faces.append((a0, a1, a1 + seg, a0 + seg))
            if hollow:
                b0, b1 = base_in + a0, base_in + a1
                faces.append((b0, b0 + seg, b1 + seg, b1))
    mats = [0] * len(faces)
    if hollow:
        mats = [0 if (k % 2 == 0) else 1 for k in range(len(faces))]
        for end in (0, n - 1):  # the cut rim: a ring from outside to inside
            for j in range(seg):
                o0, o1 = end * seg + j, end * seg + (j + 1) % seg
                faces.append((o0, base_in + o0, base_in + o1, o1) if end == 0 else (o0, o1, base_in + o1, base_in + o0)); mats.append(0)
    elif caps:
        for end in (0, n - 1):
            c = len(verts); verts.append(pts[end])
            for j in range(seg):
                a0, a1 = end * seg + j, end * seg + (j + 1) % seg
                faces.append((c, a1, a0) if end == 0 else (c, a0, a1)); mats.append(0)
    ob = mesh_obj(name, verts, faces, mat, parent)
    if hollow:
        ob.data.materials.append(inner_mat or mat)
        for p, m in zip(ob.data.polygons, mats): p.material_index = m
    shade_auto(ob, 60)
    return ob

def ellipsoid(name, centre, radii, mat, parent, seg=40, rings=24, rot=None, bumps=None):
    """An ellipsoid at a Cassie point; radii in Cassie axes (x, y, z); rot: degrees about Cassie z (a tilt);
    bumps(u, v) -> scale factor (an organic, uneven surface)."""
    rx, ry, rz = radii; verts, faces = [], []
    c = math.cos(math.radians(rot or 0)); s = math.sin(math.radians(rot or 0))
    for i in range(rings + 1):
        v = math.pi * i / rings
        for j in range(seg):
            u = 2 * math.pi * j / seg
            k = bumps(u, v) if bumps else 1.0
            x, y, z = rx * math.sin(v) * math.cos(u) * k, ry * math.cos(v) * k, rz * math.sin(v) * math.sin(u) * k
            x, y = x * c - y * s, x * s + y * c
            verts.append(T(centre[0] + x, centre[1] + y, centre[2] + z))
    for i in range(rings):
        for j in range(seg):
            a0, a1 = i * seg + j, i * seg + (j + 1) % seg
            faces.append((a0, a0 + seg, a1 + seg, a1))
    ob = mesh_obj(name, verts, faces, mat, parent)
    weld(ob); shade_auto(ob, 70)
    return ob

def weld(ob, dist=1e-5):
    """Merge the points that sit on each other (a sphere's poles): a closed surface, which cutting needs."""
    import bmesh as _bm
    bm = _bm.new(); bm.from_mesh(ob.data)
    _bm.ops.remove_doubles(bm, verts=bm.verts, dist=dist)
    _bm.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(ob.data); bm.free(); ob.data.update()

def boolean(ob, cutter, op="DIFFERENCE"):
    """Cut `cutter` out of `ob` (its faces keep the cutter's material: the cut-open walls)."""
    m = ob.modifiers.new("bool", "BOOLEAN"); m.operation = op; m.object = cutter; m.solver = "EXACT"
    try: m.use_self = False
    except Exception: pass
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
    ob.modifiers.clear(); ob.data = me
    return ob

def split(ob, names, parents):
    """Split a mesh into one object per material: names[i] for material i, parented to parents[i]."""
    import bmesh as _bm
    out = []
    for mi, (nm, par) in enumerate(zip(names, parents)):
        bm = _bm.new(); bm.from_mesh(ob.data)
        kill = [f for f in bm.faces if f.material_index != mi]
        _bm.ops.delete(bm, geom=kill, context='FACES')
        if not bm.faces:
            bm.free(); continue
        me = bpy.data.meshes.new(nm); bm.to_mesh(me); bm.free()
        for m in ob.data.materials: me.materials.append(m)
        o = bpy.data.objects.new(nm, me); bpy.context.collection.objects.link(o); o.parent = par
        for p in me.polygons: p.use_smooth = True
        shade_auto(o, 50); out.append(o)
    bpy.data.objects.remove(ob)
    return out

def shell(name, R_out, R_in, mat, parent, centre=(0, 0, 0), axis=(1, 0, 0), th=(0.0, math.pi), cut=(0.0, 0.0), seg=64, rings=40, inner_mat=None, rim_mat=None):
    """A thick spherical shell about Cassie `axis` (unit, Cassie coords) at Cassie `centre`: polar angle from the axis
    in th, minus the wedge of azimuth `cut` (radians; (0, 0) = whole), its cut edges closed (rim_mat)."""
    a = norm(T(*axis)); cc = T(*centre)
    ref = (0, 0, 1) if abs(a[2]) < 0.9 else (1, 0, 0)
    u = norm(cross(ref, a)); v = cross(a, u)
    whole = cut[1] <= cut[0]
    phis = [cut[1] + (2 * math.pi - (cut[1] - cut[0])) * j / seg for j in range(seg + (0 if whole else 1))]
    if whole: phis = [2 * math.pi * j / seg for j in range(seg)]
    ths = [th[0] + (th[1] - th[0]) * i / rings for i in range(rings + 1)]
    verts, faces, mats = [], [], []
    def pt(R, t, p): return tuple(cc[k] + R * (math.cos(t) * a[k] + math.sin(t) * (math.cos(p) * u[k] + math.sin(p) * v[k])) for k in range(3))
    np_ = len(phis)
    for R in (R_out, R_in):
        for t in ths:
            for p in phis: verts.append(pt(R, t, p))
    inn = (rings + 1) * np_
    J = np_ if whole else np_ - 1
    for i in range(rings):
        for j in range(J):
            j1 = (j + 1) % np_
            a0, a1, b0, b1 = i * np_ + j, i * np_ + j1, (i + 1) * np_ + j, (i + 1) * np_ + j1
            faces.append((a0, a1, b1, b0)); mats.append(0)
            faces.append((inn + a0, inn + b0, inn + b1, inn + a1)); mats.append(1)
    for i in (0, rings):  # the open rims (front opening and back), outside to inside
        if th[0] == 0.0 and i == 0: continue
        if th[1] >= math.pi - 1e-6 and i == rings: continue
        for j in range(J):
            j1 = (j + 1) % np_
            a0, a1 = i * np_ + j, i * np_ + j1
            faces.append((a0, inn + a0, inn + a1, a1) if i == 0 else (a0, a1, inn + a1, inn + a0)); mats.append(2)
    if not whole:  # the two cut faces of the wedge
        for j in (0, np_ - 1):
            for i in range(rings):
                a0, b0 = i * np_ + j, (i + 1) * np_ + j
                faces.append((a0, b0, inn + b0, inn + a0) if j == 0 else (a0, inn + a0, inn + b0, b0)); mats.append(2)
    ob = mesh_obj(name, verts, faces, mat, parent)
    ob.data.materials.append(inner_mat or mat); ob.data.materials.append(rim_mat or mat)
    for p, m in zip(ob.data.polygons, mats): p.material_index = m
    shade_auto(ob, 50)
    return ob

def see_through(m, alpha):
    """A material you can see into (glTF alphaMode BLEND)."""
    b = m.node_tree.nodes.get("Principled BSDF"); b.inputs["Alpha"].default_value = alpha
    for attr, val in (("surface_render_method", "BLENDED"), ("blend_method", "BLEND")):
        try: setattr(m, attr, val)
        except Exception: pass
    return m

def colour_by(ob, fn):
    """Paint each point of a mesh with fn(Cassie point) -> linear RGB (exported as the mesh's own colours)."""
    me = ob.data
    if "Col" not in me.color_attributes: me.color_attributes.new("Col", 'FLOAT_COLOR', 'POINT')
    col = me.color_attributes["Col"]
    for v in me.vertices:
        c = fn((v.co.x, v.co.z, -v.co.y)); col.data[v.index].color = (*c, 1.0)

def vertex_material(name, roughness=0.5, coat=0.0, metallic=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; b = nt.nodes.get("Principled BSDF")
    ca = nt.nodes.new("ShaderNodeVertexColor"); ca.layer_name = "Col"
    nt.links.new(ca.outputs["Color"], b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = roughness; b.inputs["Metallic"].default_value = metallic
    if coat: b.inputs["Coat Weight"].default_value = coat
    return m
