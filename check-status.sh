#!/bin/bash

echo "🔍 检查 OpenClaw Mission Control 状态..."
echo ""

# 检查后端
if curl -s http://localhost:8000/healthz > /dev/null 2>&1; then
    echo "✅ 后端服务: 正常运行 (http://localhost:8000)"
else
    echo "❌ 后端服务: 未运行"
fi

# 检查前端
if curl -s http://localhost:3000 > /dev/null 2>&1; then
    echo "✅ 前端服务: 正常运行 (http://localhost:3000)"
else
    echo "❌ 前端服务: 未运行"
fi

# 检查 PostgreSQL
if /opt/homebrew/opt/postgresql@16/bin/pg_isready > /dev/null 2>&1; then
    echo "✅ PostgreSQL: 运行中"
else
    echo "❌ PostgreSQL: 未运行"
fi

# 检查 Redis
if redis-cli ping > /dev/null 2>&1; then
    echo "✅ Redis: 运行中"
else
    echo "❌ Redis: 未运行"
fi

echo ""
echo "📱 访问地址: http://localhost:3000"
echo "🔑 登录 Token: 3e7e63bd8bd5267f0a72b4f90dee3a2e96f7689254248f91c4371667451c9178"
