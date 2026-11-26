# Cassie's 3D models

Made in Blender by the scripts in `scripts/blender/` and packed small with `scripts/blender/pack.mjs`
(meshopt compression, read by the app with `explore/meshopt_decoder.module.js`).

## Made from real anatomy (CC BY-SA 4.0)

`heart.glb`, `lungs.glb`, `eye.glb` and the cerebellum and brain stem in `brain.glb` are made from the
scanned body that the Labs' 3D body shows (`explore/body/`, see its `README.md`, `ATTRIBUTION.md` and
`LICENSES.md`):

- **Z-Anatomy — The libre 3D atlas of anatomy**, CC BY-SA 4.0, based on **BodyParts3D,
  © The Database Center for Life Science**, CC BY-SA 2.1 Japan.
- As prepared by release 1.1.0 of the **Svitylo 3D Anatomy Atlas** data.

Changes: the parts were taken out of the atlas (`scripts/blender/scan_extract.mjs`), smoothed
(subdivided and relaxed), coloured, cut open where the book shows the inside (the eye), trimmed (the
vena cava, the diaphragm's crura), and given added parts that are Cassie's own (the alveoli clusters,
the eye's choroid layer). These four model files are shared under the same licence,
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).

The brain's two hemispheres, `skin.glb`, `airplane.glb`, `bicycle.glb` and `dragon.glb` are Cassie's own,
built from shapes in Blender.
