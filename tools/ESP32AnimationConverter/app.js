(function () {
  "use strict";

  const GIFUCT_MODULE = "https://cdn.jsdelivr.net/npm/gifuct-js@2.1.2/+esm";
  const MAX_PIXELS = 65535;
  const DEFAULT_FPS = 10;
  const DEFAULT_MAX_FRAMES = 21;
  const DEFAULT_MAX_COLORS = 128;
  const DEFAULT_OUTPUT_SIZE = "64x64";
  const OUTPUT_SIZES = new Map([
    ["64x64", { width: 64, height: 64 }],
    ["64x32", { width: 64, height: 32 }],
    ["128x128", { width: 128, height: 128 }],
  ]);
  const ANIMATION_HEADER_BYTES = 10;

  const state = {
    frames: [],
    sourceWidth: 0,
    sourceHeight: 0,
    crop: { x: 0, y: 0, width: 64, height: 64 },
    currentFrame: 0,
    playing: false,
    playTimer: 0,
    drag: null,
    objectUrl: "",
    sourceKind: "none",
    sourceFileName: "animation",
    sourceBin: null,
  };

  const els = {
    body: document.body,
    gifInput: document.getElementById("gifInput"),
    canvas: document.getElementById("sourceCanvas"),
    emptyState: document.getElementById("emptyState"),
    playPause: document.getElementById("playPause"),
    frameSlider: document.getElementById("frameSlider"),
    frameReadout: document.getElementById("frameReadout"),
    cropX: document.getElementById("cropX"),
    cropY: document.getElementById("cropY"),
    cropW: document.getElementById("cropW"),
    cropH: document.getElementById("cropH"),
    pixelGridOverlay: document.getElementById("pixelGridOverlay"),
    fitCrop: document.getElementById("fitCrop"),
    squareCrop: document.getElementById("squareCrop"),
    centerCrop: document.getElementById("centerCrop"),
    outputSize: document.getElementById("outputSize"),
    fps: document.getElementById("fps"),
    loopCount: document.getElementById("loopCount"),
    predictiveMode: document.getElementById("predictiveMode"),
    limitFrames: document.getElementById("limitFrames"),
    maxFrames: document.getElementById("maxFrames"),
    panelDefaults: document.getElementById("panelDefaults"),
    maxColors: document.getElementById("maxColors"),
    background: document.getElementById("background"),
    paletteSwatches: document.getElementById("paletteSwatches"),
    exportBin: document.getElementById("exportBin"),
    exportGif: document.getElementById("exportGif"),
    downloadLink: document.getElementById("downloadLink"),
    status: document.getElementById("status"),
  };

  const ctx = els.canvas.getContext("2d", { willReadFrequently: true });

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function toInt(input, fallback) {
    const value = Number.parseInt(input.value, 10);
    return Number.isFinite(value) ? value : fallback;
  }

  function setStatus(message) {
    els.status.textContent = message;
  }

  function setBusy(message) {
    els.exportBin.disabled = true;
    els.exportGif.disabled = true;
    setStatus(message);
  }

  function selectedOutputSize() {
    return OUTPUT_SIZES.get(els.outputSize.value) || OUTPUT_SIZES.get(DEFAULT_OUTPUT_SIZE);
  }

  function setOutputSize(width, height) {
    const match = Array.from(OUTPUT_SIZES.entries()).find(([, size]) => size.width === width && size.height === height);
    els.outputSize.value = match ? match[0] : DEFAULT_OUTPUT_SIZE;
  }

  function setLoadedControls(enabled, frameCount) {
    els.frameSlider.disabled = !enabled || frameCount <= 1;
    els.playPause.disabled = !enabled || frameCount <= 1;
    els.exportBin.disabled = !enabled;
    els.exportGif.disabled = !(enabled && state.sourceKind === "bin");
    els.emptyState.hidden = enabled;
  }

  function setCrop(crop) {
    const maxWidth = Math.max(1, state.sourceWidth || 1);
    const maxHeight = Math.max(1, state.sourceHeight || 1);
    const width = clamp(Math.round(crop.width), 1, maxWidth);
    const height = clamp(Math.round(crop.height), 1, maxHeight);
    const x = clamp(Math.round(crop.x), 0, maxWidth - width);
    const y = clamp(Math.round(crop.y), 0, maxHeight - height);

    state.crop = { x, y, width, height };
    els.cropX.value = x;
    els.cropY.value = y;
    els.cropW.value = width;
    els.cropH.value = height;
    drawPreview();
  }

  function setFrame(index) {
    if (!state.frames.length) {
      state.currentFrame = 0;
      els.frameReadout.textContent = "0 / 0";
      return;
    }

    state.currentFrame = clamp(index, 0, state.frames.length - 1);
    els.frameSlider.value = String(state.currentFrame);
    els.frameReadout.textContent = `${state.currentFrame + 1} / ${state.frames.length}`;
    drawPreview();
  }

  function resizeCanvasToSource(width, height) {
    els.canvas.width = width;
    els.canvas.height = height;
  }

  function gridLineStep(crop, outputWidth, outputHeight) {
    const rect = els.canvas.getBoundingClientRect();
    const cellCssWidth = rect.width ? (crop.width / els.canvas.width) * rect.width / outputWidth : 8;
    const cellCssHeight = rect.height ? (crop.height / els.canvas.height) * rect.height / outputHeight : 8;
    let step = 1;
    while (Math.min(cellCssWidth * step, cellCssHeight * step) < 4 && step < Math.max(outputWidth, outputHeight)) {
      step *= 2;
    }
    return step;
  }

  function updatePixelGridOverlay(crop) {
    const { width: outputWidth, height: outputHeight } = selectedOutputSize();
    const step = gridLineStep(crop, outputWidth, outputHeight);
    const majorStep = Math.max(8, step);
    const overlay = els.pixelGridOverlay;

    overlay.hidden = false;
    overlay.style.left = `${(crop.x / els.canvas.width) * 100}%`;
    overlay.style.top = `${(crop.y / els.canvas.height) * 100}%`;
    overlay.style.width = `${(crop.width / els.canvas.width) * 100}%`;
    overlay.style.height = `${(crop.height / els.canvas.height) * 100}%`;
    overlay.style.setProperty("--grid-columns", String(outputWidth / step));
    overlay.style.setProperty("--grid-rows", String(outputHeight / step));
    overlay.style.setProperty("--major-grid-columns", String(outputWidth / majorStep));
    overlay.style.setProperty("--major-grid-rows", String(outputHeight / majorStep));
  }

  function drawPreview() {
    ctx.clearRect(0, 0, els.canvas.width, els.canvas.height);
    if (!state.frames.length) {
      els.pixelGridOverlay.hidden = true;
      return;
    }

    ctx.putImageData(state.frames[state.currentFrame].imageData, 0, 0);

    const crop = state.crop;
    ctx.save();
    ctx.fillStyle = "rgba(14, 20, 17, 0.48)";
    ctx.beginPath();
    ctx.rect(0, 0, els.canvas.width, els.canvas.height);
    ctx.rect(crop.x, crop.y, crop.width, crop.height);
    ctx.fill("evenodd");
    updatePixelGridOverlay(crop);
    ctx.strokeStyle = "#fff6dc";
    ctx.lineWidth = Math.max(2, Math.round(Math.min(els.canvas.width, els.canvas.height) / 180));
    ctx.strokeRect(crop.x + 0.5, crop.y + 0.5, crop.width - 1, crop.height - 1);
    ctx.strokeStyle = "#1b7f6e";
    ctx.setLineDash([8, 5]);
    ctx.strokeRect(crop.x + 4.5, crop.y + 4.5, crop.width - 9, crop.height - 9);
    ctx.restore();
  }

  function canvasPoint(event) {
    const rect = els.canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * els.canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * els.canvas.height,
    };
  }

  function cropHit(point) {
    const crop = state.crop;
    const edge = Math.max(8, Math.min(crop.width, crop.height) * 0.08);
    const inside = point.x >= crop.x && point.x <= crop.x + crop.width && point.y >= crop.y && point.y <= crop.y + crop.height;
    if (!inside) {
      return "new";
    }

    const right = Math.abs(point.x - (crop.x + crop.width)) <= edge;
    const bottom = Math.abs(point.y - (crop.y + crop.height)) <= edge;
    if (right && bottom) {
      return "resize";
    }
    return "move";
  }

  function beginDrag(event) {
    if (!state.frames.length) {
      return;
    }
    const point = canvasPoint(event);
    state.drag = {
      mode: cropHit(point),
      start: point,
      crop: { ...state.crop },
    };
    els.canvas.setPointerCapture(event.pointerId);
  }

  function updateDrag(event) {
    if (!state.drag) {
      return;
    }

    const point = canvasPoint(event);
    const dx = point.x - state.drag.start.x;
    const dy = point.y - state.drag.start.y;
    const crop = state.drag.crop;

    if (state.drag.mode === "move") {
      setCrop({ ...crop, x: crop.x + dx, y: crop.y + dy });
    } else if (state.drag.mode === "resize") {
      setCrop({ ...crop, width: crop.width + dx, height: crop.height + dy });
    } else {
      setCrop({
        x: Math.min(state.drag.start.x, point.x),
        y: Math.min(state.drag.start.y, point.y),
        width: Math.abs(dx),
        height: Math.abs(dy),
      });
    }
  }

  function endDrag(event) {
    if (!state.drag) {
      return;
    }
    state.drag = null;
    if (els.canvas.hasPointerCapture(event.pointerId)) {
      els.canvas.releasePointerCapture(event.pointerId);
    }
  }

  function stopPlayback() {
    state.playing = false;
    window.clearTimeout(state.playTimer);
    els.playPause.textContent = "Play";
  }

  function scheduleNextFrame() {
    if (!state.playing || !state.frames.length) {
      return;
    }

    const delay = Math.max(20, state.frames[state.currentFrame].delay || 100);
    state.playTimer = window.setTimeout(() => {
      setFrame((state.currentFrame + 1) % state.frames.length);
      scheduleNextFrame();
    }, delay);
  }

  function togglePlayback() {
    if (!state.frames.length) {
      return;
    }

    if (state.playing) {
      stopPlayback();
      return;
    }

    state.playing = true;
    els.playPause.textContent = "Pause";
    scheduleNextFrame();
  }

  async function decodeGif(file) {
    const buffer = await file.arrayBuffer();
    const gifuct = await import(GIFUCT_MODULE);
    const parsed = gifuct.parseGIF(buffer);
    const rawFrames = gifuct.decompressFrames(parsed, true);
    const width = parsed.lsd.width;
    const height = parsed.lsd.height;
    const workCanvas = document.createElement("canvas");
    const workCtx = workCanvas.getContext("2d", { willReadFrequently: true });
    const patchCanvas = document.createElement("canvas");
    const patchCtx = patchCanvas.getContext("2d", { willReadFrequently: true });
    workCanvas.width = width;
    workCanvas.height = height;

    const frames = [];
    let previous = null;
    let restoreImage = null;

    for (const frame of rawFrames) {
      if (previous && previous.disposalType === 2) {
        workCtx.clearRect(previous.dims.left, previous.dims.top, previous.dims.width, previous.dims.height);
      } else if (previous && previous.disposalType === 3 && restoreImage) {
        workCtx.putImageData(restoreImage, 0, 0);
      }

      restoreImage = frame.disposalType === 3 ? workCtx.getImageData(0, 0, width, height) : null;
      const patch = new ImageData(new Uint8ClampedArray(frame.patch), frame.dims.width, frame.dims.height);
      patchCanvas.width = frame.dims.width;
      patchCanvas.height = frame.dims.height;
      patchCtx.clearRect(0, 0, patchCanvas.width, patchCanvas.height);
      patchCtx.putImageData(patch, 0, 0);
      workCtx.drawImage(patchCanvas, frame.dims.left, frame.dims.top);
      frames.push({
        imageData: workCtx.getImageData(0, 0, width, height),
        delay: Math.max(20, frame.delay || 100),
      });
      previous = frame;
    }

    return { width, height, frames };
  }

  function readU16BE(bytes, offset) {
    return (bytes[offset] << 8) | bytes[offset + 1];
  }

  function inferDimensions(totalPixels) {
    const { width: requestedWidth, height: requestedHeight } = selectedOutputSize();
    if (requestedWidth * requestedHeight === totalPixels) {
      return { width: requestedWidth, height: requestedHeight };
    }

    const square = Math.round(Math.sqrt(totalPixels));
    if (square * square === totalPixels) {
      return { width: square, height: square };
    }

    for (let height = Math.floor(Math.sqrt(totalPixels)); height >= 1; height -= 1) {
      if (totalPixels % height === 0) {
        return { width: totalPixels / height, height };
      }
    }

    return { width: totalPixels, height: 1 };
  }

  function indexedFrameToImageData(indexed, palette, width, height) {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let pixel = 0; pixel < indexed.length; pixel += 1) {
      const color = palette[indexed[pixel]] || palette[0] || { r: 0, g: 0, b: 0 };
      const offset = pixel * 4;
      data[offset] = color.r;
      data[offset + 1] = color.g;
      data[offset + 2] = color.b;
      data[offset + 3] = 255;
    }
    return new ImageData(data, width, height);
  }

  function decodeAnimationBinary(buffer) {
    const bytes = new Uint8Array(buffer);
    if (bytes.length < ANIMATION_HEADER_BYTES) {
      throw new Error("Animation binary is smaller than the 10-byte header.");
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const frameCount = view.getUint16(0, true);
    const loopCount = view.getUint8(2);
    const fps = view.getUint8(3);
    const paletteBytes = view.getUint16(4, true);
    const frameBytes = view.getUint32(6, true);
    if (frameCount === 0) {
      throw new Error("Animation binary has zero frames.");
    }
    if (fps === 0) {
      throw new Error("Animation binary has zero FPS.");
    }
    if (paletteBytes === 0 || paletteBytes % 3 !== 0) {
      throw new Error("Animation binary has an invalid palette byte count.");
    }
    if (ANIMATION_HEADER_BYTES + paletteBytes + frameBytes > bytes.length) {
      throw new Error("Animation binary frame stream exceeds file size.");
    }

    const palette = [];
    let offset = ANIMATION_HEADER_BYTES;
    for (let index = 0; index < paletteBytes; index += 3) {
      palette.push({ r: bytes[offset + index], g: bytes[offset + index + 1], b: bytes[offset + index + 2] });
    }

    offset += paletteBytes;
    const frameEnd = offset + frameBytes;
    const indexedFrames = [];
    const baseDelay = Math.max(20, Math.round(1000 / fps));
    const frameDelays = [];
    let totalPixels = 0;
    let current = null;

    while (offset < frameEnd) {
      const record = bytes[offset];
      offset += 1;
      if (record === 0x49) {
        if (offset + 2 > frameEnd) {
          throw new Error("Truncated key frame length.");
        }
        const pixelCount = readU16BE(bytes, offset);
        offset += 2;
        if (totalPixels === 0) {
          totalPixels = pixelCount;
        }
        if (pixelCount > totalPixels || offset + pixelCount > frameEnd) {
          throw new Error("Invalid or truncated key frame pixels.");
        }
        current = new Uint8Array(totalPixels);
        current.set(bytes.subarray(offset, offset + pixelCount), 0);
        offset += pixelCount;
        indexedFrames.push(current.slice());
        frameDelays.push(baseDelay);
      } else if (record === 0x50) {
        if (!current || totalPixels === 0) {
          throw new Error("Predictive frame appeared before a key frame.");
        }
        if (offset + 2 > frameEnd) {
          throw new Error("Truncated predictive frame length.");
        }
        const changedPixels = readU16BE(bytes, offset);
        offset += 2;
        const positionBytes = totalPixels > 256 ? 2 : 1;
        const needed = changedPixels * (positionBytes + 1);
        if (offset + needed > frameEnd) {
          throw new Error("Truncated predictive frame pixels.");
        }
        const next = current.slice();
        for (let index = 0; index < changedPixels; index += 1) {
          const position = positionBytes === 2 ? readU16BE(bytes, offset) : bytes[offset];
          offset += positionBytes;
          const paletteIndex = bytes[offset];
          offset += 1;
          if (position >= totalPixels) {
            throw new Error("Predictive frame pixel position is outside the frame.");
          }
          next[position] = paletteIndex;
        }
        current = next;
        indexedFrames.push(current.slice());
        frameDelays.push(baseDelay);
      } else if (record === 0x44 || record === 0x46) {
        if (offset + 2 > frameEnd) {
          throw new Error("Truncated action record.");
        }
        const actionMs = readU16BE(bytes, offset);
        offset += 2;
        if (record === 0x44 && frameDelays.length > 0) {
          frameDelays[frameDelays.length - 1] += actionMs;
        }
      } else {
        throw new Error(`Unknown frame record type 0x${record.toString(16).padStart(2, "0")}.`);
      }
    }

    if (indexedFrames.length !== frameCount) {
      throw new Error(`Header says ${frameCount} frames, decoded ${indexedFrames.length}.`);
    }
    if (totalPixels <= 0 || totalPixels > MAX_PIXELS) {
      throw new Error(`Unsupported pixel count ${totalPixels}.`);
    }

    const dimensions = inferDimensions(totalPixels);
    if (dimensions.width * dimensions.height !== totalPixels) {
      throw new Error("Could not infer animation dimensions.");
    }

    return { bytes, frameCount, loopCount, fps, paletteBytes, frameBytes, palette, indexedFrames, frameDelays, totalPixels, ...dimensions };
  }

  async function loadBin(file) {
    stopPlayback();
    setBusy("Decoding BIN...");

    const decoded = decodeAnimationBinary(await file.arrayBuffer());
    state.sourceKind = "bin";
    state.sourceFileName = file.name;
    state.sourceBin = decoded;
    state.frames = decoded.indexedFrames.map((frame, index) => ({
      imageData: indexedFrameToImageData(frame, decoded.palette, decoded.width, decoded.height),
      delay: decoded.frameDelays[index],
    }));
    state.sourceWidth = decoded.width;
    state.sourceHeight = decoded.height;
    resizeCanvasToSource(decoded.width, decoded.height);

    setOutputSize(decoded.width, decoded.height);
    els.fps.value = String(decoded.fps);
    els.loopCount.value = String(decoded.loopCount);
    els.maxColors.value = String(decoded.palette.length);
    els.limitFrames.checked = false;
    els.maxFrames.disabled = true;
    setLoadedControls(true, decoded.frameCount);
    renderPalette(decoded.palette);
    setCrop({ x: 0, y: 0, width: decoded.width, height: decoded.height });
    setFrame(0);
    updateStatusPreview();
  }

  function medianDelay(frames) {
    const delays = frames.map((frame) => frame.delay).filter((delay) => delay > 0).sort((a, b) => a - b);
    if (!delays.length) {
      return 100;
    }
    return delays[Math.floor(delays.length / 2)];
  }

  function sourceFps(frames) {
    return clamp(Math.round(1000 / medianDelay(frames)), 1, 60);
  }

  async function loadGif(file) {
    stopPlayback();
    setBusy("Decoding GIF...");

    const decoded = await decodeGif(file);
    state.sourceKind = "gif";
    state.sourceFileName = file.name;
    state.sourceBin = null;
    state.frames = decoded.frames;
    state.sourceWidth = decoded.width;
    state.sourceHeight = decoded.height;
    resizeCanvasToSource(decoded.width, decoded.height);

    els.frameSlider.max = String(Math.max(0, decoded.frames.length - 1));
    setLoadedControls(decoded.frames.length > 0, decoded.frames.length);

    els.fps.value = String(Math.min(sourceFps(decoded.frames), DEFAULT_FPS));
    const outputSize = selectedOutputSize();
    setCrop(fitCropToAspect(decoded.width, decoded.height, outputSize.width, outputSize.height));
    setFrame(0);
    updateStatusPreview();
  }

  function fitCropToAspect(width, height, targetWidth, targetHeight) {
    const targetRatio = targetWidth / targetHeight;
    const sourceRatio = width / height;
    if (sourceRatio > targetRatio) {
      const cropWidth = Math.round(height * targetRatio);
      return { x: Math.round((width - cropWidth) / 2), y: 0, width: cropWidth, height };
    }

    const cropHeight = Math.round(width / targetRatio);
    return { x: 0, y: Math.round((height - cropHeight) / 2), width, height: cropHeight };
  }

  function updateStatusPreview() {
    if (!state.frames.length) {
      setStatus("No GIF or BIN loaded.");
      return;
    }

    if (state.sourceKind === "bin" && state.sourceBin) {
      const bin = state.sourceBin;
      setStatus([
        `source: ${state.sourceFileName}`,
        `decoded: ${bin.width}x${bin.height}, ${bin.frameCount} frames, ${bin.fps} fps, loops=${bin.loopCount}`,
        `palette: ${bin.palette.length} colors / ${bin.paletteBytes} bytes`,
        `frame bytes: ${bin.frameBytes.toLocaleString()}`,
        `records: imported from Expressive Pixels sequence .bin`,
        `round-trip .bin: lossless original bytes`,
        `GIF export: full-frame paletted GIF`,
      ].join("\n"));
      return;
    }

    const { width: outputWidth, height: outputHeight } = selectedOutputSize();
    const count = selectedFrameIndices().length;
    const totalPixels = outputWidth * outputHeight;
    const estimatedWrites = totalPixels * toInt(els.fps, DEFAULT_FPS);
    setStatus([
      `source: ${state.sourceWidth}x${state.sourceHeight}, ${state.frames.length} frames, ${sourceFps(state.frames)} fps`,
      `crop: ${state.crop.x},${state.crop.y} ${state.crop.width}x${state.crop.height}`,
      `output: ${outputWidth}x${outputHeight}, ${count} frames, ${toInt(els.fps, DEFAULT_FPS)} fps`,
      `worst-case load: ${estimatedWrites.toLocaleString()} pixel writes/sec`,
      `encoding: ${predictiveModeLabel(els.predictiveMode.value)}`,
      `format: Expressive Pixels sequence .bin`,
    ].join("\n"));
  }

  function selectedFrameIndices() {
    const totalFrames = state.frames.length;
    if (!els.limitFrames.checked || totalFrames === 0) {
      return Array.from({ length: totalFrames }, (_, index) => index);
    }

    const frameCount = Math.min(totalFrames, clamp(toInt(els.maxFrames, DEFAULT_MAX_FRAMES), 1, 255));
    if (frameCount === totalFrames) {
      return Array.from({ length: totalFrames }, (_, index) => index);
    }
    if (frameCount === 1) {
      return [0];
    }

    const indices = [];
    const seen = new Set();
    for (let index = 0; index < frameCount; index += 1) {
      const sourceIndex = Math.round((index * (totalFrames - 1)) / (frameCount - 1));
      if (!seen.has(sourceIndex)) {
        indices.push(sourceIndex);
        seen.add(sourceIndex);
      }
    }
    return indices;
  }

  function parseColor(hex) {
    const value = hex.replace("#", "");
    return {
      r: Number.parseInt(value.slice(0, 2), 16),
      g: Number.parseInt(value.slice(2, 4), 16),
      b: Number.parseInt(value.slice(4, 6), 16),
    };
  }

  function renderExportFrames() {
    const { width: outputWidth, height: outputHeight } = selectedOutputSize();
    const totalPixels = outputWidth * outputHeight;
    if (totalPixels > MAX_PIXELS) {
      throw new Error(`Output has ${totalPixels} pixels; firmware limit is ${MAX_PIXELS}.`);
    }

    const frameIndices = selectedFrameIndices();
    if (frameIndices.length <= 0) {
      throw new Error("No frames to export.");
    }

    const background = parseColor(els.background.value);
    const sourceCanvas = document.createElement("canvas");
    const sourceCtx = sourceCanvas.getContext("2d", { willReadFrequently: true });
    sourceCanvas.width = state.sourceWidth;
    sourceCanvas.height = state.sourceHeight;

    const exportCanvas = document.createElement("canvas");
    const exportCtx = exportCanvas.getContext("2d", { willReadFrequently: true });
    exportCanvas.width = outputWidth;
    exportCanvas.height = outputHeight;
    exportCtx.imageSmoothingEnabled = true;
    exportCtx.imageSmoothingQuality = "high";

    const frames = [];
    for (const frameIndex of frameIndices) {
      sourceCtx.putImageData(state.frames[frameIndex].imageData, 0, 0);
      exportCtx.fillStyle = els.background.value;
      exportCtx.fillRect(0, 0, outputWidth, outputHeight);
      exportCtx.drawImage(
        sourceCanvas,
        state.crop.x,
        state.crop.y,
        state.crop.width,
        state.crop.height,
        0,
        0,
        outputWidth,
        outputHeight
      );

      const image = exportCtx.getImageData(0, 0, outputWidth, outputHeight).data;
      const pixels = [];
      for (let byte = 0; byte < image.length; byte += 4) {
        const alpha = image[byte + 3] / 255;
        pixels.push({
          r: Math.round(image[byte] * alpha + background.r * (1 - alpha)),
          g: Math.round(image[byte + 1] * alpha + background.g * (1 - alpha)),
          b: Math.round(image[byte + 2] * alpha + background.b * (1 - alpha)),
        });
      }
      frames.push(pixels);
    }

    return { width: outputWidth, height: outputHeight, frames };
  }

  function buildHistogram(frames) {
    const bins = new Map();
    for (const frame of frames) {
      for (const color of frame) {
        const r = color.r >> 3;
        const g = color.g >> 3;
        const b = color.b >> 3;
        const key = (r << 10) | (g << 5) | b;
        const existing = bins.get(key);
        if (existing) {
          existing.count += 1;
          existing.rSum += color.r;
          existing.gSum += color.g;
          existing.bSum += color.b;
        } else {
          bins.set(key, { r, g, b, count: 1, rSum: color.r, gSum: color.g, bSum: color.b });
        }
      }
    }
    return Array.from(bins.values()).map((bin) => ({
      r: Math.round(bin.rSum / bin.count),
      g: Math.round(bin.gSum / bin.count),
      b: Math.round(bin.bSum / bin.count),
      count: bin.count,
    }));
  }

  function colorBox(colors) {
    let rMin = 255;
    let rMax = 0;
    let gMin = 255;
    let gMax = 0;
    let bMin = 255;
    let bMax = 0;
    let count = 0;
    for (const color of colors) {
      rMin = Math.min(rMin, color.r);
      rMax = Math.max(rMax, color.r);
      gMin = Math.min(gMin, color.g);
      gMax = Math.max(gMax, color.g);
      bMin = Math.min(bMin, color.b);
      bMax = Math.max(bMax, color.b);
      count += color.count;
    }
    return { colors, rMin, rMax, gMin, gMax, bMin, bMax, count };
  }

  function splitBox(box) {
    if (box.colors.length < 2) {
      return [box];
    }

    const ranges = [
      { channel: "r", range: box.rMax - box.rMin },
      { channel: "g", range: box.gMax - box.gMin },
      { channel: "b", range: box.bMax - box.bMin },
    ].sort((a, b) => b.range - a.range);
    const channel = ranges[0].channel;
    const sorted = box.colors.slice().sort((a, b) => a[channel] - b[channel]);
    const halfway = box.count / 2;
    let running = 0;
    let splitAt = 1;
    for (let index = 0; index < sorted.length - 1; index += 1) {
      running += sorted[index].count;
      if (running >= halfway) {
        splitAt = index + 1;
        break;
      }
    }
    return [colorBox(sorted.slice(0, splitAt)), colorBox(sorted.slice(splitAt))];
  }

  function representativeColor(box) {
    let count = 0;
    let r = 0;
    let g = 0;
    let b = 0;
    for (const color of box.colors) {
      count += color.count;
      r += color.r * color.count;
      g += color.g * color.count;
      b += color.b * color.count;
    }
    return {
      r: clamp(Math.round(r / count), 0, 255),
      g: clamp(Math.round(g / count), 0, 255),
      b: clamp(Math.round(b / count), 0, 255),
    };
  }

  function buildPalette(frames, maxColors) {
    const histogram = buildHistogram(frames);
    if (histogram.length <= maxColors) {
      return histogram.map(({ r, g, b }) => ({ r, g, b }));
    }

    let boxes = [colorBox(histogram)];
    while (boxes.length < maxColors) {
      boxes.sort((a, b) => {
        const aRange = Math.max(a.rMax - a.rMin, a.gMax - a.gMin, a.bMax - a.bMin);
        const bRange = Math.max(b.rMax - b.rMin, b.gMax - b.gMin, b.bMax - b.bMin);
        return bRange * b.count - aRange * a.count;
      });
      const next = boxes.shift();
      const split = splitBox(next);
      boxes = boxes.concat(split);
      if (split.length === 1) {
        break;
      }
    }
    return boxes.slice(0, maxColors).map(representativeColor);
  }

  function nearestPaletteIndex(color, palette) {
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < palette.length; index += 1) {
      const entry = palette[index];
      const r = color.r - entry.r;
      const g = color.g - entry.g;
      const b = color.b - entry.b;
      const distance = r * r + g * g + b * b;
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }
    return bestIndex;
  }

  function indexFrames(frames, palette) {
    return frames.map((frame) => frame.map((color) => nearestPaletteIndex(color, palette)));
  }

  function pushU16BE(bytes, value) {
    bytes.push((value >> 8) & 0xff, value & 0xff);
  }

  function pushPosition(bytes, position, totalPixels) {
    if (totalPixels > 256) {
      pushU16BE(bytes, position);
    } else {
      bytes.push(position & 0xff);
    }
  }

  function predictiveModeLabel(mode) {
    switch (mode) {
    case "off":
      return "keyframes only";
    case "writes":
      return "predictive, prefer fewer pixel writes";
    case "size":
    default:
      return "predictive, auto smaller file";
    }
  }

  function shouldUsePredictive(mode, changedPixels, totalPixels, predictiveSize, keySize) {
    switch (mode) {
    case "off":
      return false;
    case "writes":
      return changedPixels < totalPixels;
    case "size":
    default:
      return predictiveSize < keySize;
    }
  }

  function encodeFrameBytes(indexedFrames, totalPixels, mode) {
    const bytes = [];
    const stats = {
      keyFrames: 0,
      predictiveFrames: 0,
      pixelWrites: 0,
    };
    let previous = null;
    indexedFrames.forEach((frame, frameIndex) => {
      if (frameIndex === 0 || !previous) {
        bytes.push(0x49);
        pushU16BE(bytes, totalPixels);
        bytes.push(...frame);
        stats.keyFrames += 1;
        stats.pixelWrites += totalPixels;
      } else {
        const changed = [];
        for (let index = 0; index < frame.length; index += 1) {
          if (frame[index] !== previous[index]) {
            changed.push(index, frame[index]);
          }
        }
        const changedPixels = changed.length / 2;
        const predictiveSize = 1 + 2 + changedPixels * (totalPixels > 256 ? 3 : 2);
        const keySize = 1 + 2 + totalPixels;
        if (shouldUsePredictive(mode, changedPixels, totalPixels, predictiveSize, keySize)) {
          bytes.push(0x50);
          pushU16BE(bytes, changedPixels);
          for (let index = 0; index < changed.length; index += 2) {
            pushPosition(bytes, changed[index], totalPixels);
            bytes.push(changed[index + 1]);
          }
          stats.predictiveFrames += 1;
          stats.pixelWrites += changedPixels;
        } else {
          bytes.push(0x49);
          pushU16BE(bytes, totalPixels);
          bytes.push(...frame);
          stats.keyFrames += 1;
          stats.pixelWrites += totalPixels;
        }
      }
      previous = frame;
    });
    return { bytes: Uint8Array.from(bytes), stats };
  }

  function buildAnimationBinary(rendered) {
    const maxColors = clamp(toInt(els.maxColors, DEFAULT_MAX_COLORS), 2, 256);
    const palette = buildPalette(rendered.frames, maxColors);
    const indexedFrames = indexFrames(rendered.frames, palette);
    const totalPixels = rendered.width * rendered.height;
    const encodedFrames = encodeFrameBytes(indexedFrames, totalPixels, els.predictiveMode.value);
    const frameBytes = encodedFrames.bytes;
    const paletteBytes = palette.length * 3;
    const frameCount = indexedFrames.length;
    const fps = clamp(toInt(els.fps, DEFAULT_FPS), 1, 60);
    const loopCount = clamp(toInt(els.loopCount, 0), 0, 255);
    const output = new Uint8Array(10 + paletteBytes + frameBytes.length);
    const view = new DataView(output.buffer);
    view.setUint16(0, frameCount, true);
    view.setUint8(2, loopCount);
    view.setUint8(3, fps);
    view.setUint16(4, paletteBytes, true);
    view.setUint32(6, frameBytes.length, true);

    let offset = 10;
    palette.forEach((color) => {
      output[offset] = color.r;
      output[offset + 1] = color.g;
      output[offset + 2] = color.b;
      offset += 3;
    });
    output.set(frameBytes, offset);
    return { output, palette, frameBytes, frameCount, fps, loopCount, encodingStats: encodedFrames.stats };
  }

  function renderPalette(palette) {
    els.paletteSwatches.innerHTML = "";
    palette.slice(0, 256).forEach((color) => {
      const swatch = document.createElement("span");
      swatch.className = "swatch";
      swatch.style.backgroundColor = `rgb(${color.r}, ${color.g}, ${color.b})`;
      els.paletteSwatches.appendChild(swatch);
    });
  }

  function downloadBlob(bytes, extension, type) {
    if (state.objectUrl) {
      URL.revokeObjectURL(state.objectUrl);
    }
    const blob = new Blob([bytes], { type });
    state.objectUrl = URL.createObjectURL(blob);
    const stem = state.sourceFileName
      ? state.sourceFileName.replace(/\.[^.]+$/, "")
      : "animation";
    els.downloadLink.href = state.objectUrl;
    els.downloadLink.download = `${stem}.${extension}`;
    els.downloadLink.click();
  }

  function bitsNeeded(value) {
    let bits = 0;
    let next = Math.max(1, value - 1);
    while (next > 0) {
      bits += 1;
      next >>= 1;
    }
    return bits;
  }

  function lzwEncode(indices, colorCount) {
    const minCodeSize = 8;
    const clearCode = 1 << minCodeSize;
    const endCode = clearCode + 1;
    const bytes = [];
    let bitBuffer = 0;
    let bitCount = 0;
    const codeSize = minCodeSize + 1;

    function writeCode(code) {
      bitBuffer |= code << bitCount;
      bitCount += codeSize;
      while (bitCount >= 8) {
        bytes.push(bitBuffer & 0xff);
        bitBuffer >>= 8;
        bitCount -= 8;
      }
    }

    let index = 0;
    while (index < indices.length) {
      writeCode(clearCode);
      const chunkEnd = Math.min(indices.length, index + 250);
      while (index < chunkEnd) {
        writeCode(indices[index]);
        index += 1;
      }
    }
    writeCode(endCode);
    if (bitCount > 0) {
      bytes.push(bitBuffer & 0xff);
    }
    return { minCodeSize, bytes };
  }

  function pushAscii(bytes, text) {
    for (let index = 0; index < text.length; index += 1) {
      bytes.push(text.charCodeAt(index));
    }
  }

  function pushU16LE(bytes, value) {
    bytes.push(value & 0xff, (value >> 8) & 0xff);
  }

  function pushSubBlocks(bytes, payload) {
    for (let offset = 0; offset < payload.length; offset += 255) {
      const block = payload.slice(offset, offset + 255);
      bytes.push(block.length, ...block);
    }
    bytes.push(0);
  }

  function buildGifBinary(bin) {
    const colorTableSize = 256;
    const colorTablePower = 7;
    const bytes = [];
    pushAscii(bytes, "GIF89a");
    pushU16LE(bytes, bin.width);
    pushU16LE(bytes, bin.height);
    bytes.push(0x80 | 0x70 | colorTablePower, 0, 0);
    for (let index = 0; index < colorTableSize; index += 1) {
      const color = bin.palette[index] || { r: 0, g: 0, b: 0 };
      bytes.push(color.r, color.g, color.b);
    }

    bytes.push(0x21, 0xff, 0x0b);
    pushAscii(bytes, "NETSCAPE2.0");
    bytes.push(0x03, 0x01);
    pushU16LE(bytes, bin.loopCount);
    bytes.push(0x00);

    for (let index = 0; index < bin.indexedFrames.length; index += 1) {
      const delayCs = clamp(Math.round((bin.frameDelays[index] || 100) / 10), 2, 65535);
      bytes.push(0x21, 0xf9, 0x04, 0x00);
      pushU16LE(bytes, delayCs);
      bytes.push(0x00, 0x00);
      bytes.push(0x2c);
      pushU16LE(bytes, 0);
      pushU16LE(bytes, 0);
      pushU16LE(bytes, bin.width);
      pushU16LE(bytes, bin.height);
      bytes.push(0x00);
      const encoded = lzwEncode(bin.indexedFrames[index], colorTableSize);
      bytes.push(encoded.minCodeSize);
      pushSubBlocks(bytes, encoded.bytes);
    }

    bytes.push(0x3b);
    return Uint8Array.from(bytes);
  }

  function exportBin() {
    if (!state.frames.length) {
      return;
    }

    if (state.sourceKind === "bin" && state.sourceBin) {
      renderPalette(state.sourceBin.palette);
      downloadBlob(state.sourceBin.bytes, "bin", "application/octet-stream");
      setStatus([
        `exported: ${state.sourceBin.bytes.length.toLocaleString()} bytes`,
        `source: ${state.sourceFileName}`,
        `round-trip .bin: lossless original bytes`,
      ].join("\n"));
      els.exportBin.disabled = false;
      els.exportGif.disabled = false;
      return;
    }

    try {
      setBusy("Rendering frames...");
      const rendered = renderExportFrames();
      setBusy("Quantizing palette...");
      window.setTimeout(() => {
        try {
          const result = buildAnimationBinary(rendered);
          renderPalette(result.palette);
          downloadBlob(result.output, "bin", "application/octet-stream");
          setStatus([
            `exported: ${result.output.length.toLocaleString()} bytes`,
            `frames: ${result.frameCount}`,
            `fps: ${result.fps}`,
            `loops: ${result.loopCount}`,
            `palette: ${result.palette.length} colors / ${result.palette.length * 3} bytes`,
            `frame bytes: ${result.frameBytes.length.toLocaleString()}`,
            `encoding: ${predictiveModeLabel(els.predictiveMode.value)}`,
            `records: ${result.encodingStats.keyFrames} key, ${result.encodingStats.predictiveFrames} predictive`,
            `estimated load: ${Math.ceil((result.encodingStats.pixelWrites / result.frameCount) * result.fps).toLocaleString()} pixel writes/sec`,
            `worst-case load: ${(rendered.width * rendered.height * result.fps).toLocaleString()} pixel writes/sec`,
          ].join("\n"));
          els.exportBin.disabled = false;
          els.exportGif.disabled = state.sourceKind !== "bin";
        } catch (error) {
          els.exportBin.disabled = false;
          els.exportGif.disabled = state.sourceKind !== "bin";
          setStatus(error.message);
        }
      }, 1);
    } catch (error) {
      els.exportBin.disabled = false;
      els.exportGif.disabled = state.sourceKind !== "bin";
      setStatus(error.message);
    }
  }

  function exportGif() {
    if (state.sourceKind !== "bin" || !state.sourceBin) {
      return;
    }

    try {
      setBusy("Encoding GIF...");
      window.setTimeout(() => {
        try {
          const gif = buildGifBinary(state.sourceBin);
          downloadBlob(gif, "gif", "image/gif");
          setStatus([
            `exported GIF: ${gif.length.toLocaleString()} bytes`,
            `source: ${state.sourceFileName}`,
            `frames: ${state.sourceBin.frameCount}`,
            `size: ${state.sourceBin.width}x${state.sourceBin.height}`,
            `palette: ${state.sourceBin.palette.length} colors`,
          ].join("\n"));
          els.exportBin.disabled = false;
          els.exportGif.disabled = false;
        } catch (error) {
          els.exportBin.disabled = false;
          els.exportGif.disabled = false;
          setStatus(error.message);
        }
      }, 1);
    } catch (error) {
      els.exportBin.disabled = false;
      els.exportGif.disabled = false;
      setStatus(error.message);
    }
  }

  function syncCropFromInputs() {
    setCrop({
      x: toInt(els.cropX, state.crop.x),
      y: toInt(els.cropY, state.crop.y),
      width: toInt(els.cropW, state.crop.width),
      height: toInt(els.cropH, state.crop.height),
    });
    updateStatusPreview();
  }

  function fitCrop() {
    if (!state.sourceWidth || !state.sourceHeight) {
      return;
    }
    const outputSize = selectedOutputSize();
    setCrop(fitCropToAspect(state.sourceWidth, state.sourceHeight, outputSize.width, outputSize.height));
    updateStatusPreview();
  }

  function syncOutputSize() {
    fitCrop();
    updateStatusPreview();
  }

  function squareCrop() {
    if (!state.sourceWidth || !state.sourceHeight) {
      return;
    }
    const side = Math.min(state.sourceWidth, state.sourceHeight);
    setCrop({ x: (state.sourceWidth - side) / 2, y: (state.sourceHeight - side) / 2, width: side, height: side });
    updateStatusPreview();
  }

  function centerCrop() {
    setCrop({
      ...state.crop,
      x: (state.sourceWidth - state.crop.width) / 2,
      y: (state.sourceHeight - state.crop.height) / 2,
    });
    updateStatusPreview();
  }

  function handleFile(file) {
    if (!file) {
      return;
    }

    const lowerName = file.name.toLowerCase();
    const loader = lowerName.endsWith(".bin") ? loadBin : loadGif;
    loader(file).catch((error) => {
      els.exportBin.disabled = true;
      els.exportGif.disabled = true;
      setStatus(`${lowerName.endsWith(".bin") ? "BIN" : "GIF"} import failed: ${error.message}`);
    });
  }

  function applyPanelDefaults() {
    els.outputSize.value = DEFAULT_OUTPUT_SIZE;
    els.fps.value = String(DEFAULT_FPS);
    els.limitFrames.checked = true;
    els.maxFrames.disabled = false;
    els.maxFrames.value = String(DEFAULT_MAX_FRAMES);
    els.maxColors.value = String(DEFAULT_MAX_COLORS);
    els.predictiveMode.value = "writes";
    drawPreview();
    updateStatusPreview();
  }

  function bindEvents() {
    els.gifInput.addEventListener("change", () => handleFile(els.gifInput.files[0]));
    els.playPause.addEventListener("click", togglePlayback);
    els.frameSlider.addEventListener("input", () => {
      stopPlayback();
      setFrame(toInt(els.frameSlider, 0));
    });

    [els.cropX, els.cropY, els.cropW, els.cropH].forEach((input) => input.addEventListener("input", syncCropFromInputs));
    [els.fps, els.loopCount, els.maxColors, els.background].forEach((input) => {
      input.addEventListener("input", updateStatusPreview);
    });
    els.outputSize.addEventListener("change", syncOutputSize);
    els.predictiveMode.addEventListener("change", updateStatusPreview);
    els.limitFrames.addEventListener("change", () => {
      els.maxFrames.disabled = !els.limitFrames.checked;
      updateStatusPreview();
    });
    els.maxFrames.addEventListener("input", updateStatusPreview);
    els.panelDefaults.addEventListener("click", applyPanelDefaults);
    els.fitCrop.addEventListener("click", fitCrop);
    els.squareCrop.addEventListener("click", squareCrop);
    els.centerCrop.addEventListener("click", centerCrop);
    els.exportBin.addEventListener("click", exportBin);
    els.exportGif.addEventListener("click", exportGif);

    els.canvas.addEventListener("pointerdown", beginDrag);
    els.canvas.addEventListener("pointermove", updateDrag);
    els.canvas.addEventListener("pointerup", endDrag);
    els.canvas.addEventListener("pointercancel", endDrag);

    window.addEventListener("dragover", (event) => {
      event.preventDefault();
      els.body.classList.add("dropReady");
    });
    window.addEventListener("dragleave", () => els.body.classList.remove("dropReady"));
    window.addEventListener("drop", (event) => {
      event.preventDefault();
      els.body.classList.remove("dropReady");
      const file = Array.from(event.dataTransfer.files).find((entry) => entry.type === "image/gif" || /\.(gif|bin)$/i.test(entry.name));
      handleFile(file);
    });
  }

  bindEvents();
}());