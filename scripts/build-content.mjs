#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { collectAnimationMetadata } from '../src/utils/collectAnimations.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function build() {
  console.log('Building Pixel Wall Animation Content...');

  // Collect animation metadata
  console.log('Collecting animation metadata...');
  const content = await collectAnimationMetadata('./assets/processed');

  // Output directories (Astro will create _site during build)
  // We'll populate these after Astro builds, or we can use Astro's onBuild hook
  // For now, we'll just collect and save the metadata to public/
  const publicDir = './public';
  
  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
  }

  // Save content index JSON in public directory (for reference/API)
  const contentIndexPath = path.join(publicDir, 'content-index.json');
  fs.writeFileSync(contentIndexPath, JSON.stringify(content, null, 2), 'utf-8');
  console.log('Saved content-index.json to public/');

  console.log('Pre-build steps completed successfully!');
  return content;
}

build().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
