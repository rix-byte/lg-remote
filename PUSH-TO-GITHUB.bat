@echo off
cd /d "%~dp0\.."
echo ============================================
echo   Push to GitHub - LG Remote Builder
echo ============================================
echo.
echo This will upload your code to GitHub so it can build your APK.
echo.
echo STEP 1: Make sure you have a GitHub account at https://github.com
echo STEP 2: Create a NEW repository at https://github.com/new
echo   - Name it anything (e.g. "lg-remote")
echo   - Choose Public or Private
echo   - Do NOT add README or .gitignore
echo   - Click "Create repository"
echo.
echo STEP 3: Copy the repository URL (looks like: https://github.com/YOUR_NAME/lg-remote.git)
echo.
set /p REPO_URL="Paste your GitHub repository URL here and press Enter: "

echo.
echo Setting up git...
git init 2>nul
git branch -M main 2>nul

git remote remove origin 2>nul
git remote add origin %REPO_URL%

echo.
echo Adding all files...
git add .
git commit -m "LG Remote app" --allow-empty

echo.
echo Pushing to GitHub...
git push -u origin main

echo.
if errorlevel 1 (
    echo ERROR: Push failed.
    echo Make sure you entered the correct URL and that you are logged into GitHub.
    echo You may be asked to log in to GitHub in a browser window.
) else (
    echo ============================================
    echo SUCCESS! Code pushed to GitHub.
    echo.
    echo Now go to your repository on GitHub:
    echo   %REPO_URL%
    echo.
    echo Click the "Actions" tab at the top.
    echo Wait 5-10 minutes for the build to finish.
    echo Click the finished build, then download "LG-Remote-APK".
    echo Extract the zip, copy the .apk to your phone, and install it!
    echo ============================================
)
pause
