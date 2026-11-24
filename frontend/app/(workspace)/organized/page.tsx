'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import GilAssistantPanel, { type GilModel, type GilThinkingLevel } from '@/components/GilAssistantPanel'
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  BookOpen,
  Check,
  ChevronRight,
  Download,
  LoaderCircle,
  Sparkles,
  X,
} from 'lucide-react'
import { useWorkspace, ManifestItem, FolderSummary } from '@/components/WorkspaceProvider'
import FolioIcon from '@/components/FolioIcon'
import aiIconWhite from '@/assets/ai/icon-white.png'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

function isImageFile(name: string) {
  return /\.(png|jpe?g|webp|gif|svg|bmp)$/i.test(name)
}

function getFileType(filename: string): 'image' | 'pptx' | 'pdf' | 'docx' | 'sheet' | 'file' {
  const lower = filename.toLowerCase()
  if (isImageFile(lower)) return 'image'
  if (/\.(pptx|ppt|key)$/i.test(lower)) return 'pptx'
  if (/\.(pdf)$/i.test(lower)) return 'pdf'
  if (/\.(docx?|odt|rtf|txt|md)$/i.test(lower)) return 'docx'
  if (/\.(xlsx?|csv)$/i.test(lower)) return 'sheet'
  return 'file'
}

type PreviewResult = {
  filename: string
  folder: string
  summary: string
  key_points: string[]
  folder_relevance: string
  content_preview: string
  image_data?: string | null
  is_image?: boolean
  ai_powered: boolean
}

type ChatMessage = {
  role: 'user' | 'assistant'
  content: string
}

type DateCategory = 'Today' | 'Yesterday' | 'Previous 7 Days' | 'Previous 30 Days' | 'Older'
type ArchiveBatch = { id: number; date: string; file_count: number; archive_available: boolean }

function getDateCategory(dateStr?: string): DateCategory {
  if (!dateStr) return 'Today'
  const date = new Date(dateStr)
  if (isNaN(date.getTime())) return 'Today'
  const now = new Date()

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startOfItem = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()

  const diffDays = Math.floor((startOfToday - startOfItem) / (1000 * 60 * 60 * 24))

  if (diffDays <= 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays <= 7) return 'Previous 7 Days'
  if (diffDays <= 30) return 'Previous 30 Days'
  return 'Older'
}

function FinderFileThumbnail({
  filename,
  folder,
  targetPath,
  uploadedSrc,
}: {
  filename: string
  folder: string
  targetPath?: string
  uploadedSrc?: string
}) {
  const [imgFailed, setImgFailed] = useState(false)

  // Direct image preview if uploaded
  if (uploadedSrc) {
    return (
      <div className="finder-thumb-wrap">
        <img src={uploadedSrc} alt={filename} className="finder-thumb-img" />
      </div>
    )
  }

  const thumbUrl = `${API}/api/file/thumbnail?filename=${encodeURIComponent(filename)}&folder=${encodeURIComponent(folder)}${targetPath ? `&path=${encodeURIComponent(targetPath)}` : ''}`

  if (!imgFailed) {
    return (
      <div className="finder-thumb-wrap">
        <img
          src={thumbUrl}
          alt={filename}
          className="finder-thumb-img"
          onError={() => setImgFailed(true)}
        />
      </div>
    )
  }

  const ext = filename.split('.').pop()?.toUpperCase() || 'DOC'
  return (
    <div className="finder-thumb-wrap">
      <div className="finder-fallback-doc">
        <FolioIcon name="file" size={34} />
        <span style={{ fontSize: '9px', fontWeight: 700, color: '#3d5c34', marginTop: '6px' }}>
          {ext}
        </span>
      </div>
    </div>
  )
}

