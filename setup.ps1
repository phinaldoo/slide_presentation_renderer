$ErrorActionPreference = "Stop"

$ExampleEnv = ".env.example"
$TargetEnv = ".env"

Write-Host "Setting up slide presentation renderer configuration..."
Write-Host ""

function New-ApiKey {
    $bytes = New-Object byte[] 48
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $rng.GetBytes($bytes)
    }
    finally {
        $rng.Dispose()
    }

    return [Convert]::ToBase64String($bytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
}

function Sync-EnvWithExample {
    param(
        [string]$ExampleFile,
        [string]$TargetFile
    )

    $targetKeys = @{}
    foreach ($line in Get-Content -LiteralPath $TargetFile) {
        if ($line -match "^\s*(#|$)") {
            continue
        }

        if ($line -notlike "*=*") {
            continue
        }

        $key = (($line -split "=", 2)[0].Trim() -split "\s+", 2)[0]
        if ($key) {
            $targetKeys[$key] = $true
        }
    }

    $added = 0
    foreach ($line in Get-Content -LiteralPath $ExampleFile) {
        if ($line -match "^\s*(#|$)") {
            continue
        }

        if ($line -notlike "*=*") {
            continue
        }

        $key = (($line -split "=", 2)[0].Trim() -split "\s+", 2)[0]
        if (-not $key) {
            continue
        }

        if (-not $targetKeys.ContainsKey($key)) {
            Add-Content -LiteralPath $TargetFile -Value $line
            $targetKeys[$key] = $true
            $added += 1
        }
    }

    if ($added -gt 0) {
        Write-Host "Added $added new key(s) from $ExampleFile into $TargetFile"
    }
    else {
        Write-Host "$TargetFile already contains all keys from $ExampleFile"
    }
}

function Ensure-ApiKeys {
    param([string]$EnvFile)

    $lines = @(Get-Content -LiteralPath $EnvFile)
    $apiKeyIndex = -1
    $currentValue = ""

    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match "^API_KEYS=(.*)$") {
            $apiKeyIndex = $i
            $currentValue = $Matches[1].Trim().Trim('"').Trim("'")
            break
        }
    }

    if ($apiKeyIndex -lt 0) {
        $lines += "API_KEYS="
        $apiKeyIndex = $lines.Count - 1
    }

    $normalizedValue = $currentValue.ToLowerInvariant()
    $placeholderValues = @(
        "",
        "changeme",
        "default",
        "change-me-with-a-long-random-key",
        "replace-with-a-long-random-api-key"
    )

    if (($placeholderValues -notcontains $normalizedValue) -and ($currentValue.Length -ge 16)) {
        Write-Host "API_KEYS already configured"
        return
    }

    $apiKey = New-ApiKey
    if (-not $apiKey) {
        throw "Failed to generate API_KEYS"
    }

    $lines[$apiKeyIndex] = "API_KEYS=$apiKey"
    Set-Content -LiteralPath $EnvFile -Value $lines
    Write-Host "Generated API_KEYS"
}

if (-not (Test-Path -LiteralPath $ExampleEnv -PathType Leaf)) {
    throw "Missing $ExampleEnv; cannot create setup configuration."
}

if (-not (Test-Path -LiteralPath $TargetEnv -PathType Leaf)) {
    Copy-Item -LiteralPath $ExampleEnv -Destination $TargetEnv
    Write-Host "Created $TargetEnv from $ExampleEnv"
}
else {
    Write-Host "$TargetEnv already exists; syncing new keys from $ExampleEnv"
    Sync-EnvWithExample -ExampleFile $ExampleEnv -TargetFile $TargetEnv
}

Ensure-ApiKeys -EnvFile $TargetEnv

Write-Host ""
Write-Host "Setup complete."
Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. Review .env if you want to adjust ports, HTTPS, or production hardening."
Write-Host "  2. Start the renderer: docker compose -f docker-compose.yml up -d --build"
Write-Host "  3. Check status: docker compose -f docker-compose.yml ps"
