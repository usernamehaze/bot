"""Cassie's drawing book: the human eye in 3D, the real one, cut open. The shapes are the right eye of the Labs'
scanned body (Z-Anatomy / BodyParts3D, made from scans of a real adult; CC BY-SA 4.0: web/explore/body), made smooth
in Blender: the white sclera, the retina with its central artery branching over it, the clear cornea, the iris round
the pupil, the clear lens, the optic nerve and the six muscles that turn the eye. The dark choroid (not in the scan)
is a layer between sclera and retina. The top quarter nearest the viewer is taken away so the layers show, as anatomy
books draw it. Its front faces Cassie's +x.
   node scan_extract.mjs eye.json cornea_r iris_r lens_r retina_r sclera_r optic_nerve_ii_r central_retinal_artery_r <the six muscles>_r
   python3 eye.py eye.json     (the bpy module) writes web/models/eye.glb"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *
import bmesh as _bm

D = scan_load(sys.argv[1])
g = scan_frame(D, ["sclera_r"], 2.5)
f = lambda q: (lambda p: (p[2], p[1], -p[0]))(g(q))  # (turned so the front of the eye, the cornea, faces +x)
f.per_metre = g.per_metre
MUSCLES = [k for k in D if "muscle" in k]

reset()
SCLERA = material("sclera", srgb("#f1ebe1"), 0.0, 0.42, coat=0.4)
CHOROID = material("choroid", srgb("#5c2a22"), 0.0, 0.55, coat=0.2)
RETINA = material("retina", srgb("#d8843a"), 0.0, 0.48, coat=0.3)
VESSEL = material("retinal artery", srgb("#a3201c"), 0.0, 0.4, coat=0.3)
CORNEA = material("cornea", (0.9, 0.95, 1.0), 0.0, 0.02, coat=1.0, coat_rough=0.02, transmission=0.95, ior=1.376)
LENS = material("lens", (0.96, 0.95, 0.88), 0.0, 0.03, coat=1.0, coat_rough=0.02, transmission=0.92, ior=1.41)
IRIS = material("iris", srgb("#3b6f9e"), 0.0, 0.45, coat=0.6)
NERVE = material("optic nerve", srgb("#e6d29c"), 0.0, 0.5, coat=0.2)
MUSCLE = material("eye muscle", srgb("#b04a3e"), 0.0, 0.5, coat=0.2)

def quarter_cut(ob):
    """Take away the top quarter nearest the viewer (Cassie y > 0 and z > 0: Blender z > 0 and y < 0)."""
    bm = _bm.new(); bm.from_mesh(ob.data)
    for co, no in (((0, 0, 0), (0, 0, 1)), ((0, 0, 0), (0, 1, 0))):
        _bm.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], dist=1e-6, plane_co=co, plane_no=no)
    _bm.ops.delete(bm, geom=[fc for fc in bm.faces if fc.calc_center_median().z > 1e-4 and fc.calc_center_median().y < -1e-4], context="FACES")
    bm.to_mesh(ob.data); bm.free(); ob.data.update()
    return ob

def scaled(ob, k):
    for v in ob.data.vertices: v.co *= k
    return ob

quarter_cut(scan_obj("sclera", D, ["sclera_r"], f, SCLERA, part("sclera"), subdiv=3))
quarter_cut(scaled(scan_obj("choroid", D, ["retina_r"], f, CHOROID, part("choroid"), subdiv=3), 1.035))
rt = part("retina")
quarter_cut(scan_obj("retina", D, ["retina_r"], f, RETINA, rt, subdiv=3))
quarter_cut(scan_obj("retinal artery", D, ["central_retinal_artery_r"], f, VESSEL, rt, subdiv=1))
scan_obj("cornea", D, ["cornea_r"], f, CORNEA, part("cornea"), subdiv=3)
scan_obj("iris", D, ["iris_r"], f, IRIS, part("iris"), subdiv=3)
scan_obj("lens", D, ["lens_r"], f, LENS, part("lens"), subdiv=3)
scan_obj("optic nerve", D, ["optic_nerve_ii_r"], f, NERVE, part("opticnerve"), subdiv=2)
mu = part("muscles")
for k in MUSCLES:
    quarter_cut(scan_obj(k, D, [k], f, MUSCLE, mu, subdiv=2))

# the Labs' tissue look on everything but the glass (cornea, lens: kept clear)
tissue(lambda ob: None if ob.name in ("cornea", "lens") else ("muscular" if "muscle" in ob.name else "nervous" if "nerve" in ob.name or "retina" in ob.name else "visceral"), 1 / f.per_metre)
print("faces", sum(len(o.data.polygons) for o in bpy.data.objects if o.type == "MESH"))
export(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "web", "models", "eye.glb"))
print("wrote eye.glb")
