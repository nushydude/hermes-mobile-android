# Generates only a synthetic voice fixture; does not use a microphone or gateway.
# The target is create-new so an existing evidence fixture is never overwritten.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$artifactDir = Join-Path $PSScriptRoot '..\..\.artifacts\audio-smoke'
[System.IO.Directory]::CreateDirectory($artifactDir) | Out-Null
$fixturePath = Join-Path $artifactDir 'fixture.wav'
$synth = [System.Speech.Synthesis.SpeechSynthesizer]::new()
$stream = $null
try {
  $synth.SelectVoice('Microsoft Zira Desktop')
  $synth.Rate = -1
  $stream = [System.IO.File]::Open($fixturePath, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
  $synth.SetOutputToWaveStream($stream)
  $synth.Speak('Remember the blue lantern number seven.')
  $synth.SetOutputToNull()
  $stream.Flush($true)
} finally {
  $synth.Dispose()
  if ($null -ne $stream) { $stream.Dispose() }
}
Write-Output 'Synthetic fixture created.'
