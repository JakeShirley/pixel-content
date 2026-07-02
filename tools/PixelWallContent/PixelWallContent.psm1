$MaxContentNameLength = 96
$MaxPixelCount = 65535
$NativeAnimationDimensions = @(
    [pscustomobject]@{ Width = 64; Height = 64; Dimensions = "64x64" }
    [pscustomobject]@{ Width = 64; Height = 32; Dimensions = "64x32" }
    [pscustomobject]@{ Width = 128; Height = 64; Dimensions = "128x64" }
    [pscustomobject]@{ Width = 128; Height = 128; Dimensions = "128x128" }
)

function Read-UInt16LittleEndian {
    param(
        [byte[]]$Bytes,
        [int]$Offset
    )

    return ([int]$Bytes[$Offset]) -bor (([int]$Bytes[($Offset + 1)]) -shl 8)
}

function Read-UInt32LittleEndian {
    param(
        [byte[]]$Bytes,
        [int]$Offset
    )

    return [uint32]((([int]$Bytes[$Offset]) -bor (([int]$Bytes[($Offset + 1)]) -shl 8) -bor (([int]$Bytes[($Offset + 2)]) -shl 16) -bor (([int]$Bytes[($Offset + 3)]) -shl 24)) -band 0xffffffff)
}

function Read-UInt16BigEndian {
    param(
        [byte[]]$Bytes,
        [int]$Offset
    )

    return (([int]$Bytes[$Offset]) -shl 8) -bor ([int]$Bytes[($Offset + 1)])
}

function Assert-AvailableBytes {
    param(
        [byte[]]$Bytes,
        [int]$Offset,
        [int]$Length,
        [string]$Context
    )

    if ($Offset + $Length -gt $Bytes.Length) {
        throw "Truncated $Context at byte $Offset."
    }
}

function Assert-ContentName {
    param([string]$Name)

    if ($Name.Length -lt 1 -or $Name.Length -gt $MaxContentNameLength -or $Name -notmatch '^[A-Za-z0-9_-]+$') {
        throw "Content name must be 1-$MaxContentNameLength characters using only letters, numbers, '-' or '_': $Name"
    }
}

function ConvertTo-RepositoryRelativePath {
    param(
        [string]$Path,
        [string]$RootPath
    )

    $resolvedRoot = [System.IO.Path]::GetFullPath($RootPath).TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
    $resolvedPath = [System.IO.Path]::GetFullPath($Path)
    $rootWithSeparator = $resolvedRoot + [System.IO.Path]::DirectorySeparatorChar
    if ($resolvedPath.StartsWith($rootWithSeparator, [System.StringComparison]::OrdinalIgnoreCase)) {
        return $resolvedPath.Substring($rootWithSeparator.Length).Replace([System.IO.Path]::DirectorySeparatorChar, "/")
    }

    return [System.IO.Path]::GetFileName($resolvedPath)
}

function ConvertTo-UrlPath {
    param([string]$Path)

    return (($Path -split "/") | ForEach-Object { [System.Uri]::EscapeDataString($_) }) -join "/"
}

function Resolve-GitHubSourceTreeBaseUrl {
    param(
        [string]$RepositoryUrl,
        [string]$SourceRef
    )

    if ([string]::IsNullOrWhiteSpace($RepositoryUrl)) {
        $RepositoryUrl = $env:PIXEL_WALL_CONTENT_REPOSITORY_URL
    }
    if ([string]::IsNullOrWhiteSpace($RepositoryUrl) -and ![string]::IsNullOrWhiteSpace($env:GITHUB_SERVER_URL) -and ![string]::IsNullOrWhiteSpace($env:GITHUB_REPOSITORY)) {
        $RepositoryUrl = "$($env:GITHUB_SERVER_URL)/$($env:GITHUB_REPOSITORY)"
    }
    if ([string]::IsNullOrWhiteSpace($RepositoryUrl)) {
        return $null
    }

    if ([string]::IsNullOrWhiteSpace($SourceRef)) {
        $SourceRef = $env:PIXEL_WALL_CONTENT_SOURCE_REF
    }
    if ([string]::IsNullOrWhiteSpace($SourceRef)) {
        $SourceRef = $env:GITHUB_REF_NAME
    }
    if ([string]::IsNullOrWhiteSpace($SourceRef)) {
        $SourceRef = "main"
    }

    return "$($RepositoryUrl.TrimEnd("/") -replace '\.git$', '')/tree/$([System.Uri]::EscapeDataString($SourceRef))"
}

