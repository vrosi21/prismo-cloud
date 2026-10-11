import { useCallback } from 'react'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type AssetFilter, type AssetPage } from '../api'

export const useMe = () =>
  useQuery({ queryKey: ['me'], queryFn: api.me, retry: false, staleTime: Infinity, refetchOnWindowFocus: false, refetchOnReconnect: false })

// Checked often while the worker is busy, so the status bar clears promptly.
export const useStats = () =>
  useQuery({ queryKey: ['stats'], queryFn: api.stats, refetchInterval: (q) => (q.state.data?.processing ? 2000 : 20_000) })

export const useCollections = () => useQuery({ queryKey: ['collections'], queryFn: api.collections })

export const useTokens = () => useQuery({ queryKey: ['tokens'], queryFn: api.tokens })

// Pages are chained by cursor (the id of the last item seen), not by page
// number: inserting a new upload at the top never shifts or repeats rows.
export function useAssets(filter: AssetFilter) {
  return useInfiniteQuery({
    queryKey: ['assets', filter],
    queryFn: ({ pageParam }) => api.assets(filter, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: AssetPage) => last.next_cursor ?? undefined,
    // Poll only while something on screen is still being processed.
    refetchInterval: (q) => (q.state.data?.pages.some((p) => p.assets.some((a) => a.status === 'processing')) ? 1500 : false),
  })
}

export const useShared = () => useQuery({ queryKey: ['shared'], queryFn: api.shared })

// Key starts with 'assets' on purpose: whatever refreshes the library
// refreshes an open shared jar as well.
export function useSharedJarAssets(id: string, filter: AssetFilter) {
  return useInfiniteQuery({
    queryKey: ['assets', 'shared-jar', id, filter],
    queryFn: ({ pageParam }) => api.sharedJarAssets(id, filter, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    refetchInterval: (q) => (q.state.data?.pages.some((p) => p.assets.some((a) => a.status === 'processing')) ? 1500 : false),
  })
}

// Everything that shows assets or counts of them.
export function useRefreshLibrary() {
  const qc = useQueryClient()
  return useCallback(() => {
    void qc.invalidateQueries({ queryKey: ['assets'] })
    void qc.invalidateQueries({ queryKey: ['collections'] })
    void qc.invalidateQueries({ queryKey: ['stats'] })
    void qc.invalidateQueries({ queryKey: ['shared'] })
  }, [qc])
}
