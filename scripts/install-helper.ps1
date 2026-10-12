# Sets up Prismo Cloud's desktop helper on this Windows PC, for you only:
#
#   - every new capture (Windows' own screenshots, ShareX) is uploaded by itself
#   - after the upload, Ctrl+V still pastes the capture; its link is one step back in Win+V
#   - a hotkey brings up the picker: a sticker or GIF from the cloud, pasted into any chat
#
#   powershell -ExecutionPolicy Bypass -File scripts\install-helper.ps1 -Url https://<your site> -Token prismo_...
#   powershell -ExecutionPolicy Bypass -File scripts\install-helper.ps1 -Remove
#
# The web app hands you the first line ready to paste: Settings -> programs that upload
# for you -> create a token that may "add files and look" (the picker has to look).
#
# What it does:
#   - copies prismo-helper.exe to %LOCALAPPDATA%\PrismoCloud
#   - stores the address and the token as environment variables of your Windows user
#     (readable by programs running as you, by nobody else on the PC)
#   - puts a shortcut in your Startup folder, and starts the helper now
# Nothing needs administrator rights. The helper's log is %LOCALAPPDATA%\PrismoCloud\helper.log.

param(
    [string]$Url,
    [string]$Token,
    # Folder in the cloud captures go into; "screenshots/2026" works too.
    [string]$Folder = 'screenshots',
    # Brings up the picker. "off": no picker.
    [string]$Hotkey = 'win+shift+g',
    [ValidateSet('timeroom', 'multiverse', 'bmo')][string]$Theme = 'timeroom',
    # Picker only: captures are not uploaded (ShareX or something else does that).
    [switch]$NoUploads,
    # Leave the clipboard alone after an upload.
    [switch]$NoLink,
    [switch]$Remove
)

$ErrorActionPreference = 'Stop'
$home_ = Join-Path $env:LOCALAPPDATA 'PrismoCloud'
$exe = Join-Path $home_ 'prismo-helper.exe'
$log = Join-Path $home_ 'helper.log'
$startup = [Environment]::GetFolderPath('Startup')
$shortcut = Join-Path $startup 'Prismo Cloud helper.lnk'

# Also the folder watcher this helper replaces, should it be there.
Get-Process -Name 'prismo-helper', 'prismo-watch' -ErrorAction SilentlyContinue | Stop-Process -Force
Remove-Item (Join-Path $startup 'Prismo Cloud watcher.lnk') -ErrorAction SilentlyContinue

if ($Remove) {
    Remove-Item $shortcut -ErrorAction SilentlyContinue
    [Environment]::SetEnvironmentVariable('PRISMO_URL', $null, 'User')
    [Environment]::SetEnvironmentVariable('PRISMO_TOKEN', $null, 'User')
    Start-Sleep -Milliseconds 500   # WebView2 lets go of its files a moment after the helper
    Remove-Item $home_ -Recurse -Force -ErrorAction SilentlyContinue
    'Helper removed. Revoke its token in the web app (Settings -> programs that upload for you).'
    exit 0
}

if (-not $Url -or -not $Token) { throw 'Both -Url and -Token are required (or -Remove).' }
$Url = $Url.TrimEnd('/')
$bin = Join-Path $PSScriptRoot '..\apps\api\bin'
if (-not (Test-Path (Join-Path $bin 'prismo-helper.exe'))) {
    throw 'prismo-helper.exe is not built yet. Run scripts\build-helper.ps1 first (needs Docker).'
}

# Ask the cloud what this token may do, so a wrong one is noticed now and not
# the first time the hotkey shows an empty picker.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$may = 'unknown'
try {
    $null = Invoke-WebRequest -UseBasicParsing -Uri "$Url/v1/me" -Headers @{ Authorization = "Bearer $Token" } -TimeoutSec 20
    $may = 'look'
} catch {
    $status = 0
    if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
    if ($status -eq 401) { throw "Prismo Cloud at $Url does not accept this token. Was it copied whole? Was it revoked?" }
    if ($status -eq 403) { $may = 'add' }
}

New-Item -ItemType Directory -Force $home_ | Out-Null
Copy-Item (Join-Path $bin 'prismo-helper.exe') $exe -Force
$loader = Join-Path $bin 'WebView2Loader.dll'
if (Test-Path $loader) { Copy-Item $loader $home_ -Force }
[Environment]::SetEnvironmentVariable('PRISMO_URL', $Url, 'User')
[Environment]::SetEnvironmentVariable('PRISMO_TOKEN', $Token, 'User')

$arguments = "-folder `"$Folder`" -hotkey `"$Hotkey`" -theme $Theme"
if ($NoUploads) { $arguments += ' -watch=false' }
if ($NoLink) { $arguments += ' -link=false' }

$link = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcut)
$link.TargetPath = $exe
$link.Arguments = $arguments
$link.WorkingDirectory = $home_
$link.Description = 'Uploads captures to Prismo Cloud; stickers and GIFs on a hotkey'
$link.Save()

# The variables above reach new sign-ins; this session needs them set directly.
$env:PRISMO_URL = $Url
$env:PRISMO_TOKEN = $Token
Remove-Item $log -ErrorAction SilentlyContinue
Start-Process -FilePath $exe -ArgumentList $arguments -WorkingDirectory $home_

Start-Sleep -Seconds 4
$said = @(Get-Content $log -ErrorAction SilentlyContinue)
if (-not (Get-Process -Name 'prismo-helper' -ErrorAction SilentlyContinue)) {
    'The helper did not stay running. Its log says:'
    $said | Select-Object -Last 6
    exit 1
}

'The helper is running and will start at every sign-in.'
if (-not $NoUploads) {
    $watching = $said | Where-Object { $_ -like '*watching * -> *' } | Select-Object -First 1
    if ($watching -match 'watching (.+) -> ') { "  Uploads new captures from: $($Matches[1])" }
    "  They go to the folder '$Folder'. Private or not is the token's setting, in the web app."
    if (-not $NoLink) { '  After an upload: Ctrl+V pastes the capture, Win+V has its link one step back.' }
}
if ($Hotkey -ne 'off') {
    if ($said -match 'picker ready') {
        "  Picker: press $Hotkey anywhere. Type, Enter, and it is pasted where you were."
        if ($may -eq 'add') { '  BUT this token may only add files, so the picker will stay empty. Make one that may "add files and look".' }
    } else {
        '  The picker did not start. The log says:'
        $said | Where-Object { $_ -match 'picker|hotkey' } | Select-Object -Last 3 | ForEach-Object { "    $_" }
    }
}
"  Log: $log"
