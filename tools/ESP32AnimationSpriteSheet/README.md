# ESP32 Animation Sprite Sheet

Command-line inspection tool for Expressive Pixels ESP32 `.bin` animation files. It decodes the same 10-byte header, RGB palette, `I` keyframe records, and `P` predictive records used by `CustomESP32Firmware`, then writes a PNG sprite sheet for visual inspection.

## Usage

From this directory:

```powershell
python .\dump_animation_spritesheet.py ..\..\CustomESP32Firmware\data\animations\jeb-tiny-jens.bin --width 64 --height 64 --scale 4
```

Or from the repo root:

```powershell
python .\ContentTools\ESP32AnimationSpriteSheet\dump_animation_spritesheet.py .\CustomESP32Firmware\data\animations\jeb-tiny-jens.bin --width 64 --height 64 --scale 4
```

By default the tool writes `<input>-spritesheet.png` beside the source `.bin`. Use `--output` to put the PNG somewhere else:

```powershell
python .\ContentTools\ESP32AnimationSpriteSheet\dump_animation_spritesheet.py .\CustomESP32Firmware\data\animations\jeb-tiny-jens.bin --output .\jeb-tiny-jens-spritesheet.png --width 64 --height 64
```

Useful options:

```text
--width 64 --height 64   Frame dimensions. Required unless the first keyframe is square.
--columns 7              Number of frames per sprite-sheet row.
--scale 4                Nearest-neighbor pixel scale.
--gap 1                  Gap between frames, in output pixels.
--no-grid                Disable gaps between frames.
--grid-color #3f3a32     Gap/background color.
```

The `.bin` format does not store frame width or height, only pixel counts and pixel positions. Pass `--width` and `--height` for non-square animations.