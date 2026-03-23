#!/bin/bash

# OpenClaw Mission Control 停止脚本

echo "🛑 停止 OpenClaw Mission Control..."

# 读取 PID 并停止服务
if [ -f /tmp/mission_control_backend.pid ]; then
    BACKEND_PID=$(cat /tmp/mission_control_backend.pid)
    kill $BACKEND_PID 2>/dev/null && echo "✓ 后端服务已停止"
    rm /tmp/mission_control_backend.pid
fi

if [ -f /tmp/mission_control_worker.pid ]; then
    WORKER_PID=$(cat /tmp/mission_control_worker.pid)
    kill $WORKER_PID 2>/dev/null && echo "✓ Worker 已停止"
    rm /tmp/mission_control_worker.pid
fi

if [ -f /tmp/mission_control_frontend.pid ]; then
    FRONTEND_PID=$(cat /tmp/mission_control_frontend.pid)
    kill $FRONTEND_PID 2>/dev/null && echo "✓ 前端服务已停止"
    rm /tmp/mission_control_frontend.pid
fi

# 清理可能残留的进程
pkill -f "uvicorn app.main:app" 2>/dev/null
pkill -f "next dev" 2>/dev/null

echo "✅ 所有服务已停止"
