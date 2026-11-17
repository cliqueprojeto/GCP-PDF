param(
    [ValidateSet('Debug', 'Release', 'Check')][string]$Mode = 'Release',
    [string]$JavaHome = "$env:ProgramFiles/Android/Android Studio/jbr",
    [string]$Sdk = "$env:LOCALAPPDATA/Android/Sdk"
)
$ErrorActionPreference = 'Stop'
$project = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../android'))
if (-not (Test-Path -LiteralPath "$JavaHome/bin/java.exe")) { throw 'Informe -JavaHome com um JDK 17 ou 21 existente. Nenhum JDK será instalado.' }
if (-not (Test-Path -LiteralPath "$Sdk/platforms/android-36/android.jar")) { throw 'É necessário o Android SDK 36. Informe -Sdk com o SDK existente.' }
$env:JAVA_HOME = $JavaHome
$env:ANDROID_HOME = $Sdk
$version = '8.14.3'
$checksum = 'bd71102213493060956ec229d946beee57158dbd89d0e62b91bca0fa2c5f3531'
$cached = Join-Path $env:USERPROFILE ".gradle/wrapper/dists/gradle-$version-bin"
$gradle = Get-ChildItem -LiteralPath $cached -Filter gradle.bat -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
if (-not $gradle) {
    $toolchains = Join-Path $env:LOCALAPPDATA 'GCP-PDF/toolchains'
    $gradle = Join-Path $toolchains "gradle-$version/bin/gradle.bat"
    if (-not (Test-Path -LiteralPath $gradle)) {
        New-Item -ItemType Directory -Force -Path $toolchains | Out-Null
        $archive = Join-Path $toolchains "gradle-$version-bin.zip"
        Write-Host "Baixando Gradle $version em cache privado do GCP-PDF..."
        Invoke-WebRequest -Uri "https://services.gradle.org/distributions/gradle-$version-bin.zip" -OutFile $archive
        if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $checksum) { throw 'O SHA-256 do Gradle não corresponde. Arquivo não executado.' }
        Expand-Archive -LiteralPath $archive -DestinationPath $toolchains -Force
    }
}
if ($Mode -eq 'Release' -and -not (Test-Path -LiteralPath "$project/signing.properties")) {
    & (Join-Path $PSScriptRoot 'Initialize-AndroidSigning.ps1') -JavaHome $JavaHome
}
[string[]]$tasks = switch ($Mode) {
    'Debug' { @(':app:assembleDebug') }
    'Release' { @(':app:assembleRelease') }
    'Check' { @(':app:testDebugUnitTest', ':app:lintDebug', ':app:assembleDebugAndroidTest') }
}
$buildProject = $project
$temporaryDrive = $null
if ($project -match '[^\x00-\x7F]') {
    # Java's Windows argument-file decoding can lose non-ASCII classpath entries.
    # A temporary drive keeps compiler/test paths ASCII without moving any source.
    $usedDrives = [Environment]::GetLogicalDrives()
    foreach ($code in 90..78) {
        $candidate = ([char]$code).ToString() + ':'
        if (($candidate + '\') -notin $usedDrives) {
            & subst.exe $candidate ([IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')))
            if ($LASTEXITCODE -ne 0) { throw 'Não foi possível criar o caminho temporário sem acentos.' }
            $temporaryDrive = $candidate
            $buildProject = "$candidate/android"
            break
        }
    }
    if (-not $temporaryDrive) { throw 'Não há letra de unidade livre para compilar neste caminho com acentos.' }
}
try {
    & $gradle -p $buildProject @tasks --console=plain --no-daemon
    if ($LASTEXITCODE -ne 0) { throw "Build Android falhou ($LASTEXITCODE)." }
} finally {
    if ($temporaryDrive) { & subst.exe $temporaryDrive /D }
}
if ($Mode -eq 'Release') {
    $apk = Join-Path $project 'app/build/outputs/apk/release/app-release.apk'
    $apksigner = Join-Path $Sdk 'build-tools/36.0.0/apksigner.bat'
    & $apksigner verify --verbose --print-certs $apk
    if ($LASTEXITCODE -ne 0) { throw 'A assinatura do APK não foi validada.' }
    $releaseDir = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../release/android'))
    New-Item -ItemType Directory -Force -Path $releaseDir | Out-Null
    $metadata = Get-Content -LiteralPath (Join-Path $PSScriptRoot '../package.json') -Raw | ConvertFrom-Json
    $destination = Join-Path $releaseDir "GCP-PDF-$($metadata.version)-android-preview.1.apk"
    Copy-Item -LiteralPath $apk -Destination $destination -Force
    $hash = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant()
    [IO.File]::WriteAllText((Join-Path $releaseDir 'SHA256SUMS.txt'), "$hash  $([IO.Path]::GetFileName($destination))`n", [Text.UTF8Encoding]::new($false))
    Write-Host "APK assinado: $destination"
}
