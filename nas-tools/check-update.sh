#!/bin/bash
# 检查 NAS 代码库是否有新版本（不执行更新）
# 用法: ./nas-tools/check-update.sh
cd /volume1/docker/sku-manager || { echo "找不到代码目录，请检查路径"; exit 1; }

git fetch origin 2>/dev/null

LOCAL=$(git rev-parse --short HEAD 2>/dev/null)
REMOTE=$(git rev-parse --short origin/master 2>/dev/null)
BEHIND=$(git rev-list --count HEAD..origin/master 2>/dev/null)

echo "======================================"
echo "本地版本:  $LOCAL"
echo "云端版本:  $REMOTE"
echo "--------------------------------------"
if [ "$BEHIND" != "0" ] && [ -n "$BEHIND" ]; then
    echo "检测到 $BEHIND 个新提交 -> 有更新，可执行 update.sh"
else
    echo "已是最新版本，无需更新"
fi
echo "最近 3 次更新记录:"
git log -3 --oneline 2>/dev/null
echo "======================================"
