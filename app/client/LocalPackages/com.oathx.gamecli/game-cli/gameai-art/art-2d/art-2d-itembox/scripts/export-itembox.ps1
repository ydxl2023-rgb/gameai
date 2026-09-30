param(
    [Parameter(Mandatory)][string]$DeliveryDirectory,
    [string]$Quantity = '99'
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$taskDirectory = (Resolve-Path -LiteralPath $DeliveryDirectory).Path
$layerDirectory = Join-Path $taskDirectory 'layers'
$previewDirectory = Join-Path $taskDirectory 'preview'
New-Item -ItemType Directory -Force -Path $layerDirectory,$previewDirectory | Out-Null
function New-Canvas
{
    return [System.Drawing.Bitmap]::new(128,128,[System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
}
function Save-Canvas($Bitmap,$Path)
{
    if (Test-Path -LiteralPath $Path)
    {
        throw "拒绝覆盖现有产物：$Path；请使用新的版本目录。"
    }
    $Bitmap.Save($Path,[System.Drawing.Imaging.ImageFormat]::Png)
}
foreach ($name in @('L1-background','L2-icon','L4-frame'))
{
    $inputPath = Join-Path $taskDirectory "source/$name-generated.png"
    $sourceImage = [System.Drawing.Image]::FromFile($inputPath)
    $canvas = New-Canvas
    $graphics = [System.Drawing.Graphics]::FromImage($canvas)
    try
    {
        $graphics.Clear([System.Drawing.Color]::Transparent)
        $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $graphics.DrawImage($sourceImage,[System.Drawing.Rectangle]::new(0,0,128,128),0,0,$sourceImage.Width,$sourceImage.Height,[System.Drawing.GraphicsUnit]::Pixel)
        Save-Canvas $canvas (Join-Path $layerDirectory "$name.png")
    }
    finally
    {
        $graphics.Dispose()
        $canvas.Dispose()
        $sourceImage.Dispose()
    }
}
$text = New-Canvas
$graphics = [System.Drawing.Graphics]::FromImage($text)
$fontFamily = [System.Drawing.FontFamily]::new('Arial')
$path = [System.Drawing.Drawing2D.GraphicsPath]::new()
$outline = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(240,26,20,15),2)
$fill = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255,255,246,216))
try
{
    $graphics.Clear([System.Drawing.Color]::Transparent)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $path.AddString($Quantity,$fontFamily,[int][System.Drawing.FontStyle]::Bold,20,[System.Drawing.PointF]::new(80,83),[System.Drawing.StringFormat]::GenericDefault)
    $graphics.DrawPath($outline,$path)
    $graphics.FillPath($fill,$path)
    Save-Canvas $text (Join-Path $layerDirectory 'L3-text.png')
}
finally
{
    $fill.Dispose()
    $outline.Dispose()
    $path.Dispose()
    $fontFamily.Dispose()
    $graphics.Dispose()
    $text.Dispose()
}
$final = New-Canvas
$graphics = [System.Drawing.Graphics]::FromImage($final)
try
{
    $graphics.Clear([System.Drawing.Color]::Transparent)
    foreach ($name in @('L1-background','L2-icon','L3-text','L4-frame'))
    {
        $layer = [System.Drawing.Image]::FromFile((Join-Path $layerDirectory "$name.png"))
        try
        {
            $graphics.DrawImageUnscaled($layer,0,0)
        }
        finally
        {
            $layer.Dispose()
        }
    }
    Save-Canvas $final (Join-Path $previewDirectory 'itembox-128.png')
}
finally
{
    $graphics.Dispose()
    $final.Dispose()
}
Write-Output '128×128四层资源与效果图已导出。'
