// index.ts
import { Type } from "@sinclair/typebox";

// provider.ts
var HTTP_TIMEOUT_MS = 3e4;
var OpenMemoryProvider = class {
  constructor(apiUrl) {
    this.apiUrl = apiUrl;
  }
  // ---------------------------------------------------------------------------
  // Internal HTTP helper
  // ---------------------------------------------------------------------------
  async request(method, path, body) {
    const url = `${this.apiUrl}${path}`;
    const opts = {
      method,
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS)
    };
    if (body !== void 0) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    if (!res.ok) {
      const detail = await res.text().catch(() => res.statusText);
      throw new Error(
        `OpenMemory API ${method} ${path} failed ${res.status}: ${detail}`
      );
    }
    if (res.status === 204) return {};
    return res.json();
  }
  // ---------------------------------------------------------------------------
  // Result normalizers
  // ---------------------------------------------------------------------------
  normalizeMemoryItem(raw) {
    const r = raw;
    return {
      id: String(r.id ?? r.memory_id ?? ""),
      // Qdrant list returns "content", single get returns "text"
      memory: String(r.memory ?? r.text ?? r.content ?? ""),
      user_id: String(r.user_id ?? r.userId ?? ""),
      score: typeof r.score === "number" ? r.score : void 0,
      categories: Array.isArray(r.categories) ? r.categories.map(String) : void 0,
      metadata: r.metadata ?? r.metadata_,
      created_at: String(r.created_at ?? r.createdAt ?? ""),
      updated_at: String(r.updated_at ?? r.updatedAt ?? "")
    };
  }
  // ---------------------------------------------------------------------------
  // add — POST /api/v1/memories/
  // ---------------------------------------------------------------------------
  async add(messages, options) {
    const agentId = options.run_id ?? void 0;
    const body = {
      user_id: options.user_id,
      messages,
      infer: true,
      app: "openclaw",
      memory_type: "fact",
      agent_id: agentId
    };
    const res = await this.request(
      "POST",
      "/api/v1/memories/",
      body
    );
    if (Array.isArray(res)) {
      const results = res.map((item) => {
        const normalized2 = this.normalizeMemoryItem(item);
        return {
          id: normalized2.id,
          memory: normalized2.memory,
          event: "ADD"
        };
      });
      return { results };
    }
    const normalized = this.normalizeMemoryItem(res);
    if (!normalized.id) return { results: [] };
    return {
      results: [{
        id: normalized.id,
        memory: normalized.memory,
        event: "ADD"
      }]
    };
  }
  // ---------------------------------------------------------------------------
  // search — semantic vector search via new /search endpoint
  //           falls back to keyword filter if unavailable
  // ---------------------------------------------------------------------------
  async search(query, options) {
    const limit = options.limit ?? options.top_k ?? 5;
    const threshold = options.threshold ?? 0;
    const params = new URLSearchParams({
      user_id: options.user_id,
      query,
      limit: String(limit)
    });
    if (options.run_id) params.set("agent_id", options.run_id);
    if (options.threshold != null) params.set("threshold", String(options.threshold));
    let raw;
    try {
      raw = await this.request(
        "GET",
        `/api/v1/memories/search?${params}`
      );
    } catch (_err) {
      const fallback = await this.request(
        "POST",
        "/api/v1/memories/filter",
        {
          user_id: options.user_id,
          search_query: query,
          page: 1,
          size: limit
        }
      );
      raw = fallback;
    }
    const resp = raw;
    const items = resp.items ?? [];
    const normalized = items.map((item) => this.normalizeMemoryItem(item));
    return normalized.filter((item) => (item.score ?? 0) >= threshold);
  }
  // ---------------------------------------------------------------------------
  // get — GET /api/v1/memories/{memory_id}
  // ---------------------------------------------------------------------------
  async get(memoryId) {
    const raw = await this.request(
      "GET",
      `/api/v1/memories/${memoryId}`
    );
    return this.normalizeMemoryItem(raw);
  }
  // ---------------------------------------------------------------------------
  // getAll — GET /api/v1/memories/?user_id=...&agent_id=...&limit=...
  // ---------------------------------------------------------------------------
  async getAll(options) {
    const params = new URLSearchParams({ user_id: options.user_id });
    if (options.run_id) params.set("agent_id", options.run_id);
    const limit = options.page_size ?? 200;
    params.set("limit", String(limit));
    const raw = await this.request(
      "GET",
      `/api/v1/memories/?${params}`
    );
    return (raw.items ?? []).map((item) => this.normalizeMemoryItem(item));
  }
  // ---------------------------------------------------------------------------
  // delete — DELETE /api/v1/memories/
  // ---------------------------------------------------------------------------
  async delete(memoryId) {
    await this.request("DELETE", "/api/v1/memories/", {
      memory_ids: [memoryId],
      user_id: ""
    });
  }
  // ---------------------------------------------------------------------------
  // recordTurn — POST /api/v1/turns/
  // ---------------------------------------------------------------------------
  async recordTurn(params) {
    await this.request("POST", "/api/v1/turns/", {
      session_id: params.sessionId,
      user_id: params.userId,
      agent_id: params.agentId,
      messages: params.messages,
      message_count: params.messages.length,
      tool_call_count: params.toolCallCount ?? 0,
      total_tokens: params.totalTokens ?? 0,
      source: "openclaw"
    });
  }
};

// providers.ts
function createProvider(cfg, _api) {
  return new OpenMemoryProvider(cfg.apiUrl);
}

