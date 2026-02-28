#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────────────
# 咕咕记账 自动部署脚本
# 用法: ./deploy.sh [all|server|client]
# ──────────────────────────────────────────────

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ── 可配置项（可通过环境变量覆盖） ──
REMOTE_HOST="${DEPLOY_HOST:-accapi.nex.cab}"
REMOTE_USER="${DEPLOY_USER:-root}"
REMOTE_SERVER_DIR="${DEPLOY_SERVER_DIR:-/opt/home-accountant/server}"
REMOTE_WEB_DIR="${DEPLOY_WEB_DIR:-/var/www/accountant}"
SSH_KEY="${DEPLOY_SSH_KEY:-}"

SSH_OPTS="-o StrictHostKeyChecking=no -o ConnectTimeout=10"
[ -n "$SSH_KEY" ] && SSH_OPTS="$SSH_OPTS -i $SSH_KEY"

ssh_cmd() { ssh $SSH_OPTS "${REMOTE_USER}@${REMOTE_HOST}" "$@"; }
scp_cmd() { scp $SSH_OPTS "$@"; }

# ── 颜色 ──
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

# ── 后端部署 ──
deploy_server() {
  info "===== 部署后端 ====="

  info "同步后端代码到远程服务器..."
  ssh_cmd "mkdir -p ${REMOTE_SERVER_DIR}"

  rsync -avz --delete \
    --exclude '.venv/' \
    --exclude '__pycache__/' \
    --exclude '*.pyc' \
    --exclude 'data/' \
    --exclude 'tests/' \
    --exclude '.pytest_cache/' \
    -e "ssh $SSH_OPTS" \
    "${ROOT_DIR}/server/" \
    "${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_SERVER_DIR}/"

  info "在远程服务器上重新构建并启动容器..."
  ssh_cmd "cd ${REMOTE_SERVER_DIR}/docker && docker compose up -d --build"

  info "等待服务启动..."
  sleep 3

  info "健康检查..."
  if ssh_cmd "curl -sf http://127.0.0.1:8000/health > /dev/null 2>&1"; then
    info "后端部署成功 ✓"
  else
    warn "健康检查未通过，请检查容器日志: docker logs home-accountant-docker-api-1"
  fi
}

# ── 前端部署 ──
deploy_client() {
  info "===== 部署前端 ====="

  cd "${ROOT_DIR}/client"

  info "安装依赖..."
  npm install --silent

  info "构建前端..."
  npx expo export --platform web

  if [ ! -d "dist" ]; then
    error "构建失败，dist 目录不存在"
  fi

  info "同步前端产物到远程服务器..."
  ssh_cmd "mkdir -p ${REMOTE_WEB_DIR}"

  rsync -avz --delete \
    -e "ssh $SSH_OPTS" \
    "${ROOT_DIR}/client/dist/" \
    "${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_WEB_DIR}/"

  info "前端部署成功 ✓"
}

# ── 主入口 ──
TARGET="${1:-all}"

case "$TARGET" in
  server)
    deploy_server
    ;;
  client)
    deploy_client
    ;;
  all)
    deploy_server
    deploy_client
    ;;
  *)
    echo "用法: $0 [all|server|client]"
    echo "  all    - 部署前后端（默认）"
    echo "  server - 仅部署后端"
    echo "  client - 仅部署前端"
    exit 1
    ;;
esac

echo ""
info "===== 部署完成 ====="
