#!/usr/bin/env bash
# 测试 Stop hook 是否被调用

LOG_FILE="/tmp/claude-hooks-test.log"

# 记录到日志文件
log_hook() {
    local hook_type="$1"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    echo "[${timestamp}] ${hook_type} hook called" >> "$LOG_FILE"
    echo "STDIN:" >> "$LOG_FILE"
    cat - >> "$LOG_FILE"
    echo "---" >> "$LOG_FILE"
}

# 如果是 Stop hook
if [[ "${1:-}" == "stop" ]]; then
    log_hook "STOP"
fi

# 输出原始 stdin 到 stdout（透传）
cat
