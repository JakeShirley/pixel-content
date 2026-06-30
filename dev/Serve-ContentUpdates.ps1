[CmdletBinding()]
param(
    [int]$Port = 8000,
    [string]$ContentPath,
    [string]$SourceAnimation = (Join-Path $PSScriptRoot "..\PixelWallFirmware\data\animations\jeb-tiny-jens.bin"),
    [string]$Name = "dynamic-test",
    [string]$Dimensions = "64x64",
    [string]$ServeRoot = (Join-Path $PSScriptRoot ".content-update-server")
)

$ErrorActionPreference = "Stop"
$MaxContentNameBytes = 96

if ($Dimensions -notmatch '^\d+x\d+$') {
    throw "Manifest dimensions must use <width>x<height>: $Dimensions"
}

function Find-Python {
    $commands = @("python", "py")
    foreach ($name in $commands) {
        $command = Get-Command $name -ErrorAction SilentlyContinue
        if ($command) {
            return [pscustomobject]@{
                Exe = $command.Source
                PrefixArgs = if ($name -eq "py") { @("-3") } else { @() }
            }
        }
    }

    $candidateRoots = @(
        (Join-Path $env:LOCALAPPDATA "Programs\Python\Python310"),
        (Join-Path $env:LOCALAPPDATA "Programs\Python\Python311"),
        (Join-Path $env:LOCALAPPDATA "Programs\Python\Python312")
    )

    foreach ($root in $candidateRoots) {
        $candidate = Join-Path $root "python.exe"
        if (Test-Path $candidate) {
            return [pscustomobject]@{
                Exe = $candidate
                PrefixArgs = @()
            }
        }
    }

    throw "Python 3 was not found. Install Python or add python.exe to PATH."
}

function Get-LocalIPv4Addresses {
    [System.Net.Dns]::GetHostAddresses([System.Net.Dns]::GetHostName()) |
        Where-Object { $_.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork -and $_.IPAddressToString -ne "127.0.0.1" } |
        ForEach-Object { $_.IPAddressToString } |
        Sort-Object -Unique
}

function Get-ManifestPath {
    param(
        [string]$Root,
        [string]$ContentDimensions
    )

    Join-Path (Join-Path $Root "manifest") $ContentDimensions
}

function Write-ManifestFile {
    param(
        [System.Collections.Generic.List[string]]$ManifestLines,
        [string]$ContentDimensions
    )

    $manifestPath = Get-ManifestPath -Root $ServeRoot -ContentDimensions $ContentDimensions
    New-Item -ItemType Directory -Path (Split-Path $manifestPath -Parent) -Force | Out-Null
    Set-Content -Path $manifestPath -Value $ManifestLines -Encoding ascii
    return $manifestPath
}

function Add-ManifestEntry {
    param(
        [System.Collections.Generic.List[string]]$ManifestLines,
        [string]$InputPath,
        [string]$ContentName,
        [string]$ContentDimensions
    )

    if (!(Test-Path $InputPath)) {
        throw "Animation file not found: $InputPath"
    }
    if ($ContentName.EndsWith(".bin")) {
        $ContentName = [System.IO.Path]::GetFileNameWithoutExtension($ContentName)
    }
    if ($ContentName.Length -eq 0 -or $ContentName.Length -gt $MaxContentNameBytes -or $ContentName -notmatch '^[A-Za-z0-9_-]+$') {
        throw "Manifest name must be 1-$MaxContentNameBytes chars using letters, numbers, '-' or '_': $ContentName"
    }
    if ($ContentDimensions -notmatch '^\d+x\d+$') {
        throw "Manifest dimensions must use <width>x<height>: $ContentDimensions"
    }

    $animationsDir = Join-Path $ServeRoot "animations"
    New-Item -ItemType Directory -Path $animationsDir -Force | Out-Null
    $outputPath = Join-Path $animationsDir "$ContentName.bin"
    Copy-Item $InputPath $outputPath -Force

    $ManifestLines.Add($ContentName)
}

function Initialize-GeneratedServeRoot {
    if (Test-Path $ServeRoot) {
        try {
            Remove-Item $ServeRoot -Recurse -Force
        } catch {
            throw "Could not reset ServeRoot '$ServeRoot'. Stop any existing test server or pass -ServeRoot with a different folder. $($_.Exception.Message)"
        }
    }

    New-Item -ItemType Directory -Path (Join-Path $ServeRoot "animations") -Force | Out-Null
}

