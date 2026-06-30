# Pixel Wall Content Tools

Tools for preparing, inspecting, and serving Pixel Wall dynamic animation content for Pixel Wall firmware.

## Tools

- `PixelWallAnimationConverter/`: browser-based GIF and `.bin` converter.
- `PixelWallAnimationSpriteSheet/`: command-line `.bin` decoder that writes PNG sprite sheets.
- `PixelWallContent/`: PowerShell cmdlets for inspecting `.bin` files and building the static content tree for GitHub Pages.
- `Serve-ContentUpdates.ps1`: local static server helper for testing Pixel Wall dynamic content updates.

## Dynamic Content Server Format

See `CONTENT_SERVER_FORMAT.md` for the HTTP routes, manifest syntax, asset naming rules, and firmware selection behavior expected by the Pixel Wall updater.
