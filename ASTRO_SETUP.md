# Pixel Wall Content - Astro Setup

This project uses [Astro](https://astro.build/) for static site generation. Animation assets remain in `assets/processed/` and are copied to the final build output during the Astro build process.

## Local Development

### Prerequisites
- Node.js 18+ 
- npm or equivalent package manager

### Installation

```bash
npm install
```

### Development Server

```bash
npm run dev
```

Starts a local development server at `http://localhost:3000` with hot reload enabled.

### Production Build

```bash
npm run build
```

The build process:
1. Astro generates the static site in `_site/`
2. The Astro integration runs a post-build hook that:
   - Collects animation metadata from `assets/processed/`
   - Copies .bin files directly to `_site/animations/`
   - Generates manifest files in `_site/manifest/`
   - Saves `content-index.json` for reference

**Key Point**: Animation assets stay in `assets/processed/` throughout the process. They are only copied to `_site/` as part of the final build output and are not moved or duplicated elsewhere on disk.

Output structure:
```
_site/
  index.html              # Main gallery page
  content-index.json      # Animation metadata
  animations/             # .bin animation files (copied from assets/processed/)
  manifest/               # Dimension-based manifests (generated)
  converter/              # Web-based animation converter
  _astro/                 # Generated CSS and JS assets
```

### Preview Build

```bash
npm run preview
```

Serve the built site locally for testing before deployment.

## Project Structure

```
assets/processed/         # Source animation .bin files (organized by dimensions)
  32x32/
  32x64/
  64x32/
  64x64/
  128x64/
  128x128/
src/
  pages/
    index.astro           # Main gallery page
  layouts/
    Layout.astro          # Page layout with styling
  components/
    AnimationCard.astro   # Animation card component
  utils/
    collectAnimations.js  # Animation metadata collection
astro-integration.mjs     # Astro integration for post-build processing
astro.config.mjs          # Astro configuration
tools/
  PixelWallAnimationConverter/  # Web-based animation editor
  PixelWallContent/             # PowerShell utilities (legacy, for reference)
```

## Key Components

### AnimationCard.astro
Renders individual animation cards with:
- Canvas preview (rendered client-side)
- "Open in Converter" link for editing
- Animation metadata (dimensions, fps, colors, size)

### collectAnimations.js
- Walks the `assets/processed/` directory
- Parses .bin file headers to extract metadata
- Groups animations by dimensions
- Returns structured JSON for page generation

### astro-integration.mjs
Astro integration that runs after the build (`astro:build:done` hook) to:
- Collect animation metadata
- Copy .bin files to `_site/animations/`
- Generate manifest files in `_site/manifest/`
- Save `content-index.json` for reference

This approach keeps animation files in one location (`assets/processed/`) and only copies them to the final output during the build.

## GitHub Pages Deployment

The GitHub Actions workflow automatically:
1. Installs Node.js dependencies
2. Runs `npm run build` to generate the static site (including post-build integration)
3. Copies the converter tool
4. Deploys to GitHub Pages

See `.github/workflows/deploy-content-pages.yml` for workflow details.

## Gitignore

The following directories are automatically gitignored (build artifacts):
- `_site/` - Build output
- `public/` - Temporary Astro public directory (not used in this setup)
- `node_modules/` - npm dependencies
- `.astro/` - Astro cache

Animation source files in `assets/processed/` are committed to git and stay in place.

## Migration from PowerShell

Previous workflow used `Publish-PixelWallAnimationContent` PowerShell cmdlet. The Astro-based approach provides:
- Cross-platform compatibility (Windows, macOS, Linux)
- Better integration with web ecosystem tools
- Cleaner component-based architecture
- Simpler deployment pipeline (Node.js only, no PowerShell needed in CI)
- Assets stay in one location and are not moved during build

The PowerShell module in `tools/PixelWallContent/` is retained for reference and local CLI usage.