function ConvertTo-DimensionParts {
    param([string]$Dimensions)

    if ($Dimensions -notmatch '^(\d+)x(\d+)$') {
        throw "Dimensions must use <width>x<height> with a lowercase x: $Dimensions"
    }

    return [pscustomobject]@{
        Width = [int]$Matches[1]
        Height = [int]$Matches[2]
        Dimensions = $Dimensions
    }
}

function Resolve-AnimationDimensions {
    param(
        [int]$TotalPixels,
        [string]$Name,
        [string]$LeafName,
        [string]$Dimensions,
        [hashtable]$DimensionMap
    )

    $candidate = $null
    if (![string]::IsNullOrWhiteSpace($Dimensions)) {
        $candidate = $Dimensions
    } elseif ($DimensionMap) {
        if ($DimensionMap.ContainsKey($Name)) {
            $candidate = [string]$DimensionMap[$Name]
        } elseif ($DimensionMap.ContainsKey($LeafName)) {
            $candidate = [string]$DimensionMap[$LeafName]
        }
    }

    if (![string]::IsNullOrWhiteSpace($candidate)) {
        $parts = ConvertTo-DimensionParts $candidate
        if ($parts.Width * $parts.Height -ne $TotalPixels) {
            throw "Dimensions $($parts.Dimensions) do not match $TotalPixels pixels for $Name."
        }

        return $parts
    }

    $side = [int][Math]::Sqrt($TotalPixels)
    if ($side * $side -eq $TotalPixels) {
        return [pscustomobject]@{
            Width = $side
            Height = $side
            Dimensions = "$side`x$side"
        }
    }

    $nativeMatches = @($NativeAnimationDimensions | Where-Object { $_.Width * $_.Height -eq $TotalPixels })
    if ($nativeMatches.Count -eq 1) {
        return $nativeMatches[0]
    }

    throw "Cannot infer non-square dimensions for $Name from $TotalPixels pixels. Add dimensions with -Dimensions or a JSON dimension map."
}

function Read-DimensionMap {
    param([string]$Path)

    if ([string]::IsNullOrWhiteSpace($Path) -or !(Test-Path $Path -PathType Leaf)) {
        return @{}
    }

    $json = Get-Content -Path $Path -Raw | ConvertFrom-Json
    $map = @{}
    foreach ($property in $json.PSObject.Properties) {
        $map[$property.Name] = [string]$property.Value
    }

    return $map
}

