import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: {
    // One React for the app and the workspace-linked svg-renderer package.
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    // The workspace packages are CommonJS and reached through symlinks, which Vite serves as
    // source instead of pre-bundling; listing them here makes esbuild convert them to ESM.
    // Apps that install svg-renderer from npm do not need this.
    include: ['svg-renderer/web', 'svg-core'],
  },
  server: {
    fs: {
      // The fixtures are shared with the React Native example one directory up.
      allow: ['..'],
    },
  },
});
