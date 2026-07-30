$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$packagePath = Join-Path $repoRoot "package.json"
$manifestPath = Join-Path $repoRoot "manifest.json"
$distPath = Join-Path $repoRoot "dist"

$packageJson = Get-Content -LiteralPath $packagePath -Raw -Encoding UTF8 | ConvertFrom-Json
$manifestJson = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json

if ($packageJson.version -ne $manifestJson.version) {
  throw "Version mismatch: package.json=$($packageJson.version), manifest.json=$($manifestJson.version)"
}

$version = $packageJson.version
$releaseName = "OU-Yeah-v$version"
$zipPath = Join-Path $distPath "$releaseName.zip"
$checksumPath = Join-Path $distPath "$releaseName.sha256"
$stagingPath = Join-Path ([System.IO.Path]::GetTempPath()) "ou-yeah-release-$([System.Guid]::NewGuid().ToString('N'))"

$rootFiles = @(
  "manifest.json",
  "README.md",
  "CHANGELOG.md"
)

try {
  New-Item -ItemType Directory -Path $distPath -Force | Out-Null
  if (Test-Path -LiteralPath $zipPath) {
    Remove-Item -LiteralPath $zipPath -Force
  }
  if (Test-Path -LiteralPath $checksumPath) {
    Remove-Item -LiteralPath $checksumPath -Force
  }

  New-Item -ItemType Directory -Path $stagingPath -Force | Out-Null
  foreach ($file in $rootFiles) {
    Copy-Item -LiteralPath (Join-Path $repoRoot $file) -Destination (Join-Path $stagingPath $file) -Force
  }
  Copy-Item -LiteralPath (Join-Path $repoRoot "src") -Destination (Join-Path $stagingPath "src") -Recurse -Force

  Compress-Archive -Path (Join-Path $stagingPath "*") -DestinationPath $zipPath -Force

  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
  try {
    $entries = $archive.Entries | ForEach-Object { $_.FullName.Replace("\", "/") }
    $requiredEntries = @(
      "manifest.json",
      "src/content.js",
      "src/forum-export.js",
      "src/background.js",
      "src/offscreen.js",
      "src/notifications.js",
      "src/notifications.css",
      "src/fonts/SpaceGrotesk-Regular.ttf",
      "src/icons/inbox-in.svg",
      "src/icons/envelope-dot.svg"
    )

    foreach ($entry in $requiredEntries) {
      if ($entries -notcontains $entry) {
        throw "Release archive is missing $entry"
      }
    }

    $forbiddenEntry = $entries | Where-Object {
      $_ -like "node_modules/*" -or
      $_ -like ".git/*" -or
      $_ -like "test/*" -or
      $_ -like "dist/*" -or
      $_ -eq "package-lock.json"
    } | Select-Object -First 1

    if ($forbiddenEntry) {
      throw "Release archive contains forbidden entry $forbiddenEntry"
    }
  } finally {
    $archive.Dispose()
  }

  $hash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
  "$hash  $releaseName.zip" | Set-Content -LiteralPath $checksumPath -Encoding ASCII -NoNewline

  Write-Output "Release: $zipPath"
  Write-Output "SHA256:  $hash"
} finally {
  if (Test-Path -LiteralPath $stagingPath) {
    Remove-Item -LiteralPath $stagingPath -Recurse -Force
  }
}
