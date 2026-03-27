#!/usr/bin/env bash
# Mem0 OpenMemory 存储 Hook
# 触发时机: Stop - 每轮回复后（异步执行）
# 功能: 读取 transcript，存储对话到 turns 表

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
MAX_MESSAGES=50   # 最多处理的消息数
MAX_CONTENT_LEN=4000  # 单条消息最大长度

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

# 从 stdin 中提取 transcript_path
extract_transcript_path() {
    local input="$1"

    echo "$input" | jq -r '.transcript_path // empty' 2>/dev/null
}

# 解析 transcript JSONL，提取对话消息
parse_transcript() {
    local transcript_path="$1"

    if [[ -z "$transcript_path" ]] || [[ ! -f "$transcript_path" ]]; then
        log_debug "Transcript not found: $transcript_path"
        return 1
    fi

    local messages='[]'
    local count=0

    # 逐行读取 JSONL
    while IFS= read -r line && [[ $count -lt $MAX_MESSAGES ]]; do
        # 跳过空行
        [[ -z "$line" ]] && continue

        # 解析单行
        local entry_type entry_role entry_content
        entry_type=$(echo "$line" | jq -r '.type // empty' 2>/dev/null)

        # 只处理 user 和 assistant 类型的消息
        if [[ "$entry_type" != "user" && "$entry_type" != "assistant" ]]; then
            continue
        fi

        entry_role=$(echo "$line" | jq -r '.message.role // empty' 2>/dev/null)

        # 提取内容
        local content_field
        content_field=$(echo "$line" | jq '.message.content // empty' 2>/dev/null)

        # 内容可能是字符串或数组
        if [[ "$content_field" == "null" ]] || [[ -z "$content_field" ]]; then
            continue
        fi

        # 如果是数组（多模态内容），提取文本部分
        if echo "$content_field" | jq -e '. | type == "array"' >/dev/null 2>&1; then
            entry_content=$(echo "$content_field" | jq -r '
                map(
                    if .type == "text" then
                        .text
                    elif .type == "thinking" then
                        ""  # 跳过 thinking
                    else
                        empty
                    end
                ) | join("")
            ' 2>/dev/null)
        else
            # 如果是字符串，直接使用
            entry_content="$content_field"
        fi

        # 跳过空内容
        [[ -z "$entry_content" || "$entry_content" == "null" ]] && continue

        # 清理 ANSI 颜色码
        entry_content=$(echo "$entry_content" | sed 's/\x1b\[[0-9;]*m//g')

        # 截断过长内容
        if [[ ${#entry_content} -gt $MAX_CONTENT_LEN ]]; then
            entry_content="${entry_content:0:$MAX_CONTENT_LEN}..."
        fi

        # 标准化 role
        case "$entry_role" in
            "user")
                local msg_json
                msg_json=$(jq -n \
                    --arg role "user" \
                    --arg content "$entry_content" \
                    '{role: $role, content: $content}')
                messages=$(echo "$messages" | jq ". + [$msg_json]")
                ((count++))
                ;;
            "assistant")
                local msg_json
                msg_json=$(jq -n \
                    --arg role "assistant" \
                    --arg content "$entry_content" \
                    '{role: $role, content: $content}')
                messages=$(echo "$messages" | jq ". + [$msg_json]")
                ((count++))
                ;;
        esac
    done < "$transcript_path"

    echo "$messages"
}

# 获取会话 ID（基于 transcript 路径生成）
get_session_id_from_transcript() {
    local transcript_path="$1"

    # 从路径提取日期信息
    local date_str
    date_str=$(date +%Y%m%d)

    # user_id 现在固定为 yishu,不需要动态获取
    echo "claude-yishu-${date_str}"
}

# 主函数
main() {
    # 调试：记录所有调用到日志文��
    local debug_log="/tmp/mem0-store-debug.log"
    {
        echo "=== $(date '+%Y-%m-%d %H:%M:%S') ==="
        echo "CWD: $PWD"
        echo "Args: $*"
    } >> "$debug_log"

    # 读取 stdin
    local stdin_data
    stdin_data=$(read_stdin)

    # 记录 stdin 到调试日志
    {
        echo "STDIN length: ${#stdin_data}"
        echo "STDIN: $stdin_data"
    } >> "$debug_log"

    if [[ -z "$stdin_data" ]]; then
        log_debug "No stdin data"
        exit 0
    fi

    # 提取 transcript 路径
    local transcript_path
    transcript_path=$(extract_transcript_path "$stdin_data")

    if [[ -z "$transcript_path" ]]; then
        log_debug "No transcript_path found"
        echo "No transcript_path found" >> "$debug_log"
        exit 0
    fi

    log_debug "Transcript: $transcript_path"
    echo "Transcript: $transcript_path" >> "$debug_log"

    # 检查文件是否存在
    if [[ ! -f "$transcript_path" ]]; then
        log_error "Transcript file not found: $transcript_path"
        exit 0
    fi

    # 解析 transcript
    local messages_json
    messages_json=$(parse_transcript "$transcript_path")

    local msg_count
    msg_count=$(echo "$messages_json" | jq 'length')

    if [[ "$msg_count" -eq 0 ]]; then
        log_debug "No messages found in transcript"
        exit 0
    fi

    log_debug "Found $msg_count messages"

    # 获取会话 ID
    local session_id
    session_id=$(get_session_id_from_transcript "$transcript_path")

    # 获取用户 ID
    local user_id
    user_id=$(get_user_id)

    log_debug "Storing turn: session=$session_id, user=$user_id, messages=$msg_count"

    # 发送到 API - 创建 Turn（后台会自动处理 fact/summary/graph）
    local response
    if response=$(store_turn "$session_id" "$messages_json" 2>/dev/null); then
        local success
        success=$(echo "$response" | jq -r '.success // false' 2>/dev/null)
        if [[ "$success" == "true" ]]; then
            local turn_id
            turn_id=$(echo "$response" | jq -r '.turn_id // empty' 2>/dev/null)
            log_debug "Turn stored successfully: turn_id=$turn_id"
        else
            log_debug "Turn storage failed: $response"
        fi
    else
        log_error "Failed to store turn"
        log_debug "Response: $response"
    fi

    exit 0
}

# 运行
main
