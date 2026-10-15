<#
.SYNOPSIS
    Install the session-cost plugin into a DSH profile.

.DESCRIPTION
    Copies the four package files into <ProfileDir>\plugins\session-cost and, if
    the profile's cordis.patch.yml does not already carry a `session-cost` entry,
    appends the patch row that mounts it. Re-running is safe: the copy is
    idempotent and the patch row is only added once.

    The profile's patch layer is watched, so no DSH restart is needed; refresh
    the page (Ctrl+R) afterwards to load the new client bundle.

.PARAMETER ProfileDir
    The profile to install into. Defaults to $env:DSH_PROFILE_DIR, then
    ~\.dsh\profiles\desktop.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
#>
[CmdletBinding()]
param(
    [string]$ProfileDir = $(if ($env:DSH_PROFILE_DIR) { $env:DSH_PROFILE_DIR } else { Join-Path $HOME '.dsh\profiles\desktop' })
)

$ErrorActionPreference = 'Stop'

$source = $PSScriptRoot
$target = Join-Path $ProfileDir 'plugins\session-cost'
$patchFile = Join-Path $ProfileDir 'cordis.patch.yml'

if (-not (Test-Path -LiteralPath $patchFile)) {
    throw "not a DSH profile directory: $ProfileDir (no cordis.patch.yml)"
}

New-Item -ItemType Directory -Force -Path $target | Out-Null
foreach ($file in 'package.json', 'host.js', 'client.js', 'README.md') {
    $from = Join-Path $source $file
    if (Test-Path -LiteralPath $from) {
        Copy-Item -LiteralPath $from -Destination (Join-Path $target $file) -Force
    }
}
# The host half used to be index.js; a stale copy would shadow nothing but is confusing.
Remove-Item -LiteralPath (Join-Path $target 'index.js') -Force -ErrorAction SilentlyContinue
Write-Host "copied package  -> $target"

$patch = [System.IO.File]::ReadAllText($patchFile)
if ($patch -match '(?m)^\s*(?:-\s*)?id:\s*session-cost(?:-v\d+)?\s*$') {
    Write-Host 'patch entry already present; cordis.patch.yml left untouched'
}
else {
    $snippet = @'

# session-cost: this session's running spend, shown under the composer.
# The four flat rates are the OFF-PEAK price per million tokens, in `currency`.
# Peak defaults to exactly twice those; set `peak` below to override.
# Peak window is Beijing time Mon-Fri 09:00-12:00 and 14:00-18:00; list any
# Chinese public holiday dates in `holidays` to bill them off-peak all day.
#
# Reloading host.js: the loader re-imports a module only for a NEW entry id, so
# after editing host.js bump this id (session-cost-v3, ...) or restart DSH.
- insert:
    - id: session-cost-v2
      name: ./plugins/session-cost/host.js
      config:
        currency: "¥"
        per: 1000000
        input: 1
        cacheRead: 0.02
        cacheWrite: 0
        output: 4
        holidays: []
        # peak:
        #   input: 2
        #   cacheRead: 0.04
        #   cacheWrite: 0
        #   output: 8
'@
    [System.IO.File]::AppendAllText($patchFile, $snippet, [System.Text.UTF8Encoding]::new($false))
    Write-Host "appended entry  -> $patchFile"
}

Write-Host ''
Write-Host 'Done. Refresh the DSH page (Ctrl+R) to load the client half.'