// config.ts
function resolveEnvVars(value) {
  return value.replace(/\$\{([^}]+)\}/g, (_, envVar) => {
    const envValue = process.env[envVar];
    if (!envValue) {
      throw new Error(`Environment variable ${envVar} is not set`);
    }
    return envValue;
  });
}
var DEFAULT_CUSTOM_INSTRUCTIONS = `Your Task: Extract durable, actionable facts from conversations between a user and an AI assistant. Only store information that would be useful to an agent in a FUTURE session, days or weeks later.

Before storing any fact, ask: "Would a new agent \u2014 with no prior context \u2014 benefit from knowing this?" If the answer is no, do not store it.

Information to Extract (in priority order):

1. Configuration & System State Changes:
   - Tools/services configured, installed, or removed (with versions/dates)
   - Model assignments for agents, API keys configured (NEVER the key itself \u2014 see Exclude)
   - Cron schedules, automation pipelines, deployment configurations
   - Architecture decisions (agent hierarchy, system design, deployment strategy)
   - Specific identifiers: file paths, sheet IDs, channel IDs, user IDs, folder IDs

2. Standing Rules & Policies:
   - Explicit user directives about behavior ("never create accounts without consent")
   - Workflow policies ("each agent must review model selection before completing a task")
   - Security constraints, permission boundaries, access patterns

3. Identity & Demographics:
   - Name, location, timezone, language preferences
   - Occupation, employer, job role, industry

4. Preferences & Opinions:
   - Communication style preferences
   - Tool and technology preferences (with specifics: versions, configs)
   - Strong opinions or values explicitly stated
   - The WHY behind preferences when stated

5. Goals, Projects & Milestones:
   - Active projects (name, description, current status)
   - Completed setup milestones ("ElevenLabs fully configured as of 2026-02-20")
   - Deadlines, roadmaps, and progress tracking
   - Problems actively being solved

6. Technical Context:
   - Tech stack, tools, development environment
   - Agent ecosystem structure (names, roles, relationships)
   - Skill levels in different areas

7. Relationships & People:
   - Names and roles of people mentioned (colleagues, family, clients)
   - Team structure, key contacts

8. Decisions & Lessons:
   - Important decisions made and their reasoning
   - Lessons learned, strategies that worked or failed

Guidelines:

TEMPORAL ANCHORING (critical):
- ALWAYS include temporal context for time-sensitive facts using "As of YYYY-MM-DD, ..."
- Extract dates from message timestamps, dates mentioned in the text, or the system-provided current date
- If no date is available, note "date unknown" rather than omitting temporal context
- Examples: "As of 2026-02-20, ElevenLabs setup is complete" NOT "ElevenLabs setup is complete"

CONCISENESS:
- Use third person ("User prefers..." not "I prefer...")
- Keep related facts together in a single memory to preserve context
- "User's Tailscale machine 'mac' (IP 100.71.135.41) is configured under beau@rizedigital.io (as of 2026-02-20)"
- NOT a paragraph retelling the whole conversation

OUTCOMES OVER INTENT:
- When an assistant message summarizes completed work, extract the durable OUTCOMES
- "Call scripts sheet (ID: 146Qbb...) was updated with truth-based templates" NOT "User wants to update call scripts"
- Extract what WAS DONE, not what was requested

DEDUPLICATION:
- Before creating a new memory, check if a substantially similar fact already exists
- If so, UPDATE the existing memory with any new details rather than creating a duplicate

LANGUAGE:
- ALWAYS preserve the original language of the conversation
- If the user speaks Spanish, store the memory in Spanish; do not translate

Exclude (NEVER store):
- Passwords, API keys, tokens, secrets, or any credentials \u2014 even if shared in conversation. Instead store: "Tavily API key was configured and saved to .env (as of 2026-02-20)"
- One-time commands or instructions ("stop the script", "continue where you left off")
- Acknowledgments or emotional reactions ("ok", "sounds good", "you're right", "sir")
- Transient UI/navigation states ("user is in the admin panel", "relay is attached")
- Ephemeral process status ("download at 50%", "daemon not running", "still syncing")
- Cron heartbeat outputs, NO_REPLY responses, compaction flush directives
- System routing metadata (message IDs, sender IDs, channel routing info)
- Generic small talk with no informational content
- Raw code snippets (capture the intent/decision, not the code itself)
- Information the user explicitly asks not to remember`;
var DEFAULT_CUSTOM_CATEGORIES = {
  identity: "Personal identity information: name, age, location, timezone, occupation, employer, education, demographics",
  preferences: "Explicitly stated likes, dislikes, preferences, opinions, and values across any domain",
  goals: "Current and future goals, aspirations, objectives, targets the user is working toward",
  projects: "Specific projects, initiatives, or endeavors the user is working on, including status and details",
  technical: "Technical skills, tools, tech stack, development environment, programming languages, frameworks",
  decisions: "Important decisions made, reasoning behind choices, strategy changes, and their outcomes",
  relationships: "People mentioned by the user: colleagues, family, friends, their roles and relevance",
  routines: "Daily habits, work patterns, schedules, productivity routines, health and wellness habits",
  life_events: "Significant life events, milestones, transitions, upcoming plans and changes",
  lessons: "Lessons learned, insights gained, mistakes acknowledged, changed opinions or beliefs",
  work: "Work-related context: job responsibilities, workplace dynamics, career progression, professional challenges",
  health: "Health-related information voluntarily shared: conditions, medications, fitness, wellness goals"
};
var ALLOWED_KEYS = [
  "apiUrl",
  "userId",
  "autoCapture",
  "autoRecall",
  "customInstructions",
  "customCategories",
  "customPrompt",
  "enableGraph",
  "searchThreshold",
  "topK"
];
var LEGACY_KEYS = [
  "mode",
  "apiKey",
  "orgId",
  "projectId",
  "oss"
];
function assertAllowedKeys(value, allowed, label) {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length === 0) return;
  throw new Error(`${label} has unknown keys: ${unknown.join(", ")}`);
}
function detectLegacyConfig(cfg) {
  const legacyFound = LEGACY_KEYS.filter((key) => key in cfg);
  if (legacyFound.length === 0) return;
  throw new Error(
    `openclaw-mem0 config format has changed. Remove legacy keys: ${legacyFound.join(", ")}. Use "apiUrl" instead (e.g. "http://localhost:8765"). See the plugin README for migration instructions.`
  );
}
var mem0ConfigSchema = {
  parse(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("openclaw-mem0 config required");
    }
    const cfg = value;
    detectLegacyConfig(cfg);
    assertAllowedKeys(cfg, ALLOWED_KEYS, "openclaw-mem0 config");
    let apiUrl = "http://localhost:8765";
    if (typeof cfg.apiUrl === "string") {
      try {
        apiUrl = resolveEnvVars(cfg.apiUrl);
      } catch {
        apiUrl = cfg.apiUrl;
      }
    }
    return {
      apiUrl,
      userId: typeof cfg.userId === "string" && cfg.userId ? cfg.userId : "default",
      autoCapture: cfg.autoCapture !== false,
      autoRecall: cfg.autoRecall !== false,
      customInstructions: typeof cfg.customInstructions === "string" ? cfg.customInstructions : DEFAULT_CUSTOM_INSTRUCTIONS,
      customCategories: cfg.customCategories && typeof cfg.customCategories === "object" && !Array.isArray(cfg.customCategories) ? cfg.customCategories : DEFAULT_CUSTOM_CATEGORIES,
      customPrompt: typeof cfg.customPrompt === "string" ? cfg.customPrompt : DEFAULT_CUSTOM_INSTRUCTIONS,
      enableGraph: cfg.enableGraph === true,
      searchThreshold: typeof cfg.searchThreshold === "number" ? cfg.searchThreshold : 0.5,
      topK: typeof cfg.topK === "number" ? cfg.topK : 5
    };
  }
};

