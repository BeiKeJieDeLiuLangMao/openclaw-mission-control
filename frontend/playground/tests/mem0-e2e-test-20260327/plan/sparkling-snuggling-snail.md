# E2E 测试计划：OpenClaw + Claude Code → Mem0 存储验证

## Context

用户要求从源头测试消息发送链路，通过 OpenClaw CLI 和 Claude Code CLI 发送一次性请求，然后验证数据存储和前端展示。

**参考 Skill**（已更新）：
- `openclaw-mem0-testing` - OpenClaw TUI 一次性请求测试 (`openclaw agent --message`)
- `mem0-claude-code-plugin-testing` - Claude Code CLI 测试 (`claude --print --no-input`)

---

## 系统架构理解

```
┌─────────────────────────────────────────────────────────────────────┐
│  OpenClaw TUI        Claude Code CLI                                │
│  openclaw agent       claude --print --no-input                     │
│       │                     │                                        │
│       ↓                     ↓                                        │
│  ┌─────────────────────────────────────┐                           │
│  │         mem0 插件 / hooks          │                           │
│  │  OpenClaw: provider.ts (TypeScript) │                           │
│  │  Claude Code: UserPromptSubmit/Stop  │                           │
│  └─────────────────────────────────────┘                           │
│                          │                                         │
│                          ↓                                         │
│               ┌──────────────────────┐                             │
│               │  Mem0 HTTP API       │                             │
│               │  localhost:8765       │                             │
│               └──────────────────────┘                             │
│                    │           │           │                       │
│                    ↓           ↓           ↓                       │
│               ┌─────────┐  ┌─────────┐  ┌─────────┐               │
│               │ SQLite  │  │ Qdrant  │  │ Neo4j   │               │
│               │ turns   │  │ vectors │  │ graph   │               │
│               └─────────┘  └─────────┘  └─────────┘               │
└─────────────────────────────────────────────────────────────────────┘
```

### 两个使用端的记忆系统

| 使用端 | 触发命令 | 消息存储路径 | 关键文件 |
|--------|---------|-------------|---------|
| **OpenClaw** | `openclaw agent --message` | Gateway → Provider → API → Qdrant/Neo4j | `mem0/openclaw/provider.ts` |
| **Claude Code** | `claude --print --no-input` | Stop hook → mem0-store.sh → API | `mem0/claude-code-plugin/` |

---

## 实施步骤

### Phase 1: 前置条件检查

```bash
# 1.1 一键检查所有服务
echo "=== 服务状态检查 ===" && \
curl -sf http://localhost:8765/health && echo " ✓ Mem0 API" && \
curl -sf http://127.0.0.1:6333/collections && echo " ✓ Qdrant" && \
docker ps --filter name=neo4j --format "{{.Names}}: {{.Status}}" && echo " ✓ Neo4j"

# 1.2 检查 OpenClaw Gateway
openclaw gateway status

# 1.3 检查插件安装
openclaw plugins list | grep openclaw-mem0

# 1.4 记录基线状态
echo "=== 基线状态 ===" && \
curl -sL "http://localhost:8765/api/v1/memories?user_id=yishu" | jq '.total' && \
curl -sL "http://localhost:8765/api/v1/turns?user_id=yishu" | jq '.total'
```

### Phase 2: OpenClaw 端测试

**使用 `openclaw agent --message` 发送一次性请求**

#### 2.1 存储测试
```bash
# 存储用户信息
openclaw agent --message "记住：用户王五，电话 139-0000-5678，职位是后端工程师" --thinking low

# 存储项目信息
openclaw agent --message "记住：OpenClaw Team OS 是一个 AI 原生的团队协作操作系统" --thinking low

# 存储技术栈
openclaw agent --message "记住：mem0 使用 Qdrant 作为向量数据库，Neo4j 作为图数据库" --thinking low
```

#### 2.2 等待处理完成
```bash
sleep 5
```

#### 2.3 检索验证
```bash
# 检索测试
openclaw agent --message "王五的电话是多少？" --thinking low
openclaw agent --message "OpenClaw Team OS 是什么？" --thinking low
```

#### 2.4 API 直接验证
```bash
# 验证 Turn 记录
curl -sL "http://localhost:8765/api/v1/turns?user_id=yishu" | \
  jq '[.turns[] | {id: .id[:8], source, message_count, created_at}]'

# 验证 Memory 记录
curl -sL "http://localhost:8765/api/v1/memories?user_id=yishu" | \
  jq '[.items[] | {id: .id[:8], content: .content[:40], memory_type, source}]'
```

### Phase 3: Claude Code 端测试

**使用 `claude --print --no-input` 命令**

#### 3.1 创建测试项目目录
```bash
mkdir -p /tmp/mem0-test-project
cd /tmp/mem0-test-project
```

#### 3.2 执行存储测试
```bash
# 测试1：存储编辑器偏好
echo "请记住我喜欢用 Neovim 作为主要编辑器" | claude --print --no-input 2>&1 | tail -10

# 等待处理
sleep 3

# 测试2：存储编程语言偏好
echo "请记住我最喜欢的编程语言是 Go" | claude --print --no-input 2>&1 | tail -10

# 等待处理
sleep 3
```

#### 3.3 验证存储结果
```bash
# 查看最新的 turn 记录
curl -s "http://localhost:8765/api/v1/turns?user_id=yishu&limit=3" | \
  jq '.turns[] | {id: .id[:8], source, message_count, created_at}'

# 验证 Memory 记录
curl -s "http://localhost:8765/api/v1/memories?user_id=yishu&limit=5" | \
  jq '.items[] | {content: .content[:50], memory_type, source}'
```

#### 3.4 测试召回功能
```bash
# 测试召回
echo "我之前说过我喜欢用什么编辑器？" | claude --print --no-input 2>&1
```

