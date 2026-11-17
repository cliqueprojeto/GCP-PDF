param([string]$JavaHome = "$env:ProgramFiles/Android/Android Studio/jbr")
$ErrorActionPreference = 'Stop'
$project = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../android'))
$config = Join-Path $project 'signing.properties'
if (Test-Path -LiteralPath $config) { Write-Host 'Assinatura existente preservada.'; return }
$keytool = Join-Path $JavaHome 'bin/keytool.exe'
if (-not (Test-Path -LiteralPath $keytool)) { throw 'JDK não encontrado. Informe -JavaHome.' }
$vault = Join-Path $env:LOCALAPPDATA 'GCP-PDF/android-signing'
New-Item -ItemType Directory -Force -Path $vault | Out-Null
# Restrict the directory before creating credentials or keys.
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
$acl = [Security.AccessControl.DirectorySecurity]::new()
$acl.SetAccessRuleProtection($true, $false)
$acl.SetOwner($sid)
$inheritance = [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'
$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', $inheritance, 'None', 'Allow'))
$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-5-18'), 'FullControl', $inheritance, 'None', 'Allow'))
Set-Acl -LiteralPath $vault -AclObject $acl
$key = Join-Path $vault 'gcp-pdf-release.keystore'
$recovery = Join-Path $vault 'signing.properties'
if ((Test-Path -LiteralPath $key) -and -not (Test-Path -LiteralPath $recovery)) { throw 'Chave existente sem configuração. Restaure o backup da assinatura; a chave não será substituída.' }
if (-not (Test-Path -LiteralPath $recovery)) {
    $bytes = [byte[]]::new(32)
    $random = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $random.GetBytes($bytes) } finally { $random.Dispose() }
    $password = [Convert]::ToBase64String($bytes)
    $env:GCP_PDF_SIGNING_PASSWORD = $password
    try {
        & $keytool -genkeypair -noprompt -alias gcp-pdf -keyalg RSA -keysize 3072 -validity 10000 -storetype PKCS12 -keystore $key -storepass:env GCP_PDF_SIGNING_PASSWORD -keypass:env GCP_PDF_SIGNING_PASSWORD -dname 'CN=GCP-PDF, OU=Android, O=Gestao Cultural Pro, C=BR'
        if ($LASTEXITCODE -ne 0) { throw 'Falha ao criar a assinatura local.' }
        $data = "storeFile=$($key.Replace('\','/'))`nstorePassword=$password`nkeyAlias=gcp-pdf`nkeyPassword=$password`n"
        [IO.File]::WriteAllText($recovery, $data, [Text.UTF8Encoding]::new($false))
    } finally { Remove-Item Env:GCP_PDF_SIGNING_PASSWORD -ErrorAction SilentlyContinue }
}
Copy-Item -LiteralPath $recovery -Destination $config
$fileAcl = [Security.AccessControl.FileSecurity]::new()
$fileAcl.SetAccessRuleProtection($true, $false)
$fileAcl.SetOwner($sid)
$fileAcl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', 'Allow'))
$fileAcl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-5-18'), 'FullControl', 'Allow'))
Set-Acl -LiteralPath $config -AclObject $fileAcl
Write-Host "Assinatura local criada. Guarde um backup privado de $vault. Não compartilhe essa pasta junto com o APK."
