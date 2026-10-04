import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The gradient background + the 3D mascot as ONE self-contained IIFE bundle
// (mascot3d/cassie-3d.js) for the app and the landing page.
export default defineConfig({
  plugins: [react()],
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    outDir: 'dist-bundle',
    emptyOutDir: true,
    cssCodeSplit: false,
    lib: { entry: 'src/cassie3d.jsx', name: 'Cassie3DBundle', formats: ['iife'], fileName: () => 'cassie-3d.js' },
    rollupOptions: { external: ['framer'], output: { globals: { framer: 'Framer' }, assetFileNames: 'cassie-3d.[ext]' } },
  },
});
