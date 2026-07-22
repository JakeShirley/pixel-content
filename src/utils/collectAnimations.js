import fs from 'fs';
import path from 'path';

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

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
 * Collect all animation metadata from assets/processed directory
 */
export async function collectAnimationMetadata(baseDir = './assets/processed', rotationDate = new Date()) {
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
          console.warn(`Skipping ${relPath}: parent directory must use WIDTHxHEIGHT naming`);
          return;
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

  const unixDayId = Math.floor(rotationDate.getTime() / MILLISECONDS_PER_DAY);

  // Sort buckets in standard order and rotate their contents once per UTC day.
  const sortedBuckets = {};
  for (const dim of standardDimensions) {
    if (buckets[dim]) {
      const items = buckets[dim].sort((left, right) => left.localeCompare(right));
      const offset = unixDayId % items.length;
      sortedBuckets[dim] = [...items.slice(offset), ...items.slice(0, offset)];
    }
  }
  for (const [dim, items] of Object.entries(buckets)) {
    if (!sortedBuckets[dim]) {
      items.sort((left, right) => left.localeCompare(right));
      const offset = unixDayId % items.length;
      sortedBuckets[dim] = [...items.slice(offset), ...items.slice(0, offset)];
    }
  }

  return {
    animations,
    buckets: sortedBuckets,
    schemaVersion: 1,
  };
}

export default collectAnimationMetadata;
