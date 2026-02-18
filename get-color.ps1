[Reflection.Assembly]::LoadWithPartialName("System.Drawing") | Out-Null
$path = "c:\Users\hamza\Desktop\txb-unibox-crm\txb-logo.png"
$img = New-Object System.Drawing.Bitmap($path)

function Get-DominantColor {
    $maxSatur = 0
    $bestColor = "#6366F1" # Default
    for ($x = 0; $x -lt $img.Width; $x += 5) {
        for ($y = 0; $y -lt $img.Height; $y += 5) {
            $px = $img.GetPixel($x, $y)
            if ($px.A -gt 200) {
                # Simple saturation formula: max(r,g,b) - min(r,g,b)
                $s = [Math]::Max($px.R, [Math]::Max($px.G, $px.B)) - [Math]::Min($px.R, [Math]::Min($px.G, $px.B))
                if ($s -gt $maxSatur) {
                    $maxSatur = $s
                    $bestColor = "#" + $px.R.ToString("X2") + $px.G.ToString("X2") + $px.B.ToString("X2")
                }
            }
        }
    }
    return $bestColor
}

$color = Get-DominantColor
Write-Host "DOMINANT_COLOR:$color"
$img.Dispose()
