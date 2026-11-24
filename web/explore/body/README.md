# The 3D human body

These models and names are **not** Cassie's own work, and they keep their licences:

- **Z-Anatomy — The libre 3D atlas of anatomy**, CC BY-SA 4.0, based on **BodyParts3D,
  © The Database Center for Life Science**, CC BY-SA 2.1 Japan.
- Kidneys and ureters: **Human Reference Atlas** 3D reference organs (CC BY 4.0).
- Ear: **OpenEar** (CC BY 4.0).
- Prepared as release 1.1.0 of the **Svitylo 3D Anatomy Atlas** data (`@authorod/svitylo-3d-anatomy-data`).

`ATTRIBUTION.md` and `LICENSES.md` are copied unchanged from that release. `index.json` is
made from its manifest and English and Latin name lists (only the systems Cassie shows), so it
is shared under the same CC BY-SA 4.0 licence. The `.glb` files are the release's "economy"
quality, unchanged.

## The girl's body

The scanned atlas is one adult male body. For the **Girl** switch, Cassie draws the female
parts herself in `explore/body3d.js` (uterus, cervix, uterine tubes, ovaries, vagina, a
female urethra, and breasts with milk glands, ducts, nipple and areola), shaped to textbook
sizes and placed from the atlas's own bladder and chest. They are simplified models, not
scans; the bones and the rest of the body are the same atlas body.

## What each part does

`explore/body-facts.js` holds Cassie's short explanations (what a part is, and what it does)
for the main organs, bones, muscles, vessels and nerves. Parts it only knows by kind are
explained by Cassie's AI when tapped (and kept on the device).
