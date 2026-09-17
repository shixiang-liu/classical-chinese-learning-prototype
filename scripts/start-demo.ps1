[CmdletBinding()]
param(
  [string]$OllamaModel = 'gsw-qwen3-4b',
  [string]$BackendHost = '127.0.0.1',
  [int]$BackendPort = 8000,
  [int]$FrontendPort = 3000,
  [switch]$SkipFrontend,
  [switch]$ResetDemoData
)

$ErrorActionPreference = 'Stop'

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$FrontendRoot = Join-Path $RepoRoot 'frontend'
$PythonExe = Join-Path $RepoRoot '.venv\Scripts\python.exe'
if (-not (Test-Path $PythonExe)) {
  $PythonExe = 'python'
}

$BackendOutLog = Join-Path $RepoRoot 'backend-dev-out.log'
$BackendErrLog = Join-Path $RepoRoot 'backend-dev-err.log'
$FrontendOutLog = Join-Path $RepoRoot 'frontend-dev-out.log'
$FrontendErrLog = Join-Path $RepoRoot 'frontend-dev-err.log'
$OllamaOutLog = Join-Path $RepoRoot 'ollama-dev-out.log'
$OllamaErrLog = Join-Path $RepoRoot 'ollama-dev-err.log'

function Write-Step([string]$Message) {
  Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Reset-Log([string]$Path) {
  if (-not (Test-Path $Path)) {
    return
  }

  try {
    Remove-Item $Path -Force
  } catch {
    try {
      Clear-Content $Path -Force
    } catch {
      Write-Warning "Could not reset log file: $Path"
    }
  }
}

function Stop-CommandLineProcesses([string]$Pattern, [string]$Label) {
  $targets = Get-CimInstance Win32_Process |
    Where-Object { $_.CommandLine -and $_.CommandLine -match $Pattern }

  if (-not $targets) {
    return
  }

  $ids = @($targets | Select-Object -ExpandProperty ProcessId -Unique)
  Write-Step "Stopping stale $Label processes: $($ids -join ', ')"
  foreach ($id in $ids) {
    Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
  }
}

function Stop-PortListeners([int]$Port, [string]$Label) {
  $connections = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  if (-not $connections) {
    return
  }

  $ids = @($connections | Select-Object -ExpandProperty OwningProcess -Unique)
  Write-Step "Stopping $Label listener on port ${Port}: $($ids -join ', ')"
  foreach ($id in $ids) {
    if ($id -gt 0) {
      Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
    }
  }
}

function Wait-HttpOk([string]$Url, [int]$TimeoutSeconds = 40) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
        return
      }
    } catch {
      Start-Sleep -Milliseconds 800
      continue
    }

    Start-Sleep -Milliseconds 800
  }

  throw "Timed out waiting for $Url"
}

function Invoke-DemoReset() {
  Write-Step 'Resetting demo data'
  & $PythonExe (Join-Path $RepoRoot 'backend\scripts\reset_demo_data.py')
  if ($LASTEXITCODE -ne 0) {
    throw 'Demo data reset failed'
  }
}

function Assert-OllamaModel([string]$ModelName) {
  $payload = Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/tags' -Method Get -TimeoutSec 5
  $availableNames = @($payload.models | ForEach-Object { $_.name })
  $matched = $availableNames | Where-Object { $_ -eq $ModelName -or $_ -eq "${ModelName}:latest" }
  if ($matched) {
    return
  }

  throw "Ollama model '$ModelName' was not found. Available: $($availableNames -join ', ')"
}

Write-Step 'Cleaning stale local processes'
Stop-CommandLineProcesses 'uvicorn.+app\.main:app' 'backend'
Stop-PortListeners -Port $BackendPort -Label 'backend'
if (-not $SkipFrontend) {
  Stop-PortListeners -Port $FrontendPort -Label 'frontend'
}
Get-Process ollama -ErrorAction SilentlyContinue | ForEach-Object {
  Write-Step "Stopping Ollama process $($_.Id)"
  Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
}

Start-Sleep -Seconds 1

Reset-Log $BackendOutLog
Reset-Log $BackendErrLog
Reset-Log $FrontendOutLog
Reset-Log $FrontendErrLog
Reset-Log $OllamaOutLog
Reset-Log $OllamaErrLog

if ($ResetDemoData) {
  Invoke-DemoReset
}

Write-Step 'Starting Ollama'
$ollamaProcess = Start-Process -FilePath 'ollama' `
  -ArgumentList @('serve') `
  -WorkingDirectory $RepoRoot `
  -RedirectStandardOutput $OllamaOutLog `
  -RedirectStandardError $OllamaErrLog `
  -PassThru

Wait-HttpOk -Url 'http://127.0.0.1:11434/api/tags' -TimeoutSeconds 30
Assert-OllamaModel -ModelName $OllamaModel

Write-Step 'Starting backend'
$backendProcess = Start-Process -FilePath $PythonExe `
  -ArgumentList @('-m', 'uvicorn', 'app.main:app', '--app-dir', 'backend', '--host', $BackendHost, '--port', "$BackendPort") `
  -WorkingDirectory $RepoRoot `
  -RedirectStandardOutput $BackendOutLog `
  -RedirectStandardError $BackendErrLog `
  -PassThru

Wait-HttpOk -Url "http://$BackendHost`:$BackendPort/docs" -TimeoutSeconds 45

$frontendProcess = $null
if (-not $SkipFrontend) {
  Write-Step 'Starting frontend'
  $frontendProcess = Start-Process -FilePath 'npm.cmd' `
    -ArgumentList @('run', 'dev') `
    -WorkingDirectory $FrontendRoot `
    -RedirectStandardOutput $FrontendOutLog `
    -RedirectStandardError $FrontendErrLog `
    -PassThru

  Wait-HttpOk -Url "http://127.0.0.1:$FrontendPort" -TimeoutSeconds 60
}

Write-Host ''
Write-Host 'Demo stack is ready.' -ForegroundColor Green
Write-Host "Backend : http://$BackendHost`:$BackendPort/docs (PID $($backendProcess.Id))"
if ($frontendProcess) {
  Write-Host "Frontend: http://127.0.0.1:$FrontendPort (PID $($frontendProcess.Id))"
}
Write-Host "Ollama  : http://127.0.0.1:11434/api/tags (PID $($ollamaProcess.Id))"
Write-Host ''
Write-Host 'Logs:'
Write-Host "  $OllamaOutLog"
Write-Host "  $OllamaErrLog"
Write-Host "  $BackendOutLog"
Write-Host "  $BackendErrLog"
if (-not $SkipFrontend) {
  Write-Host "  $FrontendOutLog"
  Write-Host "  $FrontendErrLog"
}
