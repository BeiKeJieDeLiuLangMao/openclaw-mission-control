#!/usr/bin/env bash
# Mem0 OpenMemory API 调用封装

# 加载配置
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "${SCRIPT_DIR}/../config.sh"

# ============================================
# API 调用函数
# ============================================

# GET 请求
# 用法: api_get "/api/v1/memories/?user_id=xxx" jq_expression
api_get() {
    local endpoint="$1"
    local filter="${2:-.}"
    local url="${MEM0_API_URL}${endpoint}"

    log_debug "GET $url"

    local response
    response=$(curl -s -f -X GET "$url" 2>/dev/null)

    if [[ $? -ne 0 ]]; then
        log_error "API GET failed: $url"
        return 1
    fi

    if [[ -n "$filter" && "$filter" != "." ]]; then
        echo "$response" | jq -r "$filter" 2>/dev/null || echo "$response"
    else
        echo "$response"
    fi
}

# POST 请求
# 用法: api_post "/api/v1/turns/" '{"key":"value"}'
api_post() {
    local endpoint="$1"
    local data="$2"
    local url="${MEM0_API_URL}${endpoint}"

    log_debug "POST $url"

    local response
    response=$(curl -s -f -X POST "$url" \
        -H "Content-Type: application/json" \
        -d "$data" 2>/dev/null)

    if [[ $? -ne 0 ]]; then
        log_error "API POST failed: $url"
        log_debug "Response: $response"
        return 1
    fi

    echo "$response"
}

# 搜索记忆 (v2)
# 用法: search_memories "查询内容" jq_expression
search_memories() {
    local query="$1"
    local filter="${2:-.items}"  # 默认返回 items 数组

    local user_id
    user_id=$(get_user_id)

    # URL 编码查询内容
    local encoded_query
    encoded_query=$(jq -rn --arg q "$query" '$q | @uri')

    api_get "/api/v2/memories/search?user_id=${user_id}&query=${encoded_query}" "$filter"
}

# 获取记忆列表 (v2)
# 用法: get_memories limit
get_memories() {
    local limit="${1:-10}"

    local user_id
    user_id=$(get_user_id)

    api_get "/api/v2/memories/?user_id=${user_id}&limit=${limit}"
}

# 存储对话 (v2)
# 用法: store_turn "session_id" "messages_json"
# 返回: JSON with success/turn_id 或失败时返回空字符串
store_turn() {
    local session_id="$1"
    local messages="$2"

    # 获取配置
    local user_id
    user_id=$(get_user_id)
    local agent_id
    agent_id=$(get_agent_id)
    local source
    source=$(get_source)

    local payload
    payload=$(jq -n \
        --arg session_id "$session_id" \
        --arg user_id "$user_id" \
        --arg agent_id "$agent_id" \
        --arg source "$source" \
        --argjson messages "$messages" \
        '{
            session_id: $session_id,
            user_id: $user_id,
            agent_id: $agent_id,
            source: $source,
            messages: $messages
        }')

    local response
    response=$(api_post "/api/v2/turns/" "$payload")

    # 检查是否成功
    if [[ -n "$response" ]]; then
        local success
        success=$(echo "$response" | jq -r '.success // false' 2>/dev/null)
        if [[ "$success" == "true" ]]; then
            echo "$response"
            return 0
        fi
    fi

    # 失败时返回空字符串
    echo ""
    return 1
}

# 搜索图谱
# 用法: search_graph "查询内容" "user_id"
search_graph() {
    local query="$1"
    local user_id="$2"

    api_get "/api/v1/graph/search?q=${query}&user_id=${user_id}"
}

# 健康检查
# 用法: health_check
health_check() {
    local response
    response=$(curl -s -f "${MEM0_API_URL}/health" 2>/dev/null)

    if [[ $? -eq 0 ]]; then
        return 0
    else
        return 1
    fi
}
