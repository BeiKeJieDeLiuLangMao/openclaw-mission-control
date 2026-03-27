#!/usr/bin/env bash
# Mem0 Claude Code Plugin 项目级安装脚本
# 功能: 在项目目录安装 hooks，配置到项目级 settings.json

set -euo pipefail

# 颜色��出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 项目根目录（从脚本位置推导）
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# Claude 配置目录
CLAUDE_DIR="${PROJECT_ROOT}/.claude"
SETTINGS_FILE="${CLAUDE_DIR}/settings.json"
SETTINGS_BACKUP="${SETTINGS_FILE}.bak.$(date +%Y%m%d_%H%M%S)"

# 插件路径
PLUGIN_PATH="${PROJECT_ROOT}/mem0/claude-code-plugin"

log_info() {
    echo -e "${GREEN}[INFO]${NC} $*"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $*"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $*"
}

log_step() {
    echo -e "${BLUE}[STEP]${NC} $*"
}

# 检查依赖
check_dependencies() {
    log_step "检查依赖..."

    if ! command -v jq &> /dev/null; then
        log_error "jq 未安装。请安装: https://jqlang.github.io/jq/download/"
        exit 1
    fi

    if ! command -v curl &> /dev/null; then
        log_error "curl 未安装。"
        exit 1
    fi

    log_info "依赖检查通过 ✓"
}

# 检查是否已安装
check_installed() {
    if [[ -f "$SETTINGS_FILE" ]]; then
        if grep -q "mem0-retrieve\|mem0-store" "$SETTINGS_FILE" 2>/dev/null; then
            log_warn "项目级 hooks 已安装"
            read -p "是否要重新安装？(y/N) " -n 1 -r
            echo
            if [[ ! $REPLY =~ ^[Yy]$ ]]; then
                log_info "取消安装"
                exit 0
            fi
        fi
    fi
}

# 备份现有配置
backup_settings() {
    if [[ -f "$SETTINGS_FILE" ]]; then
        log_info "备份现有配置: $SETTINGS_BACKUP"
        cp "$SETTINGS_FILE" "$SETTINGS_BACKUP"
    fi
}

# 安装 hooks
install_hooks() {
    log_step "安装 mem0 hooks..."

    # 创建项目配置目录
    mkdir -p "$CLAUDE_DIR"

    # 脚本路径
    local retrieve_script="${PLUGIN_PATH}/mem0-retrieve.sh"
    local store_script="${PLUGIN_PATH}/mem0-store.sh"

    # 如果 settings.json 不存在，创建基础配置
    if [[ ! -f "$SETTINGS_FILE" ]]; then
        cat > "$SETTINGS_FILE" << 'EOF'
{
  "enabledPlugins": {}
}
EOF
        log_info "创建新的项目级 settings.json"
    fi

    # 使用 jq 添加 hooks
    local temp_file="${SETTINGS_FILE}.tmp"

    jq --arg retrieve "$retrieve_script" \
       --arg store "$store_script" \
       '
       if .hooks then
           .hooks |= . + {
               "UserPromptSubmit": [
                   {
                       "matcher": "*",
                       "hooks": [
                           {
                               "type": "command",
                               "command": "bash \($retrieve)",
                               "timeout": 30
                           }
                       ]
                   }
               ],
               "Stop": [
                   {
                       "matcher": "*",
                       "hooks": [
                           {
                               "type": "command",
                               "command": "bash \($store)",
                               "async": true,
                               "timeout": 60
                           }
                       ]
                   }
               ]
           }
       else
           . + {
               hooks: {
                   "UserPromptSubmit": [
                       {
                           "matcher": "*",
                           "hooks": [
                               {
                                   "type": "command",
                                   "command": "bash \($retrieve)",
                                   "timeout": 30
                               }
                           ]
                       }
                   ],
                   "Stop": [
                       {
                           "matcher": "*",
                           "hooks": [
                               {
                                   "type": "command",
                                   "command": "bash \($store)",
                                   "async": true,
                                   "timeout": 60
                               }
                           ]
                       }
                   ]
               }
           }
       end
       ' "$SETTINGS_FILE" > "$temp_file"

    # 替换原文件
    mv "$temp_file" "$SETTINGS_FILE"

    log_info "Hooks 安装成功 ✓"
}

