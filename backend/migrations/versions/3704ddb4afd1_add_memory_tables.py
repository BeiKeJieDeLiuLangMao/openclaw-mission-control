"""add memory tables

Revision ID: 3704ddb4afd1
Revises: a9b1c2d3e4f7
Create Date: 2026-03-28 00:01:22.132465

"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '3704ddb4afd1'
down_revision = 'a9b1c2d3e4f7'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create turns table
    op.create_table(
        'turns',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('session_id', sa.String(), nullable=False),
        sa.Column('user_id', sa.String(), nullable=False),
        sa.Column('agent_id', sa.String(), nullable=False),
        sa.Column('messages', postgresql.JSON(astext_type=sa.Text()), nullable=False),
        sa.Column('source', sa.String(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('processing_status', sa.String(), nullable=True),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_turns_agent_id'), 'turns', ['agent_id'], unique=False)
    op.create_index(op.f('ix_turns_created_at'), 'turns', ['created_at'], unique=False)
    op.create_index(op.f('ix_turns_processing_status'), 'turns', ['processing_status'], unique=False)
    op.create_index(op.f('ix_turns_session_id'), 'turns', ['session_id'], unique=False)
    op.create_index(op.f('ix_turns_user_id'), 'turns', ['user_id'], unique=False)

    # Create vector_memories table
    op.create_table(
        'vector_memories',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('qdrant_id', sa.String(), nullable=False),
        sa.Column('user_id', sa.String(), nullable=False),
        sa.Column('agent_id', sa.String(), nullable=True),
        sa.Column('turn_id', sa.String(), nullable=True),
        sa.Column('content', sa.String(), nullable=False),
        sa.Column('memory_type', sa.String(), nullable=False),
        sa.Column('source', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('qdrant_id')
    )
    op.create_index(op.f('ix_vector_memories_agent_id'), 'vector_memories', ['agent_id'], unique=False)
    op.create_index(op.f('ix_vector_memories_created_at'), 'vector_memories', ['created_at'], unique=False)
    op.create_index(op.f('ix_vector_memories_memory_type'), 'vector_memories', ['memory_type'], unique=False)
    op.create_index(op.f('ix_vector_memories_qdrant_id'), 'vector_memories', ['qdrant_id'], unique=False)
    op.create_index(op.f('ix_vector_memories_turn_id'), 'vector_memories', ['turn_id'], unique=False)
    op.create_index(op.f('ix_vector_memories_user_id'), 'vector_memories', ['user_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_vector_memories_user_id'), table_name='vector_memories')
    op.drop_index(op.f('ix_vector_memories_turn_id'), table_name='vector_memories')
    op.drop_index(op.f('ix_vector_memories_qdrant_id'), table_name='vector_memories')
    op.drop_index(op.f('ix_vector_memories_memory_type'), table_name='vector_memories')
    op.drop_index(op.f('ix_vector_memories_created_at'), table_name='vector_memories')
    op.drop_index(op.f('ix_vector_memories_agent_id'), table_name='vector_memories')
    op.drop_table('vector_memories')

    op.drop_index(op.f('ix_turns_user_id'), table_name='turns')
    op.drop_index(op.f('ix_turns_session_id'), table_name='turns')
    op.drop_index(op.f('ix_turns_processing_status'), table_name='turns')
    op.drop_index(op.f('ix_turns_created_at'), table_name='turns')
    op.drop_index(op.f('ix_turns_agent_id'), table_name='turns')
    op.drop_table('turns')