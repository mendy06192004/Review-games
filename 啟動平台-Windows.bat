@echo off
cd /d "%~dp0"
echo ==========================================
echo   國英數複習平台
echo ==========================================
where node >nul 2>nul
if errorlevel 1 goto nonode
if not exist src\app.js goto nosrc
if not exist node_modules goto install
goto run

:nonode
echo.
echo 找不到 Node.js，請先到 https://nodejs.org 安裝 LTS 版，
echo 安裝後請重新開機，再點兩下這個檔案。
pause
exit /b

:nosrc
echo.
echo 錯誤：找不到 src 資料夾，代表資料夾不完整。
echo 請重新下載完整的 ZIP 檔，解壓縮後再試一次。
pause
exit /b

:install
echo.
echo 第一次啟動，正在安裝需要的套件，約 1 到 3 分鐘，請稍候...
call npm install
if errorlevel 1 (
  echo 安裝失敗，請確認網路連線後再試一次。
  pause
  exit /b
)

:run
echo.
echo 啟動中，瀏覽器會自動打開。
echo 學生端：http://localhost:3000
echo 審核後台：http://localhost:3000/admin
echo 使用期間請不要關閉這個黑色視窗。
echo 學生手機掃碼：網頁右上角按「手機掃碼」（手機要連同一個 Wi-Fi）。
echo 若 Windows 跳出防火牆視窗，請勾選「私人網路」並按「允許存取」。
echo.
start "" cmd /c "timeout /t 4 >nul & start http://localhost:3000"
call npm start
echo.
echo 平台已停止。
pause
