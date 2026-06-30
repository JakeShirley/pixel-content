$MaxContentNameLength = 96
$MaxPixelCount = 65535

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

function Get-ESP32AnimationBinInfo {
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

            if ($decodedFrames -ne $frameCount) {
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
                FrameCount = $frameCount
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

function Publish-ESP32AnimationContent {
    [CmdletBinding(SupportsShouldProcess)]
    param(
        [string]$InputPath = (Join-Path (Join-Path (Get-Location) "assets") "processed"),

        [string]$OutputPath = (Join-Path (Get-Location) "_site"),

        [string]$DimensionMapPath,

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

        $info = Get-ESP32AnimationBinInfo -Path $file.FullName -DimensionMap $dimensionMap
        Assert-ContentName $info.Name
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
            [ordered]@{
                name = $_.Name
                dimensions = $_.Dimensions
                width = $_.Width
                height = $_.Height
                frames = $_.FrameCount
                fps = $_.FramesPerSecond
                paletteColors = $_.PaletteColorCount
                bytes = $_.SizeBytes
                path = "animations/$($_.Name).bin"
            }
        })
    }

    $indexPath = Join-Path $OutputPath "content-index.json"
    if ($PSCmdlet.ShouldProcess($indexPath, "Write content index")) {
        $index | ConvertTo-Json -Depth 8 | Set-Content -Path $indexPath -Encoding utf8
    }

    if ($PassThru) {
        $infos
    } else {
        [pscustomobject]@{
            OutputPath = (Resolve-Path $OutputPath).ProviderPath
            AnimationCount = $infos.Count
            Dimensions = @($buckets.Keys)
            IndexPath = (Resolve-Path $indexPath).ProviderPath
        }
    }
}

Export-ModuleMember -Function Get-ESP32AnimationBinInfo, Publish-ESP32AnimationContent