"""
Memory API router (v2).

简化的记忆 API：
- GET /: 列出记忆
- GET /search: 搜索记忆
"""

import logging
from typing import Optional, Annotated

from app.db.session import get_session
from app.memory.models import VectorMemory
from app.memory.schemas import MemoryItem, MemoryListResponse, MemorySearchResponse
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlmodel import col, select
from sqlmodel.ext.asyncio.session import AsyncSession

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/memory/memories", tags=["memory-memories"])


async def _vm_to_memory_item(vm: VectorMemory) -> MemoryItem:
    """将 VectorMemory 转换为 MemoryItem"""
    return MemoryItem(
        id=vm.qdrant_id,
        content=vm.content,
        memory_type=vm.memory_type,
        turn_id=vm.turn_id,
        agent_id=vm.agent_id,
        source=vm.source,
        created_at=vm.created_at.isoformat() if vm.created_at else None,
    )


@router.get("/", response_model=MemoryListResponse)
async def list_memories(
    user_id: str = Query(..., description="User identifier"),
    agent_id: Optional[str] = Query(None, description="Filter by agent_id"),
    memory_type: Optional[str] = Query(None, description="Filter by memory_type: summary or fact"),
    turn_id: Optional[str] = Query(None, description="Filter by turn_id"),
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    session: AsyncSession = Depends(get_session)
):
    """列出记忆"""
    statement = select(VectorMemory).where(VectorMemory.user_id == user_id)

    if agent_id:
        statement = statement.where(VectorMemory.agent_id == agent_id)
    if memory_type:
        statement = statement.where(VectorMemory.memory_type == memory_type)
    if turn_id:
        statement = statement.where(VectorMemory.turn_id == turn_id)

    # Count total
    count_statement = statement
    total_result = await session.exec(count_statement)
    memories_list = total_result.all()
    total = len(memories_list)

    # Paginate
    statement = statement.order_by(col(VectorMemory.created_at).desc()).offset(offset).limit(limit)
    result = await session.exec(statement)
    results = result.all()

    return MemoryListResponse(
        items=[await _vm_to_memory_item(vm) for vm in results],
        total=total,
        page=(offset // limit) + 1 if limit > 0 else 1,
        size=limit,
    )


@router.get("/search", response_model=MemorySearchResponse)
async def search_memories(
    user_id: str = Query(..., description="User identifier"),
    query: str = Query(..., description="Search query"),
    agent_id: Optional[str] = Query(None, description="Filter by agent_id"),
    memory_type: Optional[str] = Query(None, description="Filter by memory_type"),
    limit: int = Query(10, ge=1, le=100),
    session: AsyncSession = Depends(get_session)
):
    """
    搜索记忆（基于向量相似度）

    注意：当前实现使用关键词过滤，后续可接入 Qdrant 向量搜索。
    """
    statement = select(VectorMemory).where(VectorMemory.user_id == user_id)

    if agent_id:
        statement = statement.where(VectorMemory.agent_id == agent_id)
    if memory_type:
        statement = statement.where(VectorMemory.memory_type == memory_type)

    # 简单的关键词搜索（后续可接入 Qdrant）
    statement = statement.where(col(VectorMemory.content).contains(query))

    # Count total
    count_statement = statement
    total_result = await session.exec(count_statement)
    memories_list = total_result.all()
    total = len(memories_list)

    # Limit
    statement = statement.order_by(col(VectorMemory.created_at).desc()).limit(limit)
    result = await session.exec(statement)
    results = result.all()

    return MemorySearchResponse(
        items=[await _vm_to_memory_item(vm) for vm in results],
        total=total,
    )


@router.delete("/{memory_id}")
async def delete_memory(
    memory_id: str,
    session: Annotated[AsyncSession, Depends(get_session)]
):
    """删除记忆"""
    statement = select(VectorMemory).where(VectorMemory.qdrant_id == memory_id)
    result = await session.exec(statement)
    vm = result.first()
    if not vm:
        raise HTTPException(status_code=404, detail="Memory not found")

    try:
        await session.delete(vm)
        await session.commit()
        return {"status": "deleted", "id": memory_id}
    except Exception as e:
        await session.rollback()
        logger.error(f"Failed to delete memory: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to delete memory: {e}")