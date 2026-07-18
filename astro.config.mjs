import { defineConfig } from 'astro/config';
import pixelWallIntegration from './astro-integration.mjs';

export default defineConfig({
  site: 'https://jakeshirley.com',
  base: '/pixel-content',
  outDir: './_site',
  build: {
    format: 'file',
  },
  integrations: [pixelWallIntegration()],
});
