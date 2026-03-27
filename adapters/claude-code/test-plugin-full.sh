#!/usr/bin/env bash
# Mem0 Claude Code Plugin 完整测试脚本
# 使用方法: bash test-plugin-full.sh

set -euo pipefail

# ============================================
# 配置
# ============================================

API_URL="${MEM0_API_URL:-http://localhost:8765}"
PROJECT_DIR="/Users/yishu.cy/IdeaProjects/openclaw-team-workspace"
PLUGIN_DIR="$PROJECT_DIR/mem0/claude-code-plugin"
USER_ID="openclaw-team-workspace"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# ============================================
# 辅助函数
# ============================================

print_header() {
    echo ""
    echo "========================================"
    echo "$1"
    echo "========================================"
}

print_step() {
    echo ""
    echo -e "${YELLOW}▶ $1${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_info() {
    echo "   📝 $1"
}

# ============================================
# 测试函数
# ============================================

test_api_connection() {
    print_step "1. 测试 API 连接"

    if curl -sf "$API_URL/health" > /dev/null 2>&1; then
        print_success "API 可访问"

        # 获取服务信息
        version=$(curl -s "$API_URL/health" | jq -r '.version // "unknown"')
        print_info "版本: $version"

        return 0
    else
        print_error "API 不可访问"
        print_info "请先启动 OpenMemory 服务:"
        print_info "  cd $PROJECT_DIR/mem0"
        print_info "  uv run uvicorn openmemory.api.main:app --reload --host 127.0.0.1 --port 8765"
        return 1
    fi
}

test_hooks_config() {
    print_step "2. 检查 Hooks 配置"

    local settings_file="$PROJECT_DIR/.claude/settings.json"

    if [[ ! -f "$settings_file" ]]; then
        print_error "settings.json 不存在: $settings_file"
        return 1
    fi

    # 检查 UserPromptSubmit hook
    if jq -e '.hooks.UserPromptSubmit' "$settings_file" > /dev/null 2>&1; then
        local retrieve_cmd=$(jq -r '.hooks.UserPromptSubmit[0].hooks[0].command' "$settings_file")
        if [[ -n "$retrieve_cmd" ]]; then
            print_success "UserPromptSubmit hook 已配置"
            print_info "命令: $retrieve_cmd"
        else
            print_error "UserPromptSubmit hook 配置为空"
            return 1
        fi
    else
        print_error "UserPromptSubmit hook 未配置"
        return 1
    fi

    # 检查 Stop hook
    if jq -e '.hooks.Stop' "$settings_file" > /dev/null 2>&1; then
        local store_cmd=$(jq -r '.hooks.Stop[0].hooks[0].command' "$settings_file")
        if [[ -n "$store_cmd" ]]; then
            print_success "Stop hook 已配置"
            print_info "命令: $store_cmd"
        else
            print_error "Stop hook 配置为空"
            return 1
        fi
    else
        print_error "Stop hook 未配置"
        return 1
    fi

    return 0
}

test_retrieve_function() {
    print_step "3. 测试召回功能"

    if [[ ! -f "$PLUGIN_DIR/mem0-retrieve.sh" ]]; then
        print_error "召回脚本不存在: $PLUGIN_DIR/mem0-retrieve.sh"
        return 1
    fi

    # 测试召回脚本
    local test_message="测试查询：什么是 OpenClaw"
    local retrieve_output

    retrieve_output=$(echo "{\"message\":{\"role\":\"user\",\"content\":\"$test_message\"}}" | \
      bash "$PLUGIN_DIR/mem0-retrieve.sh" 2>&1)

    if [[ $? -eq 0 ]]; then
        print_success "召回脚本执行成功"

        if [[ -n "$retrieve_output" ]]; then
            print_info "召回结果预览:"
            echo "$retrieve_output" | head -n 5 | sed 's/^/   /'
        else
            print_info "无相关记忆（正常现象）"
        fi

        return 0
    else
        print_error "召回脚本执行失败"
        print_info "错误信息: $retrieve_output"
        return 1
    fi
}

create_test_transcript() {
    print_step "4. 创建测试数据"

    local test_file="/tmp/test_transcript_$$.jsonl"

    cat > "$test_file" << 'EOF'
{"type":"user","message":{"role":"user","content":"自动化测试：请记住我喜欢使用 Claude Code 进行开发"}}
{"type":"assistant","message":{"role":"assistant","content":"好的，我已经记住你喜欢使用 Claude Code 进行开发"}}
EOF

    print_success "测试 transcript 创建成功"
    print_info "文件路径: $test_file"

    # 返回文件路径
    echo "$test_file"
}

test_store_function() {
    local transcript_file="$1"

    print_step "5. 测试存储功能"

    if [[ ! -f "$PLUGIN_DIR/mem0-store.sh" ]]; then
        print_error "存储脚本不存在: $PLUGIN_DIR/mem0-store.sh"
        rm -f "$transcript_file"
        return 1
    fi

    # 测试存储脚本
    local store_output
    store_output=$(echo "{\"transcript_path\":\"$transcript_file\"}" | \
      bash "$PLUGIN_DIR/mem0-store.sh" 2>&1)

    local exit_code=$?

    # 清理测试文件
    rm -f "$transcript_file"

    if [[ $exit_code -eq 0 ]]; then
        print_success "存储脚本执行成功"
        return 0
    else
        print_error "存储脚本执行失败"
        print_info "错误信息: $store_output"
        return 1
    fi
}

