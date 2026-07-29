# Vision Helper — Windows resident control plane for JoyCaption local API.
# Listens on http://127.0.0.1:8765  (start / stop / status)
# Double-click VisionHelper.bat to run.

$ErrorActionPreference = "Stop"
$Host.UI.RawUI.WindowTitle = "vision helper"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

$HelperPort = 8765
$ApiBase = "http://127.0.0.1:8000"
$StateFile = Join-Path $Root "helper-state.json"
$LogFile = Join-Path $Root "helper.log"

function Write-Log([string]$msg) {
  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
  Add-Content -Path $LogFile -Value $line -Encoding UTF8
  Write-Host $line
}

function Load-Models {
  $path = Join-Path $Root "models.json"
  if (-not (Test-Path $path)) { return @() }
  return Get-Content $path -Raw -Encoding UTF8 | ConvertFrom-Json
}

function Resolve-JoyRepo([string]$modelId) {
  $models = Load-Models
  foreach ($m in $models) {
    if ($m.id -eq $modelId) { return [string]$m.repo }
  }
  if ($models.Count -gt 0) { return [string]$models[0].repo }
  return "fancyfeast/llama-joycaption-beta-one-hf-llava"
}

function Test-Docker {
  try {
    $null = & docker version --format "{{.Server.Version}}" 2>$null
    return ($LASTEXITCODE -eq 0)
  } catch {
    return $false
  }
}

function Test-Python {
  foreach ($cmd in @("python", "py")) {
    try {
      $v = & $cmd --version 2>&1
      if ($LASTEXITCODE -eq 0 -or $v -match "Python") { return $cmd }
    } catch {}
  }
  return $null
}

function Get-ApiHealth {
  try {
    $r = Invoke-RestMethod -Uri "$ApiBase/health" -TimeoutSec 2
    return $r
  } catch {
    return $null
  }
}

function Save-State($obj) {
  ($obj | ConvertTo-Json -Depth 6) | Set-Content -Path $StateFile -Encoding UTF8
}

function Read-State {
  if (Test-Path $StateFile) {
    return Get-Content $StateFile -Raw -Encoding UTF8 | ConvertFrom-Json
  }
  return [pscustomobject]@{ backend = "none"; running = $false; joyRepo = ""; pid = $null }
}

function Start-ApiDocker([string]$joyRepo, [bool]$enableJoy) {
  $env:VISION_JOY_REPO = $joyRepo
  $env:VISION_ENABLE_JOY = $(if ($enableJoy) { "1" } else { "0" })
  $env:VISION_MOCK_INFERENCE = "0"
  Write-Log "docker compose up (repo=$joyRepo joy=$enableJoy)"
  & docker compose -f (Join-Path $Root "docker-compose.yml") up -d --build
  if ($LASTEXITCODE -ne 0) { throw "docker compose up failed ($LASTEXITCODE)" }
  Save-State @{ backend = "docker"; running = $true; joyRepo = $joyRepo; pid = $null }
}

function Start-ApiPython([string]$joyRepo, [bool]$enableJoy) {
  $py = Test-Python
  if (-not $py) { throw "Python が見つかりません。Docker Desktop か Python 3.12+ を入れてください" }
  $apiDir = Join-Path $Root "api"
  $venv = Join-Path $apiDir ".venv"
  if (-not (Test-Path $venv)) {
    Write-Log "creating venv…"
    & $py -m venv $venv
  }
  $pip = Join-Path $venv "Scripts\pip.exe"
  $python = Join-Path $venv "Scripts\python.exe"
  Write-Log "installing API requirements…"
  & $pip install -r (Join-Path $apiDir "requirements.txt")
  if ($enableJoy) {
    & $pip install -r (Join-Path $apiDir "requirements-joy.txt")
  }
  $env:VISION_JOY_REPO = $joyRepo
  $env:VISION_ENABLE_JOY = $(if ($enableJoy) { "1" } else { "0" })
  $env:VISION_MOCK_INFERENCE = "0"
  $env:VISION_HOST = "127.0.0.1"
  $env:VISION_PORT = "8000"
  $env:VISION_CORS_ORIGINS = "*"
  Write-Log "starting uvicorn…"
  $proc = Start-Process -FilePath $python -ArgumentList @(
    "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000"
  ) -WorkingDirectory $apiDir -WindowStyle Minimized -PassThru
  Save-State @{ backend = "python"; running = $true; joyRepo = $joyRepo; pid = $proc.Id }
}

function Stop-Api {
  $state = Read-State
  if ($state.backend -eq "docker") {
    Write-Log "docker compose down"
    & docker compose -f (Join-Path $Root "docker-compose.yml") down
  }
  if ($state.backend -eq "python" -and $state.pid) {
    try {
      Stop-Process -Id ([int]$state.pid) -Force -ErrorAction SilentlyContinue
    } catch {}
  }
  # Also kill anything still on :8000
  try {
    $conns = Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($p in $conns) {
      if ($p -and $p -ne 0) {
        Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
      }
    }
  } catch {}
  Save-State @{ backend = "none"; running = $false; joyRepo = ""; pid = $null }
}

