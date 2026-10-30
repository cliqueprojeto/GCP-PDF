@echo off
setlocal
cd /d "%~dp0"
set "GCP_NODE=node"
if exist "%~dp0..\.tools\node-v24.22.1-win-x64\node.exe" set "PATH=%~dp0..\.tools\node-v24.22.1-win-x64;%PATH%"
if exist "%~dp0..\.tools\npm\node_modules\.bin\npm.cmd" set "PATH=%~dp0..\.tools\npm\node_modules\.bin;%PATH%"
if exist "%~dp0..\.tools\node-v24.22.1-win-x64\node.exe" set "GCP_NODE=%~dp0..\.tools\node-v24.22.1-win-x64\node.exe"
if exist "%~dp0..\.tools\npm\node_modules\npm\bin\npm-cli.js" set "npm_execpath=%~dp0..\.tools\npm\node_modules\npm\bin\npm-cli.js"
"%GCP_NODE%" "%~dp0scripts\publicar.mjs" %*
set "GCP_RESULT=%errorlevel%"
if "%~1"=="" pause
exit /b %GCP_RESULT%

