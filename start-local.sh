#!/bin/bash

# OpenClaw Mission Control 本地启动脚本
# 获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "🚀 启动 OpenClaw Mission Control..."

# 进入后端目录并启动
cd backend
source .venv/bin/activate
echo "📦 启动后端服务..."
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload &
BACKEND_PID=$!
echo "后端 PID: $BACKEND_PID"

# 等待后端启动
sleep 3

# 启动 webhook worker
echo "📦 启动 webhook worker..."
python -m app.workers.webhook_worker &
WORKER_PID=$!
echo "Worker PID: $WORKER_PID"

# 进入前端目录并启动
cd "$SCRIPT_DIR/frontend"
echo "🎨 启动前端服务..."
npm run dev &
FRONTEND_PID=$!
echo "前端 PID: $FRONTEND_PID"

echo ""
echo "✅ OpenClaw Mission Control 已启动!"
echo "📱 前端地址: http://localhost:3000"
echo "🔧 后端地址: http://localhost:8000"
echo "💊 健康检查: http://localhost:8000/healthz"
echo ""
echo "按 Ctrl+C 停止所有服务"

# 保存 PID 到文件
echo $BACKEND_PID > /tmp/mission_control_backend.pid
echo $WORKER_PID > /tmp/mission_control_worker.pid
echo $FRONTEND_PID > /tmp/mission_control_frontend.pid

# 等待所有后台进程
wait
