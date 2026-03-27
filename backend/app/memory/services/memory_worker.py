"""
记忆处理 Worker

后台轮询处理 pending turns：
1. 按 created_at 升序取出一条 pending turn
2. 顺序执行: fact → summary → graph
3. 更新处理状态
"""

import asyncio
import logging
from datetime import UTC, datetime
from typing import Optional

from sqlalchemy import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.db.session import async_session_maker
from app.memory.models import Turn, VectorMemory

logger = logging.getLogger(__name__)


async def process_fact_extraction(turn: Turn, db: AsyncSession) -> None:
    """从对话中提取关键事实"""
    try:
        # TODO: 集成 mem0 SDK 后，调用 LLM 提取事实
        # 当前暂时只记录日志
        logger.info(f"Fact extraction skipped for turn {turn.id} (mem0 SDK not integrated)")

    except Exception as e:
        logger.error(f"Fact extraction failed for turn {turn.id}: {e}")
        await db.rollback()


async def process_summary_generation(turn: Turn, db: AsyncSession) -> None:
    """生成对话摘要"""
    try:
        # TODO: 集成 mem0 SDK 后，生成并存储摘要
        logger.info(f"Summary generation skipped for turn {turn.id} (mem0 SDK not integrated)")

    except Exception as e:
        logger.error(f"Summary generation failed for turn {turn.id}: {e}")
        await db.rollback()


async def process_graph_build(turn: Turn, db: AsyncSession) -> None:
    """构建知识图谱"""
    try:
        # TODO: 集成 Neo4j 后，提取实体关系并构建图谱
        logger.info(f"Graph build skipped for turn {turn.id} (Neo4j not integrated)")

    except Exception as e:
        logger.error(f"Graph build failed for turn {turn.id}: {e}")


async def process_turn(db: AsyncSession, turn: Turn) -> bool:
    """处理单个 turn：顺序执行 fact → summary → graph"""
    try:
        # 更新状态为 processing
        turn.processing_status = "processing"
        await db.commit()

        # 1. 提取事实
        await process_fact_extraction(turn, db)

        # 2. 生成摘要
        await process_summary_generation(turn, db)

        # 3. 构建图谱
        await process_graph_build(turn, db)

        # 更新状态为 completed
        turn.processing_status = "completed"
        await db.commit()

        logger.info(f"Turn {turn.id} processing completed")
        return True

    except Exception as e:
        logger.error(f"Turn {turn.id} processing failed: {e}")
        turn.processing_status = "failed"
        await db.commit()
        return False


async def run_worker_cycle():
    """单次 Worker 轮询"""
    async with async_session_maker() as db:
        try:
            # 按创建时间升序取出一条 pending turn
            statement = select(Turn).where(
                Turn.processing_status == "pending"
            ).order_by(Turn.created_at.asc()).limit(1)
            result = await db.exec(statement)
            turn = result.first()

            if turn:
                logger.info(f"Processing turn {turn.id}")
                await process_turn(db, turn)
            else:
                logger.debug("No pending turns found")

        except Exception as e:
            logger.error(f"Worker cycle failed: {e}")


async def start_worker():
    """启动 Worker 循环"""
    logger.info("Memory worker started")
    while True:
        try:
            await run_worker_cycle()
        except Exception as e:
            logger.error(f"Worker error: {e}")

        await asyncio.sleep(5)  # 5 秒轮询


def start_worker_in_background():
    """在后台线程中启动 worker"""
    import threading

    def run():
        asyncio.run(start_worker())

    thread = threading.Thread(target=run, daemon=True)
    thread.start()
    logger.info("Memory worker thread started")
