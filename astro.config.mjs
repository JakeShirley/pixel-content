import { defineConfig } from 'astro/config';
import pixelWallIntegration from './astro-integration.mjs';

export default defineConfig({
  outDir: './_site',
  build: {
    format: 'file',
  },
  integrations: [pixelWallIntegration()],
});