export default function OrganizedPage() {
  const router = useRouter()
  const {
    organization,
    folderHistory,
    clearMemory,
    files,
    currentFolder,
    setCurrentFolder,
    currentFile,
    setCurrentFile,
  } = useWorkspace()

  const [isModalOpen, setIsModalOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [isDownloadModalOpen, setIsDownloadModalOpen] = useState(false)
  const [archiveBatches, setArchiveBatches] = useState<ArchiveBatch[]>([])
  const [loadingArchives, setLoadingArchives] = useState(false)
  const [archiveError, setArchiveError] = useState('')
  const [downloadingPeriod, setDownloadingPeriod] = useState<string | null>(null)

  // Right-hand Side Reader & AI Summarizer Drawer
  const [isSidePanelOpen, setIsSidePanelOpen] = useState(false)
  const [activeFile, setActiveFile] = useState<{ filename: string; folder: string } | null>(null)
  const [previewData, setPreviewData] = useState<PreviewResult | null>(null)
  const [loadingPreview, setLoadingPreview] = useState(false)

  // Interactive Ask AI Chat state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [sendingChat, setSendingChat] = useState(false)

  const manifest = organization?.manifest || []

  // Create fast object URLs for image preview
  const imageThumbnailMap = useMemo(() => {
    const map: Record<string, string> = {}
    files.forEach((f) => {
      if (isImageFile(f.name)) {
        try {
          map[f.name] = URL.createObjectURL(f)
        } catch {}
      }
    })
    return map
  }, [files])

  // Group manifest files by folder
  const filesByFolder: Record<string, ManifestItem[]> = useMemo(() => {
    const map: Record<string, ManifestItem[]> = {}
    manifest.forEach((item) => {
      if (!map[item.folder]) map[item.folder] = []
      map[item.folder].push(item)
    })
    return map
  }, [manifest])

  // Group folders into macOS Finder style date categories: Today, Yesterday, Previous 7 Days, etc.
  const foldersByDate = useMemo(() => {
    const categories: Record<DateCategory, FolderSummary[]> = {
      Today: [],
      Yesterday: [],
      'Previous 7 Days': [],
      'Previous 30 Days': [],
      Older: [],
    }

    const folderList = organization?.folders || []
    folderList.forEach((folder) => {
      const record = folderHistory.find((h) => h.name === folder.name)
      const dateStr = folder.date || record?.date
      const cat = getDateCategory(dateStr)
      categories[cat].push(folder)
    })

    const orderedCategories: DateCategory[] = ['Today', 'Yesterday', 'Previous 7 Days', 'Previous 30 Days', 'Older']
    return orderedCategories
      .filter((cat) => categories[cat].length > 0)
      .map((cat) => ({
        category: cat,
        folders: categories[cat],
      }))
  }, [organization, folderHistory])

  // Close modals/drawers on Escape key
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setIsModalOpen(false)
        setIsDownloadModalOpen(false)
        setIsSidePanelOpen(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  function openDocumentPage(filename: string, folder: string) {
    setCurrentFile(filename)
    router.push(`/preview?filename=${encodeURIComponent(filename)}&folder=${encodeURIComponent(folder)}`)
  }

  async function openDownloadModal() {
    setIsDownloadModalOpen(true)
    setLoadingArchives(true)
    setArchiveError('')
    try {
      const user = JSON.parse(localStorage.getItem('folio-user') || 'null')
      const response = await fetch(`${API}/api/organize/archives`, {
        headers: { Authorization: `Bearer ${user?.token || ''}` },
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.detail || 'Could not load download history.')
      setArchiveBatches(Array.isArray(data.batches) ? data.batches : [])
    } catch (error) {
      setArchiveError(error instanceof Error ? error.message : 'Could not load download history.')
    } finally {
      setLoadingArchives(false)
    }
  }

  async function downloadArchivePeriod(period: string, batches: ArchiveBatch[]) {
    const available = batches.filter((batch) => batch.archive_available)
    if (!available.length || downloadingPeriod) return
    setDownloadingPeriod(period)
    setArchiveError('')
    try {
      const user = JSON.parse(localStorage.getItem('folio-user') || 'null')
      const response = await fetch(`${API}/api/organize/archives/download`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${user?.token || ''}`,
        },
        body: JSON.stringify({ job_ids: available.map((batch) => batch.id) }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.detail || 'Could not download these organized files.')
      }
      const archiveUrl = URL.createObjectURL(await response.blob())
      const link = document.createElement('a')
      link.href = archiveUrl
      link.download = `folio-organized-${period.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.zip`
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(archiveUrl), 1000)
      setIsDownloadModalOpen(false)
    } catch (error) {
      setArchiveError(error instanceof Error ? error.message : 'Could not download these organized files.')
    } finally {
      setDownloadingPeriod(null)
    }
  }

  const dateGroups = useMemo(() => {
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)
    const weekAgo = new Date(today)
    weekAgo.setDate(weekAgo.getDate() - 6)
    const monthAgo = new Date(today)
    monthAgo.setDate(monthAgo.getDate() - 29)
    const previousMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const normalizedDate = (batch: ArchiveBatch) => {
      const value = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(batch.date) ? batch.date : `${batch.date}Z`
      return new Date(value)
    }
    const definitions = [
      { key: 'today', label: 'Today', detail: 'Files organized today', includes: (date: Date) => date >= today && date <= now },
      { key: 'yesterday', label: 'Yesterday', detail: 'Files organized yesterday', includes: (date: Date) => date >= yesterday && date < today },
      { key: 'last-week', label: 'Last 7 days', detail: 'Today and the previous 6 days', includes: (date: Date) => date >= weekAgo && date <= now },
      { key: 'last-month', label: 'Last 30 days', detail: 'Today and the previous 29 days', includes: (date: Date) => date >= monthAgo && date <= now },
      { key: 'previous-month', label: 'Previous month', detail: 'The previous calendar month', includes: (date: Date) => date >= previousMonthStart && date < thisMonthStart },
    ]
    return definitions.map((definition) => ({
      ...definition,
      batches: archiveBatches.filter((batch) => batch.archive_available && definition.includes(normalizedDate(batch))),
    }))
  }, [archiveBatches])

  async function handleOpenFile(filename: string, folder: string) {
    setActiveFile({ filename, folder })
    setCurrentFile(filename)
    setIsSidePanelOpen(true)
    setLoadingPreview(true)
    setPreviewData(null)
    setChatMessages([])

    try {
      const user = JSON.parse(localStorage.getItem('folio-user') || 'null')
      const token = user?.token || ''

      // Check if file is in the uploaded files list
      const matchedUpload = files.find((f) => f.name === filename)

      if (matchedUpload) {
        const formData = new FormData()
        formData.append('file', matchedUpload)
        formData.append('folder', folder)
        formData.append('custom_instructions', localStorage.getItem('folio-ai-instructions') || '')
        const res = await fetch(`${API}/api/file/preview`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        })
        if (res.ok) {
          const data = await res.json()
          setPreviewData(data)
          return
        }
      }

      // Try local file preview
      const localRes = await fetch(`${API}/api/local/file/preview`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          path: organization?.targetPath || null,
          filename,
          folder,
          custom_instructions: localStorage.getItem('folio-ai-instructions') || '',
        }),
      })

      if (localRes.ok) {
        const data = await localRes.json()
        setPreviewData(data)
      } else {
        // Fallback: extract summary from manifest item
        const manifestItem = manifest.find((m) => m.name === filename)
        setPreviewData({
          filename,
          folder,
          summary: manifestItem?.reason || 'File organized by Folio.',
          key_points: [
            `Classified under ${folder} based on extracted contents.`,
            `File size: ${manifestItem?.size ? (manifestItem.size / 1024).toFixed(1) + ' KB' : 'Standard'}`,
            `Document ready for reading and course review.`,
          ],
          folder_relevance: `Organized into ${folder}.`,
          content_preview: `Preview for ${filename}\n\nFolder: ${folder}\nReason: ${manifestItem?.reason || 'Content context similarity'}`,
          ai_powered: false,
        })
      }
    } catch {
      const manifestItem = manifest.find((m) => m.name === filename)
      setPreviewData({
        filename,
        folder,
        summary: manifestItem?.reason || 'Organized file ready for review.',
        key_points: [`Belongs to ${folder}`, 'Content extracted and sorted.'],
        folder_relevance: `Categorized into ${folder}`,
        content_preview: `Summary of ${filename}\nFolder: ${folder}\n${manifestItem?.reason || ''}`,
        ai_powered: false,
      })
    } finally {
      setLoadingPreview(false)
    }
  }

  async function handleSendChat(customMessage?: string, assistantMode: GilModel = 'auto', thinkingLevel: GilThinkingLevel = 'medium', customInstructions = '', attachmentContext = '') {
    const text = (customMessage || chatInput).trim()
    const attachedFilename = attachmentContext.match(/^Additional file attached: ([^\n]+)/)?.[1]
    const chatFile = activeFile || (attachedFilename ? { filename: attachedFilename, folder: '' } : null)
    if (!text || !chatFile || sendingChat) return

    const newHistory: ChatMessage[] = [...chatMessages, { role: 'user', content: text }]
    setChatMessages(newHistory)
    setChatInput('')
    setSendingChat(true)

    try {
      const user = JSON.parse(localStorage.getItem('folio-user') || 'null')
      const token = user?.token || ''

      const res = await fetch(`${API}/api/file/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          filename: chatFile.filename,
          folder: chatFile.folder,
          content: previewData?.content_preview || previewData?.summary || '',
          message: text,
          assistant_mode: assistantMode,
          thinking_level: thinkingLevel,
          custom_instructions: customInstructions,
          attachment_context: attachmentContext,
          history: newHistory.map((m) => ({ role: m.role, content: m.content })),
        }),
      })

      if (res.ok) {
        const data = await res.json()
        setChatMessages((prev) => [...prev, { role: 'assistant', content: data.reply }])
      } else {
        setChatMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: "I couldn't reach the Gemini AI model right now. Please check your internet connection and try again.",
          },
        ])
      }
    } catch {
      setChatMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: 'Error communicating with Folio AI. Please try again in a moment.',
        },
      ])
    } finally {
      setSendingChat(false)
    }
  }

  const filteredManifest = manifest.filter((item) => {
    if (!searchQuery.trim()) return true
    const q = searchQuery.toLowerCase()
    return (
      item.name.toLowerCase().includes(q) ||
      item.folder.toLowerCase().includes(q) ||
      (item.reason && item.reason.toLowerCase().includes(q))
    )
  })

  // Selected folder items
  const activeFolderFiles = currentFolder ? filesByFolder[currentFolder] || [] : []

  return (
    <div className="content-wrap organized-page-content" style={{ position: 'relative' }}>
      <div className="greeting">
        <div>
          <div className="eyebrow">
            {currentFolder ? `STEP 3 · ${currentFolder.toUpperCase()}` : 'STEP 3 · YOUR RESULT'}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '8px', marginBottom: '6px' }}>
            {currentFolder && (
              <button
                type="button"
                className="greeting-back-btn"
                onClick={() => {
                  setCurrentFolder(null)
                  setCurrentFile(null)
                }}
                title="Back to all folders"
                aria-label="Back to all folders"
              >
                <ArrowLeft size={18} />
              </button>
            )}
            <h1 style={{ margin: 0 }}>
              Your files found <em>their place.</em>
            </h1>
          </div>
          <p>
            {organization?.mode === 'local'
              ? 'The files have been sorted and moved into context-based folders on your disk.'
              : 'Folders are organized by course context. Click any folder or file to explore.'}
          </p>
        </div>
        <div className="greeting-icon">
          <img src="/folio-folder-icon.png" alt="Folio" style={{ width: '28px', height: '24px', objectFit: 'contain' }} />
        </div>
      </div>

      {organization ? (
        <div className="folder-grid-view-wrap">
          {/* LEVEL 1: ALL FOLDERS GROUPED BY DATE (macOS Finder Style: Today, Yesterday, Previous 7 Days) */}
          {!currentFolder && (
            <div>
              {foldersByDate.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px', color: '#8c9588', fontSize: '12px' }}>
                  No organized folders in memory yet.
                </div>
              ) : (
                foldersByDate.map(({ category, folders }) => (
                  <div key={category} className="date-group-section">
                    <div className="date-group-header">
                      <h3 className="date-group-title">{category}</h3>
                      <span className="date-group-badge">
                        {folders.length} {folders.length === 1 ? 'folder' : 'folders'}
                      </span>
                      <div className="date-group-divider" />
                    </div>

                    <div className="finder-folder-grid">
                      {folders.map((folder) => (
                        <div
                          key={folder.name}
                          className="finder-folder-item"
                          onClick={() => {
                            setCurrentFolder(folder.name)
                            setCurrentFile(null)
                          }}
                          title={`Open ${folder.name}`}
                        >
                          <div className="finder-folder-icon-wrap">
                            <img
                              src="/folio-folder-icon.png"
                              alt={folder.name}
                              className="finder-folder-icon"
                            />
                          </div>
                          <span className="finder-folder-name">{folder.name}</span>
                          <span className="finder-folder-count">
                            {folder.count} {folder.count === 1 ? 'item' : 'items'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* LEVEL 2: INSIDE FOLDER VIEW WITH FILE THUMBNAILS (shown when currentFolder is selected) */}
          {currentFolder && (
            <div>
              {activeFolderFiles.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px', color: '#8c9588', fontSize: '12px' }}>
                  No files found in this folder.
                </div>
              ) : (
                <div className="finder-file-grid">
                  {activeFolderFiles.map((file) => {
                    const isActive = currentFile === file.name
                    const uploadedSrc = isImageFile(file.name) ? imageThumbnailMap[file.name] : undefined

                    return (
                      <div
                        key={file.name}
                        className={`finder-file-card ${isActive ? 'active-file' : ''}`}
                        onClick={() => openDocumentPage(file.name, currentFolder)}
                        title={`Open ${file.name}`}
                      >
                        <FinderFileThumbnail
                          filename={file.name}
                          folder={currentFolder}
                          targetPath={organization?.targetPath}
                          uploadedSrc={uploadedSrc}
                        />
                        <span className="finder-filename">{file.name}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* Quick links footer */}
          <div className="organized-page-actions" style={{ display: 'flex', gap: '10px', marginTop: '26px', alignItems: 'center', flexWrap: 'wrap' }}>
            <button type="button" className="quiet-button" onClick={openDownloadModal}>
              <ArrowDownToLine size={15} /> Download organized ZIPs
            </button>
          </div>
        </div>
      ) : (
        <section className="upload-card empty-state">
          <div className="upload-icon">
            <FolioIcon name="folder" size={30} />
          </div>
          <h2>No organized batch yet</h2>
          <p>Choose or scan files first, then Folio will show the new folders and download package here.</p>
          <Link className="primary" href="/uploads">
            Go to uploads <ArrowRight size={15} />
          </Link>
        </section>
      )}

      {/* Persistent Right-Hand Side Toggle Button */}
      {manifest.length > 0 && (
        <button
          type="button"
          className="side-reader-tab-btn"
          onClick={() => setIsSidePanelOpen(!isSidePanelOpen)}
          title="Ask Gil about your files"
        >
          <Image src={aiIconWhite} alt="" width={21} height={21} className="ask-gil-tab-logo" />
          <span className="side-reader-tab-text">Ask Gil</span>
        </button>
      )}

      {isSidePanelOpen && (
        <GilAssistantPanel
          filename={activeFile?.filename}
          folder={activeFile?.folder}
          summary={previewData?.summary}
          keyPoints={previewData?.key_points}
          folderRelevance={previewData?.folder_relevance}
          loading={loadingPreview}
          messages={chatMessages}
          input={chatInput}
          sending={sendingChat}
          onInputChange={setChatInput}
          onSend={handleSendChat}
          onClose={() => setIsSidePanelOpen(false)}
        />
      )}

      {isDownloadModalOpen && (
        <div className="modal-backdrop download-history-backdrop" onClick={() => setIsDownloadModalOpen(false)}>
          <section
            className="settings-modal download-history-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="download-history-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="settings-modal-header download-history-header">
              <div className="download-history-title-wrap">
                <span className="download-history-icon"><CalendarDays size={19} /></span>
                <div>
                  <span className="mini-label">YOUR ORGANIZED FILES</span>
                  <h2 id="download-history-title">Download by date</h2>
                  <p>Choose a time period to download its organized batches together.</p>
                </div>
              </div>
              <button type="button" className="modal-close-btn" onClick={() => setIsDownloadModalOpen(false)} aria-label="Close download history">
                <X size={18} />
              </button>
            </header>

            <div className="download-history-body">
              {loadingArchives ? (
                <div className="download-history-state"><LoaderCircle size={20} className="download-history-spinner" />Loading your ZIP history…</div>
              ) : archiveError && !archiveBatches.length ? (
                <div className="download-history-state download-history-error">{archiveError}</div>
              ) : (
                <>
                  <p className="download-history-note">File counts include batches with saved ZIPs.</p>
                  <div className="download-period-list">
                    {dateGroups.map((period) => {
                      const count = period.batches.reduce((sum, batch) => sum + batch.file_count, 0)
                      const isDownloading = downloadingPeriod === period.key
                      return (
                        <div className="download-period-row" key={period.key}>
                          <div className="download-period-copy">
                            <b>{period.label}</b>
                            <span>{period.detail}</span>
                          </div>
                          <span className="download-period-count">{count} {count === 1 ? 'file' : 'files'}</span>
                          <button
                            type="button"
                            className="quiet-button download-period-button"
                            disabled={!count || Boolean(downloadingPeriod)}
                            onClick={() => downloadArchivePeriod(period.key, period.batches)}
                          >
                            {isDownloading ? <LoaderCircle size={14} className="download-history-spinner" /> : <Download size={14} />}
                            {isDownloading ? 'Preparing…' : 'Download'}
                          </button>
                        </div>
                      )
                    })}
                  </div>
                  {!archiveBatches.some((batch) => batch.archive_available) && !loadingArchives && (
                    <div className="download-history-empty">
                      {archiveBatches.length
                        ? 'Older batches were created before ZIP history was available, so their original files are not saved for download.'
                        : 'No saved ZIPs yet. Newly organized batches will appear here.'}
                    </div>
                  )}
                  {archiveBatches.some((batch) => !batch.archive_available) && archiveBatches.some((batch) => batch.archive_available) && (
                    <div className="download-history-empty">Some older batches were created before ZIP history was available and cannot be included.</div>
                  )}
                  {archiveError && <p className="download-history-error-inline">{archiveError}</p>}
                </>
              )}
            </div>
            <footer className="settings-modal-footer">
              <button type="button" className="quiet-button" onClick={() => setIsDownloadModalOpen(false)}>Close</button>
            </footer>
          </section>
        </div>
      )}

      {/* Contextual Explanations Modal Popup */}
      {isModalOpen && (
        <div className="modal-backdrop" onClick={() => setIsModalOpen(false)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title-wrap">
                <div className="modal-icon-badge">
                  <Sparkles size={18} />
                </div>
                <div>
                  <h3>Contextual Grouping Explanations</h3>
                  <p>Folio analyzed your file contents and grouped them into distinct courses and topics.</p>
                </div>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setIsModalOpen(false)}
                aria-label="Close modal"
              >
                <X size={18} />
              </button>
            </div>

            <div className="modal-search-bar">
              <input
                type="text"
                className="modal-search-input"
                placeholder="Search file name, target folder, or topic reasoning..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                autoFocus
              />
            </div>

            <div className="modal-body">
              {filteredManifest.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '30px', color: '#888', fontSize: '11px' }}>
                  No matching files or explanations found for "{searchQuery}".
                </div>
              ) : (
                filteredManifest.map((item, idx) => (
                  <div className="modal-item-card" key={`modal-${item.name}-${idx}`}>
                    <div className="modal-item-header">
                      <div className="modal-file-info">
                        <FolioIcon name="file" size={18} />
                        <b>{item.name}</b>
                      </div>
                      <div className="modal-target-folder">
                        <span>Destination:</span>
                        <span
                          style={{
                            fontWeight: 600,
                            color: '#2e5b29',
                            background: '#eef6ec',
                            padding: '2px 8px',
                            borderRadius: '5px',
                          }}
                        >
                          📁 {item.folder}
                        </span>
                      </div>
                    </div>
                    <div className="modal-reason-box">{item.reason}</div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '8px' }}>
                      <button
                        type="button"
                        className="file-preview-btn"
                        onClick={() => {
                          setIsModalOpen(false)
                          handleOpenFile(item.name, item.folder)
                        }}
                      >
                        <BookOpen size={12} /> Open in Reader & Summarizer &rarr;
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="primary"
                style={{ padding: '8px 18px', fontSize: '11px' }}
                onClick={() => setIsModalOpen(false)}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="footnote">
        <span>MADE FOR A CLEARER KIND OF WORK.</span>
        <span>FOLIO © 2026</span>
      </div>
    </div>
  )
}
