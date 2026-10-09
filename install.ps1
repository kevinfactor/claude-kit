<#
.SYNOPSIS
  Installs the X Factor kit for Claude Code (desktop app and terminal), on Windows.

.DESCRIPTION
  Copies the kit's plugins to <Claude home>\kits\claude-kit and lists them in
  CLAUDE_CODE_PLUGIN_DIRS in <Claude home>\settings.json, which every Claude Code
  session reads, the desktop app's included. Other settings are kept, and the old
  settings.json is saved beside it first. Nothing is deleted. Run it again to update.

.PARAMETER Beginner
  Blast Radius holds every delete, even one file, and Cash Tax is left out.

.PARAMETER Source
  A local copy of the kit to install from. Default: download the latest from GitHub.

.PARAMETER ClaudeHome
  Claude Code's settings folder. Default: $env:CLAUDE_CONFIG_DIR, else ~\.claude.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File install.ps1 -Beginner
#>
param(
  [switch]$Beginner,
  [string]$Source = '',
  [string]$ClaudeHome = ''
)

$ErrorActionPreference = 'Stop'
$Zip = 'https://github.com/kevinfactor/claude-kit/archive/refs/heads/main.zip'

if (-not $ClaudeHome) {
  if ($env:CLAUDE_CONFIG_DIR) { $ClaudeHome = $env:CLAUDE_CONFIG_DIR } else { $ClaudeHome = Join-Path $HOME '.claude' }
}
$Target = Join-Path $ClaudeHome 'kits\claude-kit'

# 1. Get the kit.
$Temp = $null
if (-not $Source) {
  $Temp = Join-Path ([IO.Path]::GetTempPath()) ("claude-kit-" + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $Temp | Out-Null
  Write-Host "Downloading the kit..."
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest -Uri $Zip -OutFile (Join-Path $Temp 'kit.zip') -UseBasicParsing
  Expand-Archive -Path (Join-Path $Temp 'kit.zip') -DestinationPath $Temp
  $Source = (Get-ChildItem -Path $Temp -Directory | Select-Object -First 1).FullName
}
if (-not (Test-Path (Join-Path $Source 'plugins'))) { throw "No plugins folder in $Source" }

# 2. Copy it in, over any older copy.
New-Item -ItemType Directory -Force -Path $Target | Out-Null
Copy-Item -Path (Join-Path $Source '*') -Destination $Target -Recurse -Force

$Parts = @('kit-guide', 'blast-radius', 'file-tree', 'replay-theater', 'cash-tax')
if ($Beginner) { $Parts = $Parts | Where-Object { $_ -ne 'cash-tax' } }
$Dirs = $Parts | ForEach-Object { Join-Path $Target "plugins\$_" }

# 3. Point Claude Code at it.
$SettingsPath = Join-Path $ClaudeHome 'settings.json'
if (Test-Path $SettingsPath) {
  $Raw = [IO.File]::ReadAllText($SettingsPath)
  Copy-Item $SettingsPath ($SettingsPath + '.before-kit-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
  $Settings = if ($Raw.Trim()) { $Raw | ConvertFrom-Json } else { New-Object PSObject }
} else {
  New-Item -ItemType Directory -Force -Path $ClaudeHome | Out-Null
  $Settings = New-Object PSObject
}

if (-not $Settings.PSObject.Properties['env']) { $Settings | Add-Member -NotePropertyName env -NotePropertyValue (New-Object PSObject) }
$Kept = @()
if ($Settings.env.PSObject.Properties['CLAUDE_CODE_PLUGIN_DIRS']) {
  # Keep folders that are not this kit's; this kit's are listed fresh below.
  $Kept = @($Settings.env.CLAUDE_CODE_PLUGIN_DIRS -split ';' | Where-Object { $_ -and ($_ -notlike '*\kits\claude-kit\plugins\*') })
}
$Settings.env | Add-Member -Force -NotePropertyName CLAUDE_CODE_PLUGIN_DIRS -NotePropertyValue ((@($Kept) + @($Dirs)) -join ';')

if (-not $Settings.PSObject.Properties['pluginConfigs']) { $Settings | Add-Member -NotePropertyName pluginConfigs -NotePropertyValue (New-Object PSObject) }
if (-not $Settings.pluginConfigs.PSObject.Properties['blast-radius']) {
  $Settings.pluginConfigs | Add-Member -NotePropertyName 'blast-radius' -NotePropertyValue (New-Object PSObject)
}
$Blast = $Settings.pluginConfigs.'blast-radius'
if (-not $Blast.PSObject.Properties['options']) { $Blast | Add-Member -NotePropertyName options -NotePropertyValue (New-Object PSObject) }
$Blast.options | Add-Member -Force -NotePropertyName strict -NotePropertyValue ([bool]$Beginner)

$Json = $Settings | ConvertTo-Json -Depth 64
[IO.File]::WriteAllText($SettingsPath, $Json, (New-Object Text.UTF8Encoding $false))

if ($Temp) { Remove-Item -Recurse -Force $Temp }

Write-Host ""
Write-Host "X Factor kit installed:" ($Parts -join ', ')
if ($Beginner) { Write-Host "Beginner mode: every delete waits for your approval." }
Write-Host "Start a new Claude Code session to switch it on. Type /kit to see what it does."
