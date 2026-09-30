$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Set-Location $PSScriptRoot
New-Item -ItemType Directory -Force source,layers,preview | Out-Null
$origin = 'C:/Users/Administrator/.codex/generated_images/01a0c872-8102-7cc1-b7ba-e611d68de552'
$sources = @{
    'L1-background' = 'exec-b8f09247-6268-41d3-80e1-b7efaacf789b.png'
    'L2-item40' = 'exec-08faab5b-a0c4-474f-af1f-a8e2befac6c0.png'
    'L2-item10' = 'exec-48c51ac0-f173-4032-adcd-8172cdaa9e8e.png'
    'L4-frame' = 'exec-d4033275-de98-4808-95bd-58651b3f4f40.png'
}
foreach ($name in $sources.Keys)
{
    Copy-Item -LiteralPath (Join-Path $origin $sources[$name]) -Destination "source/$name.png"
    $source = [System.Drawing.Image]::FromFile((Join-Path $PSScriptRoot "source/$name.png"))
    $bitmap = [System.Drawing.Bitmap]::new(128,128)
    $g = [System.Drawing.Graphics]::FromImage($bitmap)
    $g.Clear([System.Drawing.Color]::Transparent)
    $g.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $target = [System.Drawing.Rectangle]::new(0,0,128,128)
    if ($name.StartsWith('L2-'))
    {
        $target = [System.Drawing.Rectangle]::new(20,4,88,88)
    }
    $g.DrawImage($source,$target)
    $bitmap.Save((Join-Path $PSScriptRoot "layers/$name.png"))
    $g.Dispose()
    $bitmap.Dispose()
    $source.Dispose()
}
foreach ($item in @(@{Id=40;Name='测试晶石';Number='8'},@{Id=10;Name='测试金币';Number='6'}))
{
    $bitmap = [System.Drawing.Bitmap]::new(128,128)
    $g = [System.Drawing.Graphics]::FromImage($bitmap)
    $g.Clear([System.Drawing.Color]::Transparent)
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $font = [System.Drawing.Font]::new('Microsoft YaHei',11,[System.Drawing.FontStyle]::Bold,[System.Drawing.GraphicsUnit]::Pixel)
    $format = [System.Drawing.StringFormat]::new()
    $format.Alignment = [System.Drawing.StringAlignment]::Center
    $g.DrawString($item.Name,$font,[System.Drawing.Brushes]::White,[System.Drawing.RectangleF]::new(15,82,98,18),$format)
    $g.DrawString(('×'+$item.Number),$font,[System.Drawing.Brushes]::White,[System.Drawing.RectangleF]::new(15,99,98,18),$format)
    $bitmap.Save((Join-Path $PSScriptRoot "layers/L3-item$($item.Id)-text.png"))
    $font.Dispose()
    $format.Dispose()
    $g.Dispose()
    $bitmap.Dispose()
    $final = [System.Drawing.Bitmap]::new(128,128)
    $g = [System.Drawing.Graphics]::FromImage($final)
    $g.Clear([System.Drawing.Color]::Transparent)
    foreach ($layerName in @('L1-background',"L2-item$($item.Id)","L3-item$($item.Id)-text",'L4-frame'))
    {
        $layer = [System.Drawing.Image]::FromFile((Join-Path $PSScriptRoot "layers/$layerName.png"))
        $g.DrawImageUnscaled($layer,0,0)
        $layer.Dispose()
    }
    $final.Save((Join-Path $PSScriptRoot "preview/item$($item.Id)-128.png"))
    $g.Dispose()
    $final.Dispose()
}
$checks = @(Get-ChildItem layers,preview -Filter *.png | ForEach-Object {
    $image = [System.Drawing.Bitmap]::FromFile($_.FullName)
    $transparent = 0
    for ($y=0; $y -lt $image.Height; $y++) { for ($x=0; $x -lt $image.Width; $x++) { if ($image.GetPixel($x,$y).A -eq 0) { $transparent++ } } }
    [pscustomobject]@{file=$_.FullName.Substring($PSScriptRoot.Length+1);width=$image.Width;height=$image.Height;transparentPixels=$transparent;centerAlpha=$image.GetPixel(64,64).A;sha256=(Get-FileHash $_.FullName -Algorithm SHA256).Hash}
    $image.Dispose()
})
$checks | ConvertTo-Json -Depth 5 | Set-Content validation.json -Encoding utf8
if (@($checks | Where-Object { $_.width -ne 128 -or $_.height -ne 128 }).Count) { throw '尺寸错误' }
$checks | Format-Table file,width,height,transparentPixels,centerAlpha
