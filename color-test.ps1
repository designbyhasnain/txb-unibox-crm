Add-Type -AssemblyName System.Drawing
$path = "c:\Users\hamza\Desktop\txb-unibox-crm\txb-logo.png"
$img = [System.Drawing.Image]::FromFile($path)
$bmp = New-Object System.Drawing.Bitmap($img)

# Sample 5 points to find dominant color
$points = @(
    @($bmp.Width * 0.2, $bmp.Height * 0.2),
    @($bmp.Width * 0.5, $bmp.Height * 0.5),
    @($bmp.Width * 0.8, $bmp.Height * 0.8),
    @($bmp.Width * 0.5, $bmp.Height * 0.2),
    @($bmp.Width * 0.5, $bmp.Height * 0.8)
)

foreach ($p in $points) {
    $c = $bmp.GetPixel($p[0], $p[1])
    Write-Host ($c.R.ToString("X2") + $c.G.ToString("X2") + $c.B.ToString("X2"))
}

$img.Dispose()
$bmp.Dispose()
