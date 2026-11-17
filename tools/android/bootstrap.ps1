$ErrorActionPreference = 'Stop'
$workspaceRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$toolchainRoot = Join-Path $workspaceRoot '.toolchain'
$downloadsRoot = Join-Path $toolchainRoot 'downloads'
New-Item -ItemType Directory -Path $downloadsRoot -Force | Out-Null

function Get-VerifiedArchive([string]$Uri, [string]$Target, [string]$Sha256) {
    if (-not (Test-Path -LiteralPath $Target)) {
        Invoke-WebRequest -Uri $Uri -OutFile $Target
    }
    $actualHash = (Get-FileHash -LiteralPath $Target -Algorithm SHA256).Hash
    if ($actualHash -ne $Sha256) { throw "Download checksum mismatch: $Target" }
    Write-Output "Verified archive: $(Split-Path $Target -Leaf)"
}

$jdkRoot = Join-Path $toolchainRoot 'java'
if (-not (Get-ChildItem -LiteralPath $jdkRoot -Directory -ErrorAction SilentlyContinue)) {
    $jdkMetadata = Invoke-RestMethod 'https://api.adoptium.net/v3/assets/latest/17/hotspot?architecture=x64&image_type=jdk&os=windows&vendor=eclipse'
    $jdkRelease = $jdkMetadata | Select-Object -First 1
    $jdkArchive = Join-Path $downloadsRoot $jdkRelease.binary.package.name
    Get-VerifiedArchive $jdkRelease.binary.package.link $jdkArchive $jdkRelease.binary.package.checksum
    Expand-Archive -LiteralPath $jdkArchive -DestinationPath $jdkRoot -Force
    $jdkRelease | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $toolchainRoot 'jdk-provenance.json')
}

$commandToolsRoot = Join-Path $toolchainRoot 'android-sdk\cmdline-tools\latest'
if (-not (Test-Path -LiteralPath (Join-Path $commandToolsRoot 'bin\sdkmanager.bat'))) {
    $androidArchive = Join-Path $downloadsRoot 'commandlinetools-win-15859902_latest.zip'
    Get-VerifiedArchive 'https://dl.google.com/android/repository/commandlinetools-win-15859902_latest.zip' $androidArchive '90ae805d20434428bffcb699c290860f19bb5f66a67e6b330067e3de801fb04a'
    $stagingRoot = Join-Path $downloadsRoot 'android-command-tools'
    Expand-Archive -LiteralPath $androidArchive -DestinationPath $stagingRoot -Force
    New-Item -ItemType Directory -Path $commandToolsRoot -Force | Out-Null
    Get-ChildItem -LiteralPath (Join-Path $stagingRoot 'cmdline-tools') | Copy-Item -Destination $commandToolsRoot -Recurse -Force
}

. (Join-Path $PSScriptRoot 'env.ps1')
& java -version
& sdkmanager --sdk_root="$env:ANDROID_HOME" --version
if ($LASTEXITCODE -ne 0) { throw 'sdkmanager did not start successfully' }
# SDK installation is authorized by PLAN.md. Accept its package licenses locally.
1..30 | ForEach-Object { 'y' } | & sdkmanager --sdk_root="$env:ANDROID_HOME" --licenses
if ($LASTEXITCODE -ne 0) { throw 'SDK license acceptance failed' }
& sdkmanager --sdk_root="$env:ANDROID_HOME" 'platform-tools'
if ($LASTEXITCODE -ne 0) { throw 'platform-tools install failed' }
& adb version
& adb devices -l