function Write-ContentIndexHtml {
        param(
                [string]$OutputPath,
                [hashtable]$Index
        )

        $contentJson = $Index | ConvertTo-Json -Depth 8
        $htmlStart = @'
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Pixel Wall Animation Content</title>
    <style>
        :root {
            color-scheme: light;
            --ink: #17211d;
            --muted: #5d6962;
            --line: #d8ded8;
            --panel: #ffffff;
            --page: #f3f0e7;
            --accent: #126f62;
            --accent-strong: #0a4d45;
        }

        * {
            box-sizing: border-box;
        }

        body {
            margin: 0;
            color: var(--ink);
            background:
                linear-gradient(135deg, rgba(18, 111, 98, 0.10), transparent 34rem),
                radial-gradient(circle at top right, rgba(232, 169, 73, 0.16), transparent 26rem),
                var(--page);
            font-family: "Aptos", "Segoe UI", sans-serif;
            line-height: 1.45;
        }

        header,
        main,
        footer {
            width: min(1120px, calc(100% - 32px));
            margin: 0 auto;
        }

        header {
            padding: 40px 0 24px;
        }

        h1,
        h2,
        h3,
        p {
            margin: 0;
        }

        h1 {
            font-size: clamp(2rem, 6vw, 4rem);
            line-height: 0.95;
            max-width: 760px;
        }

        .summary {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            margin-top: 20px;
        }

        .summary span,
        .meta span,
        .manifest-title span {
            border: 1px solid var(--line);
            border-radius: 999px;
            background: rgba(255, 255, 255, 0.68);
            padding: 6px 10px;
            color: var(--muted);
            font-size: 0.9rem;
        }

        main {
            display: grid;
            gap: 28px;
            padding: 0 0 40px;
        }

        section {
            display: grid;
            gap: 14px;
        }

        .manifest-title {
            display: flex;
            flex-wrap: wrap;
            align-items: baseline;
            gap: 10px;
            padding-top: 10px;
        }

        .manifest-title h2 {
            font-size: 1.45rem;
        }

        .manifest-title a,
        .links a,
        footer a,
        .details a {
            color: var(--accent-strong);
            font-weight: 700;
            text-decoration: none;
        }

        .manifest-title a:hover,
        .links a:hover,
        footer a:hover,
        .details a:hover {
            text-decoration: underline;
        }

        .links {
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
            font-size: 0.9rem;
        }

        ol {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
            gap: 12px;
            list-style-position: inside;
            margin: 0;
            padding: 0;
        }

        li::marker {
            color: var(--accent);
            font-weight: 800;
        }

        .animation-card {
            display: grid;
            grid-template-columns: minmax(72px, 104px) 1fr;
            gap: 12px;
            min-height: 128px;
            border: 1px solid var(--line);
            border-radius: 8px;
            background: rgba(255, 255, 255, 0.82);
            padding: 12px;
            box-shadow: 0 12px 30px rgba(23, 33, 29, 0.08);
        }

        canvas {
            width: 100%;
            height: auto;
            align-self: start;
            border: 1px solid #c9d2cc;
            border-radius: 4px;
            background: #151a17;
            image-rendering: pixelated;
        }

        .details {
            display: grid;
            align-content: start;
            gap: 8px;
            min-width: 0;
        }

        .details h3 {
            overflow-wrap: anywhere;
            font-size: 1.05rem;
        }

        .meta {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
        }

        .status {
            color: var(--muted);
            font-size: 0.9rem;
        }

        footer {
            padding: 4px 0 36px;
            color: var(--muted);
            font-size: 0.95rem;
        }

        @media (max-width: 560px) {
            header,
            main,
            footer {
                width: min(100% - 20px, 1120px);
            }

            .animation-card {
                grid-template-columns: 88px 1fr;
            }
        }
    </style>
</head>
<body>
    <header>
        <h1>Pixel Wall Animation Content</h1>
        <div class="summary" id="summary"></div>
    </header>
    <main id="manifests"></main>
    <footer>
        <p>Preview rendered from deployed .bin bytes.</p>
    </footer>
    <script id="content-data" type="application/json">
'@

        $htmlEnd = @'
    </script>
    <script>
        const content = JSON.parse(document.getElementById("content-data").textContent);
        const animationsByName = new Map(content.animations.map((animation) => [animation.name, animation]));
        const summary = document.getElementById("summary");
        const manifests = document.getElementById("manifests");

        summary.append(
            chip(`${content.animations.length} animation${content.animations.length === 1 ? "" : "s"}`),
            chip(`${Object.keys(content.buckets).length} manifest${Object.keys(content.buckets).length === 1 ? "" : "s"}`)
        );

        for (const [dimensions, names] of Object.entries(content.buckets)) {
            const section = document.createElement("section");
            const title = document.createElement("div");
            title.className = "manifest-title";

            const heading = document.createElement("h2");
            heading.textContent = dimensions;
            const link = document.createElement("a");
            link.href = `manifest/${dimensions}`;
            link.textContent = `manifest/${dimensions}`;
            title.append(heading, link, chip(`${names.length} item${names.length === 1 ? "" : "s"}`));

            const list = document.createElement("ol");
            list.start = 0;
            names.forEach((name, imageIndex) => {
                const animation = animationsByName.get(name);
                if (animation) {
                    list.append(animationCard(animation, imageIndex));
                }
            });

            section.append(title, list);
            manifests.append(section);
        }

        function chip(text) {
            const element = document.createElement("span");
            element.textContent = text;
            return element;
        }

        function animationCard(animation, imageIndex) {
            const item = document.createElement("li");
            const card = document.createElement("article");
            card.className = "animation-card";

            const canvas = document.createElement("canvas");
            canvas.width = animation.width;
            canvas.height = animation.height;
            canvas.setAttribute("aria-label", `${animation.name} preview`);

            const details = document.createElement("div");
            details.className = "details";
            const heading = document.createElement("h3");
            const link = document.createElement("a");
            link.href = animation.path;
            link.textContent = animation.name;
            heading.append(link);

            const detailNodes = [heading];
            if (animation.githubUrl) {
                const links = document.createElement("div");
                links.className = "links";
                const githubLink = document.createElement("a");
                githubLink.href = animation.githubUrl;
                githubLink.textContent = "GitHub source";
                githubLink.target = "_blank";
                githubLink.rel = "noreferrer";
                links.append(githubLink);
                detailNodes.push(links);
            }

            const meta = document.createElement("div");
            meta.className = "meta";
            meta.append(
                chip(animation.dimensions),
                chip(`${animation.frames} frames`),
                chip(`${animation.fps} fps`),
                chip(`${animation.paletteColors} colors`),
                chip(`${animation.bytes.toLocaleString()} bytes`)
            );

            const status = document.createElement("p");
            status.className = "status";
            status.textContent = "Loading preview...";

            detailNodes.push(meta, status);
            details.append(...detailNodes);
            card.append(canvas, details);
            item.append(card);
            renderAnimationPreview(animation, canvas, status);
            return item;
        }

        async function renderAnimationPreview(animation, canvas, status) {
            try {
                const response = await fetch(animation.path);
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }

                const decoded = decodeAnimationBinary(new Uint8Array(await response.arrayBuffer()), animation.width, animation.height);
                const context = canvas.getContext("2d");
                const delay = Math.max(20, Math.round(1000 / Math.max(1, decoded.fps)));
                let frame = 0;
                drawFrame(context, decoded, frame);
                status.textContent = "";
                status.hidden = true;

                if (decoded.frames.length > 1) {
                    window.setInterval(() => {
                        frame = (frame + 1) % decoded.frames.length;
                        drawFrame(context, decoded, frame);
                    }, delay);
                }
            } catch (error) {
                status.hidden = false;
                status.textContent = `Preview unavailable: ${error.message}`;
            }
        }

        function decodeAnimationBinary(bytes, width, height) {
            if (bytes.length < 10) {
                throw new Error("file is smaller than the header");
            }

            const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
            const fps = view.getUint8(3);
            const paletteBytes = view.getUint16(4, true);
            const frameBytes = view.getUint32(6, true);
            const totalPixels = width * height;
            const palette = [];
            let offset = 10;
            for (let index = 0; index < paletteBytes; index += 3) {
                palette.push([bytes[offset + index], bytes[offset + index + 1], bytes[offset + index + 2]]);
            }

            offset += paletteBytes;
            const frameEnd = offset + frameBytes;
            const frames = [];
            let current = null;
            while (offset < frameEnd) {
                const record = bytes[offset];
                offset += 1;
                if (record === 0x49) {
                    const pixelCount = readU16BE(bytes, offset);
                    offset += 2;
                    current = new Uint8Array(totalPixels);
                    current.set(bytes.subarray(offset, offset + pixelCount), 0);
                    offset += pixelCount;
                    frames.push(current.slice());
                } else if (record === 0x50) {
                    if (!current) {
                        throw new Error("predictive frame before keyframe");
                    }
                    const changedPixels = readU16BE(bytes, offset);
                    offset += 2;
                    const positionBytes = totalPixels > 256 ? 2 : 1;
                    const next = current.slice();
                    for (let index = 0; index < changedPixels; index += 1) {
                        const position = positionBytes === 2 ? readU16BE(bytes, offset) : bytes[offset];
                        offset += positionBytes;
                        next[position] = bytes[offset];
                        offset += 1;
                    }
                    current = next;
                    frames.push(current.slice());
                } else if (record === 0x44 || record === 0x46) {
                    offset += 2;
                } else {
                    throw new Error(`unknown record 0x${record.toString(16)}`);
                }
            }

            return { fps, palette, frames, width, height };
        }

        function drawFrame(context, decoded, frameIndex) {
            const image = context.createImageData(decoded.width, decoded.height);
            const frame = decoded.frames[frameIndex];
            for (let pixel = 0; pixel < frame.length; pixel += 1) {
                const color = decoded.palette[frame[pixel]] || [0, 0, 0];
                const offset = pixel * 4;
                image.data[offset] = color[0];
                image.data[offset + 1] = color[1];
                image.data[offset + 2] = color[2];
                image.data[offset + 3] = 255;
            }
            context.putImageData(image, 0, 0);
        }

        function readU16BE(bytes, offset) {
            return (bytes[offset] << 8) | bytes[offset + 1];
        }
    </script>
