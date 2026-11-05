@echo off
cd /d "%~dp0"
title 考卷匯入
echo ==========================================
echo   考卷匯入：把 待匯入 資料夾的考卷自動整理成題目草稿
echo ==========================================
echo.
where node >nul 2>nul
if errorlevel 1 goto nonode
if not exist src\config.js goto nosrc
if not exist node_modules goto install
goto keycheck

:nonode
echo [錯誤] 找不到 Node.js。請先到 https://nodejs.org 安裝 LTS 版，重開電腦後再試。
pause
exit /b 1

:nosrc
echo [錯誤] 找不到 src 資料夾，請重新解壓縮完整版後再試。
pause
exit /b 1

:install
echo 第一次使用，正在安裝套件（需要幾分鐘）...
call npm install
if errorlevel 1 goto installfail
goto keycheck

:installfail
echo [錯誤] 套件安裝失敗，請把這個視窗的文字拍照給管理員。
pause
exit /b 1

:keycheck
:run
echo.
node scripts\import.js
echo.
echo 處理完成。請在瀏覽器開啟 http://localhost:3000/admin/ 審核題目。
pause
