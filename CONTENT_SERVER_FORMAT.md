# ESP32 Dynamic Content Server Format

This document describes the HTTP data shape consumed by `CustomESP32Firmware` when the device runs `update-now`.

## Base URL

The updater starts from a configured or command-provided base URL:

```text
update-now http://192.168.1.10:8000
```

The base URL must use `http://` or `https://`. HTTPS certificate validation is not enforced by the firmware, so prefer trusted LAN or application-level controls if this leaves a lab environment.

## Required Static Layout

The default server layout is:

```text
manifest/<dimensions>
animations/<name>.bin
```

For a 64 x 64 display, the firmware fetches:

```text
GET /manifest/64x64
GET /animations/<name>.bin
```

The manifest path is configurable in firmware with `CUSTOM_CONTENT_MANIFEST_PATH`. By default the path is `/manifest` and the firmware appends the current display dimensions. If the path contains `{dimensions}`, the firmware replaces that token instead:

```text
/api/manifests/{dimensions} -> /api/manifests/64x64
```

Both manifest and animation requests must return HTTP 200. The animation response body must be the raw `.bin` bytes, not JSON or base64.

## Manifest File

The manifest is a plain text file. Keep it ASCII or UTF-8 without requiring a BOM.

Rules:

- Maximum manifest body size is 8192 bytes.
- Lines may end with LF or CRLF.
- Leading and trailing whitespace on each line is ignored.
- Empty lines are ignored.
- Lines whose first non-whitespace character is `#` are comments.
- Each non-comment line is either `<name>` or legacy `<name>,<dimensions>`.
- More than one comma on a content line is invalid.

Preferred manifest:

```text
# 64x64 animations
new-demo
second-demo
```

Legacy manifest with explicit dimensions:

```text
new-demo,64x64
second-demo,64x64
```

The dimensions field, when present, must use lowercase `x`, such as `64x64`, and must match the current device display dimensions. Because the route is already display-specific, new servers should omit the dimensions field in each line.

## Content Names

`<name>` is the remote asset stem and playback alias, not the final on-device filename.

Valid names:

- 1 to 96 characters.
- Only `A-Z`, `a-z`, `0-9`, `_`, and `-`.
- Must not include `.bin`.
- Must not contain slashes, spaces, commas, dots, query strings, or URL fragments.

For a manifest entry named `new-demo`, the updater downloads:

```text
animations/new-demo.bin
```

After installation, the firmware stores the bytes in the fixed local slot:

```text
/animations/download.bin
```

It also writes this local alias manifest:

```text
/animations/updates.lst
download.bin,new-demo
```

Users can then play the downloaded animation by name:

```text
play-loop new-demo
```

## Animation Binary

Each `.bin` file must use the Expressive Pixels animation sequence format consumed by the firmware player:

```text
10-byte little-endian sequence header
RGB palette bytes
I/P frame records with big-endian 16-bit frame fields
optional D delay and F fade action records
```

The firmware validates the downloaded file before promotion. Empty files, malformed headers, invalid palette/frame streams, or unsupported records fail the update and leave the previous downloaded slot intact.

## Selection Behavior

The device does not ask the server for one specific index. Instead, the server returns a display-specific manifest and the device chooses locally.

- `image_index` is a persistent zero-based device config value.
- The default index is `0`.
- If the index is greater than the number of valid manifest entries, it wraps with modulo arithmetic.
- Comment and blank lines do not count as entries.

For this manifest:

```text
new-demo
second-demo
third-demo
```

`image_index=4` selects `second-demo`.

## Caching and Updates

The updater stores the last fetched manifest at:

```text
/animations/update-manifest.txt
```

If the downloaded slot exists, the remote manifest text is byte-for-byte unchanged, and the selected manifest entry maps to the same name, the updater skips the download. Changing comments or whitespace changes the manifest text and can force a re-download even if the selected entry is unchanged.

## Example Server Tree

```text
content-root/
  manifest/
    64x64
    32x32
  animations/
    new-demo.bin
    second-demo.bin
    badge-32.bin
```

`content-root/manifest/64x64`:

```text
new-demo
second-demo
```

`content-root/manifest/32x32`:

```text
badge-32
```

When serving this tree at `http://192.168.1.10:8000`, a 64 x 64 ESP32 running `update-now http://192.168.1.10:8000` downloads either `animations/new-demo.bin` or `animations/second-demo.bin` depending on `image_index`.
