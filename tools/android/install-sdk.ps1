$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'env.ps1')
$workspaceRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$catalog = Get-Content -Raw -LiteralPath (Join-Path $workspaceRoot 'node_modules\react-native\gradle\libs.versions.toml')
function Read-Version([string]$Name) {
    $match = [regex]::Match($catalog, "(?m)^$Name\s*=\s*`"([^`"]+)`"")
    if (-not $match.Success) { throw "Cannot read React Native $Name" }
    return $match.Groups[1].Value
}
$compileApi = Read-Version 'compileSdk'
$buildTools = Read-Version 'buildTools'
$ndk = Read-Version 'ndkVersion'
$devices = @(& adb devices | Where-Object { $_ -match '^\S+\s+device$' })
if ($devices.Count -ne 1) { throw 'Connect exactly one unlocked, USB-debugging-authorized phone first.' }
$phoneApi = (& adb shell getprop ro.build.version.sdk).Trim()
if ($phoneApi -notmatch '^\d+$') { throw 'Could not read phone Android API level' }
Write-Output "Phone API: $phoneApi; React Native compile API: $compileApi"
$available = (& sdkmanager --sdk_root="$env:ANDROID_HOME" --list) -join "`n"
$packages = @("build-tools;$buildTools", "ndk;$ndk", 'cmake;3.22.1')
foreach ($api in @($compileApi, $phoneApi) | Select-Object -Unique) {
    $platform = @("platforms;android-$api", "platforms;android-$api.0") | Where-Object { $available -match "(?m)^\s*$([regex]::Escape($_))\s+\|" } | Select-Object -First 1
    if (-not $platform) { throw "No stable SDK platform found for API $api" }
    $packages += $platform
}
& sdkmanager --sdk_root="$env:ANDROID_HOME" @packages
if ($LASTEXITCODE -ne 0) { throw 'SDK package installation failed' }
