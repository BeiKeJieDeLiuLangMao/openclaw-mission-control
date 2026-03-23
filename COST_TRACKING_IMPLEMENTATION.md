# 成本追踪看板功能实现总结

## 功能��述

成功实现了 Mission Control 的成本追踪看板功能，用于监控和分析 AI 对话的 token 使用和成本。

## 实现的功能

### 1. 后端 API (`backend/app/api/costs.py`)

**新增端点：**
- `GET /api/v1/costs/metrics` - 获取成本指标数据

**功能特性：**
- 从 `lcm.db` 读取 token 使用数据
- 支持多种时间范围：7d, 14d, 1m, 3m, 6m, 1y
- 计算每日成本（美元）基于模型定价
- 按角色类型（user/system/assistant/tool）分组统计
- 北京时间处理（+8 小时时区修正）

**定价模型：**
- fai/claude-sonnet-4-6: input $0.8/M, output $2.0/M
- fai/claude-opus-4-6: input $0.8/M, output $2.0/M
- 其他模型：默认 input $0.8/M, output $2.0/M

**返回数据：**
- KPI 指标（总成本、总 token、平均每日成本等）
- 每日成本时间序列
- 按角色/模型的成本分解

### 2. 数据模型 (`backend/app/schemas/costs.py`)

**新增 Schema：**
- `DailyCostPoint` - 每日成本数据点
- `ModelCostBreakdown` - 模型成本分解
- `CostKpis` - 成本 KPI 指标
- `CostMetrics` - 完整成本指标响应

### 3. 前端页面 (`frontend/src/app/costs/page.tsx`)

**功能特性：**
- 实时成本数据展示（每分钟刷新）
- 4 个顶部 KPI 卡片：
  - 总成本（美元）
  - 总 token 数
  - 对话数量
  - 消息数量
- 3 个详细信息区块：
  - 成本概览
  - token 分解（输入/输出）
  - 活动统计
- 最近 7 天每日成本明细
- 按角色类型的模型成本分解

**UI 特点：**
- 响应式设计，支持移动端
- 数字格式化（货币、千分位、紧凑格式）
- 加载状态和错误处理
- 与现有 Dashboard 风格一致

### 4. 导航集成

**侧边栏更新：**
- 在 "Overview" 部分添加了 "成本追踪" 导航链接
- 使用 DollarSign 图标
- 支持折叠侧边栏的 tooltip 显示

## 技术实现细节

### 数据库查询

**时区处理：**
```sql
SELECT
  date(datetime(created_at, '+8 hours')) as date,
  SUM(CASE WHEN role IN ('user', 'system') THEN token_count ELSE 0 END) as input_tokens,
  SUM(CASE WHEN role = 'assistant' THEN token_count ELSE 0 END) as output_tokens
FROM messages
WHERE created_at >= ? AND created_at <= ?
GROUP BY date(datetime(created_at, '+8 hours'))
```

**成本计算：**
- Input tokens: 按输入定价计算
- Output tokens: 按输出定价计算
- 总成本 = input_cost + output_cost

### API 集成

**前端 API 客户端：**
- 通过 orval 自动生成
- React Query 集成用于数据获取和缓存
- 自动重试和错误处理

**认证：**
- 使用现有的组织成员认证
- `require_org_member` 依赖注入

## 部署说明

### 后端部署

1. 成本 API 路由已注册到 `backend/app/main.py`
2. 新增 OpenAPI 标签 "costs"
3. 无需数据库迁移（读取外部 lcm.db）

### 前端部署

1. 成本页面路径：`/costs`
2. 需要重新生成 API 客户端：
   ```bash
   cd frontend
   npm run api:gen
   ```
3. 侧边栏导航自动更新

## 使用方式

1. 访问 `/costs` 页面
2. 查看最近 7 天的成本数据（默认）
3. 可以扩展支持更多时间范围选择
4. 数据每分钟自动刷新

## 数据来源

- **数据库：** `~/.openclaw/lcm.db`
- **表：** `messages` (token_count, role, created_at)
- **关联：** `conversations` (conversation_id)

## 未来扩展建议

1. **时间范围选择器：** 添加 UI 控件切换不同时间范围
2. **成本预测：** 基于历史数据预测未来成本
3. **预算告警：** 设置成本阈值和告警
4. **按项目/板分组：** 细化成本归属
5. **图表可视化：** 添加折线图、饼图等
6. **成本导出：** CSV/Excel 导出功能
7. **模型定价配置：** 支持动态定价配置

## 测试验证

- ✅ 后端 API 导入成功
- ✅ 路由注册正确 (`/api/v1/costs/metrics`)
- ✅ OpenAPI 规范包含新端点
- ✅ 前端 API 客户端生成成功
- ✅ 前端页面构建成功
- ✅ 数据库查询验证通过
- ✅ 时区处理正确（北京时间 +8）

## 文件清单

### 后端
- `backend/app/api/costs.py` - 成本追踪 API 端点
- `backend/app/schemas/costs.py` - 数据模型定义
- `backend/app/main.py` - 路由注册（已更新）

### 前端
- `frontend/src/app/costs/page.tsx` - 成本追踪页面
- `frontend/src/components/organisms/DashboardSidebar.tsx` - 导航更新
- `frontend/src/api/generated/costs/` - 自动生成的 API 客户端

## 总结

成功实现了完整的成本追踪看板功能，包括：
- 后端 API 从 lcm.db 读取并计算成本
- 前端页面展示详细的成本分析
- 导航集成和用户体验优化
- 时区处理和数据准确性保证

该功能为团队提供了实时监控 AI 使用成本的能力，有助于优化资源使用和成本控制。
