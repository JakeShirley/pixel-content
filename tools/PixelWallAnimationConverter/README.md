# Pixel Wall Animation Editor

Static browser tool for editing and converting GIF, PNG, WebP, and raw Expressive Pixels animation sequences consumed by Pixel Wall firmware.

Open `index.html` in a browser, import a GIF, PNG, or WebP image, choose one of the fixed output sizes, position and scale the image in the output scene, choose a predictive encoding mode, and export a `.bin` file. Drag the image to move it, drag its lower-right handle to scale it, or use the X, Y, and Scale controls for exact placement. `Fit` shows the whole image and preserves empty scene space, while `Fill` covers the scene. PNG images are imported as a single frame. Animated WebP files retain their individual frames and timing in browsers that support the WebCodecs `ImageDecoder` API; static WebP files work in all browsers with WebP image support. Supported output sizes are 32 x 32, 32 x 64, 64 x 64, 64 x 32, 64 x 128, 128 x 64, and 128 x 128, with 64 x 64 selected by default. You can also import an existing `.bin` file to preview it, export the original `.bin` bytes losslessly, or recreate a paletted animated GIF from the decoded frame stream. Defaults are tuned for the Pixel Wall HUB75 player: 10 fps, 21 sampled frames, 128 colors, and predictive frame records.

Predictive encoding modes:

- `Auto, smaller file`: emits `P` records only when they are smaller than full `I` keyframes.
- `Prefer fewer pixel writes`: emits `P` records whenever fewer pixels changed than a full frame, even when that makes the file larger.
- `Keyframes only`: emits only full `I` keyframes.

The generated file layout is:

```text
10-byte little-endian sequence header
RGB palette bytes
I/P frame records with big-endian 16-bit frame fields
```

When a `.bin` file is imported, `Export .bin` preserves the original bytes for a lossless round trip. `Export GIF` reconstructs full frames from `I` key frames and `P` predictive frames, applies `D` delay records to GIF timing, ignores `F` fade records, and writes a full-frame GIF using the binary's palette. GIF export uses literal LZW chunks for correctness, so recreated GIFs can be larger than optimized GIFs. The `.bin` format does not store display geometry, so the importer auto-detects likely native or rotated dimensions from pixel continuity and also exposes a BIN geometry selector plus W/H swap override for manual correction.

The tool uses `gifuct-js` from jsDelivr at runtime to decode GIF frames. If the page is opened without internet access, serve or vendor that dependency first.

Copy exported files into the firmware data folder (`PixelWallFirmware/data/animations/`) and add them to `animations.lst` when they need an ID alias.