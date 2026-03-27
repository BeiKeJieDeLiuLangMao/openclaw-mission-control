"""
Turn storage API router (v2).

简化后的 API：
- POST /: 创建 Turn（status=pending），立即返回
- GET /: 列出 Turns
- GET /{turn_id}: 获取单个 Turn
"""

import logging
from typing import Optional, Annotated
from uuid import UUID

from app.db.session import get_session
from app.memory.models import Turn
from app.memory.schemas import TurnStoreRequest, TurnStoreResponse
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/memory/turns", tags=["memory-turns"])


class TurnResponse(BaseModel):
    """Turn 响应"""
    id: str
    session_id: str
    user_id: str
    agent_id: str
    messages: list
    source: str
    processing_status: str
    created_at: str


class TurnListResponse(BaseModel):
    """Turn 列表响应"""
    turns: list
    total: int


async def _turn_to_response(turn: Turn) -> TurnResponse:
    """将 Turn 模型转换为响应模型"""
    return TurnResponse(
        id=str(turn.id),
        session_id=turn.session_id,
        user_id=turn.user_id,
        agent_id=turn.agent_id,
        messages=turn.messages,
        source=turn.source,
        processing_status=turn.processing_status,
        created_at=turn.created_at.isoformat() if turn.created_at else None,
    )


@router.post("/", response_model=TurnStoreResponse)
async def create_turn(
    request: TurnStoreRequest,
    session: Annotated[AsyncSession, Depends(get_session)]
):
    """
    存储 Turn（异步处理）

    创建 Turn 记录后立即返回，后台 worker 异步处理 fact/summary/graph。
    """
    try:
        turn = Turn(
            session_id=request.session_id,
            user_id=request.user_id,
            agent_id=request.agent_id,
            messages=request.messages,
            source=request.source,
            processing_status="pending",
        )
        session.add(turn)
        await session.commit()
        await session.refresh(turn)

        logger.info(f"Created turn {turn.id} for session {request.session_id}, source={request.source}")
        return TurnStoreResponse(
            success=True,
            turn_id=str(turn.id),
        )
    except Exception as e:
        await session.rollback()
        logger.error(f"Failed to create turn: {e}")
        return TurnStoreResponse(
            success=False,
            message=str(e),
        )


@router.get("/{turn_id}", response_model=TurnResponse)
async def get_turn(
    turn_id: str,
    session: Annotated[AsyncSession, Depends(get_session)]
):
    """获取单个 Turn"""
    statement = select(Turn).where(Turn.id == turn_id)
    result = await session.exec(statement)
    turn = result.first()
    if not turn:
        raise HTTPException(status_code=404, detail="Turn not found")
    return await _turn_to_response(turn)


@router.get("/", response_model=TurnListResponse)
async def list_turns(
    user_id: str = Query(..., description="User identifier"),
    session_id: Optional[str] = Query(None, description="Filter by session ID"),
    agent_id: Optional[str] = Query(None, description="Filter by agent ID"),
    status: Optional[str] = Query(None, description="Filter by processing status"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    session: AsyncSession = Depends(get_session)
):
    """列出 Turns"""
    statement = select(Turn).where(Turn.user_id == user_id)

    if session_id:
        statement = statement.where(Turn.session_id == session_id)
    if agent_id:
        statement = statement.where(Turn.agent_id == agent_id)
    if status:
        statement = statement.where(Turn.processing_status == status)

    # Count total
    count_statement = statement
    total_result = await session.exec(count_statement)
    # TODO: Use proper count query
    turns_list = total_result.all()
    total = len(turns_list)

    # Paginate
    statement = statement.order_by(Turn.created_at.desc()).offset(offset).limit(limit)
    result = await session.exec(statement)
    turns = result.all()

    return TurnListResponse(
        turns=[await _turn_to_response(turn) for turn in turns],
        total=total
    )


@router.delete("/{turn_id}")
async def delete_turn(
    turn_id: str,
    session: Annotated[AsyncSession, Depends(get_session)]
):
    """删除 Turn"""
    statement = select(Turn).where(Turn.id == turn_id)
    result = await session.exec(statement)
    turn = result.first()
    if not turn:
        raise HTTPException(status_code=404, detail="Turn not found")

    try:
        await session.delete(turn)
        await session.commit()
        return {"status": "deleted", "id": str(turn_id)}
    except Exception as e:
        await session.rollback()
        logger.error(f"Failed to delete turn: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to delete turn: {e}")