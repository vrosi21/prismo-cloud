# Builds the Windows programs into apps\api\bin:
#
#   prismo-helper.exe   the desktop helper: uploads captures, picker on a hotkey
#   prismo-watch.exe    uploads captures and nothing else; has no window
#
#   powershell -ExecutionPolicy Bypass -File scripts\build-helper.ps1
#
# Go does not have to be installed: the build runs in Docker.

$ErrorActionPreference = 'Stop'
$api = (Resolve-Path (Join-Path $PSScriptRoot '..\apps\api')).Path

# One line, single quotes only: Windows PowerShell mangles double quotes and
# line ends on their way into another program.
$steps = @(
    'export GOOS=windows GOARCH=amd64 CGO_ENABLED=0'
    # -H=windowsgui: no console window comes up with the helper.
    "go build -trimpath -ldflags '-H=windowsgui -s -w' -o bin/prismo-helper.exe ./cmd/prismo-helper"
    "go build -trimpath -ldflags '-s -w' -o bin/prismo-watch.exe ./cmd/prismo-watch"
    # Microsoft's small loader for WebView2. With it next to the helper,
    # Windows loads it the ordinary way.
    "cp `$(go list -m -f '{{.Dir}}' github.com/jchv/go-webview2)/webviewloader/sdk/x64/WebView2Loader.dll bin/"
    'chmod u+w bin/WebView2Loader.dll'
) -join ' && '

docker run --rm -v "${api}:/src" -v prismo-gomod:/go/pkg/mod -v prismo-gobuild:/root/.cache/go-build -w /src golang:1.27-alpine sh -c $steps
if ($LASTEXITCODE -ne 0) { throw 'The build failed. Is Docker Desktop running?' }

Get-ChildItem (Join-Path $api 'bin') -Include 'prismo-helper.exe', 'prismo-watch.exe', 'WebView2Loader.dll' -Recurse |
    ForEach-Object { '{0,-22} {1,6:N1} MB' -f $_.Name, ($_.Length / 1MB) }
'Next: scripts\install-helper.ps1 (the web app hands you the whole line: settings, programs that upload for you).'
