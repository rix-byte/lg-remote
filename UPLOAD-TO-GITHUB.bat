@echo off
cd /d "%~dp0"

echo ============================================
echo   Upload LG Remote to GitHub
echo ============================================
echo.
echo BEFORE running this, do these 2 things:
echo.
echo  1. Create a free account at: https://github.com
echo.
echo  2. Create a new empty repository:
echo     - Go to: https://github.com/new
echo     - Repository name: lg-remote
echo     - Leave everything else as default
echo     - Do NOT tick "Add a README file"
echo     - Click the green "Create repository" button
echo.
echo  3. On the next page you will see a URL like:
echo     https://github.com/YOUR-USERNAME/lg-remote.git
echo     Copy that URL.
echo.
pause

echo.
set /p REPO_URL="Paste the repository URL and press Enter: "

if "%REPO_URL%"=="" (
    echo No URL entered. Exiting.
    pause
    exit /b 1
)

echo.
echo Setting up local git repository...
git init
git branch -M main
git remote remove origin 2>nul
git remote add origin %REPO_URL%

echo.
echo Adding files...
git add .
git commit -m "LG Remote app" --allow-empty

echo.
echo ============================================
echo Pushing to GitHub...
echo A browser window may open asking you to log in to GitHub.
echo ============================================
echo.
git push -u origin main --force

echo.
if %errorlevel% == 0 (
    echo ============================================
    echo  SUCCESS!
    echo.
    echo  Next steps:
    echo  1. Go to your GitHub repository in the browser
    echo  2. Click the "Actions" tab at the top
    echo  3. You will see a build running - wait for a green checkmark
    echo     (takes about 5-10 minutes)
    echo  4. Click the completed build
    echo  5. Scroll down to "Artifacts" and click "LG-Remote-APK"
    echo  6. A zip file downloads - open it, get the .apk file
    echo  7. Copy the .apk to your phone and tap it to install
    echo     (Android will ask "Allow install from unknown sources" - tap Allow)
    echo ============================================
) else (
    echo.
    echo ============================================
    echo  Push failed. Most likely fix:
    echo.
    echo  GitHub no longer accepts your password for git push.
    echo  You need a Personal Access Token instead. Here is how:
    echo.
    echo  1. Go to: https://github.com/settings/tokens/new
    echo  2. Note: "LG Remote push"
    echo  3. Expiration: 30 days
    echo  4. Check the box: "repo" (full control)
    echo  5. Click "Generate token" - COPY the token (you only see it once!)
    echo  6. Run this script again
    echo  7. When Windows asks for a password, paste the token instead
    echo ============================================
)
echo.
pause
