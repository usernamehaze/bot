"""Cassie's drawing book: the lungs in 3D, the real ones. The shapes are the lungs of the Labs' scanned body
(Z-Anatomy / BodyParts3D, made from scans of a real adult; CC BY-SA 4.0: web/explore/body), made smooth in Blender:
the trachea, the whole bronchial tree down to the segmental bronchi, the right lung's three lobes and the left lung's
two (with the notch for the heart), see-through so the airways show, over the dome of the diaphragm. At the end of
each segmental bronchus, a cluster of air sacs (alveoli), drawn bigger than life so they can be seen.
   node scan_extract.mjs lungs.json 'lungs*' 'tracheobronchial_tree*' diaphragm
   python3 lungs.py lungs.json     (the bpy module) writes web/models/lungs.glb"""
import math, os, random, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *

D = scan_load(sys.argv[1])
LOBES_R = ["superior_lobe_of_right_lung", "middle_lobe_of_right_lung", "inferior_lobe_of_right_lung"]
LOBES_L = ["superior_lobe_of_left_lung", "inferior_lobe_of_left_lung"]
AIRWAYS = [k for k in D if "bronch" in k]
f = scan_frame(D, LOBES_R + LOBES_L + ["trachea"], 4.6, (0.0, 0.1, 0.0))

reset(); random.seed(7)
TRACH = material("trachea", srgb("#e8d6cc"), 0.0, 0.42, coat=0.35)
BRONCH = material("bronchi", srgb("#cfe0ee"), 0.0, 0.38, coat=0.45)
ALV = material("alveoli", srgb("#ef9f9c"), 0.0, 0.48, coat=0.35)
LUNG_R = see_through(material("right lung", srgb("#e59a94"), 0.0, 0.45, coat=0.4), 0.34)
LUNG_L = see_through(material("left lung", srgb("#e2928e"), 0.0, 0.45, coat=0.4), 0.34)
DIA = see_through(material("diaphragm", srgb("#b4483e"), 0.0, 0.5, coat=0.25), 0.62)

scan_obj("trachea", D, ["trachea"], f, TRACH, part("trachea"), subdiv=2)
br = part("bronchi")
for k in AIRWAYS:
    scan_obj(k, D, k, f, BRONCH, br, subdiv=2)
rl, ll = part("rightlung"), part("leftlung")
for k in LOBES_R: scan_obj(k, D, k, f, LUNG_R, rl, smooth=2, subdiv=1)
for k in LOBES_L: scan_obj(k, D, k, f, LUNG_L, ll, smooth=2, subdiv=1)
dia = scan_obj("diaphragm", D, ["diaphragm"], f, DIA, part("diaphragm"), smooth=1, subdiv=1)
# only its dome under the lungs (not the long tendons, the crura, that run down the spine)
import bmesh as _bm
low = min(f(D[k]["pos"][i:i + 3])[1] for k in LOBES_R + LOBES_L for i in range(0, len(D[k]["pos"]), 3))
bm = _bm.new(); bm.from_mesh(dia.data)
_bm.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], dist=1e-6, plane_co=(0, 0, low - 0.25), plane_no=(0, 0, 1), clear_inner=True)
bm.to_mesh(dia.data); bm.free(); dia.data.update()

# ---------- air sacs at the far end of every segmental bronchus
pts = lambda k: [f(D[k]["pos"][i:i + 3]) for i in range(0, len(D[k]["pos"]), 3)]
tr = pts("trachea"); carina = min(tr, key=lambda p: p[1])
al = part("alveoli")
n = 0
for k in AIRWAYS:
    if "segmental" not in k: continue
    tip = max(pts(k), key=lambda p: sum((p[j] - carina[j]) ** 2 for j in range(3)))
    out = [tip[j] - carina[j] for j in range(3)]; L = math.sqrt(sum(x * x for x in out)); out = [x / L for x in out]
    c = [tip[j] - out[j] * 0.03 for j in range(3)]  # (inside the lung, at the tip)
    for s in range(9):
        q = [c[j] + random.uniform(-0.07, 0.07) + out[j] * random.uniform(-0.04, 0.02) for j in range(3)]
        bpy.ops.mesh.primitive_uv_sphere_add(segments=14, ring_count=9, radius=random.uniform(0.032, 0.046), location=T(*q))
        o = bpy.context.active_object; o.name = f"alveolus {n}"; o.data.materials.append(ALV); o.parent = al
        for p in o.data.polygons: p.use_smooth = True
        n += 1
print("alveoli", n)

tissue(lambda ob: "visceral", 1 / f.per_metre)
print("faces", sum(len(o.data.polygons) for o in bpy.data.objects if o.type == "MESH"))
export(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "web", "models", "lungs.glb"))
print("wrote lungs.glb")
