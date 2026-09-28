import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Builds the mascot as one self-contained IIFE bundle with stable filenames
// (cassie-mascot.js / .css) so the vanilla app can reference it directly.
export default defineConfig({
  plugins: [react()],
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    outDir: 'dist-mascot',
    emptyOutDir: true,
    cssCodeSplit: false,
    lib: {
      entry: 'src/mascot.jsx',
      name: 'CassieMascotBundle',
      formats: ['iife'],
      fileName: () => 'cassie-mascot.js',
    },
    rollupOptions: {
      output: { assetFileNames: 'cassie-mascot.[ext]' },
    },
  },
});
