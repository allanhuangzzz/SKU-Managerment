#!/bin/bash
# NAS 一键更新：拉取最新代码并重启容器（不碰 data/ 数据）
# 用法: ./nas-tools/update.sh
set -e
cd /volume1/docker/sku-manager || { echo "找不到代码目录，请检查路径"; exit 1; }

echo "[1/3] 拉取最新代码..."
git pull

echo "[2/3] 重建并重启容器（数据在 data/ 不受影响）..."
cd deploy_nas
sudo docker compose up -d --build

echo "[3/3] 完成！刷新页面即可看到新版本。"
