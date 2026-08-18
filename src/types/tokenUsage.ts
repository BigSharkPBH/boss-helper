export type TokenUsageKind = 'aiFiltering' | 'aiGreeting'

export type TokenUsageWindow = 1 | 3 | 7

export interface TokenUsageRecord {
  id: string
  time: number
  kind: TokenUsageKind
  model: string
  modelName?: string
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
  jobTitle?: string
  jobKey?: string
}

export interface TokenUsageSummary {
  calls: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  byKind: Record<TokenUsageKind, Omit<TokenUsageSummary, 'byKind'>>
}
