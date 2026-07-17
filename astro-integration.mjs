import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { collectAnimationMetadata } from './src/utils/collectAnimations.js';

export default function pixelWallIntegration() {
  return {
    name: 'pixel-wall-content',
    hooks: {
      'astro:build:done': async ({ dir }) => {
        console.log('Post-build: Processing animation content...');

        const content = await collectAnimationMetadata('./assets/processed');
        
        // dir is a URL object, convert it to a proper file path
        const siteDir = fileURLToPath(dir);
        const animationsDir = path.join(siteDir, 'animations');
        const manifestDir = path.join(siteDir, 'manifest');

        // Create directories
        if (!fs.existsSync(animationsDir)) {
          fs.mkdirSync(animationsDir, { recursive: true });
        }
        if (!fs.existsSync(manifestDir)) {
          fs.mkdirSync(manifestDir, { recursive: true });
        }

        // Copy animation files
        console.log(`Copying ${content.animations.length} animation files...`);
        for (const animation of content.animations) {
          const srcPath = animation.sourcePath;
          const destPath = path.join(siteDir, animation.path);
          
          try {
            fs.copyFileSync(srcPath, destPath);
          } catch (err) {
            console.error(`Failed to copy ${srcPath}: ${err}`);
          }
        }

        // Generate manifest files
        console.log('Generating manifest files...');
        for (const [dimensions, names] of Object.entries(content.buckets)) {
          const manifestPath = path.join(manifestDir, dimensions);
          const manifestContent = names.join('\n') + '\n';
          fs.writeFileSync(manifestPath, manifestContent, 'utf-8');
          console.log(`  ${dimensions}: ${names.length} items`);
        }

        // Save content index JSON
        const contentIndexPath = path.join(siteDir, 'content-index.json');
        fs.writeFileSync(contentIndexPath, JSON.stringify(content, null, 2), 'utf-8');
        console.log('Saved content-index.json');

        console.log('Post-build steps completed successfully!');
      },
    },
  };
}
