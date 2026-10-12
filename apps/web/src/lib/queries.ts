import { useCallback, useMemo } from 'react'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type AssetFilter, type AssetPage, type Folder } from '../api'
import { buildTree } from './folders'

export const useMe = () =>
  useQuery({ queryKey: ['me'], queryFn: api.me, retry: false, staleTime: Infinity, refetchOnWindowFocus: false, refetchOnReconnect: false })

// Checked often while the worker is busy, so the status bar clears promptly.
export const useStats = () =>
  useQuery({ queryKey: ['stats'], queryFn: api.stats, refetchInterval: (q) => (q.state.data?.processing ? 2000 : 20_000) })

const NO_FOLDERS: Folder[] = []

export const useFolders = () => useQuery({ queryKey: ['folders'], queryFn: api.folders })

/** The signed-in person's folders as a tree. Rebuilt only when the list changes. */
export function useFolderTree() {
  const { data = NO_FOLDERS } = useFolders()
  return useMemo(() => buildTree(data), [data])
}

export const useTokens = () => useQuery({ queryKey: ['tokens'], queryFn: api.tokens })

const processing = (pages: AssetPage[] | undefined) => pages?.some((p) => p.assets.some((a) => a.status === 'processing')) ?? false

// Pages are chained by cursor (the id of the last item seen), not by page
// number: inserting a new upload at the top never shifts or repeats rows.
export function useAssets(filter: AssetFilter) {
  return useInfiniteQuery({
    queryKey: ['assets', filter],
    queryFn: ({ pageParam }) => api.assets(filter, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: AssetPage) => last.next_cursor ?? undefined,
    // Poll only while something on screen is still being processed.
    refetchInterval: (q) => (processing(q.state.data?.pages) ? 1500 : false),
  })
}

export const useShared = () => useQuery({ queryKey: ['shared'], queryFn: api.shared })

// Key starts with 'assets' on purpose: whatever refreshes the library
// refreshes an open shared folder as well.
export function useSharedFolder(id: string, filter: AssetFilter) {
  return useInfiniteQuery({
    queryKey: ['assets', 'shared-folder', id, filter],
    queryFn: ({ pageParam }) => api.sharedFolder(id, filter, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    refetchInterval: (q) => (processing(q.state.data?.pages) ? 1500 : false),
  })
}

// Everything that shows files, folders or counts of them.
export function useRefreshLibrary() {
  const qc = useQueryClient()
  return useCallback(() => {
    void qc.invalidateQueries({ queryKey: ['assets'] })
    void qc.invalidateQueries({ queryKey: ['folders'] })
    void qc.invalidateQueries({ queryKey: ['stats'] })
    void qc.invalidateQueries({ queryKey: ['shared'] })
  }, [qc])
}
