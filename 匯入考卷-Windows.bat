@echo off
cd /d "%~dp0"
title 考卷匯入
echo ==========================================
echo   考卷匯入：把 待匯入 資料夾的考卷交給 AI 整理成草稿
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
if not "%ANTHROPIC_API_KEY%"=="" goto run
echo 請貼上 Claude API 金鑰，然後按 Enter。
echo （金鑰只在這個視窗有效，不會存進檔案。沒有金鑰就直接按 Enter，改用離線模式。）
set /p ANTHROPIC_API_KEY=金鑰：
if not "%ANTHROPIC_API_KEY%"=="" goto run
echo 使用離線模式（只能處理有文字層的 PDF，不會用 AI）。
set OFFLINE=--offline

:run
echo.
node scripts\import.js %OFFLINE%
echo.
echo 處理完成。請在瀏覽器開啟 http://localhost:3000/admin/ 審核題目。
pause
