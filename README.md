# ESP32 Content Tools

Tools for preparing, inspecting, and serving dynamic animation content for `CustomESP32Firmware`.

## Tools

- `ESP32AnimationConverter/`: browser-based GIF and `.bin` converter.
- `ESP32AnimationSpriteSheet/`: command-line `.bin` decoder that writes PNG sprite sheets.
- `Serve-ContentUpdates.ps1`: local static server helper for testing ESP32 dynamic content updates.

## Dynamic Content Server Format

See `CONTENT_SERVER_FORMAT.md` for the HTTP routes, manifest syntax, asset naming rules, and firmware selection behavior expected by the ESP32 updater.
