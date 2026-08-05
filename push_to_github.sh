#!/usr/bin/env bash
# 小暖 · 一键推送到 GitHub
# 用法：
#   ./push_to_github.sh <仓库URL>            # 走系统 git 凭证 / gh 登录
#   ./push_to_github.sh <仓库URL> <TOKEN>    # 用 Personal Access Token（勾了 repo 权限）
#   GITHUB_TOKEN=xxx ./push_to_github.sh <仓库URL>
#
# 说明：本脚本从 xiaonuan.bundle 恢复完整 git 历史到当前目录，
#       然后把 main 分支推到指定仓库。运行环境需能访问 github.com。
set -e

REPO_URL="${1:?用法: ./push_to_github.sh <仓库URL> [TOKEN]}"
TOKEN="${2:-$GITHUB_TOKEN}"

DIR="$(cd "$(dirname "$0")" && pwd)"
BUNDLE="$DIR/xiaonuan.bundle"

if [ ! -f "$BUNDLE" ]; then
  echo "❌ 找不到 $BUNDLE，请确认脚本与 bundle 在同一目录。"
  exit 1
fi

cd "$DIR"

# 当前目录还不是 git 仓库 → 从 bundle 恢复 .git（文件已随 zip 解压，这里只补历史）
if [ ! -d .git ]; then
  echo "→ 从 bundle 恢复 git 历史…"
  TMP="$(mktemp -d)"
  git clone "$BUNDLE" "$TMP" >/dev/null 2>&1
  cp -a "$TMP/.git" "$DIR/"
  rm -rf "$TMP"
  git reset --hard main >/dev/null 2>&1 || git reset --hard HEAD >/dev/null 2>&1
fi

# 组装带鉴权的 remote URL
AUTH_URL="$REPO_URL"
if [ -n "$TOKEN" ]; then
  AUTH_URL="$(printf '%s' "$REPO_URL" | sed -E "s#^https://#https://x-access-token:${TOKEN}@#")"
fi

git remote remove origin 2>/dev/null || true
git remote add origin "$AUTH_URL"

echo "→ 推送到 $REPO_URL …"
git push -u origin main
echo "✅ 完成！仓库已同步到 $REPO_URL"
