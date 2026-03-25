# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

OpenClaw Mission Control 是一个用于运营和管理 OpenClaw 的统一平台。这是一个全栈应用:
- **Backend**: FastAPI 服务 (`backend/`),使用 SQLAlchemy + Alembic
- **Frontend**: Next.js 应用 (`frontend/`),使用 TypeScript + React
- 前后端通过 REST API 通信,前端 API 客户端由 orval 自动生成

## 核心架构

### Backend 结构
```
backend/
├── app/
│   ├── api/           # API 路由模块 (按功能领域组织)
│   ├── core/          # 核心功能 (认证、配置、错误处理、日志、限流)
│   ├── db/            # 数据库会话和连接管理
│   ├── models/        # SQLAlchemy ORM 模型
│   ├── schemas/       # Pydantic 请求/响应模式
│   └── services/      # 业务逻辑层
├── migrations/        # Alembic 数据库迁移
├── templates/         # 后端提供的模板 (用于 gateway 流程)
└── tests/            # pytest 测试套件
```

### Frontend 结构
```
frontend/
├── src/
│   ├── app/          # Next.js App Router 页面和布局
│   ├── components/   # React 组件 (按 atoms/molecules/organisms 组织)
│   ├── lib/          # 工具函数和共享逻辑
│   ├── api/
│   │   └── generated/ # 自动生成的 API 客户端 (不要手动编辑)
│   ├── auth/         # 认证集成 (Clerk/local)
│   └── hooks/        # 自定义 React hooks
```

### 认证架构
项目支持两种认证模式 (通过 `AUTH_MODE` 环境变量配置):
- **local**: 共享 bearer token 模式,用于自托管
- **clerk**: Clerk JWT 模式

认证逻辑在 `backend/app/core/auth.py` 和 `frontend/src/auth/` 中实现。

### 限流系统
支持两种限流后端 (`RATE_LIMIT_BACKEND`):
- **memory**: 内存限流 (默认)
- **redis**: Redis 限流 (需要 `RATE_LIMIT_REDIS_URL`)

## 常用开发命令

### 依赖安装
```bash
make setup              # 安装前后端依赖
make backend-sync       # 仅后端: uv sync --extra dev
make frontend-sync      # 仅前端: npm install
```

### 代码质量检查
```bash
make check              # 完整 CI 检查 (lint + typecheck + tests + build)
make lint               # 前后端 lint
make typecheck          # 前后端类型检查
```

### 测试
```bash
make backend-test       # 运行后端测试 (pytest)
make backend-coverage   # 后端测试覆盖率 (要求 100% 覆盖指定模块)
make frontend-test      # 运行前端测试 (vitest)
```

### 代码格式化
```bash
make format             # 格式化前后端代码
make format-check       # 检查格式 (不修改文件)
```

### 构建和运行
```bash
# Docker 方式 (推荐用于生产)
docker compose -f compose.yml --env-file .env up -d --build

# 本地开发模式 (快速迭代)
docker compose -f compose.yml --env-file .env up -d db
cd backend && uv run uvicorn app.main:app --reload --port 8000
cd frontend && npm run dev

# 前端构建
make frontend-build    # 或: cd frontend && npm run build
```

### MC 自用 Mac 开机自启 (launchd)

> 以下为本地 MC 开发环境的 launchd 配置，适用于非 Docker 模式。
> 配置文件在 `~/Library/LaunchAgents/`，登录后自动启动前后端服务。

| 服务 | plist 文件 | 端口 |
|---|---|---|
| Backend (FastAPI) | `ai.openclaw.mc.backend.plist` | 8000 |
| Frontend (Next.js) | `ai.openclaw.mc.frontend.plist` | 3000 |

```bash
# 查看服务状态
launchctl list | grep ai.openclaw.mc

# 重新加载服务 (修改 plist 后需执行)
launchctl unload ~/Library/LaunchAgents/ai.openclaw.mc.backend.plist
launchctl unload ~/Library/LaunchAgents/ai.openclaw.mc.frontend.plist
launchctl load ~/Library/LaunchAgents/ai.openclaw.mc.backend.plist
launchctl load ~/Library/LaunchAgents/ai.openclaw.mc.frontend.plist

# 查看日志
cat ~/.openclaw/logs/mc-backend.log
cat ~/.openclaw/logs/mc-backend-error.log
cat ~/.openclaw/logs/mc-frontend.log
cat ~/.openclaw/logs/mc-frontend-error.log
```

> 注意：LaunchAgents 在**用户登录后**启动，非机器开机。如需开机即启动需用 LaunchDaemons。

