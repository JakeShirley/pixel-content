import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Read binary animation file and extract metadata
 */
function readAnimationMetadata(filePath) {
  const buffer = fs.readFileSync(filePath);
  
  if (buffer.length < 10) {
    throw new Error(`File too small: ${filePath}`);
  }

  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  
  // Read header
  const frameCount = view.getUint16(0, true);
  const loopCount = buffer[2];
  const fps = buffer[3];
  const paletteBytes = view.getUint16(4, true);
  const frameBytes = view.getUint32(6, true);
  
  if (frameCount === 0 || fps === 0 || paletteBytes === 0 || paletteBytes % 3 !== 0) {
    throw new Error(`Invalid header in ${filePath}`);
  }

  const paletteColors = Math.floor(paletteBytes / 3);
  const declaredSize = 10 + paletteBytes + frameBytes;
  const actualSize = buffer.length;

  return {
    frameCount,
    loopCount,
    fps,
    paletteColors,
    bytes: actualSize,
    declaredSize,
  };
}

/**
 * Infer animation dimensions from pixel count and frame structure
 */
function inferDimensions(pixelCount) {
  // Standard Pixel Wall panel sizes
  const standardSizes = [
    { width: 32, height: 32 },
    { width: 32, height: 64 },
    { width: 64, height: 32 },
    { width: 64, height: 64 },
    { width: 64, height: 128 },
    { width: 128, height: 64 },
    { width: 128, height: 128 },
  ];

  // Find exact match
  for (const size of standardSizes) {
    if (size.width * size.height === pixelCount) {
      return size;
    }
  }

  // Fallback to square
  const side = Math.sqrt(pixelCount);
  if (Number.isInteger(side)) {
    return { width: side, height: side };
  }

  return null;
}

/**
 * Collect all animation metadata from assets/processed directory
 */
export async function collectAnimationMetadata(baseDir = './assets/processed') {
  const animations = [];
  const buckets = {};
  const standardDimensions = ['32x32', '32x64', '64x32', '64x64', '64x128', '128x64', '128x128'];

  function walkDir(dir, relativePath = '') {
    if (!fs.existsSync(dir)) {
      return;
    }

    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relPath = path.join(relativePath, entry.name);

      if (entry.isDirectory()) {
        // Check if this is a dimensions folder
        const dimensionsMatch = entry.name.match(/^(\d+)x(\d+)$/);
        walkDir(fullPath, relPath);
      } else if (entry.name.endsWith('.bin')) {
        const fileName = path.basename(entry.name, '.bin');
        const parentDir = path.basename(path.dirname(fullPath));
        const dimensionsMatch = parentDir.match(/^(\d+)x(\d+)$/);

        let width, height;
        if (dimensionsMatch) {
          width = parseInt(dimensionsMatch[1], 10);
          height = parseInt(dimensionsMatch[2], 10);
        } else {
          // Try to infer from file
          try {
            const meta = readAnimationMetadata(fullPath);
            const inferredDim = inferDimensions(width * height || 4096);
            if (!inferredDim) {
              console.warn(`Could not infer dimensions for ${relPath}`);
              return;
            }
            width = inferredDim.width;
            height = inferredDim.height;
          } catch (err) {
            console.warn(`Skipping ${relPath}: ${err.message}`);
            return;
          }
        }

        try {
          const metadata = readAnimationMetadata(fullPath);
          const dimensions = `${width}x${height}`;
          const publishedName = `${dimensions}_${fileName}`;

          const animation = {
            name: fileName,
            publishedName,
            dimensions,
            width,
            height,
            frames: metadata.frameCount,
            fps: metadata.fps,
            paletteColors: metadata.paletteColors,
            bytes: metadata.bytes,
            path: `animations/${publishedName}.bin`,
            sourcePath: `assets/processed/${relPath}`,
          };

          animations.push(animation);

          // Organize by dimensions
          if (!buckets[dimensions]) {
            buckets[dimensions] = [];
          }
          buckets[dimensions].push(publishedName);
        } catch (err) {
          console.warn(`Skipping ${relPath}: ${err.message}`);
        }
      }
    }
  }

  walkDir(baseDir);

  // Sort buckets in standard order
  const sortedBuckets = {};
  for (const dim of standardDimensions) {
    if (buckets[dim]) {
      sortedBuckets[dim] = buckets[dim];
    }
  }
  for (const [dim, items] of Object.entries(buckets)) {
    if (!sortedBuckets[dim]) {
      sortedBuckets[dim] = items;
    }
  }

  return {
    animations,
    buckets: sortedBuckets,
    schemaVersion: 1,
  };
}

export default collectAnimationMetadata;
