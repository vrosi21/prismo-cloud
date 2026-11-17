# Puts the /prismo skill into Claude Code for your Windows user, so every Claude session
# on this PC can read and change your Prismo planner (tasks, events, notebooks, boards).
#
#   powershell -ExecutionPolicy Bypass -File scripts\install-skill.ps1 -Url https://<your site> -Token prismo_...
#   powershell -ExecutionPolicy Bypass -File scripts\install-skill.ps1            (update the files only)
#   powershell -ExecutionPolicy Bypass -File scripts\install-skill.ps1 -Remove
#
# The token must be a "plan" token: Settings -> programs that upload for you -> it may:
# "plan: for claude sessions". That page hands you the first line ready to paste. Such a
# token reaches the planner and the ledger, nothing else (no files, no other tokens).
#
# What it does:
#   - copies tools\prismo-skill (SKILL.md, prismo.mjs) to %USERPROFILE%\.claude\skills\prismo,
#     with the bundle format (apps\web\src\bundle-prompt.md) as reference\bundle.md
#   - stores the address and the token as environment variables of your Windows user
#     (PRISMO_URL, PRISMO_PLANNER_TOKEN), readable by programs running as you
#   - checks that the token works
# Run it again after pulling a newer version of the skill. Needs Node 22 or newer.

param(
    [string]$Url,
    [string]$Token,
    [switch]$Remove
)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$skill = Join-Path $env:USERPROFILE '.claude\skills\prismo'

if ($Remove) {
    if (Test-Path $skill) { Remove-Item -Recurse -Force $skill }
    [Environment]::SetEnvironmentVariable('PRISMO_PLANNER_TOKEN', $null, 'User')
    'The /prismo skill is gone, and its token is no longer stored. Revoke the token in Settings too.'
    return
}

if ($Token -and -not $Token.StartsWith('prismo_')) { throw 'That is not a Prismo token (they start with prismo_).' }
if ($Token -and -not $Url) { throw 'Give -Url too: the address of your Prismo Cloud.' }

New-Item -ItemType Directory -Force (Join-Path $skill 'reference') | Out-Null
Copy-Item (Join-Path $repo 'tools\prismo-skill\SKILL.md') $skill -Force
Copy-Item (Join-Path $repo 'tools\prismo-skill\prismo.mjs') $skill -Force
Copy-Item (Join-Path $repo 'apps\web\src\bundle-prompt.md') (Join-Path $skill 'reference\bundle.md') -Force
"Skill files are in $skill"

if ($Url) {
    [Environment]::SetEnvironmentVariable('PRISMO_URL', $Url.TrimEnd('/'), 'User')
    $env:PRISMO_URL = $Url.TrimEnd('/')
}
if ($Token) {
    [Environment]::SetEnvironmentVariable('PRISMO_PLANNER_TOKEN', $Token, 'User')
    $env:PRISMO_PLANNER_TOKEN = $Token
}

if (-not [Environment]::GetEnvironmentVariable('PRISMO_PLANNER_TOKEN', 'User')) {
    'No token stored yet: run this again with -Url and -Token (Settings makes one).'
    return
}
& node (Join-Path $skill 'prismo.mjs') check --as install
if ($LASTEXITCODE -ne 0) { throw 'The skill is installed, but the check failed (see above).' }
''
'Done. In any Claude Code session: /prismo <what you want>, e.g.'
'  /prismo write a roadmap for this project in folder projects/x'
'Everything sessions change is listed on the lookout wall, under "ledger".'
