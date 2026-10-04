// Cassie landing page background — a living "marble" ShaderGradient
// (github.com/ruucm/shadergradient, MIT). Built as one IIFE bundle so the static
// landing page can mount it with window.CassieGradient.mount(el, options).
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ShaderGradientCanvas, ShaderGradient } from '@shadergradient/react';

const MARBLE = { // the "halo" preset, recoloured to Cassie's marble monochrome (ink · graphite · pearl)
  type: 'plane', animate: 'on', uSpeed: 0.22, uStrength: 4, uDensity: 1.3, uFrequency: 5.5, uAmplitude: 1, uTime: 0,
  positionX: -1.4, positionY: 0, positionZ: 0, rotationX: 0, rotationY: 10, rotationZ: 50,
  color1: '#18171e', color2: '#8e8a92', color3: '#f1ebe1', reflection: 0.1,
  cAzimuthAngle: 180, cPolarAngle: 90, cDistance: 3.6, cameraZoom: 1,
  lightType: '3d', brightness: 1.15, envPreset: 'city', grain: 'off',
};

function mount(el, opts = {}) {
  const props = { ...MARBLE, ...(opts.props || {}) };
  if (opts.still) props.animate = 'off';
  const root = createRoot(el);
  root.render(
    <ShaderGradientCanvas style={{ position: 'absolute', inset: 0 }} pixelDensity={opts.pixelDensity || 1} fov={45} pointerEvents="none" lazyLoad={false} powerPreference="low-power">
      <ShaderGradient control="props" {...props} />
    </ShaderGradientCanvas>
  );
  return { unmount: () => root.unmount() };
}

window.CassieGradient = { mount, MARBLE };
