<#
  打开数据编辑器（免安装、零依赖）。
  编辑器要用 File System Access API 才能「保存到 data/」，Chrome 只在安全上下文里给这个 API，
  file:// 不行，所以这里用自带的 tools\editor-server.cjs 在 127.0.0.1:3001 上把它供出去，
  再用 Chrome / Edge 打开。服务已开着就直接开窗口。
#>
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$Tools     = Join-Path (Split-Path -Parent $PSScriptRoot) 'tools'
$ServerJs  = Join-Path $Tools 'editor-server.cjs'
$Port      = if ($env:SP_EDITOR_PORT) { [int]$env:SP_EDITOR_PORT } else { 3001 }
$Url       = 'http://localhost:' + $Port + '/'

if (-not (Test-Path $ServerJs)) {
  [System.Windows.Forms.MessageBox]::Show('找不到编辑器服务：' + [Environment]::NewLine + $ServerJs, '数据编辑器', 'OK', 'Error') | Out-Null
  exit 1
}

function Test-EditorUp {
  try { $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5; return ($r.StatusCode -eq 200) } catch { return $false }
}

if (-not (Test-EditorUp)) {
  # 后台起服务：无窗口、无控制台闪烁
  Start-Process -FilePath 'node' -ArgumentList @('"' + $ServerJs + '"', '--port', "$Port", '--no-open') `
    -WorkingDirectory $Tools -WindowStyle Hidden
  $deadline = (Get-Date).AddSeconds(20)
  while ((Get-Date) -lt $deadline -and -not (Test-EditorUp)) { Start-Sleep -Milliseconds 300 }
}

if (-not (Test-EditorUp)) {
  [System.Windows.Forms.MessageBox]::Show('编辑器服务没能起来，请手动运行：' + [Environment]::NewLine + 'node "' + $ServerJs + '"', '数据编辑器', 'OK', 'Error') | Out-Null
  exit 1
}

# 优先 Chrome / Edge：默认 .html 关联可能是不支持该 API 的浏览器
$browsers = @(
  (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
  (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
  (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe'),
  (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
  (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe')
) | Where-Object { $_ -and (Test-Path $_) }

if ($browsers.Count) { Start-Process -FilePath $browsers[0] -ArgumentList @('--new-window', $Url) }
else { Start-Process $Url }
