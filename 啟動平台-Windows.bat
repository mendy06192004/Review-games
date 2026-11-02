@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ==========================================
echo   國英數複習平台
echo ==========================================
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo 找不到 Node.js，請先到 https://nodejs.org 下載安裝 LTS 版，裝好後再點兩下這個檔案。
  pause
  exit /b
)
if not exist node_modules (
  echo.
  echo 第一次啟動，正在安裝需要的套件，大約 1～3 分鐘，請稍候……
  call npm install
  if errorlevel 1 (
    echo 安裝失敗，請確認電腦有連上網路後再試一次。
    pause
    exit /b
  )
)
echo.
echo 啟動中……瀏覽器會自動打開。
echo 學生端：http://localhost:3000
echo 審核後台：http://localhost:3000/admin
echo.
echo ※ 使用期間請不要關閉這個黑色視窗；要關閉平台時，直接關掉這個視窗即可。
echo.
start "" cmd /c "timeout /t 3 >nul & start http://localhost:3000"
call npm start
pause
