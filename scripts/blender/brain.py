"""Cassie's drawing book: the human brain in 3D (python3 brain.py with the bpy module). Two folded hemispheres (the
gyri and sulci made with Blender's own noise), coloured by lobe as anatomy books do (frontal red, parietal blue,
temporal yellow, occipital green), the cerebellum with its fine folds, and the brain stem. Front is Cassie's +x.
Writes web/models/brain.glb."""
import math, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *
import bmesh
from mathutils import Vector, noise

reset()
LOBES = [("frontal", "#c8322e"), ("parietal", "#3f68c8"), ("temporal", "#e3b62c"), ("occipital", "#3c9a4a")]
MATS = {k: material(k + " lobe", srgb(c), 0.0, 0.55, coat=0.35, coat_rough=0.35) for k, c in LOBES}
def lobe(X, Y, Z):
    if Y < -0.05 - 0.25 * X and X > -1.0: return "temporal"
    if X > 0.25: return "frontal"
    if X < -0.95: return "occipital"
    return "parietal"
parts = {k: part(k) for k, _ in LOBES}
for side in (1, -1):
    bm = bmesh.new(); bmesh.ops.create_icosphere(bm, subdivisions=6, radius=1.0)
    for v in bm.verts:
        d = v.co.normalized()  # (Blender coords) → Cassie: X = d.x (front), Y = d.z (up), Z = -d.y (side)
        X, Y, Z = d.x, d.z, -d.y
        # a hemisphere's shape: long front to back, the temporal lobe bulging down at the front, flat on the inside
        r = 1.0 + 0.18 * math.exp(-((X - 0.25) ** 2 + (Y + 0.75) ** 2) / 0.12) - 0.1 * max(0.0, -Y) ** 2
        p = Vector((X * 1.72 * r, Y * 1.18 * r, Z * 0.74 * r))
        # the folds: valleys where the noise crosses zero (sulci), gyri between them
        n = noise.noise(Vector((p.x * 2.9 + side * 7, p.y * 2.9, p.z * 2.9)))
        valley = math.exp(-(n / 0.1) ** 2)
        k = 1.0 - 0.085 * valley + 0.015 * max(0.0, 1 - abs(n) / 0.35)
        if side * p.z < 0.05:  # the inner face: flat, toward the middle
            p.z = side * 0.05 + (p.z - side * 0.05) * 0.15
        p = Vector((p.x * k, p.y * k, p.z * k)) + Vector((0, 0, side * 0.74))
        v.co = Vector(T(p.x, p.y + 0.35, p.z))
    me = bpy.data.meshes.new(f"hemisphere {side}"); bm.to_mesh(me); bm.free()
    for k, _ in LOBES: me.materials.append(MATS[k])
    for f in me.polygons:
        c = f.center; f.material_index = [k for k, _ in LOBES].index(lobe(c.x, c.z - 0.35, -c.y)); f.use_smooth = True
    ob = bpy.data.objects.new(f"hemisphere {side}", me); bpy.context.collection.objects.link(ob)
    for o in split(ob, [f"{k} {side}" for k, _ in LOBES], [parts[k] for k, _ in LOBES]): pass

# ---------- cerebellum: under the back, with its many thin horizontal folds
cb = part("cerebellum")
CER = material("cerebellum", srgb("#b0587a"), 0.0, 0.55, coat=0.3)
for side in (1, -1):
    o = ellipsoid(f"cerebellum {side}", (-1.12, -0.55, side * 0.42), (0.62, 0.42, 0.5), CER, cb, seg=96, rings=64,
                  bumps=lambda u, v: 1.0 - 0.035 * (0.5 + 0.5 * math.cos(v * 46)))
# ---------- brain stem: midbrain, the pons bulge, the medulla
bs = part("brainstem")
STEM = material("brain stem", srgb("#d6b28a"), 0.0, 0.5, coat=0.3)
sweep("brain stem", [(-0.35, -0.1, 0), (-0.42, -0.7, 0), (-0.45, -1.3, 0), (-0.5, -1.9, 0)], lambda u: 0.26 - 0.08 * u, STEM, bs, seg=28)
ellipsoid("pons", (-0.34, -0.75, 0), (0.3, 0.3, 0.32), STEM, bs, seg=40, rings=24)

export(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "web", "models", "brain.glb"))
print("wrote brain.glb")
