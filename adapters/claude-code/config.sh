#!/usr/bin/env bash
# Claude Code Hooks for Mem0 OpenMemory
# 配置文件

# ============================================
# 配置项（可通过环境变量覆盖）
# ============================================

# Mem0 OpenMemory API 地址
MEM0_API_URL="${MEM0_API_URL:-http://localhost:8000}"

# 插件目录（自动检测）
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 用户 ID: 固定为 yishu
get_user_id() {
    echo "yishu"
}

# Agent ID: 使用当前工作目录的末级文件夹名
get_agent_id() {
    basename "$PWD"
}

# Session ID：基于目录和时间戳生成
get_session_id() {
    local user_id
    user_id=$(get_user_id)
    echo "claude-${user_id}-$(date +%Y%m%d-%H%M%S)"
}

# Source: 来源标识
get_source() {
    echo "claude-code"
}

# 调试模式（设置为 1 启用）
DEBUG="${MEM0_DEBUG:-0}"

# ============================================
# 工具函数
# ============================================

log_debug() {
    if [[ "$DEBUG" == "1" ]]; then
        echo "[DEBUG] $*" >&2
    fi
}

log_info() {
    echo "[INFO] $*" >&2
}

log_error() {
    echo "[ERROR] $*" >&2
}

# 确保 jq 可用
check_dependencies() {
    if ! command -v jq &> /dev/null; then
        log_error "jq is required but not installed. Install: https://jqlang.github.io/jq/download/"
        return 1
    fi
    if ! command -v curl &> /dev/null; then
        log_error "curl is required but not installed."
        return 1
    fi
    return 0
}
