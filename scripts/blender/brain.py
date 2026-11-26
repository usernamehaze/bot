"""Cassie's drawing book: the human brain in 3D. Two folded hemispheres (rounded gyri between narrow, winding sulci,
made with Blender's own noise and relaxed smooth), each lobe a slightly different shade of living brain (frontal pink,
parietal mauve, temporal sand, occipital sage) so they can be told apart; under the back, the real cerebellum and
brain stem of the Labs' scanned body (Z-Anatomy / BodyParts3D, made from scans of a real adult; CC BY-SA 4.0:
web/explore/body), set where the brain's own shape puts them. (The scan has no cerebral cortex.) Front is Cassie's +x.
   node scan_extract.mjs brain.json 'cerebellum*' 'brainstem*'
   python3 brain.py brain.json     (the bpy module) writes web/models/brain.glb"""
import math, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *
import bmesh
from mathutils import Vector, noise

reset()
LOBES = [("frontal", "#e3a39b"), ("parietal", "#c9a2c4"), ("temporal", "#e5c08e"), ("occipital", "#a8c49f")]
MATS = {k: material(k + " lobe", srgb(c), 0.0, 0.5, coat=0.4, coat_rough=0.3) for k, c in LOBES}
def lobe(X, Y, Z):
    # the boundaries run as the real sulci do: the lateral sulcus slanting up toward the back, the central sulcus slanting
    # back as it climbs, the parieto-occipital edge leaning forward, each with a small wobble
    w = 0.07 * noise.noise(Vector((X * 3.1, Y * 3.1, Z * 3.1)))
    if Y < -0.12 - 0.3 * X + w and X > -1.05: return "temporal"
    if X > 0.38 - 0.42 * Y + w: return "frontal"
    if X < -0.98 + 0.28 * Y + w: return "occipital"
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
        # (v321) the noise's own coordinates are bent by a slower noise, so the sulci wind as real ones do; the valleys are
        # narrow and the gyri between them rounded (and relaxed smooth below)
        q = Vector((p.x * 2.5 + side * 7, p.y * 2.5, p.z * 2.5))
        q = q + noise.noise_vector(q * 0.45) * 0.9
        n = noise.noise(q)
        valley = math.exp(-(n / 0.13) ** 2)
        k = 1.0 - 0.075 * valley + 0.02 * (1.0 - valley) * min(1.0, abs(n) / 0.3)
        if side * p.z < 0.05:  # the inner face: flat, toward the middle
            p.z = side * 0.05 + (p.z - side * 0.05) * 0.15
        p = Vector((p.x * k, p.y * k, p.z * k)) + Vector((0, 0, side * 0.7))
        v.co = Vector(T(p.x, p.y + 0.35, p.z))
    me = bpy.data.meshes.new(f"hemisphere {side}"); bm.to_mesh(me); bm.free()
    for k, _ in LOBES: me.materials.append(MATS[k])
    for f in me.polygons:
        c = f.center; f.material_index = [k for k, _ in LOBES].index(lobe(c.x, c.z - 0.35, -c.y)); f.use_smooth = True
    ob = bpy.data.objects.new(f"hemisphere {side}", me); bpy.context.collection.objects.link(ob)
    m = ob.modifiers.new("relax", "LAPLACIANSMOOTH"); m.iterations = 3; m.lambda_factor = 0.5; m.use_volume_preserve = True
    apply_mods(ob)
    for o in split(ob, [f"{k} {side}" for k, _ in LOBES], [parts[k] for k, _ in LOBES]): pass

# ---------- the real cerebellum and brain stem, turned so their front is +x and fitted where the hemispheres leave room
# for them (the cerebellum under the back, its middle at (-1.12, -0.55), 1.84 wide)
D = scan_load(sys.argv[1])
CEREB = [k for k in D if "lobule" in k or "vermis" in k or k in ("central_lobule", "culmen", "declive", "flocculus_l", "flocculus_r", "lingula_of_cerebellum", "tonsil_of_cerebellum_l", "tonsil_of_cerebellum_r", "superior_cerebellar_peduncle_l", "superior_cerebellar_peduncle_r")]
STEM_K = [k for k in D if k.split("_")[0] in ("medulla", "olive", "pyramid", "base", "midbrain", "inferior", "superior", "pons") and "colliculus" in k or k.startswith(("medulla_oblongata", "olive_", "pyramid_of", "base_of_peduncle", "midbrain_", "pons_"))]
STEM_K = [k for k in STEM_K if k not in CEREB]
turn = lambda q: (q[2], q[1], -q[0])
pts = [turn(D[k]["pos"][i:i + 3]) for k in CEREB for i in range(0, len(D[k]["pos"]), 3)]
lo = [min(p[j] for p in pts) for j in range(3)]; hi = [max(p[j] for p in pts) for j in range(3)]
sc = 1.84 / (hi[2] - lo[2]); mid = [(lo[j] + hi[j]) / 2 for j in range(3)]
f = lambda q: (lambda p: ((p[0] - mid[0]) * sc - 1.12, (p[1] - mid[1]) * sc - 0.55, (p[2] - mid[2]) * sc))(turn(q))
f.per_metre = sc
CER = material("cerebellum", srgb("#d9a6a0"), 0.0, 0.48, coat=0.4, coat_rough=0.3)
STEM = material("brain stem", srgb("#e6cdb4"), 0.0, 0.45, coat=0.35)
cb, bs = part("cerebellum"), part("brainstem")
for k in CEREB: scan_obj(k, D, k, f, CER, cb, subdiv=2)
for k in STEM_K: scan_obj(k, D, k, f, STEM, bs, subdiv=2)
print("cerebellum pieces", len(CEREB), "brain stem pieces", len(STEM_K))

tissue(lambda ob: "nervous", 1 / f.per_metre)
print("faces", sum(len(o.data.polygons) for o in bpy.data.objects if o.type == "MESH"))
export(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "web", "models", "brain.glb"))
print("wrote brain.glb")
