#!/usr/bin/env bash
#
# HomeAccountant 插件一键管理脚本
#
# 用法:
#   ./manage.sh start          # 启动所有插件
#   ./manage.sh stop           # 停止所有插件
#   ./manage.sh restart        # 重启所有插件
#   ./manage.sh status         # 查看所有插件状态
#   ./manage.sh start <name>   # 启动指定插件
#   ./manage.sh stop <name>    # 停止指定插件
#   ./manage.sh logs <name>    # 查看指定插件日志

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PID_DIR="$SCRIPT_DIR/.pids"
LOG_DIR="$SCRIPT_DIR/.logs"

mkdir -p "$PID_DIR" "$LOG_DIR"

# 自动发现所有含 plugin.py 的子目录
discover_plugins() {
    for d in "$SCRIPT_DIR"/*/; do
        if [[ -f "$d/plugin.py" ]]; then
            basename "$d"
        fi
    done
}

is_running() {
    local name="$1"
    local pid_file="$PID_DIR/$name.pid"
    if [[ -f "$pid_file" ]]; then
        local pid
        pid=$(cat "$pid_file")
        if kill -0 "$pid" 2>/dev/null; then
            return 0
        fi
        rm -f "$pid_file"
    fi
    return 1
}

start_plugin() {
    local name="$1"
    local plugin_dir="$SCRIPT_DIR/$name"

    if [[ ! -f "$plugin_dir/plugin.py" ]]; then
        echo "  ✗ $name: plugin.py 不存在"
        return 1
    fi

    if [[ ! -f "$plugin_dir/config.json" ]]; then
        echo "  ✗ $name: 未配置 (缺少 config.json，请先运行 --setup)"
        return 1
    fi

    if is_running "$name"; then
        local pid
        pid=$(cat "$PID_DIR/$name.pid")
        echo "  - $name: 已在运行 (PID $pid)"
        return 0
    fi

    local log_file="$LOG_DIR/$name.log"
    nohup python3 "$plugin_dir/plugin.py" >> "$log_file" 2>&1 &
    local pid=$!
    echo "$pid" > "$PID_DIR/$name.pid"
    
    # 等一下确认进程没有立刻退出
    sleep 1
    if kill -0 "$pid" 2>/dev/null; then
        echo "  ✓ $name: 已启动 (PID $pid)"
    else
        rm -f "$PID_DIR/$name.pid"
        echo "  ✗ $name: 启动失败，查看日志: $log_file"
        tail -5 "$log_file" 2>/dev/null | sed 's/^/    /'
        return 1
    fi
}

stop_plugin() {
    local name="$1"

    if ! is_running "$name"; then
        echo "  - $name: 未在运行"
        return 0
    fi

    local pid
    pid=$(cat "$PID_DIR/$name.pid")
    echo -n "  - $name: 停止中 (PID $pid)..."
    
    kill "$pid" 2>/dev/null
    
    # 等待优雅退出（最多 10 秒）
    local waited=0
    while kill -0 "$pid" 2>/dev/null && [[ $waited -lt 10 ]]; do
        sleep 1
        ((waited++))
    done

    if kill -0 "$pid" 2>/dev/null; then
        kill -9 "$pid" 2>/dev/null
        echo " 强制终止"
    else
        echo " 已停止"
    fi

    rm -f "$PID_DIR/$name.pid"
}

show_status() {
    local name="$1"
    if is_running "$name"; then
        local pid
        pid=$(cat "$PID_DIR/$name.pid")
        local mem
        mem=$(ps -o rss= -p "$pid" 2>/dev/null | awk '{printf "%.1fM", $1/1024}')
        local uptime
        uptime=$(ps -o etime= -p "$pid" 2>/dev/null | xargs)
        echo "  ● $name: 运行中 (PID $pid, 内存 $mem, 运行时间 $uptime)"
    else
        echo "  ○ $name: 未运行"
    fi
}

show_logs() {
    local name="$1"
    local log_file="$LOG_DIR/$name.log"
    if [[ -f "$log_file" ]]; then
        echo "=== $name 最近日志 ==="
        tail -30 "$log_file"
    else
        echo "  $name: 无日志文件"
    fi
}

# 获取目标插件列表
get_targets() {
    local specific="$1"
    if [[ -n "$specific" ]]; then
        echo "$specific"
    else
        discover_plugins
    fi
}

usage() {
    cat <<EOF
HomeAccountant 插件管理器

用法: $(basename "$0") <命令> [插件名]

命令:
  start   [name]    启动所有/指定插件
  stop    [name]    停止所有/指定插件
  restart [name]    重启所有/指定插件
  status  [name]    查看所有/指定插件状态
  logs    <name>    查看指定插件日志
  list              列出所有已发现的插件

插件列表:
$(discover_plugins | sed 's/^/  - /')
EOF
}

# ─── 主逻辑 ───

CMD="${1:-}"
TARGET="${2:-}"

case "$CMD" in
    start)
        echo "启动插件..."
        for p in $(get_targets "$TARGET"); do
            start_plugin "$p"
        done
        ;;
    stop)
        echo "停止插件..."
        for p in $(get_targets "$TARGET"); do
            stop_plugin "$p"
        done
        ;;
    restart)
        echo "重启插件..."
        for p in $(get_targets "$TARGET"); do
            stop_plugin "$p"
            start_plugin "$p"
        done
        ;;
    status)
        echo "插件状态:"
        for p in $(get_targets "$TARGET"); do
            show_status "$p"
        done
        ;;
    logs)
        if [[ -z "$TARGET" ]]; then
            echo "请指定插件名: $(basename "$0") logs <name>"
            exit 1
        fi
        show_logs "$TARGET"
        ;;
    list)
        echo "已发现插件:"
        discover_plugins | sed 's/^/  - /'
        ;;
    *)
        usage
        exit 1
        ;;
esac
