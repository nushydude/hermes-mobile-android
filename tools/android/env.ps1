$workspaceRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$toolchainRoot = Join-Path $workspaceRoot '.toolchain'
$jdkDirectory = Get-ChildItem -LiteralPath (Join-Path $toolchainRoot 'java') -Directory -ErrorAction Stop | Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'bin\javac.exe') } | Select-Object -First 1
if (-not $jdkDirectory) { throw 'Run tools/android/bootstrap.ps1 first.' }
$env:JAVA_HOME = $jdkDirectory.FullName
$env:ANDROID_HOME = Join-Path $toolchainRoot 'android-sdk'
$env:GRADLE_USER_HOME = Join-Path $toolchainRoot 'gradle'
$env:PATH = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:ANDROID_HOME\cmdline-tools\latest\bin;$env:PATH"
