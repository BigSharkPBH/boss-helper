import { ref } from 'vue'

import { counter } from '@/message'
import type {
  TokenUsageKind,
  TokenUsageRecord,
  TokenUsageSummary,
  TokenUsageWindow,
} from '@/types/tokenUsage'
import { getUuid } from '@/utils'
import { jsonClone } from '@/utils/deepmerge'
import { logger } from '@/utils/logger'

export const tokenUsageKey = 'local:token-usage'

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const MAX_RECORDS = 5000

function emptyKindSummary(): Omit<TokenUsageSummary, 'byKind'> {
  return { calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 }
}

function startOfLocalDay(date = new Date()): Date {
  const start = new Date(date)
  start.setHours(0, 0, 0, 0)
  return start
}

export function tokenUsageWindowStart(days: TokenUsageWindow, now = Date.now()): number {
  const start = startOfLocalDay(new Date(now))
  start.setDate(start.getDate() - (days - 1))
  return start.getTime()
}

export function summarizeTokenUsage(records: TokenUsageRecord[]): TokenUsageSummary {
  const summary: TokenUsageSummary = {
    ...emptyKindSummary(),
    byKind: {
      aiFiltering: emptyKindSummary(),
      aiGreeting: emptyKindSummary(),
    },
  }

  for (const record of records) {
    const prompt = record.promptTokens ?? 0
    const completion = record.completionTokens ?? 0
    const total = record.totalTokens ?? prompt + completion
    summary.calls += 1
    summary.promptTokens += prompt
    summary.completionTokens += completion
    summary.totalTokens += total

    const kind = summary.byKind[record.kind]
    kind.calls += 1
    kind.promptTokens += prompt
    kind.completionTokens += completion
    kind.totalTokens += total
  }

  return summary
}

function pruneRecords(list: TokenUsageRecord[], now = Date.now()): TokenUsageRecord[] {
  const cutoff = now - RETENTION_MS
  const kept = list.filter((item) => item.time >= cutoff)
  if (kept.length <= MAX_RECORDS) return kept
  return kept.slice(kept.length - MAX_RECORDS)
}

export function useTokenUsage(getUid: () => string) {
  const records = ref<TokenUsageRecord[]>([])
  const ready = ref(false)
  let loadedUid = ''
  let opChain = Promise.resolve()

  function currentUid() {
    return getUid() || 'anon'
  }

  function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const next = opChain.then(fn, fn)
    opChain = next.then(
      () => undefined,
      (error) => {
        logger.error('Token usage 操作失败', error)
      },
    )
    return next
  }

  async function persist(uid: string, list: TokenUsageRecord[]) {
    const all = await counter.storageGet<Record<string, TokenUsageRecord[]>>(tokenUsageKey, {})
    await counter.storageSet(tokenUsageKey, {
      ...all,
      [uid]: jsonClone(list),
    })
  }

  async function loadUnlocked() {
    const uid = currentUid()
    const all = await counter.storageGet<Record<string, TokenUsageRecord[]>>(tokenUsageKey, {})
    const next = pruneRecords(all[uid] ?? [])
    records.value = next
    loadedUid = uid
    ready.value = true
    if (next.length !== (all[uid]?.length ?? 0)) {
      await persist(uid, next)
    }
  }

  async function ensureLoadedUnlocked() {
    if (!ready.value || loadedUid !== currentUid()) {
      await loadUnlocked()
    }
  }

  function load() {
    return runExclusive(async () => {
      try {
        await loadUnlocked()
      } catch (error) {
        logger.error('Token usage 加载失败', error)
      }
    })
  }

  function record(entry: Omit<TokenUsageRecord, 'id'> & { kind: TokenUsageKind }) {
    return runExclusive(async () => {
      try {
        await ensureLoadedUnlocked()
        const next = pruneRecords([
          ...records.value,
          {
            ...entry,
            id: getUuid(16, 16),
          },
        ])
        records.value = next
        await persist(currentUid(), next)
      } catch (error) {
        logger.error('Token usage 记录失败', error)
      }
    })
  }

  function clear() {
    return runExclusive(async () => {
      try {
        await ensureLoadedUnlocked()
        records.value = []
        await persist(currentUid(), [])
      } catch (error) {
        logger.error('Token usage 清空失败', error)
      }
    })
  }

  return {
    records,
    ready,
    load,
    record,
    clear,
  }
}
