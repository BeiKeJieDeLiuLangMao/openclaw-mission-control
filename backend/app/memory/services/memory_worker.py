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
from app.memory.utils import get_memory_client

logger = logging.getLogger(__name__)


async def process_fact_extraction(turn: Turn, db: AsyncSession) -> None:
    """从对话中提取关键事实"""
    try:
        memory_client = get_memory_client()
        if not memory_client:
            logger.warning(f"Memory client unavailable for turn {turn.id}")
            return

        metadata = {
            "source": turn.source,
            "turn_id": str(turn.id),
            "memory_type": "fact",
        }
        if turn.agent_id:
            metadata["agent_id"] = turn.agent_id

        # 调用 LLM 提取事实
        response = memory_client.add(
            messages=turn.messages,
            user_id=turn.user_id,
            agent_id=turn.agent_id,
            metadata=metadata,
            infer=True
        )

        # 写入 vector_memories 表
        results = response.get("results", [])
        for item in results:
            vm = VectorMemory(
                qdrant_id=item.get("id", ""),
                user_id=turn.user_id,
                agent_id=turn.agent_id,
                turn_id=str(turn.id),
                content=item.get("memory", item.get("text", "")),
                memory_type="fact",
                source=turn.source,
            )
            db.add(vm)

        await db.commit()
        logger.info(f"Fact extraction completed for turn {turn.id}, extracted {len(results)} facts")

    except Exception as e:
        logger.error(f"Fact extraction failed for turn {turn.id}: {e}")
        await db.rollback()


async def process_summary_generation(turn: Turn, db: AsyncSession) -> None:
    """生成对话摘要"""
    try:
        memory_client = get_memory_client()
        if not memory_client:
            logger.warning(f"Memory client unavailable for turn {turn.id}")
            return

        # 构建摘要文本
        summary_text = _build_summary_text(turn.messages)
        if not summary_text:
            logger.info(f"No summary text for turn {turn.id}")
            return

        metadata = {
            "source": turn.source,
            "turn_id": str(turn.id),
            "memory_type": "summary",
        }
        if turn.agent_id:
            metadata["agent_id"] = turn.agent_id

        # 存储摘要（不经过 LLM 提取）
        response = memory_client.add(
            messages=[{"role": "user", "content": summary_text}],
            user_id=turn.user_id,
            agent_id=turn.agent_id,
            metadata=metadata,
            infer=False
        )

        # 写入 vector_memories 表
        results = response.get("results", [])
        for item in results:
            vm = VectorMemory(
                qdrant_id=item.get("id", ""),
                user_id=turn.user_id,
                agent_id=turn.agent_id,
                turn_id=str(turn.id),
                content=item.get("memory", item.get("text", "")),
                memory_type="summary",
                source=turn.source,
            )
            db.add(vm)

        await db.commit()
        logger.info(f"Summary generation completed for turn {turn.id}")

    except Exception as e:
        logger.error(f"Summary generation failed for turn {turn.id}: {e}")
        await db.rollback()


def _build_summary_text(messages: list) -> str:
    """构建对话摘要文本"""
    if not messages:
        return ""

    lines = []
    for msg in messages:
        role = msg.get("role", "unknown")
        content = msg.get("content", "")
        if content:
            lines.append(f"{role}: {content}")

    return "\n".join(lines)


async def process_graph_build(turn: Turn, db: AsyncSession) -> None:
    """构建知识图谱"""
    try:
        memory_client = get_memory_client()
        if not memory_client:
            logger.warning(f"Memory client unavailable for turn {turn.id}")
            return

        # 从 messages 提取实体关系
        entities, relations = _extract_entities_and_relations(turn.messages)

        # 写入 Neo4j（如果可用）
        if entities or relations:
            logger.info(f"Graph build for turn {turn.id}: {len(entities)} entities, {len(relations)} relations")
        else:
            logger.info(f"No entities/relations extracted for turn {turn.id}")

    except Exception as e:
        logger.error(f"Graph build failed for turn {turn.id}: {e}")


def _extract_entities_and_relations(messages: list) -> tuple:
    """从对话中提取实体和关系"""
    # 简化实现，后续可以接入 LLM 做实体识别
    entities = []
    relations = []

    for msg in messages:
        content = msg.get("content", "")
        if content:
            # 简单关键词提取（后续优化）
            if "项目" in content:
                entities.append({"type": "project", "name": "当前项目"})
            if "AI" in content or "人工智能" in content:
                entities.append({"type": "tech", "name": "AI技术"})

    return entities, relations


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
            result = await db.execute(statement)
            turn = result.scalar_one_or_none()

            if turn:
                logger.info(f"Processing turn {turn.id}")
                await process_turn(db, turn)
            else:
                logger.debug("No pending turns found")

        except Exception as e:
            logger.error(f"Worker cycle failed: {e}", exc_info=True)


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
