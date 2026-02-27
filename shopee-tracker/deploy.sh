#!/bin/bash
# --- CONFIG ---
REPO_DIR="/home/huu/spe-repo/shopee-tracker"
TRACKER_DIR="/var/www/shopee-tracker"

echo "Step 1: Fetching latest code from GitHub..."
cd $REPO_DIR
git fetch --all
git reset --hard origin/main

echo "Step 2: Syncing Shopee Tracker..."
# Syncing directly from the repo root to /var/www/shopee-tracker
# We exclude dist because it is managed separately by scp from local build
rsync -av --exclude 'node_modules' --exclude '.git' --exclude '.env' --exclude 'dist' $REPO_DIR/ $TRACKER_DIR/

echo "Step 3: Installing dependencies for Tracker..."
cd $TRACKER_DIR
npm install --no-audit --no-fund --loglevel error

echo "Step 4: Restarting PM2 Tracker service..."
pm2 restart shopee-tracker || pm2 start $TRACKER_DIR/server/index.cjs --name shopee-tracker

echo "=== DEPLOY TRACKER SUCCESSFUL ==="