### API 客户端生成
```bash
# 修改后端 API 后,重新生成前端 API 客户端
make api-gen           # 后端必须运行在 127.0.0.1:8000
```

### 数据库迁移
```bash
make backend-migrate           # 应用迁移
make backend-migration-check   # 验证迁移图和可逆性
```

## 代码风格规范

### Python
- **格式化**: Black (100 字符行宽) + isort
- **Lint**: flake8
- **类型检查**: mypy --strict
- **命名**: `snake_case` 用于变量和函数,`PascalCase` 用于类
- **导入顺序**: stdlib → 第三方 → 本地 (由 isort 管理)

### TypeScript/React
- **格式化**: Prettier
- **Lint**: ESLint
- **类型检查**: tsc --noEmit
- **命名**: `PascalCase` 用于组件,`camelCase` 用于变量/函数
- **未使用变量**: 使用下划线前缀 `_variable` 满足 lint 规则

## 开发注意事项

### API 更新流程
1. 在 `backend/app/api/` 中修改路由
2. 在 `backend/app/schemas/` 中更新 Pydantic 模式
3. 确保后端运行在 `127.0.0.1:8000`
4. 运行 `make api-gen` 重新生成前端 API 客户端
5. 在 `frontend/src/app/` 或组件中使用生成的客户端

### 数据库变更
1. 修改 `backend/app/models/` 中的模型
2. 运行 `cd backend && uv run alembic revision --autogenerate -m "描述"`
3. 检查生成的迁移文件在 `backend/migrations/versions/`
4. 运行 `make backend-migrate` 应用迁移
5. 使用 `make backend-migration-check` 验证迁移正确性

### 环境配置
- 复制 `.env.example` 到 `.env` 并填写真实值
- 关键配置:
  - `AUTH_MODE=local` 时,必须设置非占位符的 `LOCAL_AUTH_TOKEN` (最少 50 字符)
  - `BASE_URL` 必须匹配公共后端源 (如果不是 `http://localhost:8000`)
  - `NEXT_PUBLIC_API_URL=auto` 会自动解析为当前主机的 8000 端口

### 覆盖率策略
- 当前只对特定模块强制 100% 覆盖率:
  - `app.core.error_handling`
  - `app.services.mentions`
- 运行 `make backend-coverage` 查看覆盖率报告
- 覆盖率报告生成在 `backend/coverage.xml` 和 `backend/coverage.json`

## Git 工作流

### Conventional Commits
遵循项目的 commit 历史模式:
- `feat: ...` - 新功能
- `fix: ...` - bug 修复
- `docs: ...` - 文档更新
- `test(core): ...` - 测试相关 (可指定作用域)
- `refactor: ...` - 代码重构

### Pull Request 指南
- 保持 PR 专注且基于最新的 `master` 分支
- 包含以下信息:
  - 变更内容和原因
  - 测试证据 (`make check` 或相关命令输出)
  - 关联的 issue
  - UI 或工作流变更时的截图/日志

## 重要路径和文件

### 配置文件
- `backend/pyproject.toml` - Python 项目配置和工具设置
- `frontend/package.json` - Node.js 依赖和脚本
- `compose.yml` - Docker Compose 配置
- `.env.example` - 环境变量模板

### 关键代码文件
- `backend/app/main.py` - FastAPI 应用入口和路由注册
- `backend/app/core/config.py` - 配置管理 (Pydantic Settings)
- `backend/app/core/auth.py` - 认证逻辑
- `backend/app/core/error_handling.py` - 统一错误处理
- `frontend/src/proxy.ts` - API 代理配置

### 文档
- `docs/README.md` - 文档导航
- `docs/getting-started/` - 入门指南
- `docs/development/` - 开发指南
- `docs/deployment/` - 部署文档

## 故障排查

### 限流问题
- 如果使用 Redis 后端,检查 `RATE_LIMIT_REDIS_URL` 连接
- 应用启动时会验证 Redis 连接 (见 `app/core/rate_limit.py`)

### 迁移问题
- 运行 `make backend-migration-check` 验证迁移图
- 检查 `backend/migrations/versions/` 中的迁移文件顺序

### API 客户端生成失败
- 确保后端运行在 `127.0.0.1:8000` (不是 localhost)
- 检查后端健康状态: `curl http://localhost:8000/healthz`
- 查看前端 `orval.config.ts` 配置

### Docker 构建问题
- 完全重新构建: `docker compose -f compose.yml --env-file .env build --no-cache --pull`
- 查看日志: `docker compose -f compose.yml --env-file .env logs -f`
