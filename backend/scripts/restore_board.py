"""Restore the 度假技术团队 board + agents from openclaw.json.bak config."""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from uuid import uuid4

BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))

ORG_ID = "734bda31-d5d1-4925-82b2-2eccfc72081e"
BOARD_ID = "da4fada7-d08d-4591-9631-a501a75af897"
GATEWAY_ID = "2c280d22-5f6a-4e0e-b42c-68f6968e94f8"


async def run() -> None:
    from sqlalchemy import select

    from app.db.session import async_session_maker, init_db
    from app.models.agents import Agent
    from app.models.boards import Board
    from app.models.gateways import Gateway
    from app.models.users import User

    await init_db()

    # 1. Ensure Gateway exists
    async with async_session_maker() as session:
        async with session.begin():
            existing = await session.execute(select(Gateway).where(Gateway.id == GATEWAY_ID))
            if existing.scalar_one_or_none():
                print(f"Gateway already exists, skipping.")
            else:
                gateway = Gateway(
                    id=GATEWAY_ID,
                    organization_id=ORG_ID,
                    name="yishu.cy's Macbook Pro Gateway Agent",
                    url="http://localhost:8080",
                    token=None,
                    workspace_root="/Users/yishu.cy/.openclaw/workspace-gateway-2c280d22-5f6a-4e0e-b42c-68f6968e94f8",
                )
                session.add(gateway)
                print(f"Created Gateway")

    # 2. Ensure Board exists
    async with async_session_maker() as session:
        async with session.begin():
            existing = await session.execute(select(Board).where(Board.id == BOARD_ID))
            if existing.scalar_one_or_none():
                print(f"Board already exists, skipping.")
            else:
                board = Board(
                    id=BOARD_ID,
                    organization_id=ORG_ID,
                    name="度假技术团队",
                    slug="vacation-tech-team",
                    gateway_id=GATEWAY_ID,
                    board_type="goal",
                    objective="度假技术团队协作管理",
                    success_metrics={"team": "vacation-tech"},
                )
                session.add(board)
                print(f"Created Board 度假技术团队")

    # 3. Create Lead Agent
    async with async_session_maker() as session:
        async with session.begin():
            existing = await session.execute(select(Agent).where(Agent.id == BOARD_ID))
            if existing.scalar_one_or_none():
                print("Lead agent Alex already exists.")
            else:
                lead = Agent(
                    id=BOARD_ID,
                    board_id=BOARD_ID,
                    gateway_id=GATEWAY_ID,
                    name="Alex",
                    status="online",
                    is_board_lead=True,
                )
                session.add(lead)
                print("Created lead agent Alex")

    # 4. PM agents (generate new UUIDs, preserve names from openclaw.json.bak)
    pm_agents = [
        "发布端PM",
        "交易PM",
        "导购PM",
        "小二后台PM",
        "垂直行业PM",
        "商品PM",
        "度假标准库PM",
        "商品详情PM",
        "度假自营PM",
    ]

    for name in pm_agents:
        new_id = str(uuid4())
        async with async_session_maker() as session:
            async with session.begin():
                existing = await session.execute(
                    select(Agent).where(Agent.name == name, Agent.board_id == BOARD_ID)
                )
                if not existing.scalar_one_or_none():
                    pm = Agent(
                        id=new_id,
                        board_id=BOARD_ID,
                        gateway_id=GATEWAY_ID,
                        name=name,
                        status="offline",
                        is_board_lead=False,
                    )
                    session.add(pm)
                    print(f"Created agent: {name}")
                else:
                    print(f"Agent {name} already exists, skipping.")

    print("Done!")


if __name__ == "__main__":
    asyncio.run(run())