### Phase 4: 图谱验证

```bash
# 4.1 检查 Neo4j 图节点
docker exec neo4j-mem0 cypher-shell -u neo4j -p mem0password \
  "MATCH (n) RETURN labels(n)[0] as label, n.name, count(*) as cnt ORDER BY cnt DESC LIMIT 10" \
  2>/dev/null | grep -v CONNECTED

# 4.2 检查关系类型
docker exec neo4j-mem0 cypher-shell -u neo4j -p mem0password \
  "MATCH ()-[r]->() RETURN type(r) as rel_type, count(*) as cnt ORDER BY cnt DESC LIMIT 10" \
  2>/dev/null | grep -v CONNECTED

# 4.3 图谱统计
curl -sL "http://localhost:8765/api/v1/graph/stats?user_id=yishu" | \
  jq '{nodes: .nodes, relations: .relations}'
```

### Phase 5: 前端 Playwright 测试

#### 5.1 创建 Playwright 测试
```typescript
// e2e/memories/openclaw-mem0-e2e.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Mem0 Storage E2E - OpenClaw & Claude Code', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:3000/memories');
  });

  test('Memories page loads and displays data', async ({ page }) => {
    await page.waitForSelector('[class*="memory"]', { timeout: 15000 });
    await page.screenshot({ path: 'memories-list.png' });
    const cards = page.locator('[class*="memory-card"]');
    expect(await cards.count()).toBeGreaterThan(0);
  });

  test('Graph view renders correctly', async ({ page }) => {
    const graphBtn = page.locator('button', { hasText: 'Graph' });
    await graphBtn.click();
    await page.waitForSelector('canvas', { timeout: 10000 });
    await page.screenshot({ path: 'graph-view.png' });
  });

  test('Source badges visible', async ({ page }) => {
    await page.waitForSelector('[class*="memory"]', { timeout: 15000 });
    await page.screenshot({ path: 'memories-sources.png' });
  });
});
```

#### 5.2 运行测试
```bash
cd /Users/yishu.cy/IdeaProjects/openclaw-team-workspace/openclaw-mission-control/frontend

npx playwright test e2e/memories/openclaw-mem0-e2e.spec.ts \
  --reporter=list \
  --screenshot=on
```

### Phase 6: 数据比对报告

```bash
echo "============================================"
echo "       MEM0 E2E TEST VERIFICATION"
echo "============================================"

echo -e "\n[1] OpenClaw + Claude Code Memories"
curl -sL "http://localhost:8765/api/v1/memories?user_id=yishu" | \
  jq '{total: .total, by_type: ([.items[].memory_type] | reduce .[] as $t ({}; .[$t] = (.[$t] // 0) + 1))}'

echo -e "\n[2] Turns by Source"
curl -sL "http://localhost:8765/api/v1/turns?user_id=yishu" | \
  jq '.turns | group_by(.source) | map({source: .[0].source, count: length})'

echo -e "\n[3] Turn-Memory Relationship (turn_id coverage)"
curl -sL "http://localhost:8765/api/v1/memories?user_id=yishu" | \
  jq '[.items[] | (.turn_id != null)] | {with_turn_id: (map(select(.==true)) | length), without_turn_id: (map(select(.==false)) | length)}'

echo -e "\n[4] Neo4j Graph Stats"
docker exec neo4j-mem0 cypher-shell -u neo4j -p mem0password \
  "MATCH (n) RETURN labels(n)[0] as label, count(*) as cnt ORDER BY cnt DESC LIMIT 5" \
  2>/dev/null | grep -v CONNECTED

echo -e "\n[5] Recent Memories"
curl -sL "http://localhost:8765/api/v1/memories?user_id=yishu" | \
  jq '[.items[-5:][] | {content: .content[:50], memory_type, source}]'

echo -e "\n============================================"
```

---

## 验证标准

| 测试项 | 验证方法 | 预期结果 |
|--------|---------|---------|
| OpenClaw Turn 创建 | `openclaw agent --message` 后检查 API | source="openclaw" 的 turn 记录 |
| OpenClaw Memory 创建 | API 查询 | user_id=yishu 的记忆增加 |
| Claude Code Turn 创建 | `claude --print --no-input` 后检查 API | source="claude-code" 的 turn 记录 |
| Claude Code Memory 创建 | API 查询 | 有新的 fact 类型记忆 |
| Neo4j 图节点 | Cypher 查询 | 有新增实体节点 |
| Neo4j 图关系 | Cypher 查询 | 有新增关系 |
| 前端列表视图 | Playwright 截图 | 记忆卡片正常显示 |
| 前端图谱视图 | Playwright 截图 | canvas 元素存在 |

---

## 关键文件

| 文件 | 操作 |
|------|------|
| `mem0/openclaw/provider.ts` | 参考 - OpenClaw Provider |
| `mem0/openmemory/api/app/routers/memories.py` | 参考 - Memory API |
| `mem0/openmemory/api/app/routers/turns.py` | 参考 - Turn API |
| `mem0/claude-code-plugin/mem0-store.sh` | 参考 - Claude Code Hook |
| `openclaw-mission-control/frontend/e2e/memories/openclaw-mem0-e2e.spec.ts` | 新建 - Playwright 测试 |
| `openclaw-mission-control/frontend/src/app/memories/page.tsx` | 验证 - 前端页面 |

---

## 预期发现

1. **OpenClaw 消息** → Turn + Memory 创建成功
2. **Claude Code 消息** → Turn + Memory 创建成功
3. **turn_id 关联** → 可能为 null（当前设计问题）
4. **Neo4j 图关系** → 实体和关系正常创建
5. **前端展示** → 记忆列表和图谱正常显示
