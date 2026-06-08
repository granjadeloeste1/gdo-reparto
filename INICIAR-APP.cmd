@echo off
title GDO Reparto - servidor local
echo ============================================
echo   GRANJA DEL OESTE - App de Reparto
echo ============================================
echo.
echo Iniciando el servidor local...
echo NO cierres esta ventana mientras uses la app.
echo Para apagar la app: cerra esta ventana negra.
echo.
start "" powershell -NoExit -ExecutionPolicy Bypass -File "%USERPROFILE%\.claude\gdo-reparto-serve.ps1"
echo Abriendo la app en el navegador...
timeout /t 2 /nobreak >nul
start "" http://localhost:8124/
echo.
echo Listo. Si no se abrio sola, entra a:  http://localhost:8124/
echo Tienda online de prueba:              http://localhost:8124/tienda.html
echo.
pause
