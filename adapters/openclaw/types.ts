/**
 * Shared type definitions for the OpenClaw Mem0 plugin.
 */

// NOTE: Mem0Mode (platform | open-source) is deprecated.
// All operations now go through the OpenMemory HTTP API.
export type Mem0Mode = "platform" | "open-source";

export type Mem0Config = {
  // OpenMemory API URL
  apiUrl: string;
  // Shared settings
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

export interface AddOptions {
  user_id: string;
  run_id?: string;
  source?: string;
}

export interface SearchOptions {
  user_id: string;
  run_id?: string;
  top_k?: number;
  threshold?: number;
  limit?: number;
  keyword_search?: boolean;
  reranking?: boolean;
  source?: string;
}

export interface ListOptions {
  user_id: string;
  run_id?: string;
  page_size?: number;
  source?: string;
}

export interface MemoryItem {
  id: string;
  memory: string;
  user_id?: string;
  score?: number;
  categories?: string[];
  metadata?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}

export interface AddResultItem {
  id: string;
  memory: string;
  event: "ADD" | "UPDATE" | "DELETE" | "NOOP";
}

export interface AddResult {
  results: AddResultItem[];
}

export interface Mem0Provider {
  add(
    messages: Array<{ role: string; content: string }>,
    options: AddOptions,
  ): Promise<AddResult>;
  search(query: string, options: SearchOptions): Promise<MemoryItem[]>;
  get(memoryId: string): Promise<MemoryItem>;
  getAll(options: ListOptions): Promise<MemoryItem[]>;
  delete(memoryId: string): Promise<void>;
  // recordTurn: POST /api/v2/turns/ - 异步处理 fact/summary/graph
  recordTurn(params: {
    sessionId: string;
    userId: string;
    agentId: string;
    messages: Array<{ role: string; content: string }>;
  }): Promise<{ success: boolean; turn_id?: string }>;
}
