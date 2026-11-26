"""Cassie's drawing book: the human heart in 3D, the real one. The shapes are the heart of the Labs' scanned body
(Z-Anatomy / BodyParts3D, made from scans of a real adult; CC BY-SA 4.0: web/explore/body), made smooth in Blender:
the four chambers (each its own part, so Pull apart opens the heart and shows the valves inside), the valve leaflets
and papillary muscles, the coronary arteries on its surface, the aorta, the pulmonary trunk, the venae cavae and the
pulmonary veins. Coloured as the anatomy books do: the right side (blood low in oxygen) a little blue, the left red.
   node scan_extract.mjs heart.json <SCAN...>     (NODE_PATH with @gltf-transform/core, extensions, meshoptimizer)
   python3 heart.py heart.json                    (the bpy module) writes web/models/heart.glb"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *
import bmesh as _bm

SCAN = ["heart*", "ascending_aorta", "pulmonary_trunk", "bifurcation_of_pulmonary_trunk", "superior_vena_cava", "inferior_vena_cava_thoracic_part",
        "left_inferior_pulmonary_vein", "left_superior_pulmonary_vein", "right_inferior_pulmonary_vein", "right_superior_pulmonary_vein", "left_coronary_artery", "right_coronary_artery"]
D = scan_load(sys.argv[1])
CH = ["right_atrium", "right_ventricle", "left_atrium", "left_ventricle"]
f = scan_frame(D, CH, 3.0, (0.0, -0.1, 0.0))

reset()
RIGHT = material("right heart", srgb("#a8454f"), 0.0, 0.42, coat=0.5, coat_rough=0.28)
LEFT = material("left heart", srgb("#bd3f3a"), 0.0, 0.42, coat=0.5, coat_rough=0.28)
AORTA = material("aorta", srgb("#cf3a36"), 0.0, 0.32, coat=0.55, coat_rough=0.2)
PULM = material("pulmonary artery", srgb("#7e5cc0"), 0.0, 0.32, coat=0.55, coat_rough=0.2)
CAVA = material("vena cava", srgb("#3e78c8"), 0.0, 0.32, coat=0.55, coat_rough=0.2)
PVEIN = material("pulmonary vein", srgb("#d05868"), 0.0, 0.32, coat=0.55, coat_rough=0.2)
VALVE = material("valve", srgb("#f0d6cc"), 0.0, 0.5, coat=0.3)
PAPIL = material("papillary muscle", srgb("#c25a5c"), 0.0, 0.5, coat=0.3)
CORON = material("coronary artery", srgb("#e0503c"), 0.0, 0.35, coat=0.5)

def clip_below(ob, z):
    """Keep only what is above height z (Blender up), the vena cava as far as just under the heart."""
    bm = _bm.new(); bm.from_mesh(ob.data)
    _bm.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], dist=1e-6, plane_co=(0, 0, z), plane_no=(0, 0, 1), clear_inner=True)
    bm.to_mesh(ob.data); bm.free(); ob.data.update()

rs, ls = part("rightside"), part("leftside")
for k in CH:
    scan_obj(k, D, k, f, RIGHT if k.startswith("right") else LEFT, rs if k.startswith("right") else ls, smooth=2, subdiv=2)
vl = part("valves")
for k in D:
    if "leaflet" in k or "papillary" in k:
        scan_obj(k, D, k, f, VALVE if "leaflet" in k else PAPIL, vl, subdiv=2)
co = part("coronary")
for k in ("left_coronary_artery", "right_coronary_artery"):
    scan_obj(k, D, k, f, CORON, co, subdiv=1)
scan_obj("aorta", D, ["ascending_aorta"], f, AORTA, part("aorta"), subdiv=2)
scan_obj("pulmonary trunk", D, ["pulmonary_trunk", "bifurcation_of_pulmonary_trunk"], f, PULM, part("pulmonary"), subdiv=2)
vc = part("venacava")
scan_obj("superior vena cava", D, ["superior_vena_cava"], f, CAVA, vc, subdiv=2)
clip_below(scan_obj("inferior vena cava", D, ["inferior_vena_cava_thoracic_part"], f, CAVA, vc, subdiv=2), -1.95)
pv = part("pulmveins")
for k in ("left_inferior_pulmonary_vein", "left_superior_pulmonary_vein", "right_inferior_pulmonary_vein", "right_superior_pulmonary_vein"):
    scan_obj(k, D, k, f, PVEIN, pv, subdiv=2)

tissue(lambda ob: "cardiovascular", 1 / f.per_metre)
print("faces", sum(len(o.data.polygons) for o in bpy.data.objects if o.type == "MESH"))
export(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "web", "models", "heart.glb"))
print("wrote heart.glb")
