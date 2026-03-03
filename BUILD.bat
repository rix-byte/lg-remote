@echo off
cd /d "%~dp0"
echo ============================================
echo   LG TV Remote - APK Builder
echo ============================================
echo.

:: Check Node.js
node --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js is not installed.
    echo Please download and install it from: https://nodejs.org
    echo Choose the "LTS" version, run the installer, then run this script again.
    pause
    exit /b 1
)

echo Step 1: Installing dependencies...
call npm install
if errorlevel 1 (
    echo ERROR: npm install failed.
    pause
    exit /b 1
)

echo.
echo Step 2: Installing EAS build tool...
call npm install -g eas-cli

echo.
echo Step 3: Committing latest files to local git repo...
if not exist ".git" (
    git init
)
git add .
git commit -m "LG Remote app" --allow-empty

echo.
echo Step 4: Checking Expo login...
call eas whoami >nul 2>&1
if errorlevel 1 (
    echo Please log in to your Expo account.
    echo (Sign up free at https://expo.dev if you don't have one)
    echo.
    call eas login
) else (
    echo Already logged in.
)

echo.
echo Step 5: Building APK in the cloud (10-15 minutes)...
echo You will get a download link when it's done.
echo.
call eas build --platform android --profile preview

echo.
echo ============================================
echo DONE! Check above for the download link.
echo Download the .apk file to your phone and tap it to install.
echo (You may need to allow "Install unknown apps" in your phone settings)
echo ============================================
pause
