#!/usr/bin/env python3
"""测试成本追踪 API 的简单脚本"""

import sqlite3
from datetime import datetime, timedelta
from pathlib import Path

# LCM 数据库���径
LCM_DB_PATH = Path.home() / ".openclaw" / "lcm.db"

# 模型定价（每百万 token，美元）
MODEL_PRICING = {
    "fai/claude-sonnet-4-6": {"input": 0.8, "output": 2.0},
    "fai/claude-opus-4-6": {"input": 0.8, "output": 2.0},
    "default": {"input": 0.8, "output": 2.0},
}

def get_daily_costs(days=7):
    """获取每日成本数据"""
    if not LCM_DB_PATH.exists():
        print(f"❌ LCM 数据库不存在: {LCM_DB_PATH}")
        return []

    try:
        conn = sqlite3.connect(str(LCM_DB_PATH))
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        # 计算日期范围
        end_date = datetime.now()
        start_date = end_date - timedelta(days=days)

        # 查询每日 token 使用
        query = """
        SELECT
            date(datetime(created_at, '+8 hours')) as date,
            SUM(CASE WHEN role IN ('user', 'system') THEN token_count ELSE 0 END) as input_tokens,
            SUM(CASE WHEN role = 'assistant' THEN token_count ELSE 0 END) as output_tokens,
            COUNT(DISTINCT conversation_id) as conversations_count,
            COUNT(*) as messages_count
        FROM messages
        WHERE date(datetime(created_at, '+8 hours')) >= date(?)
        GROUP BY date(datetime(created_at, '+8 hours'))
        ORDER BY date DESC
        """

        start_str = start_date.strftime("%Y-%m-%d")
        cursor.execute(query, (start_str,))
        rows = cursor.fetchall()

        daily_costs = []
        for row in rows:
            input_tokens = row["input_tokens"] or 0
            output_tokens = row["output_tokens"] or 0
            total_tokens = input_tokens + output_tokens

            # 计算成本
            pricing = MODEL_PRICING["default"]
            input_cost_usd = (input_tokens / 1_000_000) * pricing["input"]
            output_cost_usd = (output_tokens / 1_000_000) * pricing["output"]
            total_cost_usd = input_cost_usd + output_cost_usd

            daily_costs.append({
                "date": row["date"],
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "total_tokens": total_tokens,
                "input_cost_usd": round(input_cost_usd, 4),
                "output_cost_usd": round(output_cost_usd, 4),
                "total_cost_usd": round(total_cost_usd, 4),
                "conversations_count": row["conversations_count"],
                "messages_count": row["messages_count"],
            })

        conn.close()
        return daily_costs

    except Exception as e:
        print(f"❌ 查询数据库失败: {str(e)}")
        return []

def format_currency(value):
    """格式化货币"""
    return f"${value:.4f}"

def format_number(value):
    """格式化数字"""
    if value >= 1_000_000:
        return f"{value/1_000_000:.1f}M"
    elif value >= 1_000:
        return f"{value/1_000:.1f}K"
    else:
        return str(value)

def main():
    print("📊 OpenClaw 成本追踪测试")
    print("=" * 50)

    # 获取最近 7 天的数据
    daily_costs = get_daily_costs(days=7)

    if not daily_costs:
        print("❌ 没有找到成本数据")
        return

    # 计算总计
    total_cost = sum(d["total_cost_usd"] for d in daily_costs)
    total_tokens = sum(d["total_tokens"] for d in daily_costs)
    total_input_tokens = sum(d["input_tokens"] for d in daily_costs)
    total_output_tokens = sum(d["output_tokens"] for d in daily_costs)
    total_conversations = sum(d["conversations_count"] for d in daily_costs)
    total_messages = sum(d["messages_count"] for d in daily_costs)

    days_count = len(daily_costs)
    avg_daily_cost = total_cost / days_count if days_count > 0 else 0
    avg_daily_tokens = total_tokens / days_count if days_count > 0 else 0

    # 显示 KPI
    print(f"\n🎯 关键指标 (最近 {days_count} 天)")
    print("-" * 30)
    print(f"总成本:     {format_currency(total_cost)}")
    print(f"日均成本:   {format_currency(avg_daily_cost)}")
    print(f"总 Token:   {format_number(total_tokens)}")
    print(f"日均 Token: {format_number(int(avg_daily_tokens))}")
    print(f"对话数:     {total_conversations}")
    print(f"消息数:     {total_messages}")

    # 显示 Token 分解
    print(f"\n📝 Token 分解")
    print("-" * 30)
    print(f"Input:  {format_number(total_input_tokens)} ({total_input_tokens/total_tokens*100:.1f}%)")
    print(f"Output: {format_number(total_output_tokens)} ({total_output_tokens/total_tokens*100:.1f}%)")

    # 显示每日明细
    print(f"\n📅 每日明细 (最近 7 天)")
    print("-" * 30)
    print(f"{'日期':<12} {'成本':<12} {'Token':<12} {'消息':<8}")
    print("-" * 50)

    for day in daily_costs[:7]:  # 只显示最近 7 天
        print(f"{day['date']:<12} {format_currency(day['total_cost_usd']):<12} "
              f"{format_number(day['total_tokens']):<12} {day['messages_count']:<8}")

    print("\n✅ 成本追踪功能正常工作！")

if __name__ == "__main__":
    main()
