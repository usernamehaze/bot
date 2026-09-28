# Cassie 3D — glossy-pink loading screen + multi-emotion bot

A React app (React Three Fiber + drei + Framer Motion + Tailwind) with:

- **Screen 1 — Loading / Landing:** a rotating 3D wireframe orbit/mandala with a
  glowing glossy-pink core, a pulsing `Cassie ✦ / thinking…` title, and
  tap-to-enter.
- **Screen 2 — Bot interface:** a white matte-ceramic 3D robot ("Cassie") with
  glossy-pink emissive eyes and chest core, switching between **5 emotions**
  (Ready, Thinking, Encouraging, Celebrating, Curious) via a responsive button
  grid. Poses animate smoothly (arms, head tilt, jump), with star eyes + confetti
  for Celebrating and floating status icons for Thinking/Curious.

## Materials & render rules
- Body: `MeshPhysicalMaterial` white ceramic (`roughness 0.2`, `metalness 0.1`).
- Glowing parts (eyes, core, rings): `MeshPhysicalMaterial` neon pink
  (`#FF1493`) with high `emissiveIntensity` + `transmission`, plus a Bloom pass.
- Lighting: drei `<Environment preset="city" />` + a directional pink light with
  soft shadows (`ContactShadows` / PCF soft shadows).

## Run it

```bash
cd cassie-3d
npm install
npm run dev        # local dev server
npm run build      # production build → dist/
npm run preview    # preview the build
```

## Deploy
The build is fully static (`dist/`). Point Cloudflare Pages / Netlify at this
folder with build command `npm run build` and output directory `dist`, or copy
`dist/` somewhere under the existing site.

> Note: `<Environment preset="city" />` fetches a small HDR at runtime, so the
> first load needs network access. Swap it for a bundled HDR or a plain
> `<hemisphereLight>` if you need fully offline lighting.
