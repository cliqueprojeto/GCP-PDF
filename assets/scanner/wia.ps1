param([string]$Action, [string]$DeviceId, [string]$Folder, [string]$Options)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
function Set-Property($Properties, [int]$Id, $Value) {
  $property = @($Properties | Where-Object { $_.PropertyID -eq $Id })
  if ($property.Count -ne 1) { throw "O driver não oferece a propriedade WIA $Id." }
  $property[0].Value = $Value
}
$manager = New-Object -ComObject WIA.DeviceManager
$devices = @($manager.DeviceInfos | Where-Object { $_.Type -eq 1 })
if ($Action -eq 'list') {
  $result = @($devices | ForEach-Object { @{ id = $_.DeviceID; name = [string]$_.Properties.Item('Name').Value } })
  ConvertTo-Json -InputObject $result -Compress
  exit
}
$info = $devices | Where-Object { $_.DeviceID -eq $DeviceId } | Select-Object -First 1
if (!$info) { throw 'Scanner desconectado ou não encontrado pelo WIA.' }
$device = $info.Connect()
$capability = @($device.Properties | Where-Object { $_.PropertyID -eq 3086 })
$flags = if ($capability.Count) { [int]$capability[0].Value } else { 0 }
$sources = @()
if ($flags -band 2) { $sources += 'Mesa' }
if ($flags -eq 0) { $sources += 'Padrão do driver' }
if ($flags -band 1) { $sources += 'Alimentador' }
if ($flags -band 4) { $sources += 'Alimentador duplex' }
if ($Action -eq 'capabilities') {
  @{ sources = $sources; nativeUi = $true; description = 'Windows WIA • mesa ou uma folha do alimentador por aquisição. Duplex depende do driver.' } | ConvertTo-Json -Compress
  exit
}
if ($Action -ne 'scan') { throw 'Ação WIA inválida.' }
$o = $Options | ConvertFrom-Json
if ($sources -notcontains $o.source) { throw 'Origem indisponível no driver WIA.' }
$dialog = New-Object -ComObject WIA.CommonDialog
$handling = switch ($o.source) { 'Mesa' { 2 } 'Alimentador' { 1 } 'Alimentador duplex' { 5 } }
# Some flatbed-only drivers omit document handling entirely.
if ($o.source -ne 'Padrão do driver' -and @($device.Properties | Where-Object { $_.PropertyID -eq 3088 }).Count) { Set-Property $device.Properties 3088 $handling }
$count = if ($o.source -eq 'Alimentador duplex') { 2 } else { 1 }
for ($n = 1; $n -le $count; $n++) {
  $item = $device.Items.Item(1)
  if (!$o.nativeUi) {
    Set-Property $item.Properties 6147 ([int]$o.dpi)
    Set-Property $item.Properties 6148 ([int]$o.dpi)
    $intent = switch ($o.color) { 'color' { 1 } 'gray' { 2 } 'bw' { 4 } }
    Set-Property $item.Properties 6146 $intent
    $paper = switch ($o.paper) { 'A3' { @(297,420) } 'A5' { @(148,210) } 'Carta' { @(215.9,279.4) } 'Ofício' { @(215.9,355.6) } default { @(210,297) } }
    Set-Property $item.Properties 6151 ([int][Math]::Round($paper[0] / 25.4 * $o.dpi))
    Set-Property $item.Properties 6152 ([int][Math]::Round($paper[1] / 25.4 * $o.dpi))
  }
  $format = '{B96B3CAF-0728-11D3-9D7B-0000F81EF32E}' # PNG
  if ($o.nativeUi) { $null = $dialog.ShowItemProperties($item, $false) }
  $image = if ($o.nativeUi) { $dialog.ShowTransfer($item,$format,$false) } else { $item.Transfer($format) }
  if (!$image) { break }
  if ($image.FormatID -ne $format) {
    $processor = New-Object -ComObject WIA.ImageProcess
    $processor.Filters.Add($processor.FilterInfos.Item('Convert').FilterID)
    $processor.Filters.Item(1).Properties.Item('FormatID').Value = $format
    $image = $processor.Apply($image)
  }
  $image.SaveFile((Join-Path $Folder ('page-{0:D4}.png' -f $n)))
}