// filtering.ts
var NOISE_MESSAGE_PATTERNS = [
  /^(HEARTBEAT_OK|NO_REPLY)$/i,
  /^Current time:.*\d{4}/,
  /^Pre-compaction memory flush/i,
  /^(ok|yes|no|sir|sure|thanks|done|good|nice|cool|got it|it's on|continue)$/i,
  /^System: \[.*\] (Slack message edited|Gateway restart|Exec (failed|completed))/,
  /^System: \[.*\] ⚠️ Post-Compaction Audit:/
];
var NOISE_CONTENT_PATTERNS = [
  { pattern: /Conversation info \(untrusted metadata\):\s*```json\s*\{[\s\S]*?\}\s*```/g, replacement: "" },
  { pattern: /\[media attached:.*?\]/g, replacement: "" },
  { pattern: /To send an image back, prefer the message tool[\s\S]*?Keep caption in the text body\./g, replacement: "" },
  { pattern: /System: \[\d{4}-\d{2}-\d{2}.*?\] ⚠️ Post-Compaction Audit:[\s\S]*?after memory compaction\./g, replacement: "" },
  { pattern: /Replied message \(untrusted, for context\):\s*```json[\s\S]*?```/g, replacement: "" }
];
var MAX_MESSAGE_LENGTH = 2e3;
var GENERIC_ASSISTANT_PATTERNS = [
  /^(I see you'?ve shared|Thanks for sharing|Got it[.!]?\s*(I see|Let me|How can)|I understand[.!]?\s*(How can|Is there|Would you))/i,
  /^(How can I help|Is there anything|Would you like me to|Let me know (if|how|what))/i,
  /^(I('?ll| will) (help|assist|look into|review|take a look))/i,
  /^(Sure[.!]?\s*(How|What|Is)|Understood[.!]?\s*(How|What|Is))/i,
  /^(That('?s| is) (noted|understood|clear))/i
];
function isNoiseMessage(content) {
  const trimmed = content.trim();
  if (!trimmed) return true;
  return NOISE_MESSAGE_PATTERNS.some((p) => p.test(trimmed));
}
function isGenericAssistantMessage(content) {
  const trimmed = content.trim();
  if (trimmed.length > 300) return false;
  return GENERIC_ASSISTANT_PATTERNS.some((p) => p.test(trimmed));
}
function stripNoiseFromContent(content) {
  let cleaned = content;
  for (const { pattern, replacement } of NOISE_CONTENT_PATTERNS) {
    cleaned = cleaned.replace(pattern, replacement);
  }
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim();
  return cleaned;
}
function truncateMessage(content) {
  if (content.length <= MAX_MESSAGE_LENGTH) return content;
  return content.slice(0, MAX_MESSAGE_LENGTH) + "\n[...truncated]";
}
function filterMessagesForExtraction(messages) {
  const filtered = [];
  for (const msg of messages) {
    if (isNoiseMessage(msg.content)) continue;
    if (msg.role === "assistant" && isGenericAssistantMessage(msg.content)) continue;
    const cleaned = stripNoiseFromContent(msg.content);
    if (!cleaned) continue;
    filtered.push({ role: msg.role, content: truncateMessage(cleaned) });
  }
  return filtered;
}

// isolation.ts
var SKIP_TRIGGERS = /* @__PURE__ */ new Set(["cron", "heartbeat", "automation", "schedule"]);
function isNonInteractiveTrigger(trigger, sessionKey) {
  if (trigger && SKIP_TRIGGERS.has(trigger.toLowerCase())) return true;
  if (sessionKey) {
    if (/:cron:/i.test(sessionKey) || /:heartbeat:/i.test(sessionKey)) return true;
  }
  return false;
}
function isSubagentSession(sessionKey) {
  if (!sessionKey) return false;
  return /:subagent:/i.test(sessionKey);
}
function extractAgentId(sessionKey) {
  if (!sessionKey) return void 0;
  const subagentMatch = sessionKey.match(/:subagent:([^:]+)$/);
  if (subagentMatch?.[1]) return `subagent-${subagentMatch[1]}`;
  const match = sessionKey.match(/^agent:([^:]+):/);
  const agentId = match?.[1];
  if (!agentId || agentId === "main") return void 0;
  return agentId;
}
function effectiveUserId(baseUserId, sessionKey) {
  const agentId = extractAgentId(sessionKey);
  return agentId ? `${baseUserId}:agent:${agentId}` : baseUserId;
}
function agentUserId(baseUserId, agentId) {
  return `${baseUserId}:agent:${agentId}`;
}
function resolveUserId(baseUserId, opts, currentSessionId) {
  if (opts.agentId) return agentUserId(baseUserId, opts.agentId);
  if (opts.userId) return opts.userId;
  return effectiveUserId(baseUserId, currentSessionId);
}

// index.ts
var memoryPlugin = {
  id: "openclaw-mem0",
  name: "Memory (Mem0)",
  description: "Mem0 memory backend \u2014 Mem0 platform or self-hosted open-source",
  kind: "memory",
  configSchema: mem0ConfigSchema,
  register(api) {
    const cfg = mem0ConfigSchema.parse(api.pluginConfig);
    const provider = createProvider(cfg, api);
    let currentSessionId;
    const _effectiveUserId = (sessionKey) => effectiveUserId(cfg.userId, sessionKey);
    const _agentUserId = (id) => agentUserId(cfg.userId, id);
    const _resolveUserId = (opts) => resolveUserId(cfg.userId, opts, currentSessionId);
    api.logger.info(
      `openclaw-mem0: registered (apiUrl: ${cfg.apiUrl}, user: ${cfg.userId}, graph: ${cfg.enableGraph}, autoRecall: ${cfg.autoRecall}, autoCapture: ${cfg.autoCapture})`
    );
    function buildAddOptions(userIdOverride, runId, sessionKey) {
      const opts = {
        user_id: userIdOverride || _effectiveUserId(sessionKey),
        source: "OPENCLAW"
      };
      if (runId) opts.run_id = runId;
      return opts;
    }
    function buildSearchOptions(userIdOverride, limit, runId, sessionKey) {
      const opts = {
        user_id: userIdOverride || _effectiveUserId(sessionKey),
        top_k: limit ?? cfg.topK,
        limit: limit ?? cfg.topK,
        threshold: cfg.searchThreshold,
        keyword_search: true,
        reranking: true,
        source: "OPENCLAW"
      };
      if (runId) opts.run_id = runId;
      return opts;
    }
    registerTools(api, provider, cfg, _resolveUserId, _effectiveUserId, _agentUserId, buildAddOptions, buildSearchOptions, () => currentSessionId);
    registerCli(api, provider, cfg, _effectiveUserId, _agentUserId, buildSearchOptions, () => currentSessionId);
    registerHooks(api, provider, cfg, _effectiveUserId, buildAddOptions, buildSearchOptions, {
      setCurrentSessionId: (id) => {
        currentSessionId = id;
      }
    });
    api.registerService({
      id: "openclaw-mem0",
      start: () => {
        api.logger.info(
          `openclaw-mem0: initialized (apiUrl: ${cfg.apiUrl}, user: ${cfg.userId}, autoRecall: ${cfg.autoRecall}, autoCapture: ${cfg.autoCapture})`
        );
      },
      stop: () => {
        api.logger.info("openclaw-mem0: stopped");
      }
    });
  }
};
function registerTools(api, provider, cfg, _resolveUserId, _effectiveUserId, _agentUserId, buildAddOptions, buildSearchOptions, getCurrentSessionId) {
  api.registerTool(
    {
      name: "memory_search",
      label: "Memory Search",
      description: "Search through long-term memories stored in Mem0. Use when you need context about user preferences, past decisions, or previously discussed topics.",
      parameters: Type.Object({
        query: Type.String({ description: "Search query" }),
        limit: Type.Optional(
          Type.Number({
            description: `Max results (default: ${cfg.topK})`
          })
        ),
        userId: Type.Optional(
          Type.String({
            description: "User ID to scope search (default: configured userId)"
          })
        ),
        agentId: Type.Optional(
          Type.String({
            description: 'Agent ID to search memories for a specific agent (e.g. "researcher"). Overrides userId.'
          })
        ),
        scope: Type.Optional(
          Type.Union([
            Type.Literal("session"),
            Type.Literal("long-term"),
            Type.Literal("all")
          ], {
            description: 'Memory scope: "session" (current session only), "long-term" (user-scoped only), or "all" (both). Default: "all"'
          })
        )
      }),
      async execute(_toolCallId, params) {
        const { query, limit, userId, agentId, scope = "all" } = params;
        try {
          let results = [];
          const uid = _resolveUserId({ agentId, userId });
          const currentSessionId = getCurrentSessionId();
          if (scope === "session") {
            if (currentSessionId) {
              results = await provider.search(
                query,
                buildSearchOptions(uid, limit, currentSessionId)
              );
            }
          } else if (scope === "long-term") {
            results = await provider.search(
              query,
              buildSearchOptions(uid, limit)
            );
          } else {
            const longTermResults = await provider.search(
              query,
              buildSearchOptions(uid, limit)
            );
            let sessionResults = [];
            if (currentSessionId) {
              sessionResults = await provider.search(
                query,
                buildSearchOptions(uid, limit, currentSessionId)
              );
            }
            const seen = new Set(longTermResults.map((r) => r.id));
            results = [
              ...longTermResults,
              ...sessionResults.filter((r) => !seen.has(r.id))
            ];
          }
          if (!results || results.length === 0) {
            return {
              content: [
                { type: "text", text: "No relevant memories found." }
              ],
              details: { count: 0 }
            };
          }
          const text = results.map(
            (r, i) => `${i + 1}. ${r.memory} (score: ${((r.score ?? 0) * 100).toFixed(0)}%, id: ${r.id})`
          ).join("\n");
          const sanitized = results.map((r) => ({
            id: r.id,
            memory: r.memory,
            score: r.score,
            categories: r.categories,
            created_at: r.created_at
          }));
          return {
            content: [
              {
                type: "text",
                text: `Found ${results.length} memories:

${text}`
              }
            ],
            details: { count: results.length, memories: sanitized }
          };
        } catch (err) {
          return {
            content: [
              {
                type: "text",
                text: `Memory search failed: ${String(err)}`
              }
            ],
            details: { error: String(err) }
          };
        }
      }
    },
    { name: "memory_search" }
  );
  api.registerTool(
    {
      name: "memory_store",
      label: "Memory Store",
      description: "Save important information in long-term memory via Mem0. Use for preferences, facts, decisions, and anything worth remembering.",
      parameters: Type.Object({
        text: Type.String({ description: "Information to remember" }),
        userId: Type.Optional(
          Type.String({
            description: "User ID to scope this memory"
          })
        ),
        agentId: Type.Optional(
          Type.String({
            description: `Agent ID to store memory under a specific agent's namespace (e.g. "researcher"). Overrides userId.`
          })
        ),
        metadata: Type.Optional(
          Type.Record(Type.String(), Type.Unknown(), {
            description: "Optional metadata to attach to this memory"
          })
        ),
        longTerm: Type.Optional(
          Type.Boolean({
            description: "Store as long-term (user-scoped) memory. Default: true. Set to false for session-scoped memory."
          })
        )
      }),
      async execute(_toolCallId, params) {
        const { text, userId, agentId, longTerm = true } = params;
        try {
          const uid = _resolveUserId({ agentId, userId });
          const currentSessionId = getCurrentSessionId();
          const runId = !longTerm && currentSessionId ? currentSessionId : void 0;
          const preview = text.slice(0, 200);
          const dedupOpts = buildSearchOptions(uid, 3);
          dedupOpts.threshold = 0.85;
          const existing = await provider.search(preview, dedupOpts);
          if (existing.length > 0) {
            api.logger.info(
              `openclaw-mem0: found ${existing.length} similar existing memories \u2014 mem0 may update instead of add`
            );
          }
          const result = await provider.add(
            [{ role: "user", content: text }],
            buildAddOptions(uid, runId, currentSessionId)
          );
          const added = result.results?.filter((r) => r.event === "ADD") ?? [];
          const updated = result.results?.filter((r) => r.event === "UPDATE") ?? [];
          const summary = [];
          if (added.length > 0)
            summary.push(
              `${added.length} new memor${added.length === 1 ? "y" : "ies"} added`
            );
          if (updated.length > 0)
            summary.push(
              `${updated.length} memor${updated.length === 1 ? "y" : "ies"} updated`
            );
          if (summary.length === 0)
            summary.push("No new memories extracted");
          return {
            content: [
              {
                type: "text",
                text: `Stored: ${summary.join(", ")}. ${result.results?.map((r) => `[${r.event}] ${r.memory}`).join("; ") ?? ""}`
              }
            ],
            details: {
              action: "stored",
              results: result.results
            }
          };
        } catch (err) {
          return {
            content: [
              {
                type: "text",
                text: `Memory store failed: ${String(err)}`
              }
            ],
            details: { error: String(err) }
          };
        }
      }
    },
    { name: "memory_store" }
  );
  api.registerTool(
    {
      name: "memory_get",
      label: "Memory Get",
      description: "Retrieve a specific memory by its ID from Mem0.",
      parameters: Type.Object({
        memoryId: Type.String({ description: "The memory ID to retrieve" })
      }),
      async execute(_toolCallId, params) {
        const { memoryId } = params;
        try {
          const memory = await provider.get(memoryId);
          return {
            content: [
              {
                type: "text",
                text: `Memory ${memory.id}:
${memory.memory}

Created: ${memory.created_at ?? "unknown"}
Updated: ${memory.updated_at ?? "unknown"}`
              }
            ],
            details: { memory }
          };
        } catch (err) {
          return {
            content: [
              {
                type: "text",
                text: `Memory get failed: ${String(err)}`
              }
            ],
            details: { error: String(err) }
          };
        }
      }
    },
    { name: "memory_get" }
  );
  api.registerTool(
    {
      name: "memory_list",
      label: "Memory List",
      description: "List all stored memories for a user or agent. Use this when you want to see everything that's been remembered, rather than searching for something specific.",
      parameters: Type.Object({
        userId: Type.Optional(
          Type.String({
            description: "User ID to list memories for (default: configured userId)"
          })
        ),
        agentId: Type.Optional(
          Type.String({
            description: 'Agent ID to list memories for a specific agent (e.g. "researcher"). Overrides userId.'
          })
        ),
        scope: Type.Optional(
          Type.Union([
            Type.Literal("session"),
            Type.Literal("long-term"),
            Type.Literal("all")
          ], {
            description: 'Memory scope: "session" (current session only), "long-term" (user-scoped only), or "all" (both). Default: "all"'
          })
        )
      }),
      async execute(_toolCallId, params) {
        const { userId, agentId, scope = "all" } = params;
        try {
          let memories = [];
          const uid = _resolveUserId({ agentId, userId });
          const currentSessionId = getCurrentSessionId();
          if (scope === "session") {
            if (currentSessionId) {
              memories = await provider.getAll({
                user_id: uid,
                run_id: currentSessionId,
                source: "OPENCLAW"
              });
            }
          } else if (scope === "long-term") {
            memories = await provider.getAll({ user_id: uid, source: "OPENCLAW" });
          } else {
            const longTerm = await provider.getAll({ user_id: uid, source: "OPENCLAW" });
            let session = [];
            if (currentSessionId) {
              session = await provider.getAll({
                user_id: uid,
                run_id: currentSessionId,
                source: "OPENCLAW"
              });
            }
            const seen = new Set(longTerm.map((r) => r.id));
            memories = [
              ...longTerm,
              ...session.filter((r) => !seen.has(r.id))
            ];
          }
          if (!memories || memories.length === 0) {
            return {
              content: [
                { type: "text", text: "No memories stored yet." }
              ],
              details: { count: 0 }
            };
          }
          const text = memories.map(
            (r, i) => `${i + 1}. ${r.memory} (id: ${r.id})`
          ).join("\n");
          const sanitized = memories.map((r) => ({
            id: r.id,
            memory: r.memory,
            categories: r.categories,
            created_at: r.created_at
          }));
          return {
            content: [
              {
                type: "text",
                text: `${memories.length} memories:

${text}`
              }
            ],
            details: { count: memories.length, memories: sanitized }
          };
        } catch (err) {
          return {
            content: [
              {
                type: "text",
                text: `Memory list failed: ${String(err)}`
              }
            ],
            details: { error: String(err) }
          };
        }
      }
    },
    { name: "memory_list" }
  );
  api.registerTool(
    {
      name: "memory_forget",
      label: "Memory Forget",
      description: "Delete memories from Mem0. Provide a specific memoryId to delete directly, or a query to search and delete matching memories. Supports agent-scoped deletion. GDPR-compliant.",
      parameters: Type.Object({
        query: Type.Optional(
          Type.String({
            description: "Search query to find memory to delete"
          })
        ),
        memoryId: Type.Optional(
          Type.String({ description: "Specific memory ID to delete" })
        ),
        agentId: Type.Optional(
          Type.String({
            description: `Agent ID to scope deletion to a specific agent's memories (e.g. "researcher").`
          })
        )
      }),
      async execute(_toolCallId, params) {
        const { query, memoryId, agentId } = params;
        try {
          if (memoryId) {
            await provider.delete(memoryId);
            return {
              content: [
                { type: "text", text: `Memory ${memoryId} forgotten.` }
              ],
              details: { action: "deleted", id: memoryId }
            };
          }
          if (query) {
            const uid = _resolveUserId({ agentId });
            const results = await provider.search(
              query,
              buildSearchOptions(uid, 5)
            );
            if (!results || results.length === 0) {
              return {
                content: [
                  { type: "text", text: "No matching memories found." }
                ],
                details: { found: 0 }
              };
            }
            if (results.length === 1 || (results[0].score ?? 0) > 0.9) {
              await provider.delete(results[0].id);
              return {
                content: [
                  {
                    type: "text",
                    text: `Forgotten: "${results[0].memory}"`
                  }
                ],
                details: { action: "deleted", id: results[0].id }
              };
            }
            const list = results.map(
              (r) => `- [${r.id}] ${r.memory.slice(0, 80)}${r.memory.length > 80 ? "..." : ""} (score: ${((r.score ?? 0) * 100).toFixed(0)}%)`
            ).join("\n");
            const candidates = results.map((r) => ({
              id: r.id,
              memory: r.memory,
              score: r.score
            }));
            return {
              content: [
                {
                  type: "text",
                  text: `Found ${results.length} candidates. Specify memoryId to delete:
${list}`
                }
              ],
              details: { action: "candidates", candidates }
            };
          }
          return {
            content: [
              { type: "text", text: "Provide a query or memoryId." }
            ],
            details: { error: "missing_param" }
          };
        } catch (err) {
          return {
            content: [
              {
                type: "text",
                text: `Memory forget failed: ${String(err)}`
              }
            ],
            details: { error: String(err) }
          };
        }
      }
    },
    { name: "memory_forget" }
  );
}
function registerCli(api, provider, cfg, _effectiveUserId, _agentUserId, buildSearchOptions, getCurrentSessionId) {
  api.registerCli(
    ({ program }) => {
      const mem0 = program.command("mem0").description("Mem0 memory plugin commands");
      mem0.command("search").description("Search memories in Mem0").argument("<query>", "Search query").option("--limit <n>", "Max results", String(cfg.topK)).option("--scope <scope>", 'Memory scope: "session", "long-term", or "all"', "all").option("--agent <agentId>", "Search a specific agent's memory namespace").action(async (query, opts) => {
        try {
          const limit = parseInt(opts.limit, 10);
          const scope = opts.scope;
          const currentSessionId = getCurrentSessionId();
          const uid = opts.agent ? _agentUserId(opts.agent) : _effectiveUserId(currentSessionId);
          let allResults = [];
          if (scope === "session" || scope === "all") {
            if (currentSessionId) {
              const sessionResults = await provider.search(
                query,
                buildSearchOptions(uid, limit, currentSessionId)
              );
              if (sessionResults?.length) {
                allResults.push(...sessionResults.map((r) => ({ ...r, _scope: "session" })));
              }
            } else if (scope === "session") {
              console.log("No active session ID available for session-scoped search.");
              return;
            }
          }
          if (scope === "long-term" || scope === "all") {
            const longTermResults = await provider.search(
              query,
              buildSearchOptions(uid, limit)
            );
            if (longTermResults?.length) {
              allResults.push(...longTermResults.map((r) => ({ ...r, _scope: "long-term" })));
            }
          }
          if (scope === "all") {
            const seen = /* @__PURE__ */ new Set();
            allResults = allResults.filter((r) => {
              if (seen.has(r.id)) return false;
              seen.add(r.id);
              return true;
            });
          }
          if (!allResults.length) {
            console.log("No memories found.");
            return;
          }
          const output = allResults.map((r) => ({
            id: r.id,
            memory: r.memory,
            score: r.score,
            scope: r._scope,
            categories: r.categories,
            created_at: r.created_at
          }));
          console.log(JSON.stringify(output, null, 2));
        } catch (err) {
          console.error(`Search failed: ${String(err)}`);
        }
      });
      mem0.command("stats").description("Show memory statistics from Mem0").option("--agent <agentId>", "Show stats for a specific agent").action(async (opts) => {
        try {
          const uid = opts.agent ? _agentUserId(opts.agent) : cfg.userId;
          const memories = await provider.getAll({
            user_id: uid,
            source: "OPENCLAW"
          });
          console.log(`API URL: ${cfg.apiUrl}`);
          console.log(`User: ${uid}${opts.agent ? ` (agent: ${opts.agent})` : ""}`);
          console.log(
            `Total memories: ${Array.isArray(memories) ? memories.length : "unknown"}`
          );
          console.log(`Graph enabled: ${cfg.enableGraph}`);
          console.log(
            `Auto-recall: ${cfg.autoRecall}, Auto-capture: ${cfg.autoCapture}`
          );
        } catch (err) {
          console.error(`Stats failed: ${String(err)}`);
        }
      });
    },
    { commands: ["mem0"] }
  );
}
function registerHooks(api, provider, cfg, _effectiveUserId, buildAddOptions, buildSearchOptions, session) {
  if (cfg.autoRecall) {
    api.on("before_agent_start", async (event, ctx) => {
      if (!event.prompt || event.prompt.length < 5) return;
      const trigger = ctx?.trigger ?? void 0;
      const sessionId = ctx?.sessionKey ?? void 0;
      if (isNonInteractiveTrigger(trigger, sessionId)) {
        api.logger.info("openclaw-mem0: skipping recall for non-interactive trigger");
        return;
      }
      if (sessionId) session.setCurrentSessionId(sessionId);
      const isNewSession = true;
      const isSubagent = isSubagentSession(sessionId);
      const recallSessionKey = isSubagent ? void 0 : sessionId;
      try {
        const recallTopK = Math.max((cfg.topK ?? 5) * 2, 10);
        let longTermResults = await provider.search(
          event.prompt,
          buildSearchOptions(void 0, recallTopK, void 0, recallSessionKey)
        );
        const recallThreshold = Math.max(cfg.searchThreshold, 0.6);
        longTermResults = longTermResults.filter(
          (r) => (r.score ?? 0) >= recallThreshold
        );
        if (longTermResults.length > 1) {
          const topScore = longTermResults[0]?.score ?? 0;
          if (topScore > 0) {
            longTermResults = longTermResults.filter(
              (r) => (r.score ?? 0) >= topScore * 0.5
            );
          }
        }
        if (event.prompt.length < 100 || isNewSession) {
          const broadOpts = buildSearchOptions(void 0, 5, void 0, recallSessionKey);
          broadOpts.threshold = 0.5;
          const broadResults = await provider.search(
            "recent decisions, preferences, active projects, and configuration",
            broadOpts
          );
          const existingIds = new Set(longTermResults.map((r) => r.id));
          for (const r of broadResults) {
            if (!existingIds.has(r.id)) {
              longTermResults.push(r);
            }
          }
        }
        longTermResults = longTermResults.slice(0, cfg.topK);
        let sessionResults = [];
        if (sessionId) {
          sessionResults = await provider.search(
            event.prompt,
            buildSearchOptions(void 0, void 0, sessionId, recallSessionKey)
          );
          sessionResults = sessionResults.filter(
            (r) => (r.score ?? 0) >= cfg.searchThreshold
          );
        }
        const longTermIds = new Set(longTermResults.map((r) => r.id));
        const uniqueSessionResults = sessionResults.filter(
          (r) => !longTermIds.has(r.id)
        );
        if (longTermResults.length === 0 && uniqueSessionResults.length === 0) return;
        let memoryContext = "";
        if (longTermResults.length > 0) {
          memoryContext += longTermResults.map(
            (r) => `- ${r.memory}${r.categories?.length ? ` [${r.categories.join(", ")}]` : ""}`
          ).join("\n");
        }
        if (uniqueSessionResults.length > 0) {
          if (memoryContext) memoryContext += "\n";
          memoryContext += "\nSession memories:\n";
          memoryContext += uniqueSessionResults.map((r) => `- ${r.memory}`).join("\n");
        }
        const totalCount = longTermResults.length + uniqueSessionResults.length;
        api.logger.info(
          `openclaw-mem0: injecting ${totalCount} memories into context (${longTermResults.length} long-term, ${uniqueSessionResults.length} session)`
        );
        const preamble = isSubagent ? `The following are stored memories for user "${cfg.userId}". You are a subagent \u2014 use these memories for context but do not assume you are this user.` : `The following are stored memories for user "${cfg.userId}". Use them to personalize your response:`;
        return {
          prependContext: `<relevant-memories>
${preamble}
${memoryContext}
</relevant-memories>`
        };
      } catch (err) {
        api.logger.warn(`openclaw-mem0: recall failed: ${String(err)}`);
      }
    });
  }
  if (cfg.autoCapture) {
    api.on("agent_end", async (event, ctx) => {
      if (!event.success || !event.messages || event.messages.length === 0) {
        return;
      }
      const trigger = ctx?.trigger ?? void 0;
      const sessionId = ctx?.sessionKey ?? void 0;
      if (isNonInteractiveTrigger(trigger, sessionId)) {
        api.logger.info("openclaw-mem0: skipping capture for non-interactive trigger");
        return;
      }
      if (isSubagentSession(sessionId)) {
        api.logger.info("openclaw-mem0: skipping capture for subagent (main agent captures consolidated result)");
        return;
      }
      if (sessionId) session.setCurrentSessionId(sessionId);
      try {
        const SUMMARY_PATTERNS = [
          /## What I (Accomplished|Built|Updated)/i,
          /✅\s*(Done|Complete|All done)/i,
          /Here's (what I updated|the recap|a summary)/i,
          /### Changes Made/i,
          /Implementation Status/i,
          /All locked in\. Quick summary/i
        ];
        const allParsed = [];
        for (let i = 0; i < event.messages.length; i++) {
          const msg = event.messages[i];
          if (!msg || typeof msg !== "object") continue;
          const msgObj = msg;
          const role = msgObj.role;
          if (role !== "user" && role !== "assistant") continue;
          let textContent = "";
          const content = msgObj.content;
          if (typeof content === "string") {
            textContent = content;
          } else if (Array.isArray(content)) {
            for (const block of content) {
              if (block && typeof block === "object" && "text" in block && typeof block.text === "string") {
                textContent += (textContent ? "\n" : "") + block.text;
              }
            }
          }
          if (!textContent) continue;
          if (textContent.includes("<relevant-memories>")) {
            textContent = textContent.replace(/<relevant-memories>[\s\S]*?<\/relevant-memories>\s*/g, "").trim();
            if (!textContent) continue;
          }
          const isSummary = role === "assistant" && SUMMARY_PATTERNS.some((p) => p.test(textContent));
          allParsed.push({
            role,
            content: textContent,
            index: i,
            isSummary
          });
        }
        if (allParsed.length === 0) return;
        const recentWindow = 20;
        const recentCutoff = allParsed.length - recentWindow;
        const candidates = [];
        for (const msg of allParsed) {
          if (msg.isSummary && msg.index < recentCutoff) {
            candidates.push(msg);
          }
        }
        const seenIndices = new Set(candidates.map((m) => m.index));
        for (const msg of allParsed) {
          if (msg.index >= recentCutoff && !seenIndices.has(msg.index)) {
            candidates.push(msg);
          }
        }
        candidates.sort((a, b) => a.index - b.index);
        const selected = candidates.map((m) => ({
          role: m.role,
          content: m.content
        }));
        const formattedMessages = filterMessagesForExtraction(selected);
        if (formattedMessages.length === 0) return;
        if (!formattedMessages.some((m) => m.role === "user")) return;
        const timestamp = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
        formattedMessages.unshift({
          role: "system",
          content: `Current date: ${timestamp}. The user is identified as "${cfg.userId}". Extract durable facts from this conversation. Include this date when storing time-sensitive information.`
        });
        const addOpts = buildAddOptions(void 0, sessionId, sessionId);
        if (provider.recordTurn) {
          try {
            await provider.recordTurn({
              sessionId: sessionId ?? "unknown",
              userId: cfg.userId,
              agentId: sessionId ? sessionId.split(":")[1] : void 0,
              messages: formattedMessages,
              toolCallCount: event.toolCallCount,
              totalTokens: event.totalTokens
            });
          } catch (turnErr) {
            api.logger.warn(`openclaw-mem0: turn recording failed: ${String(turnErr)}`);
          }
        }
        const result = await provider.add(
          formattedMessages,
          addOpts
        );
        const capturedCount = result.results?.length ?? 0;
        if (capturedCount > 0) {
          api.logger.info(
            `openclaw-mem0: auto-captured ${capturedCount} memories`
          );
        }
      } catch (err) {
        api.logger.warn(`openclaw-mem0: capture failed: ${String(err)}`);
      }
    });
  }
}
var index_default = memoryPlugin;
export {
  agentUserId,
  createProvider,
  index_default as default,
  effectiveUserId,
  extractAgentId,
  filterMessagesForExtraction,
  isGenericAssistantMessage,
  isNoiseMessage,
  isNonInteractiveTrigger,
  isSubagentSession,
  mem0ConfigSchema,
  resolveUserId,
  stripNoiseFromContent
};
//# sourceMappingURL=index.js.map