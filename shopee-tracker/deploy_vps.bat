@echo off
setlocal

:: --- CONFIG ---
set PEM_PATH=D:\Files\Code_HocTap\huuu.pem
set VPS_USER=huu
set VPS_IP=20.189.121.4
set REMOTE_TARGET=/var/www/shopee-tracker
set REMOTE_REPO=/home/huu/spe-repo/shopee-tracker

echo [STEP 1] Building frontend LOCALLY (to save VPS RAM)...
call npm run build -- --base=/tracker/
if %ERRORLEVEL% neq 0 (
    echo Error during build!
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo [STEP 2] Pushing source code to GitHub...
set /p commit_msg="Enter commit message (default: deploy: update distribution): "
if "%commit_msg%"=="" set commit_msg=deploy: update distribution
git add .
git commit -m "%commit_msg%"
git push

echo.
echo [STEP 3] Uploading BUILT files (dist) to VPS...
:: Create directory if not exists and upload
ssh -i "%PEM_PATH%" %VPS_USER%@%VPS_IP% "mkdir -p %REMOTE_TARGET%/dist"
scp -i "%PEM_PATH%" -r dist/* %VPS_USER%@%VPS_IP%:%REMOTE_TARGET%/dist/

echo.
echo [STEP 4] Executing remote deploy (Syncing server-side files)...
ssh -i "%PEM_PATH%" %VPS_USER%@%VPS_IP% "cd %REMOTE_REPO% && git pull && bash deploy.sh"

echo.
echo ========================================
echo        DEPLOY FINISHED SUCCESSFULLY
echo ========================================
pause
