import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base: './' so the build can be hosted from any sub-path (e.g. /cassie-3d/)
export default defineConfig({
  plugins: [react()],
  base: './',
});
