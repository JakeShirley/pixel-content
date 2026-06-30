# ESP32 Content PowerShell Tools

PowerShell cmdlets for inspecting Expressive Pixels ESP32 `.bin` animations and building the static content tree consumed by `update-now`.

## Inspect a `.bin`

```powershell
Import-Module .\tools\ESP32Content\ESP32Content.psm1
Get-ESP32AnimationBinInfo .\assets\processed\tiny-jens.bin | Format-List
```

The cmdlet validates the 10-byte header, palette, frame records, frame count, palette indexes, and pixel positions. It outputs frame count, FPS, palette size, byte counts, record counts, total pixels, and inferred dimensions.

The `.bin` format stores pixel count, not orientation. Square animations are inferred automatically. For non-square animations, provide dimensions explicitly:

```powershell
Get-ESP32AnimationBinInfo .\assets\processed\wide-badge.bin -Dimensions 64x32
```

## Build the Pages content tree

```powershell
Import-Module .\tools\ESP32Content\ESP32Content.psm1
Publish-ESP32AnimationContent -InputPath .\assets\processed -OutputPath .\_site -Clean -PassThru
```

The publisher writes:

```text
_site/
  animations/<name>.bin
  manifest/<dimensions>
  content-index.json
```

Manifest files follow `CONTENT_SERVER_FORMAT.md`: each `manifest/<dimensions>` file contains the animation names for that display size, and the firmware downloads raw bytes from `animations/<name>.bin`.

For non-square animations, add `assets/processed/dimensions.json`:

```json
{
  "wide-badge": "64x32",
  "tall-badge.bin": "32x64"
}
```

Keys can be either the asset stem or file name.