</body>
</html>
'@

        $indexHtmlPath = Join-Path $OutputPath "index.html"
        Set-Content -Path $indexHtmlPath -Value ($htmlStart + "`n" + $contentJson + "`n" + $htmlEnd) -Encoding utf8
        return $indexHtmlPath
}

function Get-PixelWallAnimationBinInfo {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory, ValueFromPipeline, ValueFromPipelineByPropertyName)]
        [Alias("FullName")]
        [string[]]$Path,

        [string]$Dimensions,

        [hashtable]$DimensionMap
    )

    process {
        foreach ($item in $Path) {
            $resolvedPath = (Resolve-Path $item).ProviderPath
            $name = [System.IO.Path]::GetFileNameWithoutExtension($resolvedPath)
            $leafName = [System.IO.Path]::GetFileName($resolvedPath)
            $bytes = [System.IO.File]::ReadAllBytes($resolvedPath)

            if ($bytes.Length -lt 10) {
                throw "Animation binary is smaller than the 10-byte header: $resolvedPath"
            }

            $frameCount = Read-UInt16LittleEndian $bytes 0
            $loopCount = [int]$bytes[2]
            $fps = [int]$bytes[3]
            $paletteBytes = Read-UInt16LittleEndian $bytes 4
            $frameBytes = Read-UInt32LittleEndian $bytes 6
            $declaredSize = 10 + $paletteBytes + $frameBytes

            if ($frameCount -eq 0) {
                throw "Animation binary has zero frames: $resolvedPath"
            }
            if ($fps -eq 0) {
                throw "Animation binary has zero FPS: $resolvedPath"
            }
            if ($paletteBytes -eq 0 -or $paletteBytes % 3 -ne 0) {
                throw "Invalid palette byte count $paletteBytes in $resolvedPath"
            }
            if ($declaredSize -gt $bytes.Length) {
                throw "Header declares $declaredSize bytes, but file has $($bytes.Length): $resolvedPath"
            }

            $paletteColorCount = [int]($paletteBytes / 3)
            $frameStart = 10 + $paletteBytes
            $offset = $frameStart
            $frameEnd = $frameStart + $frameBytes
            $decodedFrames = 0
            $totalPixels = 0
            $hasCurrentFrame = $false
            $recordCounts = [ordered]@{ I = 0; P = 0; D = 0; F = 0 }

            while ($offset -lt $frameEnd) {
                $record = [char]$bytes[$offset]
                $offset += 1

                switch ($record) {
                    "I" {
                        Assert-AvailableBytes $bytes $offset 2 "keyframe pixel count"
                        $pixelCount = Read-UInt16BigEndian $bytes $offset
                        $offset += 2
                        if ($totalPixels -eq 0) {
                            $totalPixels = $pixelCount
                        }
                        if ($pixelCount -gt $totalPixels) {
                            throw "Keyframe has $pixelCount pixels, expected at most $totalPixels in $resolvedPath"
                        }
                        Assert-AvailableBytes $bytes $offset $pixelCount "keyframe pixels"
                        for ($index = 0; $index -lt $pixelCount; $index += 1) {
                            if ($bytes[($offset + $index)] -ge $paletteColorCount) {
                                throw "Palette index $($bytes[($offset + $index)]) is outside the $paletteColorCount-color palette in $resolvedPath"
                            }
                        }
                        $offset += $pixelCount
                        $decodedFrames += 1
                        $hasCurrentFrame = $true
                        $recordCounts.I += 1
                    }
                    "P" {
                        if (!$hasCurrentFrame -or $totalPixels -eq 0) {
                            throw "Predictive frame appeared before a keyframe in $resolvedPath"
                        }
                        Assert-AvailableBytes $bytes $offset 2 "predictive pixel count"
                        $changedPixels = Read-UInt16BigEndian $bytes $offset
                        $offset += 2
                        $positionBytes = if ($totalPixels -gt 256) { 2 } else { 1 }
                        Assert-AvailableBytes $bytes $offset ($changedPixels * ($positionBytes + 1)) "predictive pixels"
                        for ($index = 0; $index -lt $changedPixels; $index += 1) {
                            $position = if ($positionBytes -eq 2) { Read-UInt16BigEndian $bytes $offset } else { [int]$bytes[$offset] }
                            $offset += $positionBytes
                            $paletteIndex = [int]$bytes[$offset]
                            $offset += 1
                            if ($position -ge $totalPixels) {
                                throw "Predictive frame pixel position $position is outside the $totalPixels-pixel frame in $resolvedPath"
                            }
                            if ($paletteIndex -ge $paletteColorCount) {
                                throw "Palette index $paletteIndex is outside the $paletteColorCount-color palette in $resolvedPath"
                            }
                        }
                        $decodedFrames += 1
                        $recordCounts.P += 1
                    }
                    "D" {
                        Assert-AvailableBytes $bytes $offset 2 "delay action"
                        $offset += 2
                        $recordCounts.D += 1
                    }
                    "F" {
                        Assert-AvailableBytes $bytes $offset 2 "fade action"
                        $offset += 2
                        $recordCounts.F += 1
                    }
                    default {
                        $recordOffset = $offset - $frameStart - 1
                        throw "Unknown frame record 0x$('{0:x2}' -f [int][byte][char]$record) at frame byte $recordOffset in $resolvedPath"
                    }
                }
            }

            if ($decodedFrames -le 0) {
                throw "Animation binary contains no renderable frames in $resolvedPath"
            }
            if ($frameCount -ne $decodedFrames) {
                throw "Header says $frameCount frames, decoded $decodedFrames frames in $resolvedPath"
            }
            if ($totalPixels -le 0 -or $totalPixels -gt $MaxPixelCount) {
                throw "Unsupported pixel count $totalPixels in $resolvedPath"
            }

            $dimensionParts = Resolve-AnimationDimensions -TotalPixels $totalPixels -Name $name -LeafName $leafName -Dimensions $Dimensions -DimensionMap $DimensionMap

            [pscustomobject]@{
                Path = $resolvedPath
                Name = $name
                SizeBytes = $bytes.Length
                DeclaredSizeBytes = $declaredSize
                ExtraBytes = $bytes.Length - $declaredSize
                DeclaredFrameCount = $frameCount
                FrameCount = $decodedFrames
                LoopCount = $loopCount
                FramesPerSecond = $fps
                PaletteBytes = $paletteBytes
                PaletteColorCount = $paletteColorCount
                FrameBytes = $frameBytes
                TotalPixels = $totalPixels
                Width = $dimensionParts.Width
                Height = $dimensionParts.Height
                Dimensions = $dimensionParts.Dimensions
                Records = [pscustomobject]$recordCounts
            }
        }
    }
}

