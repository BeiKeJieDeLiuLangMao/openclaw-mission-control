#!/usr/bin/env bash
# Mem0 Claude Code Plugin 安装脚本
# 功能: 自动配置 hooks 到 ~/.claude/settings.json

set -euo pipefail

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 插件目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_NAME="mem0-claude-code"

# Claude 配置目录
CLAUDE_DIR="${HOME}/.claude"
SETTINGS_FILE="${CLAUDE_DIR}/settings.json"
SETTINGS_BACKUP="${SETTINGS_FILE}.bak.$(date +%Y%m%d_%H%M%S)"

log_info() {
    echo -e "${GREEN}[INFO]${NC} $*"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $*"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $*"
}

# 检查依赖
check_dependencies() {
    log_info "检查依赖..."

    if ! command -v jq &> /dev/null; then
        log_error "jq 未安装。请安装: https://jqlang.github.io/jq/download/"
        exit 1
    fi

    if ! command -v curl &> /dev/null; then
        log_error "curl 未安装。"
        exit 1
    fi

    log_info "依赖检查通过"
}

# 备份现有配置
backup_settings() {
    if [[ -f "$SETTINGS_FILE" ]]; then
        log_info "备份现有配置: $SETTINGS_BACKUP"
        cp "$SETTINGS_FILE" "$SETTINGS_BACKUP"
    fi
}

# 检查是否已安装
check_installed() {
    if [[ -f "$SETTINGS_FILE" ]]; then
        if grep -q "$PLUGIN_NAME\|mem0-retrieve\|mem0-store" "$SETTINGS_FILE" 2>/dev/null; then
            log_warn "似乎已经安装过 mem0 hooks"
            read -p "是否要重新安装？(y/N) " -n 1 -r
            echo
            if [[ ! $REPLY =~ ^[Yy]$ ]]; then
                log_info "取消安装"
                exit 0
            fi
        fi
    fi
}

# 安装 hooks
install_hooks() {
    log_info "安装 mem0 hooks..."

    # 创建配置目录
    mkdir -p "$CLAUDE_DIR"

    # 如果 settings.json 不存在，创建基础配置
    if [[ ! -f "$SETTINGS_FILE" ]]; then
        cat > "$SETTINGS_FILE" << 'EOF'
{
  "hooks": {}
}
EOF
        log_info "创建新的 settings.json"
    fi

    # 读取现有配置
    local existing_settings
    existing_settings=$(cat "$SETTINGS_FILE")

    # 创建新的 hooks 配置
    local new_hooks
    new_hooks=$(cat << 'EOF'
    "UserPromptSubmit": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "PLUGIN_DIR/mem0-retrieve.sh",
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
            "command": "PLUGIN_DIR/mem0-store.sh",
            "async": true,
            "timeout": 60
          }
        ]
      }
    ]
EOF
)

    # 替换路径
    new_hooks="${new_hooks//PLUGIN_DIR/${SCRIPT_DIR}}"

    # 合并配置
    local merged_settings
    merged_settings=$(echo "$existing_settings" | jq \
        --argjson new_hooks "$new_hooks" \
        'if .hooks then .hooks *= $new_hooks else .hooks = $new_hooks end')

    # 写回配置
    echo "$merged_settings" > "$SETTINGS_FILE"

    log_info "Hooks 安装成功!"
}

# 验证安装
verify_install() {
    log_info "验证安装..."

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

    log_info "安装验证通过!"
}

# 卸载
uninstall() {
    log_info "卸载 mem0 hooks..."

    if [[ ! -f "$SETTINGS_FILE" ]]; then
        log_info "没有找到配置文件"
        exit 0
    fi

    # 备份
    backup_settings

    # 移除 hooks
    local cleaned_settings
    cleaned_settings=$(cat "$SETTINGS_FILE" | jq 'delpaths([
        paths |
        select(
            . as $p |
            ($p | length) >= 2 and
            $p[0] == "hooks" and
            ($p[1] | strings | test("mem0"))
        )
    ])')

    echo "$cleaned_settings" > "$SETTINGS_FILE"

    log_info "卸载完成!"
}

# 显示帮助
show_help() {
    cat << 'EOF'
Mem0 Claude Code Plugin 安装脚本

用法:
    ./install.sh [选项]

选项:
    --install     安装 hooks (默认)
    --uninstall   卸载 hooks
    --verify      验证安装
    --help        显示帮助

示例:
    ./install.sh           # 安装
    ./install.sh --uninstall  # 卸载
EOF
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
    echo "  Mem0 Claude Code Plugin Installer"
    echo "=========================================="
    echo ""

    case "$action" in
        install)
            check_dependencies
            check_installed
            backup_settings
            install_hooks
            verify_install

            echo ""
            log_info "安装完成!"
            log_info ""
            log_info "下一步:"
            log_info "1. 确保 openmemory 服务正在运行: cd mem0 && uvicorn openmemory.api.main:app --reload"
            log_info "2. 重启 Claude Code 或开始新会话"
            log_info "3. 发送一条消息测试召回功能"
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
