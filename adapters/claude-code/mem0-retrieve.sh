#!/usr/bin/env bash
# Mem0 OpenMemory 召回 Hook
# 触发时机: UserPromptSubmit - 用户发出消息时
# 功能: 基于用户输入查询相关记忆，注入到上下文

set -euo pipefail

# 获取脚本所在目录的绝对路径
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 加载配置（使用绝对路径）
# shellcheck source=/dev/null
source "${SCRIPT_DIR}/config.sh"
# shellcheck source=/dev/null
source "${SCRIPT_DIR}/lib/api.sh"

# ============================================
# 配置
# ============================================

MAX_STDIN=65536  # 最大读取 64KB
TIMEOUT=10        # API 超时秒数

# ============================================
# 主逻辑
# ============================================

# 检查依赖
check_dependencies || exit 0

# 读取 stdin
read_stdin() {
    local stdin_data=""
    local chunk

    while IFS= read -r chunk; do
        stdin_data+="$chunk"
        if [[ ${#stdin_data} -gt $MAX_STDIN ]]; then
            break
        fi
    done

    echo "$stdin_data"
}

# 提取用户消息内容
extract_user_message() {
    local input="$1"

    # 尝试提取用户消息内容
    # 格式1: {"message": {"role": "user", "content": "..."}}
    local content
    content=$(echo "$input" | jq -r '.message.content // empty' 2>/dev/null)

    if [[ -n "$content" && "$content" != "null" ]]; then
        echo "$content"
        return
    fi

    # 格式2: {"text": "..."} (简单格式)
    content=$(echo "$input" | jq -r '.text // empty' 2>/dev/null)
    if [[ -n "$content" && "$content" != "null" ]]; then
        echo "$content"
        return
    fi

    echo ""
}

# 格式化记忆输出
format_memories() {
    local memories_json="$1"
    local count

    # API 返回格式: {"items": [...], "total": N}
    count=$(echo "$memories_json" | jq '.total // (.items | length) // 0' 2>/dev/null || echo "0")

    if [[ "$count" -eq 0 ]] || [[ "$count" == "null" ]]; then
        echo ""
        return
    fi

    echo "## 相关记忆"
    echo ""

    # 遍历记忆并格式化
    echo "$memories_json" | jq -r '.items[] | "- **\(.content // .memory // "...")**" ' 2>/dev/null || true

    echo ""
    echo "---"
    echo ""
}

# 获取项目名称
get_project_name() {
    basename "$PWD"
}

# 主函数
main() {
    # 读取 stdin
    local stdin_data
    stdin_data=$(read_stdin)

    if [[ -z "$stdin_data" ]]; then
        log_debug "No stdin data"
        exit 0
    fi

    # 提取用户消息
    local user_message
    user_message=$(extract_user_message "$stdin_data")

    if [[ -z "$user_message" ]]; then
        log_debug "No user message found"
        exit 0
    fi

    log_debug "User message: ${user_message:0:100}..."

    # 获取用户 ID
    local user_id
    user_id=$(get_user_id)

    log_debug "User ID: $user_id"

    # 跳过太短的消息（可能是确认回复等）
    # 使用 UTF-8 字符计数，考虑中文字符
    local msg_bytes=${#user_message}
    local msg_length=$(echo -n "$user_message" | wc -m | tr -d ' ')
    if [[ $msg_length -lt 2 ]]; then
        log_debug "Message too short, skipping (length: $msg_length)"
        exit 0
    fi

    # 跳过确认类消息
    local skip_patterns=("^yes$" "^y$" "^no$" "^n$" "^ok$" "^好$" "^是的$" "^不是$" "^对$" "^错$")
    for pattern in "${skip_patterns[@]}"; do
        if [[ "$user_message" =~ $pattern ]]; then
            log_debug "Message matches skip pattern: $pattern"
            exit 0
        fi
    done

    # 搜索相关记忆
    local memories_json
    # macOS 没有 timeout 命令，直接调用
    if ! memories_json=$(search_memories "$user_message" "$user_id" "." 2>/dev/null); then
        log_error "Failed to search memories"
        exit 0
    fi

    log_debug "Found memories: $(echo "$memories_json" | jq 'length' 2>/dev/null || echo "0")"

    # 格式化输出
    local output
    output=$(format_memories "$memories_json")

    if [[ -n "$output" ]]; then
        echo "$output"
    fi

    exit 0
}

# 运行
main
