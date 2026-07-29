param(
    [Parameter(Mandatory=$true)][string]$Src,
    [string]$OutDir = "c:\.Project\Soto_Player\Soto_Player-Community\public\icons"
)

Add-Type -AssemblyName System.Drawing

function Get-PngBytes {
    param([string]$SrcPath, [int]$Size)
    $img = [System.Drawing.Image]::FromFile($SrcPath)
    $bmp = New-Object System.Drawing.Bitmap($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.DrawImage($img, 0, 0, $Size, $Size)
    $g.Dispose()
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $bytes = $ms.ToArray()
    $ms.Dispose()
    $bmp.Dispose()
    $img.Dispose()
    return $bytes
}

function Save-Png {
    param([string]$Path, [byte[]]$Bytes)
    [System.IO.File]::WriteAllBytes($Path, $Bytes)
    Write-Host "  $Path : $($Bytes.Length) bytes"
}

function Build-Ico {
    param([array]$Entries)
    $count = $Entries.Count
    $headerSize = 6 + $count * 16
    $totalDataSize = 0
    foreach ($e in $Entries) { $totalDataSize += $e.Bytes.Length }
    $totalLen = $headerSize + $totalDataSize
    $buf = New-Object byte[] -ArgumentList $totalLen
    $offset = 0

    [BitConverter]::GetBytes([uint16]0).CopyTo($buf, $offset); $offset += 2
    [BitConverter]::GetBytes([uint16]1).CopyTo($buf, $offset); $offset += 2
    [BitConverter]::GetBytes([uint16]$count).CopyTo($buf, $offset); $offset += 2

    $dataOffset = $headerSize
    foreach ($e in $Entries) {
        $dim = if ($e.Size -ge 256) { [byte]0 } else { [byte]$e.Size }
        $buf[$offset] = $dim; $offset += 1
        $buf[$offset] = $dim; $offset += 1
        $buf[$offset] = 0; $offset += 1
        $buf[$offset] = 0; $offset += 1
        [BitConverter]::GetBytes([uint16]1).CopyTo($buf, $offset); $offset += 2
        [BitConverter]::GetBytes([uint16]32).CopyTo($buf, $offset); $offset += 2
        [BitConverter]::GetBytes([uint32]$e.Bytes.Length).CopyTo($buf, $offset); $offset += 4
        [BitConverter]::GetBytes([uint32]$dataOffset).CopyTo($buf, $offset); $offset += 4
        $dataOffset += $e.Bytes.Length
    }

    foreach ($e in $Entries) {
        $e.Bytes.CopyTo($buf, $offset)
        $offset += $e.Bytes.Length
    }

    return $buf
}

Write-Host "=== Generating PNG sizes ==="
$pngSizes = @(16, 32, 48, 64, 96, 128, 192, 256, 512, 1024)
$pngEntries = @{}
foreach ($s in $pngSizes) {
    $bytes = Get-PngBytes -SrcPath $Src -Size $s
    $pngEntries[$s] = $bytes
    if ($s -le 512) {
        Save-Png -Path "$OutDir\favicon-${s}x${s}.png" -Bytes $bytes
    }
}

Write-Host "=== favicon.png (256x256) ==="
Save-Png -Path "$OutDir\favicon.png" -Bytes $pngEntries[256]

Write-Host "=== logo-icon.png (512x512) ==="
Save-Png -Path "$OutDir\logo-icon.png" -Bytes $pngEntries[512]

Write-Host "=== logo-icon-1024x1024.png ==="
Save-Png -Path "$OutDir\logo-icon-1024x1024.png" -Bytes $pngEntries[1024]

Write-Host "=== favicon.ico ==="
$icoEntries = @(16, 32, 48, 64, 128, 256) | ForEach-Object {
    @{ Size = $_; Bytes = $pngEntries[$_] }
}
$faviconIco = Build-Ico -Entries $icoEntries
[System.IO.File]::WriteAllBytes("$OutDir\favicon.ico", $faviconIco)
Write-Host "  $OutDir\favicon.ico : $($faviconIco.Length) bytes"

Write-Host "=== logo.ico ==="
[System.IO.File]::WriteAllBytes("$OutDir\logo.ico", $faviconIco)
Write-Host "  $OutDir\logo.ico : $($faviconIco.Length) bytes"

Write-Host "=== tray.ico ==="
$trayEntries = @(16, 32) | ForEach-Object {
    @{ Size = $_; Bytes = $pngEntries[$_] }
}
$trayIco = Build-Ico -Entries $trayEntries
$trayDir = "$OutDir\tray"
if (-not (Test-Path $trayDir)) { New-Item -ItemType Directory -Path $trayDir | Out-Null }
[System.IO.File]::WriteAllBytes("$trayDir\tray.ico", $trayIco)
Write-Host "  $trayDir\tray.ico : $($trayIco.Length) bytes"

Write-Host ""
Write-Host "=== Done ==="
