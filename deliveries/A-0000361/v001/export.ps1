param([Parameter(Mandatory)][string]$GeneratedSource)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Set-Location $PSScriptRoot
New-Item -ItemType Directory -Force source,assets,preview | Out-Null
Copy-Item -LiteralPath $GeneratedSource -Destination source/generated-panel.png
$raw = [System.Drawing.Image]::FromFile((Join-Path $PSScriptRoot 'source/generated-panel.png'))
$sprite = [System.Drawing.Bitmap]::new(512,512)
$g = [System.Drawing.Graphics]::FromImage($sprite)
$g.Clear([System.Drawing.Color]::Transparent)
$g.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g.DrawImage($raw,[System.Drawing.Rectangle]::new(0,0,512,512))
$g.Dispose()
$raw.Dispose()
$sprite.Save((Join-Path $PSScriptRoot 'assets/UI-PANEL.png'))
# Keep each 80-pixel corner unchanged; stretch only edge strips and center.
$border = 80
$sourceStops = @(0,$border,(512-$border),512)
$checks = @()
foreach ($variant in @(@{id='P02';width=1620;height=820},@{id='P03';width=1220;height=590},@{id='P04';width=1620;height=820}))
{
    $target = [System.Drawing.Bitmap]::new($variant.width,$variant.height)
    $g = [System.Drawing.Graphics]::FromImage($target)
    $g.Clear([System.Drawing.Color]::Transparent)
    $g.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
    $dx = @(0,$border,($variant.width-$border),$variant.width)
    $dy = @(0,$border,($variant.height-$border),$variant.height)
    for ($row=0; $row -lt 3; $row++)
    {
        for ($col=0; $col -lt 3; $col++)
        {
            $rect = [System.Drawing.Rectangle]::new($dx[$col],$dy[$row],$dx[$col+1]-$dx[$col],$dy[$row+1]-$dy[$row])
            $g.DrawImage($sprite,$rect,$sourceStops[$col],$sourceStops[$row],$sourceStops[$col+1]-$sourceStops[$col],$sourceStops[$row+1]-$sourceStops[$row],[System.Drawing.GraphicsUnit]::Pixel)
        }
    }
    $g.Dispose()
    $mismatches=0
    foreach ($corner in @(@{sx=0;sy=0;tx=0;ty=0},@{sx=432;sy=0;tx=$variant.width-80;ty=0},@{sx=0;sy=432;tx=0;ty=$variant.height-80},@{sx=432;sy=432;tx=$variant.width-80;ty=$variant.height-80}))
    {
        for ($y=0; $y -lt 80; $y++) { for ($x=0; $x -lt 80; $x++) {
            # Copy protected corners byte-for-byte, avoiding GDI alpha rounding.
            $target.SetPixel($corner.tx+$x,$corner.ty+$y,$sprite.GetPixel($corner.sx+$x,$corner.sy+$y))
            if ($sprite.GetPixel($corner.sx+$x,$corner.sy+$y).ToArgb() -ne $target.GetPixel($corner.tx+$x,$corner.ty+$y).ToArgb()) { $mismatches++ }
        } }
    }
    $target.Save((Join-Path $PSScriptRoot "preview/$($variant.id).png"))
    $checks += @{variant=$variant.id;width=$target.Width;height=$target.Height;cornerPixelMismatches=$mismatches;cornersUnchanged=($mismatches -eq 0)}
    $target.Dispose()
}
$sprite.Dispose()
$checks | ConvertTo-Json -Depth 6 | Set-Content validation.json -Encoding utf8
$checks | ConvertTo-Json -Depth 6
Get-ChildItem source,assets,preview -Filter *.png | ForEach-Object { @{path=$_.FullName.Substring($PSScriptRoot.Length+1);sha256=(Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()} } | ConvertTo-Json | Set-Content sha256.json -Encoding utf8