function Publish-PixelWallAnimationContent {
    [CmdletBinding(SupportsShouldProcess)]
    param(
        [string]$InputPath = (Join-Path (Join-Path (Get-Location) "assets") "processed"),

        [string]$OutputPath = (Join-Path (Get-Location) "_site"),

        [string]$DimensionMapPath,

        [string]$RepositoryUrl,

        [string]$SourceRef,

        [switch]$Recurse,

        [switch]$Clean,

        [switch]$PassThru
    )

    $resolvedInput = (Resolve-Path $InputPath).ProviderPath
    if ([string]::IsNullOrWhiteSpace($DimensionMapPath) -and (Test-Path $resolvedInput -PathType Container)) {
        foreach ($candidate in @("dimensions.json", ".dimensions.json")) {
            $candidatePath = Join-Path $resolvedInput $candidate
            if (Test-Path $candidatePath -PathType Leaf) {
                $DimensionMapPath = $candidatePath
                break
            }
        }
    }

    $dimensionMap = Read-DimensionMap $DimensionMapPath
    $files = if (Test-Path $resolvedInput -PathType Container) {
        Get-ChildItem -Path $resolvedInput -Filter "*.bin" -File -Recurse:$Recurse | Sort-Object FullName
    } else {
        @(Get-Item -Path $resolvedInput)
    }

    if ($files.Count -eq 0) {
        throw "No .bin files found in $resolvedInput"
    }

    $repositoryRoot = (Get-Location).ProviderPath
    $githubSourceTreeBaseUrl = Resolve-GitHubSourceTreeBaseUrl -RepositoryUrl $RepositoryUrl -SourceRef $SourceRef

    if ($Clean -and (Test-Path $OutputPath)) {
        Remove-Item -Path $OutputPath -Recurse -Force
    }

    $animationsDir = Join-Path $OutputPath "animations"
    $manifestDir = Join-Path $OutputPath "manifest"
    New-Item -ItemType Directory -Path $animationsDir, $manifestDir -Force | Out-Null

    $seenNames = @{}
    $infos = @()
    foreach ($file in $files) {
        if (!$file.Extension.Equals(".bin", [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "Input file must be a .bin animation: $($file.FullName)"
        }

        $info = Get-PixelWallAnimationBinInfo -Path $file.FullName -DimensionMap $dimensionMap
        Assert-ContentName $info.Name
        $sourcePath = ConvertTo-RepositoryRelativePath -Path $file.FullName -RootPath $repositoryRoot
        $info | Add-Member -NotePropertyName SourcePath -NotePropertyValue $sourcePath
        if (![string]::IsNullOrWhiteSpace($githubSourceTreeBaseUrl)) {
            $info | Add-Member -NotePropertyName GitHubUrl -NotePropertyValue "$githubSourceTreeBaseUrl/$(ConvertTo-UrlPath $sourcePath)"
        }
        if ($seenNames.ContainsKey($info.Name)) {
            throw "Duplicate animation name '$($info.Name)' from $($file.FullName) and $($seenNames[$info.Name])."
        }
        $seenNames[$info.Name] = $file.FullName

        $destination = Join-Path $animationsDir "$($info.Name).bin"
        if ($PSCmdlet.ShouldProcess($destination, "Copy animation")) {
            Copy-Item -Path $file.FullName -Destination $destination -Force
        }

        $infos += $info
    }

    $buckets = [ordered]@{}
    foreach ($group in ($infos | Group-Object Dimensions | Sort-Object Name)) {
        $names = @($group.Group | Sort-Object Name | ForEach-Object { $_.Name })
        $buckets[$group.Name] = $names
        $manifestPath = Join-Path $manifestDir $group.Name
        $manifestLines = @("# $($group.Name) animations") + $names
        if ($PSCmdlet.ShouldProcess($manifestPath, "Write manifest")) {
            Set-Content -Path $manifestPath -Value $manifestLines -Encoding ascii
        }
    }

    $index = [ordered]@{
        schemaVersion = 1
        buckets = $buckets
        animations = @($infos | Sort-Object Dimensions, Name | ForEach-Object {
            $animation = [ordered]@{
                name = $_.Name
                dimensions = $_.Dimensions
                width = $_.Width
                height = $_.Height
                frames = $_.FrameCount
                fps = $_.FramesPerSecond
                paletteColors = $_.PaletteColorCount
                bytes = $_.SizeBytes
                path = "animations/$($_.Name).bin"
                sourcePath = $_.SourcePath
            }
            if (![string]::IsNullOrWhiteSpace($_.GitHubUrl)) {
                $animation.githubUrl = $_.GitHubUrl
            }
            $animation
        })
    }

    $indexPath = Join-Path $OutputPath "content-index.json"
    if ($PSCmdlet.ShouldProcess($indexPath, "Write content index")) {
        $index | ConvertTo-Json -Depth 8 | Set-Content -Path $indexPath -Encoding utf8
    }

    $indexHtmlPath = Join-Path $OutputPath "index.html"
    if ($PSCmdlet.ShouldProcess($indexHtmlPath, "Write HTML index")) {
        $indexHtmlPath = Write-ContentIndexHtml -OutputPath $OutputPath -Index $index
    }

    if ($PassThru) {
        $infos
    } else {
        [pscustomobject]@{
            OutputPath = (Resolve-Path $OutputPath).ProviderPath
            AnimationCount = $infos.Count
            Dimensions = @($buckets.Keys)
            IndexPath = (Resolve-Path $indexPath).ProviderPath
            IndexHtmlPath = (Resolve-Path $indexHtmlPath).ProviderPath
        }
    }
}

Export-ModuleMember -Function Get-PixelWallAnimationBinInfo, Publish-PixelWallAnimationContent