verify_storage() {
    print_step "6. 验证存储结果"

    # 等待异步处理
    print_info "等待异步处理完成..."
    sleep 3

    # 查询 turns
    local turns_response
    turns_response=$(curl -s "$API_URL/api/v1/turns/?user_id=$USER_ID&limit=1")

    if [[ -z "$turns_response" ]]; then
        print_error "无法查询 turns 表"
        return 1
    fi

    local total_turns
    total_turns=$(echo "$turns_response" | jq -r '.total // 0')

    if [[ "$total_turns" -gt 0 ]]; then
        print_success "找到 $total_turns 条 turn 记录"

        local latest_turn
        latest_turn=$(echo "$turns_response" | jq '.items[0]')

        local turn_id=$(echo "$latest_turn" | jq -r '.id')
        local source=$(echo "$latest_turn" | jq -r '.source')
        local msg_count=$(echo "$latest_turn" | jq -r '.message_count')
        local created_at=$(echo "$latest_turn" | jq -r '.created_at')

        print_info "最新 Turn:"
        print_info "  ID: ${turn_id:0:8}..."
        print_info "  来源: $source"
        print_info "  消息数: $msg_count"
        print_info "  创建时间: $created_at"

        return 0
    else
        print_error "数据库中无 turn 记录"
        print_info "请检查:"
        print_info "  1. 存储脚本是否正确执行"
        print_info "  2. 数据库连接是否正常"
        print_info "  3. 后端日志是否有错误"
        return 1
    fi
}

verify_memory_extraction() {
    print_step "7. 验证记忆提取"

    # 等待记忆提取（异步）
    print_info "等待记忆提取完成..."
    sleep 5

    # 查询记忆
    local memories_response
    memories_response=$(curl -s "$API_URL/api/v1/memories/?user_id=$USER_ID&limit=10")

    if [[ -z "$memories_response" ]]; then
        print_error "无法查询记忆"
        return 1
    fi

    local total_memories
    total_memories=$(echo "$memories_response" | jq -r '.total // 0')

    print_info "当前记忆总数: $total_memories"

    if [[ "$total_memories" -gt 0 ]]; then
        print_success "记忆提取成功"

        # 显示最近的记忆
        local latest_memory
        latest_memory=$(echo "$memories_response" | jq '.items[0]')

        local content=$(echo "$latest_memory" | jq -r '.content')
        local memory_type=$(echo "$latest_memory" | jq -r '.memory_type')
        local source=$(echo "$latest_memory" | jq -r '.source // "null"')

        print_info "最新记忆:"
        print_info "  类型: $memory_type"
        print_info "  来源: $source"
        print_info "  内容: ${content:0:50}..."

        return 0
    else
        print_info "暂无记忆提取（可能是首次测试）"
        return 0
    fi
}

test_source_field() {
    print_step "8. 测试 Source 字段"

    local memories_response
    memories_response=$(curl -s "$API_URL/api/v1/memories/?user_id=$USER_ID&limit=5")

    if [[ -z "$memories_response" ]]; then
        print_error "无法查询记忆"
        return 1
    fi

    # 检查是否有 source 字段
    local has_source
    has_source=$(echo "$memories_response" | jq -r '.items[0].source // "null"')

    if [[ "$has_source" != "null" ]] && [[ -n "$has_source" ]]; then
        print_success "Source 字段存在"
        print_info "Source 值: $has_source"

        # 统计 source 分布
        print_info "Source 分布:"
        echo "$memories_response" | jq -r '.items[].source // "null"' | \
          sort | uniq -c | sed 's/^/   /'

        return 0
    else
        print_error "Source 字段不存在或为 null"
        print_info "请检查:"
        print_info "  1. 后端服务是否已重启"
        print_info "  2. 代码修改是否正确应用"
        print_info "  3. Turns 表中的 source 字段是否有值"
        return 1
    fi
}

# ============================================
# 主测试流程
# ============================================

main() {
    print_header "Mem0 Claude Code Plugin 测试套件"

    echo ""
    echo "配置信息:"
    echo "  API URL: $API_URL"
    echo "  项目目录: $PROJECT_DIR"
    echo "  插件目录: $PLUGIN_DIR"
    echo "  User ID: $USER_ID"

    local failed=0

    # 运行测试
    test_api_connection || ((failed++))
    test_hooks_config || ((failed++))
    test_retrieve_function || ((failed++))

    local transcript_file
    transcript_file=$(create_test_transcript) || ((failed++))

    test_store_function "$transcript_file" || ((failed++))
    verify_storage || ((failed++))
    verify_memory_extraction || ((failed++))
    test_source_field || ((failed++))

    # 总结
    print_header "测试总结"

    if [[ $failed -eq 0 ]]; then
        print_success "所有测试通过！"
        echo ""
        echo "下一步:"
        echo "  1. 在 Claude Code 中发送测试消息"
        echo "  2. 验证 UserPromptSubmit hook 是否召回相关记忆"
        echo "  3. 检查 Mission Control 的记忆管理页面"
        return 0
    else
        print_error "$failed 个测试失败"
        echo ""
        echo "请检查:"
        echo "  1. OpenMemory 服务是否运行"
        echo "  2. Hooks 配置是否正确"
        echo "  3. 数据库连接是否正常"
        echo "  4. 后端日志是否有错误信息"
        return 1
    fi
}

# 运行主函数
main "$@"
