param(
    [ValidateSet('Debug', 'Preview')][string]$Variant = 'Debug',
    [switch]$SkipPrebuild
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'env.ps1')
$workspaceRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$appRoot = Join-Path $workspaceRoot 'app'
$artifactRoot = Join-Path $workspaceRoot '.artifacts'
New-Item -ItemType Directory -Path $artifactRoot -Force | Out-Null
Push-Location $appRoot
try {
    if (-not $SkipPrebuild) {
        & npx expo prebuild --platform android --no-install
        if ($LASTEXITCODE -ne 0) { throw 'Android prebuild failed' }
    } elseif (-not (Test-Path -LiteralPath (Join-Path $appRoot 'android/gradlew.bat'))) {
        throw 'No native project exists; build once without -SkipPrebuild first'
    }
    # Image-picker can globally block this permission even when expo-audio enables it.
    # Reject that generated project before producing an APK with unusable voice capture.
    $voiceManifest = [xml](Get-Content -LiteralPath (Join-Path $appRoot 'android/app/src/main/AndroidManifest.xml') -Raw)
    $voicePermission = @($voiceManifest.manifest.'uses-permission' | Where-Object {
        $_.GetAttribute('name', 'http://schemas.android.com/apk/res/android') -eq 'android.permission.RECORD_AUDIO'
    })
    if ($voicePermission.Count -eq 0 -or @($voicePermission | Where-Object {
        $_.GetAttribute('node', 'http://schemas.android.com/tools') -eq 'remove'
    }).Count -gt 0) {
        throw 'Voice recording permission is missing or blocked in the generated Android manifest.'
    }
    Push-Location (Join-Path $appRoot 'android')
    try {
        $buildTask = if ($Variant -eq 'Preview') { ':app:assembleRelease' } else { ':app:assembleDebug' }
        & .\gradlew.bat $buildTask '-PreactNativeArchitectures=arm64-v8a' '-Dorg.gradle.jvmargs=-Xmx4g -XX:MaxMetaspaceSize=1g' --console=plain --max-workers=4 *> (Join-Path $artifactRoot 'android-build.log')
        if ($LASTEXITCODE -ne 0) {
            Get-Content -LiteralPath (Join-Path $artifactRoot 'android-build.log') -Tail 70
            throw 'Android build failed; see .artifacts/android-build.log'
        }
        $sourceApk = if ($Variant -eq 'Preview') { 'app\build\outputs\apk\release\app-release.apk' } else { 'app\build\outputs\apk\debug\app-debug.apk' }
        $outputName = if ($Variant -eq 'Preview') { 'hermes-mobile-preview.apk' } else { 'hermes-mobile-development.apk' }
        Copy-Item -LiteralPath $sourceApk -Destination (Join-Path $artifactRoot $outputName) -Force
        Write-Output "Built .artifacts/$outputName"
    } finally { Pop-Location }
} finally { Pop-Location }
