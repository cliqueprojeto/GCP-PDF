@echo off
rem Abre o GCP-PDF em modo de teste (sem gerar .exe).
rem Alteracoes na interface (src\renderer) aparecem na hora; feche e abra de novo para alteracoes em src\main.
cd /d "%~dp0"
if not exist node_modules (
  echo Instalando dependencias pela primeira vez...
  call npm ci || goto erro
)
call npm run dev %*
if errorlevel 1 goto erro
exit /b 0
:erro
echo.
echo Nao foi possivel iniciar o GCP-PDF em modo de teste.
pause
exit /b 1
