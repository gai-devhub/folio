'use client'

import { createContext, ReactNode, useContext, useEffect, useState } from 'react'

export type FolderSummary = { name: string; count: number; date?: string }
export type ManifestItem = { name: string; folder: string; reason: string; size?: number; extension?: string; date?: string }
export type Organization = {
  count: number
  folders: FolderSummary[]
  blob?: string
  manifest?: ManifestItem[]
  mode: 'upload' | 'local'
  targetPath?: string
  date?: string
}

export type OrganizedFolderRecord = {
  id: string
  name: string
  date: string // ISO date string
  count: number
  files: ManifestItem[]
  mode: 'upload' | 'local'
  targetPath?: string
}

export type LocalFileItem = {
  name: string
  path: string
  size: number
  extension: string
}

type WorkspaceValue = {
  files: File[]
  setFiles: (files: File[]) => void
  organization: Organization | null
  folderHistory: OrganizedFolderRecord[]
  error: string
  busy: boolean
  localTarget: string
  setLocalTarget: (path: string) => void
  localScanResults: LocalFileItem[]
  currentFolder: string | null
  setCurrentFolder: (folder: string | null) => void
  currentFile: string | null
  setCurrentFile: (file: string | null) => void
  organize: () => Promise<boolean>
  scanLocalFolder: (path?: string) => Promise<boolean>
  organizeLocalFolder: (path?: string, dryRun?: boolean) => Promise<boolean>
  clear: () => void
  clearMemory: () => void
}