function Get-BinFilesForContentDirectory {
    param([string]$Directory)

    $topLevelFiles = @(Get-ChildItem -Path $Directory -Filter "*.bin" -File -ErrorAction SilentlyContinue | Sort-Object Name)
    if ($topLevelFiles.Count -gt 0) {
        return $topLevelFiles
    }

    $animationsDirectory = Join-Path $Directory "animations"
    if (Test-Path $animationsDirectory -PathType Container) {
        return @(Get-ChildItem -Path $animationsDirectory -Filter "*.bin" -File -ErrorAction SilentlyContinue | Sort-Object Name)
    }

    throw "ContentPath directory does not contain manifest or any .bin files: $Directory"
}

$python = Find-Python
$playNames = [System.Collections.Generic.List[string]]::new()
$servingExistingContent = $false

if (![string]::IsNullOrWhiteSpace($ContentPath)) {
    $resolvedContentPath = (Resolve-Path $ContentPath).ProviderPath
    if (Test-Path $resolvedContentPath -PathType Container) {
        $existingManifest = Get-ManifestPath -Root $resolvedContentPath -ContentDimensions $Dimensions
        if (Test-Path $existingManifest -PathType Leaf) {
            $ServeRoot = $resolvedContentPath
            $manifestPath = $existingManifest
            $servingExistingContent = $true
        } else {
            Initialize-GeneratedServeRoot
            $manifestLines = [System.Collections.Generic.List[string]]::new()
            $manifestLines.Add("# Pixel Wall dynamic content test manifest")
            foreach ($animation in @(Get-BinFilesForContentDirectory $resolvedContentPath)) {
                $contentName = [System.IO.Path]::GetFileNameWithoutExtension($animation.Name)
                Add-ManifestEntry -ManifestLines $manifestLines -InputPath $animation.FullName -ContentName $contentName -ContentDimensions $Dimensions
                $playNames.Add($contentName)
            }

            $manifestPath = Write-ManifestFile -ManifestLines $manifestLines -ContentDimensions $Dimensions
        }
    } else {
        if (![System.IO.Path]::GetExtension($resolvedContentPath).Equals(".bin", [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "ContentPath file must be a .bin animation file: $resolvedContentPath"
        }

        Initialize-GeneratedServeRoot
        $manifestLines = [System.Collections.Generic.List[string]]::new()
        $manifestLines.Add("# Pixel Wall dynamic content test manifest")
        $contentName = if ($PSBoundParameters.ContainsKey("Name")) { $Name } else { [System.IO.Path]::GetFileNameWithoutExtension((Split-Path $resolvedContentPath -Leaf)) }
        Add-ManifestEntry -ManifestLines $manifestLines -InputPath $resolvedContentPath -ContentName $contentName -ContentDimensions $Dimensions
        $playNames.Add($contentName)
        $manifestPath = Write-ManifestFile -ManifestLines $manifestLines -ContentDimensions $Dimensions
    }
} else {
    Initialize-GeneratedServeRoot
    $manifestLines = [System.Collections.Generic.List[string]]::new()
    $manifestLines.Add("# Pixel Wall dynamic content test manifest")

    Add-ManifestEntry -ManifestLines $manifestLines -InputPath $SourceAnimation -ContentName $Name -ContentDimensions $Dimensions
    $playNames.Add($Name)

    $manifestPath = Write-ManifestFile -ManifestLines $manifestLines -ContentDimensions $Dimensions
}

Write-Host "Dynamic content test root: $ServeRoot"
Write-Host "Manifest: $manifestPath"
Write-Host "Python: $($python.Exe)"
if ($servingExistingContent) {
    Write-Host "Mode: serving existing content path"
} else {
    Write-Host "Mode: generated manifest"
}
Write-Host ""
Write-Host "From the Pixel Wall web UI or serial shell, run one of these commands:"
foreach ($ip in Get-LocalIPv4Addresses) {
    Write-Host "  update-now http://$ip`:$Port"
}
Write-Host ""
if ($playNames.Count -gt 0) {
    Write-Host "Then test playback with one of these names:"
    foreach ($name in $playNames) {
        Write-Host "  play-loop $name"
    }
    Write-Host ""
}
Write-Host "Press Ctrl+C to stop the server. If Windows Firewall prompts, allow Python on private networks."
Write-Host ""

$pythonArgs = @()
$pythonArgs += $python.PrefixArgs
$pythonArgs += @("-m", "http.server", [string]$Port, "--bind", "0.0.0.0")

Push-Location $ServeRoot
try {
    & $python.Exe @pythonArgs
    exit $LASTEXITCODE
}
finally {
    Pop-Location
}