function Wait-ApiReady([int]$seconds = 180) {
  $deadline = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $deadline) {
    $h = Get-ApiHealth
    if ($h -and $h.status -eq "ok") { return $h }
    Start-Sleep -Seconds 2
  }
  return $null
}

function New-JsonResponse([int]$code, $obj) {
  $json = ($obj | ConvertTo-Json -Depth 8 -Compress)
  return @{ code = $code; body = $json }
}

function Handle-Request($req, $res) {
  $method = $req.HttpMethod
  $path = $req.Url.AbsolutePath.TrimEnd("/")
  if ([string]::IsNullOrEmpty($path)) { $path = "/" }

  # CORS for Pages / local UI
  $res.Headers.Add("Access-Control-Allow-Origin", "*")
  $res.Headers.Add("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
  $res.Headers.Add("Access-Control-Allow-Headers", "Content-Type")

  if ($method -eq "OPTIONS") {
    $res.StatusCode = 204
    $res.Close()
    return
  }

  $bodyText = ""
  if ($req.HasEntityBody) {
    $reader = New-Object System.IO.StreamReader($req.InputStream, $req.ContentEncoding)
    $bodyText = $reader.ReadToEnd()
    $reader.Close()
  }

  try {
    if ($method -eq "GET" -and ($path -eq "/status" -or $path -eq "/")) {
      $state = Read-State
      $health = Get-ApiHealth
      $payload = @{
        ok          = $true
        running     = [bool]$state.running
        apiReady    = [bool]($health -and $health.status -eq "ok")
        joyReady    = [bool]($health -and $health.joy_ready)
        joyAvailable= [bool]($health -and $health.joy_available)
        joyRepo     = $(if ($health -and $health.models.joy) { $health.models.joy } else { $state.joyRepo })
        backend     = $state.backend
        message     = $(if ($health) { "API 接続OK" } elseif ($state.running) { "API 起動中…" } else { "待機中" })
        docker      = Test-Docker
        python      = [bool](Test-Python)
      }
      $out = New-JsonResponse 200 $payload
    }
    elseif ($method -eq "POST" -and $path -eq "/start") {
      $parsed = @{}
      if ($bodyText) { $parsed = $bodyText | ConvertFrom-Json }
      $modelId = if ($parsed.joyModelId) { [string]$parsed.joyModelId } else { "beta-one" }
      $enableJoy = $true
      if ($null -ne $parsed.enableJoy) { $enableJoy = [bool]$parsed.enableJoy }
      $repo = Resolve-JoyRepo $modelId

      Stop-Api
      if (Test-Docker) {
        Start-ApiDocker $repo $enableJoy
        $backend = "docker"
      } else {
        Start-ApiPython $repo $enableJoy
        $backend = "python"
      }
      $health = Wait-ApiReady 240
      $payload = @{
        ok           = [bool]$health
        running      = $true
        apiReady     = [bool]$health
        joyReady     = [bool]($health -and $health.joy_ready)
        joyAvailable = [bool]($health -and $health.joy_available)
        joyRepo      = $repo
        backend      = $backend
        message      = $(if ($health) { "JoyCaption API を起動しました" } else { "起動コマンドは送りましたが /health がまだ応答しません。初回はモデル取得に時間がかかります" })
      }
      $out = New-JsonResponse ($(if ($health) { 200 } else { 202 })) $payload
    }
    elseif ($method -eq "POST" -and $path -eq "/stop") {
      Stop-Api
      $out = New-JsonResponse 200 @{
        ok = $true; running = $false; apiReady = $false; backend = "none"
        message = "停止しました"
      }
    }
    else {
      $out = New-JsonResponse 404 @{ ok = $false; error = "not found" }
    }
  } catch {
    Write-Log "error: $_"
    $out = New-JsonResponse 500 @{ ok = $false; error = "$_"; running = $false; apiReady = $false }
  }

  $bytes = [System.Text.Encoding]::UTF8.GetBytes($out.body)
  $res.StatusCode = $out.code
  $res.ContentType = "application/json; charset=utf-8"
  $res.ContentLength64 = $bytes.Length
  $res.OutputStream.Write($bytes, 0, $bytes.Length)
  $res.Close()
}

# --- main ---
Write-Log "vision helper starting on 127.0.0.1:$HelperPort"
Write-Host ""
Write-Host "  vision helper  (常駐)"
Write-Host "  制御: http://127.0.0.1:$HelperPort/status"
Write-Host "  API : http://127.0.0.1:8000/health"
Write-Host "  この窓を閉じるとヘルパーが止まります。"
Write-Host "  vision の設定から「JoyCaption を起動」を押してください。"
Write-Host ""

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://127.0.0.1:$HelperPort/")
try {
  $listener.Start()
} catch {
  Write-Host "ポート $HelperPort を開けません。他の VisionHelper が動いていないか確認してください。"
  Write-Host $_
  Read-Host "Enter で終了"
  exit 1
}

while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  try {
    Handle-Request $ctx.Request $ctx.Response
  } catch {
    Write-Log "request error: $_"
    try { $ctx.Response.Abort() } catch {}
  }
}
