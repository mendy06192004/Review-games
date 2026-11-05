@echo off
cd /d "%~dp0"
title 設定 Claude API 金鑰
echo ==========================================
echo   設定 Claude API 金鑰（只需要做一次）
echo ==========================================
echo.
echo 金鑰會存在這台電腦的 Windows 使用者設定中，不會寫進任何程式檔案。
echo 請貼上金鑰（以 sk-ant- 開頭），然後按 Enter：
set /p KEY=金鑰：
if "%KEY%"=="" goto empty
setx ANTHROPIC_API_KEY "%KEY%" >nul
echo.
echo 設定完成！請關掉平台的黑色視窗，再重新雙擊「啟動平台-Windows.bat」，新的設定才會生效。
pause
exit /b 0

:empty
echo 沒有輸入金鑰，已取消。
pause
