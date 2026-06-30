#!/usr/bin/env python3
"""Render ESP32 Expressive Pixels .bin animations as PNG sprite sheets."""

from __future__ import annotations

import argparse
import binascii
import math
import struct
import zlib
from dataclasses import dataclass
from pathlib import Path


HEADER_BYTES = 10
DEFAULT_SCALE = 4
DEFAULT_GAP = 1
DEFAULT_GRID = "#3f3a32"


@dataclass
class AnimationMeta:
    frame_count: int
    loop_count: int
    fps: int
    palette_bytes: int
    frame_bytes: int


@dataclass
class DecodedAnimation:
    meta: AnimationMeta
    palette: list[tuple[int, int, int]]
    frames: list[list[int]]
    op_counts: dict[str, int]
    total_pixels: int


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Decode an ESP32 Expressive Pixels animation .bin and write a PNG sprite sheet."
    )
    parser.add_argument("input", type=Path, help="Animation .bin file to decode.")
    parser.add_argument("--output", "-o", type=Path, help="Output PNG path. Default: <input>-spritesheet.png")
    parser.add_argument("--width", type=int, help="Frame width. Default: infer square dimensions from first keyframe.")
    parser.add_argument("--height", type=int, help="Frame height. Default: infer square dimensions from first keyframe.")
    parser.add_argument("--columns", type=int, help="Sprite sheet columns. Default: ceil(sqrt(frame count)).")
    parser.add_argument("--scale", type=int, default=DEFAULT_SCALE, help=f"Nearest-neighbor scale. Default: {DEFAULT_SCALE}.")
    parser.add_argument("--gap", type=int, default=DEFAULT_GAP, help=f"Gap between frames in output pixels. Default: {DEFAULT_GAP}.")
    parser.add_argument("--grid-color", default=DEFAULT_GRID, help=f"Gap/background RGB hex color. Default: {DEFAULT_GRID}.")
    parser.add_argument("--no-grid", action="store_true", help="Disable gaps between frames.")
    return parser.parse_args()


def read_u16le(data: bytes, offset: int) -> int:
    return data[offset] | (data[offset + 1] << 8)


def read_u32le(data: bytes, offset: int) -> int:
    return data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24)


def read_u16be(data: bytes, offset: int) -> int:
    return (data[offset] << 8) | data[offset + 1]


def parse_hex_color(value: str) -> tuple[int, int, int]:
    text = value.strip().lstrip("#")
    if len(text) != 6:
        raise ValueError(f"expected 6-digit RGB hex color, got {value!r}")
    return tuple(int(text[index : index + 2], 16) for index in range(0, 6, 2))


def infer_dimensions(total_pixels: int) -> tuple[int, int]:
    side = math.isqrt(total_pixels)
    if side * side == total_pixels:
        return side, side
    raise ValueError(
        f"cannot infer dimensions for {total_pixels} pixels; pass --width and --height"
    )


def require_available(data: bytes, offset: int, length: int, context: str) -> None:
    if offset + length > len(data):
        raise ValueError(f"truncated {context} at byte {offset}")


def decode_animation(path: Path, width: int | None, height: int | None) -> DecodedAnimation:
    data = path.read_bytes()
    if len(data) < HEADER_BYTES:
        raise ValueError("file is smaller than the 10-byte animation header")

    meta = AnimationMeta(
        frame_count=read_u16le(data, 0),
        loop_count=data[2],
        fps=data[3],
        palette_bytes=read_u16le(data, 4),
        frame_bytes=read_u32le(data, 6),
    )
    if meta.palette_bytes == 0 or meta.palette_bytes % 3 != 0:
        raise ValueError(f"invalid palette byte count: {meta.palette_bytes}")

    expected_size = HEADER_BYTES + meta.palette_bytes + meta.frame_bytes
    if expected_size > len(data):
        raise ValueError(f"header declares {expected_size} bytes, but file has {len(data)}")

    palette_start = HEADER_BYTES
    frame_start = palette_start + meta.palette_bytes
    palette = [
        (data[offset], data[offset + 1], data[offset + 2])
        for offset in range(palette_start, frame_start, 3)
    ]

    total_pixels = width * height if width and height else 0
    offset = frame_start
    end = frame_start + meta.frame_bytes
    frames: list[list[int]] = []
    current: list[int] | None = None
    op_counts = {"I": 0, "P": 0, "D": 0, "F": 0}

    while offset < end:
        opcode = data[offset]
        offset += 1

        if opcode == ord("I"):
            require_available(data, offset, 2, "keyframe pixel count")
            pixel_count = read_u16be(data, offset)
            offset += 2
            if total_pixels == 0:
                total_pixels = pixel_count
            if pixel_count > total_pixels:
                raise ValueError(f"keyframe has {pixel_count} pixels, expected at most {total_pixels}")
            require_available(data, offset, pixel_count, "keyframe pixels")
            next_frame = list(current) if current is not None else [0] * total_pixels
            for pixel in range(pixel_count):
                palette_index = data[offset + pixel]
                if palette_index >= len(palette):
                    raise ValueError(f"palette index {palette_index} out of range in keyframe {len(frames)}")
                next_frame[pixel] = palette_index
            offset += pixel_count
            frames.append(next_frame)
            current = next_frame
            op_counts["I"] += 1
        elif opcode == ord("P"):
            if current is None:
                raise ValueError("predictive frame encountered before any keyframe")
            require_available(data, offset, 2, "predictive pixel count")
            change_count = read_u16be(data, offset)
            offset += 2
            position_bytes = 2 if total_pixels > 256 else 1
            require_available(data, offset, change_count * (position_bytes + 1), "predictive pixels")
            next_frame = list(current)
            for _ in range(change_count):
                if position_bytes == 2:
                    position = read_u16be(data, offset)
                    offset += 2
                else:
                    position = data[offset]
                    offset += 1
                palette_index = data[offset]
                offset += 1
                if position >= total_pixels:
                    raise ValueError(f"pixel position {position} out of range in predictive frame {len(frames)}")
                if palette_index >= len(palette):
                    raise ValueError(f"palette index {palette_index} out of range in predictive frame {len(frames)}")
                next_frame[position] = palette_index
            frames.append(next_frame)
            current = next_frame
            op_counts["P"] += 1
        elif opcode == ord("D"):
            require_available(data, offset, 2, "delay action")
            offset += 2
            op_counts["D"] += 1
        elif opcode == ord("F"):
            require_available(data, offset, 2, "fade action")
            offset += 2
            op_counts["F"] += 1
        else:
            raise ValueError(f"unknown record type 0x{opcode:02x} at frame byte {offset - frame_start - 1}")

    if not frames:
        raise ValueError("animation contains no renderable frames")
    if meta.frame_count != len(frames):
        print(f"warning: header says {meta.frame_count} frames, decoded {len(frames)} renderable frames")

    return DecodedAnimation(meta, palette, frames, op_counts, total_pixels)


