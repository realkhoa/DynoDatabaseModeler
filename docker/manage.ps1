<#
.SYNOPSIS
    Management utility for DynoDbModeler testing database containers.
.DESCRIPTION
    Provides automated commands to start, stop, monitor, inspect, and wipe
    local test database containers for PostgreSQL, MySQL, MariaDB, MSSQL,
    MongoDB, Redis, and Adminer.
#>

param(
    [Parameter(Position = 0)]
    [ValidateSet("start", "stop", "restart", "status", "logs", "reset", "help")]
    [string]$Command = "status",

    [Parameter(Position = 1)]
    [string]$Service = ""
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir
$ComposeFile = Join-Path $ProjectRoot "docker-compose.yml"

<#
    .DESCRIPTION
        @brief Validates that Docker engine and Docker Compose are installed and running.
        @throws System.Exception if Docker CLI is unavailable or daemon is unreachable.
#>
function Test-DockerEnvironment {
    try {
        & docker info > $null 2>&1
        if ($LASTEXITCODE -ne 0) {
            Write-Error "Docker daemon is not running or unreachable. Please start Docker Desktop."
        }
    } catch {
        Write-Error "Docker CLI is not found on PATH. Please install Docker."
    }
}

<#
    .DESCRIPTION
        @brief Starts the test database containers in detached mode.
        @param targetService Optional specific service name to start.
#>
function Start-DynoDatabases([string]$targetService) {
    Test-DockerEnvironment
    Push-Location $ProjectRoot
    try {
        if ([string]::IsNullOrWhiteSpace($targetService)) {
            Write-Host "Starting all database containers..." -ForegroundColor Cyan
            & docker compose up -d
        } else {
            Write-Host "Starting database service: $targetService..." -ForegroundColor Cyan
            & docker compose up -d $targetService
        }
    } finally {
        Pop-Location
    }
}

<#
    .DESCRIPTION
        @brief Stops the running test database containers.
        @param targetService Optional specific service name to stop.
#>
function Stop-DynoDatabases([string]$targetService) {
    Test-DockerEnvironment
    Push-Location $ProjectRoot
    try {
        if ([string]::IsNullOrWhiteSpace($targetService)) {
            Write-Host "Stopping all database containers..." -ForegroundColor Yellow
            & docker compose stop
        } else {
            Write-Host "Stopping database service: $targetService..." -ForegroundColor Yellow
            & docker compose stop $targetService
        }
    } finally {
        Pop-Location
    }
}

<#
    .DESCRIPTION
        @brief Retrieves health and operational status of all database services.
#>
function Get-DynoStatus {
    Test-DockerEnvironment
    Push-Location $ProjectRoot
    try {
        Write-Host "=== DynoDbModeler Test Database Status ===" -ForegroundColor Green
        & docker compose ps
    } finally {
        Pop-Location
    }
}

<#
    .DESCRIPTION
        @brief Displays streaming logs for database services.
        @param targetService Optional specific service name to inspect logs for.
#>
function Show-DynoLogs([string]$targetService) {
    Test-DockerEnvironment
    Push-Location $ProjectRoot
    try {
        if ([string]::IsNullOrWhiteSpace($targetService)) {
            & docker compose logs -f --tail=100
        } else {
            & docker compose logs -f --tail=100 $targetService
        }
    } finally {
        Pop-Location
    }
}

<#
    .DESCRIPTION
        @brief Destroys all database containers and clears named volumes to re-seed clean data.
        @details Irreversibly purges PostgreSQL, MySQL, MSSQL, MariaDB, Mongo, and Redis data volumes.
#>
function Reset-DynoDatabases {
    Test-DockerEnvironment
    Push-Location $ProjectRoot
    try {
        Write-Warning "Resetting all database containers and volumes. All test data will be wiped!"
        & docker compose down -v
        Write-Host "Restarting fresh containers with seed scripts..." -ForegroundColor Cyan
        & docker compose up -d
    } finally {
        Pop-Location
    }
}

<#
    .DESCRIPTION
        @brief Displays command line usage and parameter documentation.
#>
function Show-Usage {
    Write-Host @"
Usage: .\docker\manage.ps1 <command> [service]

Commands:
  start [service]     Start all or a specific database container (e.g. postgres, mysql, mssql)
  stop [service]      Stop all or a specific container
  restart [service]   Restart container(s)
  status              Check running status and health of all database services
  logs [service]      View streaming container logs
  reset               Wipe all volumes and recreate clean seeded databases
  help                Show this help menu

Examples:
  .\docker\manage.ps1 start
  .\docker\manage.ps1 start postgres
  .\docker\manage.ps1 logs mysql
  .\docker\manage.ps1 status
  .\docker\manage.ps1 reset
"@ -ForegroundColor Gray
}

switch ($Command.ToLower()) {
    "start"   { Start-DynoDatabases $Service }
    "stop"    { Stop-DynoDatabases $Service }
    "restart" { Stop-DynoDatabases $Service; Start-DynoDatabases $Service }
    "status"  { Get-DynoStatus }
    "logs"    { Show-DynoLogs $Service }
    "reset"   { Reset-DynoDatabases }
    "help"    { Show-Usage }
    default   { Show-Usage }
}