# 验证安装
verify_install() {
    log_step "验证安装..."

    if [[ ! -f "$SETTINGS_FILE" ]]; then
        log_error "配置文件不存在: $SETTINGS_FILE"
        return 1
    fi

    # 检查配置是否正确
    if jq -e '.hooks.UserPromptSubmit' "$SETTINGS_FILE" > /dev/null 2>&1; then
        log_info "✓ UserPromptSubmit hook 已配置"
    else
        log_error "✗ UserPromptSubmit hook 配置失败"
        return 1
    fi

    if jq -e '.hooks.Stop' "$SETTINGS_FILE" > /dev/null 2>&1; then
        log_info "✓ Stop hook 已配置"
    else
        log_error "✗ Stop hook 配置失败"
        return 1
    fi

    # 检查脚本是否存在
    if [[ -f "${PLUGIN_PATH}/mem0-retrieve.sh" ]]; then
        log_info "✓ mem0-retrieve.sh 存在"
    else
        log_error "✗ mem0-retrieve.sh 不存在"
        return 1
    fi

    if [[ -f "${PLUGIN_PATH}/mem0-store.sh" ]]; then
        log_info "✓ mem0-store.sh 存在"
    else
        log_error "✗ mem0-store.sh 不存在"
        return 1
    fi

    log_info "安装验证通过 ✓"
}

# 卸载
uninstall() {
    log_step "卸载 mem0 hooks..."

    if [[ ! -f "$SETTINGS_FILE" ]]; then
        log_info "没有找到配置文件"
        exit 0
    fi

    # 备份
    backup_settings

    # 移除 hooks 字段
    local temp_file="${SETTINGS_FILE}.tmp"
    jq 'del(.hooks)' "$SETTINGS_FILE" > "$temp_file"
    mv "$temp_file" "$SETTINGS_FILE"

    log_info "卸载完成 ✓"
}

# 显示帮助
show_help() {
    cat << 'EOF'
Mem0 Claude Code Plugin 项目级安装脚本

用法:
    ./install-project.sh [选项]

选项:
    --install     安装 hooks (默认)
    --uninstall   卸载 hooks
    --verify      验证安装
    --help        显示帮助

说明:
    此脚本将 hooks 安装到项目级的 .claude/settings.json，
    仅在当前项目中生效。

项目根目录: auto-detected
配置文件: .claude/settings.json

示例:
    ./install-project.sh           # 安装
    ./install-project.sh --uninstall  # 卸载
EOF
}

# 显示安装摘要
show_summary() {
    echo ""
    echo "=========================================="
    echo "  安装摘要"
    echo "=========================================="
    echo ""
    echo "项目根目录: ${PROJECT_ROOT}"
    echo "插件路径: ${PLUGIN_PATH}"
    echo "配置文件: ${SETTINGS_FILE}"
    echo ""
    echo "下一步:"
    echo "  1. 确保 openmemory 服务运行: cd mem0 && uvicorn openmemory.api.main:app --reload"
    echo "  2. 在项目目录启动 Claude Code: cd ${PROJECT_ROOT} && claude"
    echo "  3. 发送一条消息测试召回功能"
    echo ""
}

# 主函数
main() {
    local action="install"

    case "${1:-}" in
        --install|-i)
            action="install"
            ;;
        --uninstall|-u)
            action="uninstall"
            ;;
        --verify|-v)
            action="verify"
            ;;
        --help|-h)
            show_help
            exit 0
            ;;
        *)
            ;;
    esac

    echo "=========================================="
    echo "  Mem0 Claude Code Plugin"
    echo "  项目级安装"
    echo "=========================================="
    echo ""

    case "$action" in
        install)
            check_dependencies
            check_installed
            backup_settings
            install_hooks
            verify_install
            show_summary
            ;;
        uninstall)
            uninstall
            ;;
        verify)
            verify_install
            ;;
    esac
}

main "$@"