def png_chunk(kind: bytes, payload: bytes) -> bytes:
    crc = binascii.crc32(kind)
    crc = binascii.crc32(payload, crc) & 0xFFFFFFFF
    return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", crc)


def write_png(path: Path, width: int, height: int, pixels: list[tuple[int, int, int]]) -> None:
    raw = bytearray()
    for y in range(height):
        raw.append(0)
        row_start = y * width
        for red, green, blue in pixels[row_start : row_start + width]:
            raw.extend((red, green, blue))

    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as file:
        file.write(b"\x89PNG\r\n\x1a\n")
        file.write(png_chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)))
        file.write(png_chunk(b"IDAT", zlib.compress(bytes(raw), 9)))
        file.write(png_chunk(b"IEND", b""))


def render_sprite_sheet(
    decoded: DecodedAnimation,
    frame_width: int,
    frame_height: int,
    columns: int,
    scale: int,
    gap: int,
    grid_color: tuple[int, int, int],
) -> tuple[int, int, list[tuple[int, int, int]]]:
    rows = math.ceil(len(decoded.frames) / columns)
    cell_width = frame_width * scale
    cell_height = frame_height * scale
    sheet_width = columns * cell_width + max(0, columns - 1) * gap
    sheet_height = rows * cell_height + max(0, rows - 1) * gap
    pixels = [grid_color] * (sheet_width * sheet_height)

    for frame_index, frame in enumerate(decoded.frames):
        column = frame_index % columns
        row = frame_index // columns
        base_x = column * (cell_width + gap)
        base_y = row * (cell_height + gap)
        for source_y in range(frame_height):
            for source_x in range(frame_width):
                palette_index = frame[source_y * frame_width + source_x]
                color = decoded.palette[palette_index]
                for y_scale in range(scale):
                    target_y = base_y + source_y * scale + y_scale
                    target_offset = target_y * sheet_width + base_x + source_x * scale
                    for x_scale in range(scale):
                        pixels[target_offset + x_scale] = color

    return sheet_width, sheet_height, pixels


def main() -> int:
    args = parse_args()
    if args.scale < 1:
        raise SystemExit("--scale must be at least 1")
    if args.gap < 0:
        raise SystemExit("--gap must be 0 or greater")
    if (args.width is None) != (args.height is None):
        raise SystemExit("pass both --width and --height, or neither")

    decoded = decode_animation(args.input, args.width, args.height)
    frame_width, frame_height = (args.width, args.height) if args.width and args.height else infer_dimensions(decoded.total_pixels)
    if frame_width * frame_height != decoded.total_pixels:
        raise SystemExit(
            f"dimensions {frame_width}x{frame_height} do not match {decoded.total_pixels} decoded pixels"
        )

    columns = args.columns or math.ceil(math.sqrt(len(decoded.frames)))
    if columns < 1:
        raise SystemExit("--columns must be at least 1")
    gap = 0 if args.no_grid else args.gap
    output = args.output or args.input.with_name(f"{args.input.stem}-spritesheet.png")
    sheet_width, sheet_height, pixels = render_sprite_sheet(
        decoded,
        frame_width,
        frame_height,
        columns,
        args.scale,
        gap,
        parse_hex_color(args.grid_color),
    )
    write_png(output, sheet_width, sheet_height, pixels)

    print(f"input: {args.input}")
    print(f"output: {output}")
    print(
        "header: "
        f"frames={decoded.meta.frame_count} fps={decoded.meta.fps} loops={decoded.meta.loop_count} "
        f"palette={len(decoded.palette)} frame_bytes={decoded.meta.frame_bytes}"
    )
    print(
        "records: "
        f"I={decoded.op_counts['I']} P={decoded.op_counts['P']} "
        f"D={decoded.op_counts['D']} F={decoded.op_counts['F']}"
    )
    print(f"sheet: {sheet_width}x{sheet_height}, frames={len(decoded.frames)}, frame={frame_width}x{frame_height}, scale={args.scale}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())