const WorkspaceContext = createContext<WorkspaceValue | null>(null)
const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [files, setFiles] = useState<File[]>([])
  const [organization, setOrganization] = useState<Organization | null>(null)
  const [folderHistory, setFolderHistory] = useState<OrganizedFolderRecord[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [localTarget, setLocalTarget] = useState('Desktop')
  const [localScanResults, setLocalScanResults] = useState<LocalFileItem[]>([])
  const [currentFolder, setCurrentFolder] = useState<string | null>(null)
  const [currentFile, setCurrentFile] = useState<string | null>(null)

  function getUser() {
    try {
      return JSON.parse(localStorage.getItem('folio-user') || 'null')
    } catch {
      return null
    }
  }

  // Load user's persistent memory on mount / user change
  useEffect(() => {
    const preferredLocalTarget = localStorage.getItem('folio-local-target')
    if (preferredLocalTarget) setLocalTarget(preferredLocalTarget)
    const user = getUser()
    if (!user?.username) return

    try {
      const memoryKey = `folio_memory_${user.username}`
      const savedMemory = localStorage.getItem(memoryKey)
      if (savedMemory) {
        const parsed: OrganizedFolderRecord[] = JSON.parse(savedMemory)
        if (Array.isArray(parsed) && parsed.length > 0) {
          setFolderHistory(parsed)

          // If no active organization in React state, restore from user memory
          setOrganization((current) => {
            if (current) return current

            // Merge all historical folders
            const allFolders: FolderSummary[] = parsed.map((f) => ({
              name: f.name,
              count: f.count,
              date: f.date,
            }))

            const allManifest: ManifestItem[] = []
            parsed.forEach((f) => {
              if (Array.isArray(f.files)) {
                allManifest.push(...f.files)
              }
            })

            const totalCount = allManifest.length || parsed.reduce((sum, f) => sum + f.count, 0)
            const latestTargetPath = parsed.find((f) => f.targetPath)?.targetPath

            return {
              count: totalCount,
              folders: allFolders,
              manifest: allManifest,
              mode: parsed[0]?.mode || 'local',
              targetPath: latestTargetPath,
              date: parsed[0]?.date,
            }
          })
        }
      }
    } catch (e) {
      console.warn('Could not read user memory from localStorage', e)
    }
  }, [])

  function persistToUserMemory(newFolders: FolderSummary[], manifest: ManifestItem[], mode: 'upload' | 'local', targetPath?: string) {
    const user = getUser()
    if (!user?.username) return

    const nowIso = new Date().toISOString()
    const newRecords: OrganizedFolderRecord[] = newFolders.map((f) => ({
      id: `${f.name}-${Date.now()}`,
      name: f.name,
      date: nowIso,
      count: f.count,
      files: manifest.filter((m) => m.folder === f.name).map((m) => ({ ...m, date: nowIso })),
      mode,
      targetPath,
    }))

    setFolderHistory((prev) => {
      // Merge with existing: if folder with same name exists, update files and bump date
      const updated = [...newRecords]
      const newNames = new Set(newRecords.map((r) => r.name))

      prev.forEach((oldRecord) => {
        if (!newNames.has(oldRecord.name)) {
          updated.push(oldRecord)
        }
      })

      try {
        localStorage.setItem(`folio_memory_${user.username}`, JSON.stringify(updated))
      } catch (err) {
        console.warn('Could not save user memory to localStorage', err)
      }
      return updated
    })
  }

  async function organize(): Promise<boolean> {
    const user = getUser()
    if (!user || files.length === 0) {
      setError('Choose at least one file first.')
      return false
    }
    setBusy(true)
    setError('')
    const form = new FormData()
    files.forEach((file) =>
      form.append('files', file, (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name)
    )
    try {
      const response = await fetch(`${API}/api/organize`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${user.token}` },
        body: form,
      })
      if (!response.ok) {
        const body = await response.json()
        throw new Error(body.detail || 'Organization failed.')
      }
      const folders: FolderSummary[] = JSON.parse(response.headers.get('X-Organization-Summary') || '[]')
      let manifest: ManifestItem[] = []
      try {
        manifest = JSON.parse(response.headers.get('X-Organization-Manifest') || '[]')
      } catch {
        manifest = []
      }
      const blob = await response.blob()
      const nowIso = new Date().toISOString()
      const next: Organization = {
        count: Number(response.headers.get('X-Organized-Count') || files.length),
        folders: folders.map((f) => ({ ...f, date: nowIso })),
        manifest: manifest.map((m) => ({ ...m, date: nowIso })),
        blob: URL.createObjectURL(blob),
        mode: 'upload',
        date: nowIso,
      }
      setOrganization((previous) => {
        if (previous?.blob) URL.revokeObjectURL(previous.blob)
        return next
      })

      // Persist to user memory
      persistToUserMemory(folders, manifest, 'upload')

      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not connect to the organizer server.')
      return false
    } finally {
      setBusy(false)
    }
  }

  async function scanLocalFolder(path?: string): Promise<boolean> {
    const user = getUser()
    if (!user) {
      setError('Please sign in first.')
      return false
    }
    const target = path || localTarget || 'Desktop'
    setBusy(true)
    setError('')
    try {
      const response = await fetch(`${API}/api/local/scan`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${user.token}`,
        },
        body: JSON.stringify({ path: target }),
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.detail || 'Could not scan local folder.')
      }
      setLocalScanResults(data.files || [])
      setLocalTarget(data.target_path || target)
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not scan local folder.')
      return false
    } finally {
      setBusy(false)
    }
  }

  async function organizeLocalFolder(path?: string, dryRun: boolean = false): Promise<boolean> {
    const user = getUser()
    if (!user) {
      setError('Please sign in first.')
      return false
    }
    const target = path || localTarget || 'Desktop'
    setBusy(true)
    setError('')
    try {
      const response = await fetch(`${API}/api/local/organize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${user.token}`,
        },
        body: JSON.stringify({ path: target, dry_run: dryRun }),
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.detail || 'Could not organize folder.')
      }
      const nowIso = new Date().toISOString()
      const nextFolders: FolderSummary[] = (data.folders || []).map((f: FolderSummary) => ({ ...f, date: nowIso }))
      const nextManifest: ManifestItem[] = (data.manifest || []).map((m: ManifestItem) => ({ ...m, date: nowIso }))

      const next: Organization = {
        count: data.moved_count || 0,
        folders: nextFolders,
        manifest: nextManifest,
        mode: 'local',
        targetPath: data.target_path,
        date: nowIso,
      }
      setOrganization(next)

      // Persist to user memory
      if (!dryRun) {
        persistToUserMemory(nextFolders, nextManifest, 'local', data.target_path)
      }

      // refresh scan
      if (!dryRun) {
        scanLocalFolder(target)
      }
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not organize folder.')
      return false
    } finally {
      setBusy(false)
    }
  }

  function clear() {
    setFiles([])
    setOrganization(null)
    setLocalScanResults([])
    setCurrentFolder(null)
    setCurrentFile(null)
    setError('')
  }

  function clearMemory() {
    const user = getUser()
    if (user?.username) {
      try {
        localStorage.removeItem(`folio_memory_${user.username}`)
      } catch {}
    }
    setFolderHistory([])
    setOrganization(null)
    setCurrentFolder(null)
    setCurrentFile(null)
  }

  return (
    <WorkspaceContext.Provider
      value={{
        files,
        setFiles,
        organization,
        folderHistory,
        error,
        busy,
        localTarget,
        setLocalTarget,
        localScanResults,
        currentFolder,
        setCurrentFolder,
        currentFile,
        setCurrentFile,
        organize,
        scanLocalFolder,
        organizeLocalFolder,
        clear,
        clearMemory,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  )
}

export function useWorkspace() {
  const value = useContext(WorkspaceContext)
  if (!value) throw new Error('useWorkspace must be used inside WorkspaceProvider')
  return value
}
