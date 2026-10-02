$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$packagePath = Join-Path $repoRoot "package.json"
$lockPath = Join-Path $repoRoot "package-lock.json"
$manifestPath = Join-Path $repoRoot "manifest.json"
$distPath = Join-Path $repoRoot "dist"

$packageJson = Get-Content -LiteralPath $packagePath -Raw -Encoding UTF8 | ConvertFrom-Json
$lockVersionsJson = & node -e "const fs = require('node:fs'); const lock = JSON.parse(fs.readFileSync(process.argv[1], 'utf8')); process.stdout.write(JSON.stringify({ version: lock.version, rootVersion: lock.packages[''].version }));" $lockPath
if ($LASTEXITCODE -ne 0) {
  throw "Cannot read version metadata from package-lock.json"
}
$lockVersions = $lockVersionsJson | ConvertFrom-Json
$manifestJson = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json

if ($packageJson.version -ne $manifestJson.version) {
  throw "Version mismatch: package.json=$($packageJson.version), manifest.json=$($manifestJson.version)"
}

if ($packageJson.version -ne $lockVersions.version -or $packageJson.version -ne $lockVersions.rootVersion) {
  throw "Version mismatch: package-lock.json must match package.json and manifest.json"
}

$version = $packageJson.version
if ($version -notmatch "^\d+\.\d+\.\d+$") {
  throw "Invalid Chrome extension release version: $version"
}
$releaseName = "OU-Yeah-v$version"
$zipPath = Join-Path $distPath "$releaseName.zip"
$checksumPath = Join-Path $distPath "$releaseName.sha256"
$tempRootPath = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$stagingPath = Join-Path $tempRootPath "ou-yeah-release-$([System.Guid]::NewGuid().ToString('N'))"

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
      "src/time-format.js",
      "src/content.js",
      "src/deadlines.js",
      "src/course-download.js",
      "src/forum-export.js",
      "src/quiz-trainer.js",
      "src/course-data-export.js",
      "src/background.js",
      "src/offscreen.html",
      "src/offscreen.js",
      "src/notifications.js",
      "src/notifications.css",
      "src/fonts/SpaceGrotesk-Regular.ttf",
      "src/icons/inbox-in.svg",
      "src/icons/pause.svg",
      "src/icons/play.svg",
      "src/icons/envelope-dot.svg"
    )

    $requiredEntries += $manifestJson.background.service_worker
    $requiredEntries += $manifestJson.icons.PSObject.Properties | ForEach-Object { $_.Value }
    $requiredEntries += $manifestJson.action.default_icon.PSObject.Properties | ForEach-Object { $_.Value }
    foreach ($contentScript in $manifestJson.content_scripts) {
      $requiredEntries += @($contentScript.js)
      $requiredEntries += @($contentScript.css)
    }

    foreach ($entry in ($requiredEntries | Where-Object { $_ } | Select-Object -Unique)) {
      if ($entries -notcontains $entry) {
        throw "Release archive is missing $entry"
      }
    }

    $manifestReader = New-Object System.IO.StreamReader($archive.GetEntry("manifest.json").Open())
    try {
      $packedManifest = $manifestReader.ReadToEnd() | ConvertFrom-Json
      if ($packedManifest.version -ne $version) {
        throw "Release archive manifest version does not match $version"
      }
    } finally {
      $manifestReader.Dispose()
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

  $hashAlgorithm = [System.Security.Cryptography.SHA256]::Create()
  $zipStream = [System.IO.File]::OpenRead($zipPath)
  try {
    $hash = [System.BitConverter]::ToString($hashAlgorithm.ComputeHash($zipStream)).Replace("-", "").ToLowerInvariant()
  } finally {
    $zipStream.Dispose()
    $hashAlgorithm.Dispose()
  }
  "$hash  $releaseName.zip" | Set-Content -LiteralPath $checksumPath -Encoding ASCII -NoNewline

  Write-Output "Release: $zipPath"
  Write-Output "SHA256:  $hash"
} finally {
  if (Test-Path -LiteralPath $stagingPath) {
    $resolvedStagingPath = [System.IO.Path]::GetFullPath($stagingPath)
    $tempPrefix = $tempRootPath.TrimEnd([char[]]@('\', '/')) + [System.IO.Path]::DirectorySeparatorChar
    if (-not $resolvedStagingPath.StartsWith($tempPrefix, [System.StringComparison]::OrdinalIgnoreCase) -or
        [System.IO.Path]::GetFileName($resolvedStagingPath) -notmatch '^ou-yeah-release-[0-9a-f]{32}$') {
      throw "Refusing to remove a staging directory outside the release temp folder"
    }
    Remove-Item -LiteralPath $resolvedStagingPath -Recurse -Force
  }
}
