import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { collectAnimationMetadata } from './src/utils/collectAnimations.js';

export default function pixelWallIntegration() {
  return {
    name: 'pixel-wall-content',
    hooks: {
      'astro:server:setup': async ({ server }) => {
        const content = await collectAnimationMetadata('./assets/processed');
        const animations = new Map(
          content.animations.map((animation) => [`/${animation.path}`, animation.sourcePath]),
        );
        const manifests = new Map(
          Object.entries(content.buckets).map(([dimensions, names]) => [
            `/manifest/${dimensions}`,
            `${names.join('\n')}\n`,
          ]),
        );
        const converterDir = path.resolve('tools/PixelWallAnimationConverter');
        const contentTypes = new Map([
          ['.css', 'text/css; charset=utf-8'],
          ['.html', 'text/html; charset=utf-8'],
          ['.js', 'text/javascript; charset=utf-8'],
        ]);

        server.middlewares.use((request, response, next) => {
          const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
          const animationPath = animations.get(pathname);

          if (animationPath) {
            response.setHeader('Content-Type', 'application/octet-stream');
            fs.createReadStream(animationPath).pipe(response);
            return;
          }

          const manifest = manifests.get(pathname);
          if (manifest) {
            response.setHeader('Content-Type', 'text/plain; charset=utf-8');
            response.end(manifest);
            return;
          }

          if (pathname === '/converter' || pathname.startsWith('/converter/')) {
            const relativePath = pathname.replace(/^\/converter\/?/, '') || 'index.html';
            const filePath = path.resolve(converterDir, relativePath);
            const relativeFilePath = path.relative(converterDir, filePath);

            if (!relativeFilePath.startsWith('..') && !path.isAbsolute(relativeFilePath) && fs.existsSync(filePath)) {
              response.setHeader(
                'Content-Type',
                contentTypes.get(path.extname(filePath)) ?? 'application/octet-stream',
              );
              fs.createReadStream(filePath).pipe(response);
              return;
            }
          }

          next();
        });
      },
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
