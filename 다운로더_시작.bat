@echo off
chcp 65001 >nul
title 유튜브 ^& 인스타 다운로더
cd /d %~dp0

where npm >nul 2>nul
if errorlevel 1 (
  echo.
  echo [오류] Node.js가 설치되어 있지 않습니다.
  echo https://nodejs.org 에서 LTS 버전을 설치한 뒤 다시 실행해 주세요.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo.
  echo 처음 실행이라 필요한 패키지를 설치합니다. 잠시만 기다려 주세요...
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo [오류] npm install에 실패했습니다. 위 오류 메시지를 확인해 주세요.
    echo.
    pause
    exit /b 1
  )
)

echo.
echo 서버를 시작합니다. 잠시 후 브라우저가 자동으로 열립니다...
echo 이 창을 닫으면 서버가 종료됩니다.
echo.

start "" cmd /c "timeout /t 3 /nobreak >nul & start http://localhost:3000"

call npm start

pause
