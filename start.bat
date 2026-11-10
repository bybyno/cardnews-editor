@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 카드뉴스 편집기 (이 창을 닫으면 편집기가 꺼져요)

call :findpy
if not defined PY (
  echo 파이썬이 없어요. 먼저 같은 폴더의 "설치.bat" 을 더블클릭해 주세요.
  pause
  exit /b 1
)
start "" http://127.0.0.1:5178/
:run
"%PY%" server.py 5178
rem 종료 코드 3 = 업데이트 후 다시 시작
if %errorlevel%==3 (
  echo 업데이트를 적용해서 편집기를 다시 시작합니다...
  goto run
)
pause
exit /b 0

:findpy
set "PY="
for %%P in ("%LOCALAPPDATA%\Programs\Python\Python312\python.exe" "%LOCALAPPDATA%\Programs\Python\Python313\python.exe") do (
  if not defined PY if exist %%P set "PY=%%~P"
)
if defined PY exit /b 0
py -3 -c "import sys" >nul 2>nul
if not errorlevel 1 for /f "delims=" %%i in ('py -3 -c "import sys;print(sys.executable)"') do set "PY=%%i"
if defined PY exit /b 0
python -c "import sys" >nul 2>nul
if not errorlevel 1 for /f "delims=" %%i in ('python -c "import sys;print(sys.executable)"') do set "PY=%%i"
exit /b 0
