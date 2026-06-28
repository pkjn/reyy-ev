Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Image]::FromFile('e:\Startup\reyy\driver-app\assets\images\reyy-ev-logo.jpeg')
$img.Save('e:\Startup\reyy\driver-app\assets\images\reyy-ev-logo.png', [System.Drawing.Imaging.ImageFormat]::Png)
$img.Dispose()
