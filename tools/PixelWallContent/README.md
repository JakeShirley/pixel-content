# Pixel Wall Content PowerShell Tools

PowerShell cmdlets for inspecting Pixel Wall `.bin` animations and building the static content tree consumed by `update-now`.

## Inspect a `.bin`

```powershell
Import-Module .\tools\PixelWallContent\PixelWallContent.psm1
Get-PixelWallAnimationBinInfo .\assets\processed\tiny-jens.bin | Format-List
```

The cmdlet validates the 10-byte header, palette, frame records, palette indexes, and pixel positions. It outputs renderable frame count, declared header frame count, FPS, palette size, byte counts, record counts, total pixels, and inferred dimensions.

The `.bin` format stores pixel count, not orientation. Square animations and known native Pixel Wall panel sizes are inferred automatically. For custom non-square animations, provide dimensions explicitly:

```powershell
Get-PixelWallAnimationBinInfo .\assets\processed\wide-badge.bin -Dimensions 64x32
```

## Build the Pages content tree

```powershell
Import-Module .\tools\PixelWallContent\PixelWallContent.psm1
Publish-PixelWallAnimationContent -InputPath .\assets\processed -OutputPath .\_site -Clean -PassThru
```

The publisher writes:

```text
_site/
  index.html
  animations/<name>.bin
  manifest/<dimensions>
  content-index.json
```

Manifest files follow `CONTENT_SERVER_FORMAT.md`: each `manifest/<dimensions>` file contains the animation names for that display size, and the firmware downloads raw bytes from `animations/<name>.bin`. The generated `index.html` lists the manifests in bucket order, keeps each manifest list in order, shows zero-based `image_index` values, and renders browser previews from the deployed `.bin` bytes.

