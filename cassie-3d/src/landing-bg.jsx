// Cassie's living gradient background (github.com/ruucm/shadergradient, MIT).
// window.CassieGradient.mount(el, { props, still, pixelDensity }) → { update(props), unmount() }
// update() glides between colour sets, so picking a new favourite colour flows smoothly.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ShaderGradientCanvas, ShaderGradient } from '@shadergradient/react';
import { Color } from 'three';

const MARBLE = { // the "halo" preset, recoloured to Cassie's marble monochrome (ink · graphite · pearl)
  type: 'plane', animate: 'on', uSpeed: 0.22, uStrength: 4, uDensity: 1.3, uFrequency: 5.5, uAmplitude: 1, uTime: 0,
  positionX: -1.4, positionY: 0, positionZ: 0, rotationX: 0, rotationY: 10, rotationZ: 50,
  color1: '#18171e', color2: '#8e8a92', color3: '#f1ebe1', reflection: 0.1,
  cAzimuthAngle: 180, cPolarAngle: 90, cDistance: 3.6, cameraZoom: 1,
  lightType: '3d', brightness: 1.15, envPreset: 'city', grain: 'off',
};

function mount(el, opts = {}) {
  let props = { ...MARBLE, ...(opts.props || {}) };
  if (opts.still) props.animate = 'off';
  const root = createRoot(el);
  const draw = () => root.render(
    <ShaderGradientCanvas style={{ position: 'absolute', inset: 0 }} pixelDensity={opts.pixelDensity || 1} fov={45} pointerEvents="none" lazyLoad={false} powerPreference="low-power">
      <ShaderGradient control="props" {...props} />
    </ShaderGradientCanvas>
  );
  draw();
  let anim = 0;
  function update(next = {}) {
    cancelAnimationFrame(anim);
    const keys = ['color1', 'color2', 'color3'];
    const from = keys.map((k) => new Color(props[k])), to = keys.map((k) => new Color(next[k] || props[k]));
    const rest = { ...next }; keys.forEach((k) => delete rest[k]);
    props = { ...props, ...rest };
    const t0 = performance.now(), dur = opts.still ? 0 : 700;
    const step = (now) => {
      const k = dur ? Math.min(1, (now - t0) / dur) : 1, e = k * k * (3 - 2 * k);
      keys.forEach((key, i) => { props[key] = '#' + from[i].clone().lerp(to[i], e).getHexString(); });
      draw();
      if (k < 1) anim = requestAnimationFrame(step);
    };
    anim = requestAnimationFrame(step);
  }
  return { update, unmount: () => { cancelAnimationFrame(anim); root.unmount(); } };
}

window.CassieGradient = { mount, MARBLE };
