# Makes this Windows PC upload every new screenshot to Prismo Cloud by itself:
# installs the folder watcher for the current user and starts it at every sign-in.
#
#   powershell -ExecutionPolicy Bypass -File scripts\install-watcher.ps1 -Url https://<your site> -Token prismo_...
#   powershell -ExecutionPolicy Bypass -File scripts\install-watcher.ps1 -Remove
#
# Create the token in the web app: Settings -> capture clients ("upload only" is enough).
# What it does:
#   - copies prismo-watch.exe to %LOCALAPPDATA%\PrismoCloud
#   - stores the address and the token as environment variables of your Windows user
#     (readable by programs running as you, by nobody else on the PC)
#   - puts a shortcut in your Startup folder, and starts the watcher now
# Nothing needs administrator rights. The watcher's log is %LOCALAPPDATA%\PrismoCloud\watch.log.

param(
    [string]$Url,
    [string]$Token,
    [string]$Collection = 'screenshots',
    [ValidateSet('private', 'unlisted', 'public')][string]$Visibility = 'private',
    [switch]$Remove
)

$ErrorActionPreference = 'Stop'
$home_ = Join-Path $env:LOCALAPPDATA 'PrismoCloud'
$exe = Join-Path $home_ 'prismo-watch.exe'
$shortcut = Join-Path ([Environment]::GetFolderPath('Startup')) 'Prismo Cloud watcher.lnk'

Get-Process -Name 'prismo-watch' -ErrorAction SilentlyContinue | Stop-Process -Force

if ($Remove) {
    Remove-Item $shortcut -ErrorAction SilentlyContinue
    [Environment]::SetEnvironmentVariable('PRISMO_URL', $null, 'User')
    [Environment]::SetEnvironmentVariable('PRISMO_TOKEN', $null, 'User')
    Remove-Item $home_ -Recurse -ErrorAction SilentlyContinue
    'Watcher removed. Revoke its token in the web app (Settings -> capture clients).'
    exit 0
}

if (-not $Url -or -not $Token) { throw 'Both -Url and -Token are required (or -Remove).' }
$built = Join-Path $PSScriptRoot '..\apps\api\bin\prismo-watch.exe'
if (-not (Test-Path $built)) { throw "prismo-watch.exe is not built yet (expected at $built). See README, 'Capture'." }

New-Item -ItemType Directory -Force $home_ | Out-Null
Copy-Item $built $exe -Force
[Environment]::SetEnvironmentVariable('PRISMO_URL', $Url.TrimEnd('/'), 'User')
[Environment]::SetEnvironmentVariable('PRISMO_TOKEN', $Token, 'User')

# Started through a hidden PowerShell so no console window sits on the taskbar.
$run = "& '$exe' -collection '$Collection' -visibility $Visibility -log '$home_\watch.log'"
$link = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcut)
$link.TargetPath = 'powershell.exe'
$link.Arguments = "-NoProfile -WindowStyle Hidden -Command `"$run`""
$link.WindowStyle = 7
$link.Description = 'Uploads new screenshots to Prismo Cloud'
$link.Save()

# The variables above reach new sign-ins; this session needs them set directly.
$env:PRISMO_URL = $Url.TrimEnd('/')
$env:PRISMO_TOKEN = $Token
Start-Process powershell.exe -WindowStyle Hidden -ArgumentList '-NoProfile', '-WindowStyle', 'Hidden', '-Command', $run

Start-Sleep -Seconds 2
if (Get-Process -Name 'prismo-watch' -ErrorAction SilentlyContinue) {
    "Watcher is running and will start at every sign-in."
    "It watches the folder Windows saves screenshots to; new files go to the '$Collection' jar as $Visibility."
    "Log: $home_\watch.log"
} else {
    "The watcher did not stay running. Last log lines:"
    Get-Content (Join-Path $home_ 'watch.log') -Tail 5 -ErrorAction SilentlyContinue
    exit 1
}
