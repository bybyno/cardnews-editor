@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 카드뉴스 편집기 설치
echo ==================================================
echo    카드뉴스 편집기 설치 (처음 한 번만 하면 돼요)
echo ==================================================
echo.

call :findpy
if defined PY goto havepy

echo [1/3] 파이썬이 없어서 설치합니다... (2~5분)
where winget >nul 2>nul
if not errorlevel 1 (
  winget install -e --id Python.Python.3.12 --scope user --silent --accept-package-agreements --accept-source-agreements
)
call :findpy
if defined PY goto havepy

echo     winget 으로 설치가 안 돼서 python.org 에서 직접 받습니다...
curl -L -o "%TEMP%\python-3.12-installer.exe" https://www.python.org/ftp/python/3.12.10/python-3.12.10-amd64.exe
if errorlevel 1 goto pyfail
"%TEMP%\python-3.12-installer.exe" /quiet InstallAllUsers=0 PrependPath=1 Include_launcher=1
call :findpy
if defined PY goto havepy

:pyfail
echo.
echo [실패] 파이썬을 자동으로 설치하지 못했어요.
echo   https://www.python.org/downloads/ 에서 직접 설치해 주세요.
echo   (설치 첫 화면에서 "Add python.exe to PATH" 를 꼭 체크)
echo   그다음 이 설치.bat 을 다시 실행하면 돼요.
pause
exit /b 1

:havepy
echo [1/3] 파이썬 확인: %PY%
echo.
echo [2/3] 필요한 프로그램 설치 (누끼 기능 포함, 5~10분)...
"%PY%" -m pip install --upgrade pip
"%PY%" -m pip install "rembg[cpu]" pillow
if errorlevel 1 (
  echo.
  echo [주의] 누끼 프로그램 설치에 실패했어요. 누끼 기능만 빼고 나머지는 쓸 수 있어요.
  echo        인터넷 연결을 확인하고 설치.bat 을 다시 실행해 보세요.
  pause
  exit /b 1
)
echo.
echo [3/3] 누끼 AI 모델 미리 받기 (약 1GB, 인터넷 속도에 따라 몇 분)...
"%PY%" -c "from rembg import new_session; new_session('birefnet-general'); print('누끼 모델 준비 완료')"
echo.
echo ==================================================
echo    설치 완료!  이제 start.bat 을 더블클릭하세요.
echo ==================================================
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
