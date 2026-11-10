@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 카드뉴스 편집기 업데이트 배포
echo 지금 편집기를 깃허브에 올려서, 공유받은 사람들 편집기에 '업데이트 하기'가 뜨게 합니다.
echo (API 키, 프로젝트, 받은 포스트는 올라가지 않아요)
echo.
set /p NOTES=무엇이 바뀌었는지 한 줄로 (그냥 Enter 해도 돼요):
python publish.py %NOTES%
echo.
pause
