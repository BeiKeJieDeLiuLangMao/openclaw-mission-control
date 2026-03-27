# Mem0 Claude Code Plugin

将 Claude Code 对话自动存储到 Mem0 OpenMemory 系统，实现跨会话记忆。

## 功能

- **自动召回**: 用户发出消息后，自动查询相关历史记忆并注入上下文
- **自动存储**: 每轮对话结束后，自动存储到 turns 表
- **Facts 提取**: 后台自动从对话中提取关键事实
- **图谱构建**: 自动建立实体关系图谱

## 架构

```
用户消息 → UserPromptSubmit → 查询记忆 → 注入上下文
                                        ↓
Claude 回复 → Stop → 存储对话 → turns 表 → Facts 提取 → Qdrant/Neo4j
```

## 安装

### 前置要求

1. **Mem0 OpenMemory 服务运行中**
   ```bash
   cd mem0
   uvicorn openmemory.api.main:app --reload
   ```

2. **依赖**
   - `jq` - JSON 处理
   - `curl` - HTTP 请求

### 安装方式

#### 方式一：项目级安装（推荐）

hooks 只在当前项目生效，不影响其他项目。

```bash
cd /Users/yishu.cy/IdeaProjects/openclaw-team-workspace/mem0/claude-code-plugin
./install-project.sh
```

安装后配置路径：
- 配置文件：`项目根目录/.claude/settings.json`
- hooks 脚本：使用相对路径 `mem0/claude-code-plugin/`

#### 方式二：全局安装

hooks 对所有 Claude Code 会话生效。

```bash
./install.sh
```

安装后配置路径：
- 配置文件：`~/.claude/settings.json`
- hooks 脚本：使用绝对路径

### 卸载

```bash
# 项目级卸载
./install-project.sh --uninstall

# 全局卸载
./install.sh --uninstall
```

## 配置

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `MEM0_API_URL` | `http://localhost:8765` | OpenMemory API 地址 |
| `MEM0_DEBUG` | `0` | 调试模式（设为 1 启用） |

### 用户 ID

使用当前工作目录的末级文件夹名作为用户 ID，实现项目级别的记忆隔离。

例如：
- `/Users/xxx/projects/myapp` → 用户 ID: `myapp`
- `/Users/xxx/IdeaProjects/openclaw-team-workspace` → 用户 ID: `openclaw-team-workspace`

## 使用

安装后自动生效，无需额外操作。

### 测试

```bash
# 1. 启动服务
cd mem0
uvicorn openmemory.api.main:app --reload

# 2. 开启调试日志
export MEM0_DEBUG=1

# 3. 启动 Claude Code 并发送消息
claude

# 4. 观察日志
# [INFO] User ID: openclaw-team-workspace
# [DEBUG] Found 3 memories
```

### 验证存储

```bash
# 查询 turns 表
sqlite3 ~/.openclaw/memory/main.sqlite
sqlite> SELECT id, session_id, message_count, created_at FROM turns ORDER BY created_at DESC LIMIT 5;
```

## 故障排除

### 服务未响应

```bash
# 检查服务状态
curl http://localhost:8765/health

# 如果未运行，启动服务
cd mem0
uvicorn openmemory.api.main:app --reload --port 8765
```

### Hook 未触发

```bash
# 检查 settings.json 配置
cat ~/.claude/settings.json | jq '.hooks'

# 检查脚本权限
ls -la ~/.claude/hooks/mem0/
```

### API 错误

```bash
# 启用调试模式
export MEM0_DEBUG=1

# 手动测试 API
curl -X POST http://localhost:8765/api/v1/turns/ \
  -H "Content-Type: application/json" \
  -d '{"session_id":"test","user_id":"test","messages":[]}'
```

## API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/v1/turns/` | POST | 存储对话 |
| `/api/v1/memories/` | GET | 查询记忆 |
| `/api/v1/graph/search` | GET | 搜索图谱 |

## 许可证

MIT
