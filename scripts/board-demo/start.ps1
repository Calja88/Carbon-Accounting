param([switch]$Tunnel, [int]$Port = 3000)
$ErrorActionPreference = 'Stop'
Set-Location (Resolve-Path (Join-Path $PSScriptRoot '../..'))
if (-not (Test-Path '.env.board-demo') -or -not (Test-Path '.next/BUILD_ID')) { throw 'Configure the guarded demo and run pnpm build first.' }
$node = (Get-Command node -ErrorAction Stop).Source
# Keep a board session from losing database connections to Windows idle sleep.
# This request lasts only for this launcher process; it does not change power settings.
Add-Type @'
using System.Runtime.InteropServices;
public static class BoardDemoPower {
    [DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint flags);
}
'@
[BoardDemoPower]::SetThreadExecutionState([uint32]2147483651) | Out-Null
# Verifies identity, READY state, source bytes and replay before exposing a port.
& $node --env-file=.env.board-demo --import tsx scripts/board-demo/run.ts --check
if ($LASTEXITCODE -ne 0) { throw 'Demo verification failed; no server or tunnel started.' }
$logDir = Join-Path (Get-Location) 'artifacts/board-runtime'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$tunnelProcess = $null
$serverProcess = $null
try {
  $publicUrl = "http://localhost:$Port"
  if ($Tunnel) {
    $cloudflared = Join-Path (Get-Location) 'artifacts/board-tools/cloudflared.exe'
    if (-not (Test-Path $cloudflared)) { $cloudflared = (Get-Command cloudflared -ErrorAction Stop).Source }
    $tunnelProcess = Start-Process -FilePath $cloudflared -ArgumentList @('tunnel','--url',"http://127.0.0.1:$Port",'--no-autoupdate') -WindowStyle Hidden -PassThru -RedirectStandardOutput "$logDir/tunnel-out.log" -RedirectStandardError "$logDir/tunnel.log"
    $deadline = (Get-Date).AddSeconds(45)
    do {
      Start-Sleep -Milliseconds 500
      $match = [regex]::Match((Get-Content "$logDir/tunnel.log" -Raw -ErrorAction SilentlyContinue), 'https://[a-z0-9-]+\.trycloudflare\.com')
      if ($tunnelProcess.HasExited) { throw 'Tunnel exited; inspect artifacts/board-runtime/tunnel.log.' }
    } until ($match.Success -or (Get-Date) -gt $deadline)
    if (-not $match.Success) { throw 'Tunnel did not provide an HTTPS URL.' }
    $publicUrl = $match.Value
  }
  # Child inherits this runtime URL; the private env file supplies everything else.
  $env:AUTH_URL = $publicUrl
  $serverProcess = Start-Process -FilePath $node -ArgumentList @('--env-file=.env.board-demo','node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',"$Port") -WindowStyle Hidden -PassThru -RedirectStandardOutput "$logDir/server-out.log" -RedirectStandardError "$logDir/server.log"
  Write-Host "Board demo: $publicUrl (Ctrl+C stops this launcher)."
  Write-Host 'Keep this machine awake. Persona credentials stay in the private local env files.'
  while (-not $serverProcess.HasExited) { Start-Sleep -Seconds 1 }
  if ($serverProcess.ExitCode -ne 0) { throw 'Demo server exited; inspect artifacts/board-runtime/server.log.' }
} finally {
  [BoardDemoPower]::SetThreadExecutionState([uint32]2147483648) | Out-Null
  if ($serverProcess -and -not $serverProcess.HasExited) { Stop-Process -Id $serverProcess.Id }
  if ($tunnelProcess -and -not $tunnelProcess.HasExited) { Stop-Process -Id $tunnelProcess.Id }
}
