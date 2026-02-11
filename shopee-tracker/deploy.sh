#!/bin/bash
# --- CONFIG ---
REPO_DIR="/home/huu/shopee-tracker"
TRACKER_DIR="/var/www/shopee-tracker"

echo "Step 1: Fetching latest code from GitHub..."
cd $REPO_DIR
git fetch --all
git reset --hard origin/main

echo "Step 2: Syncing Shopee Tracker..."
rsync -av --exclude 'node_modules' --exclude '.git' --exclude '.env' $REPO_DIR/shopee-tracker/ $TRACKER_DIR/

echo "Step 3: Installing dependencies for Tracker..."
cd $TRACKER_DIR
npm install --no-audit --no-fund --loglevel error

echo "Step 4: Skipping build on VPS for memory safety..."
# npm run build -- --base=/tracker/

echo "Step 5: Restarting PM2 Tracker service..."
pm2 restart shopee-tracker || pm2 start $TRACKER_DIR/server/index.cjs --name shopee-tracker

echo "=== DEPLOY TRACKER SUCCESSFUL ==="
