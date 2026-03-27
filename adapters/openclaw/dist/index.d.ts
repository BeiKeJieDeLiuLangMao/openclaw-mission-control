import { OpenClawPluginApi } from 'openclaw/plugin-sdk';

type Mem0Config = {
    apiUrl: string;
    userId: string;
    autoCapture: boolean;
    autoRecall: boolean;
    customInstructions: string;
    customCategories: Record<string, string>;
    customPrompt?: string;
    enableGraph: boolean;
    searchThreshold: number;
    topK: number;
};
interface AddOptions {
    user_id: string;
    run_id?: string;
    source?: string;
}
interface SearchOptions {
    user_id: string;
    run_id?: string;
    top_k?: number;
    threshold?: number;
    limit?: number;
    keyword_search?: boolean;
    reranking?: boolean;
    source?: string;
}
interface ListOptions {
    user_id: string;
    run_id?: string;
    page_size?: number;
    source?: string;
}
interface MemoryItem {
    id: string;
    memory: string;
    user_id?: string;
    score?: number;
    categories?: string[];
    metadata?: Record<string, unknown>;
    created_at?: string;
    updated_at?: string;
}
interface AddResultItem {
    id: string;
    memory: string;
    event: "ADD" | "UPDATE" | "DELETE" | "NOOP";
}
interface AddResult {
    results: AddResultItem[];
}
interface Mem0Provider {
    add(messages: Array<{
        role: string;
        content: string;
    }>, options: AddOptions): Promise<AddResult>;
    search(query: string, options: SearchOptions): Promise<MemoryItem[]>;
    get(memoryId: string): Promise<MemoryItem>;
    getAll(options: ListOptions): Promise<MemoryItem[]>;
    delete(memoryId: string): Promise<void>;
    recordTurn?(params: {
        sessionId: string;
        userId: string;
        agentId?: string;
        messages: Array<{
            role: string;
            content: string;
        }>;
        toolCallCount?: number;
        totalTokens?: number;
    }): Promise<void>;
}

/**
 * Per-agent memory isolation helpers.
 *
 * Multi-agent setups write/read from separate userId namespaces
 * automatically via sessionKey routing.
 */
/**
 * Returns true if the session trigger is non-interactive and memory
 * hooks should be skipped entirely.
 *
 * Also detects cron-style session keys (e.g. "agent:main:cron:<id>")
 * as a fallback when the trigger field is not set.
 */
declare function isNonInteractiveTrigger(trigger: string | undefined, sessionKey: string | undefined): boolean;
/**
 * Returns true if the session key indicates a subagent (ephemeral) session.
 * Subagent UUIDs are random per-spawn, so their namespaces are always empty
 * on recall and orphaned after capture.
 */
declare function isSubagentSession(sessionKey: string | undefined): boolean;
/**
 * Parse an agent ID from a session key.
 *
 * OpenClaw session key formats:
 *   - Main agent:  "agent:main:main"
 *   - Subagent:    "agent:main:subagent:<uuid>"
 *   - Named agent: "agent:<agentId>:<session>"
 *
 * Returns the subagent UUID for subagent sessions, the agentId for
 * non-"main" named agents, or undefined for the main agent session.
 */
declare function extractAgentId(sessionKey: string | undefined): string | undefined;
/**
 * Derive the effective user_id from a session key, namespacing per-agent.
 * Falls back to baseUserId when the session is not agent-scoped.
 */
declare function effectiveUserId(baseUserId: string, sessionKey?: string): string;
/** Build a user_id for an explicit agentId (e.g. from tool params). */
declare function agentUserId(baseUserId: string, agentId: string): string;
/**
 * Resolve user_id with priority: explicit agentId > explicit userId > session-derived > configured.
 */
declare function resolveUserId(baseUserId: string, opts: {
    agentId?: string;
    userId?: string;
}, currentSessionId?: string): string;

/**
 * Pre-extraction message filtering: noise detection, content stripping,
 * generic assistant detection, truncation, and deduplication.
 */
/**
 * Check whether a message's content is entirely noise (cron heartbeats,
 * single-word acknowledgments, system routing metadata, etc.).
 */
declare function isNoiseMessage(content: string): boolean;
/**
 * Check whether an assistant message is a generic acknowledgment with no
 * extractable facts (e.g. "I see you've shared an update. How can I help?").
 * Only applies to short assistant messages — longer responses likely contain
 * substantive content even if they start with a generic opener.
 */
declare function isGenericAssistantMessage(content: string): boolean;
/**
 * Remove embedded noise fragments (routing metadata, media boilerplate,
 * compaction audit blocks) from a message while preserving the useful content.
 */
declare function stripNoiseFromContent(content: string): string;
/**
 * Full pre-extraction pipeline: drop noise messages, strip noise fragments,
 * and truncate remaining messages to a reasonable length.
 */
declare function filterMessagesForExtraction(messages: Array<{
    role: string;
    content: string;
}>): Array<{
    role: string;
    content: string;
}>;

/**
 * Configuration parsing, env var resolution, and default instructions/categories.
 */

declare const mem0ConfigSchema: {
    parse(value: unknown): Mem0Config;
};

/**
 * OpenClaw Mem0 plugin — OpenMemory HTTP API provider factory.
 *
 * All memory operations are delegated to the OpenMemory Python service
 * at the configured apiUrl (default: http://localhost:8765).
 */

declare function createProvider(cfg: Mem0Config, _api: OpenClawPluginApi): Mem0Provider;

/**
 * OpenClaw Memory (Mem0) Plugin
 *
 * Long-term memory via OpenMemory HTTP API — all operations are HTTP calls
 * to the local OpenMemory Python service (http://localhost:8765 by default).
 *
 * Features:
 * - 5 tools: memory_search, memory_list, memory_store, memory_get, memory_forget
 *   (with session/long-term scope support via scope and longTerm parameters)
 * - Short-term (session-scoped) and long-term (user-scoped) memory
 * - Auto-recall: injects relevant memories (both scopes) before each agent turn
 * - Auto-capture: stores key facts scoped to the current session after each agent turn
 * - Per-agent isolation: multi-agent setups write/read from separate userId namespaces
 *   automatically via sessionKey routing (zero breaking changes for single-agent setups)
 * - CLI: openclaw mem0 search, openclaw mem0 stats
 * - Turn recording: records conversation turns to the OpenMemory API
 */

declare const memoryPlugin: {
    id: string;
    name: string;
    description: string;
    kind: "memory";
    configSchema: {
        parse(value: unknown): Mem0Config;
    };
    register(api: OpenClawPluginApi): void;
};

export { agentUserId, createProvider, memoryPlugin as default, effectiveUserId, extractAgentId, filterMessagesForExtraction, isGenericAssistantMessage, isNoiseMessage, isNonInteractiveTrigger, isSubagentSession, mem0ConfigSchema, resolveUserId, stripNoiseFromContent };
