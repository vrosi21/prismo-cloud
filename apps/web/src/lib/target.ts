import { useEffect } from 'react'
import { createStore } from './store'

// Where a dropped, pasted or picked file goes. The page on screen knows
// (the open folder, a shared folder that allows adding), the upload button
// and the drop handler in the app shell need to know; this is how they meet.

export interface UploadTarget {
  /** Folder id, or null for "in no folder". */
  folderId: string | null
  /** false: nothing can be added here (a view-only share, the trash). */
  allowed: boolean
}

export const uploadTarget = createStore<UploadTarget | null>(null)

/** Declares the upload target for as long as the calling page is shown. */
export function useUploadTarget(folderId: string | null, allowed: boolean) {
  useEffect(() => {
    uploadTarget.set({ folderId, allowed })
    return () => uploadTarget.set(null)
  }, [folderId, allowed])
}
