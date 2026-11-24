$ErrorActionPreference = "Stop"
$workspace = $PSScriptRoot
$dockerDesktop = Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe"

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw "Docker Desktop is required to run Sonora's local AI. Install Docker Desktop, then run this launcher again."
}

docker info *> $null
if ($LASTEXITCODE -ne 0) {
  if (-not (Test-Path -LiteralPath $dockerDesktop)) {
    throw "Docker Desktop was not found at $dockerDesktop. Start Docker Desktop, then run this launcher again."
  }
  Start-Process -FilePath $dockerDesktop -WindowStyle Hidden
  $ready = $false
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    Start-Sleep -Seconds 2
    docker info *> $null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
  }
  if (-not $ready) { throw "Docker Desktop did not become ready. Start it manually and try again." }
}

Push-Location $workspace
try {
  docker compose up --build -d
  if ($LASTEXITCODE -ne 0) { throw "Sonora could not start. Review the Docker Compose output above." }
} finally {
  Pop-Location
}

Start-Process "http://127.0.0.1:8000/"
