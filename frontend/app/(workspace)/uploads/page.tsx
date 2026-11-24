'use client'

import { ChangeEvent, DragEvent, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowRight,
  Check,
  Plus,
  RefreshCw,
  Sparkles,
  X,
} from 'lucide-react'
import { useWorkspace } from '@/components/WorkspaceProvider'
import FolioIcon from '@/components/FolioIcon'

export default function UploadsPage() {
  const router = useRouter()
  const {
    files,
    setFiles,
    organize,
    error,
    busy,
    localTarget,
    setLocalTarget,
    localScanResults,
    scanLocalFolder,
    organizeLocalFolder,
  } = useWorkspace()

  const [activeTab, setActiveTab] = useState<'upload' | 'local'>('upload')
  const [localSuccess, setLocalSuccess] = useState('')
  const picker = useRef<HTMLInputElement>(null)
  const folderPicker = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (localStorage.getItem('folio-default-upload-mode') === 'local') setActiveTab('local')
  }, [])

  function addFiles(list: FileList | null) {
    if (!list) return
    const additions = Array.from(list)
    setFiles([
      ...files,
      ...additions.filter((file) => !files.some((existing) => existing.name === file.name && existing.size === file.size)),
    ])
  }

  async function submitUpload() {
    if (await organize()) router.push('/organized')
  }

  function drop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    addFiles(event.dataTransfer.files)
  }

  function select(event: ChangeEvent<HTMLInputElement>) {
    addFiles(event.target.files)
    event.currentTarget.value = ''
  }

  function chooseFolder() {
    const element = folderPicker.current as (HTMLInputElement & { webkitdirectory?: boolean }) | null
    if (element) {
      element.webkitdirectory = true
      element.setAttribute('directory', '')
      element.click()
    }
  }

  async function handleLocalScan(preset?: string) {
    const target = preset || localTarget
    setLocalSuccess('')
    if (preset) setLocalTarget(preset)
    await scanLocalFolder(target)
  }

  async function handleLocalOrganize() {
    setLocalSuccess('')
    const ok = await organizeLocalFolder(localTarget, false)
    if (ok) {
      router.push('/organized')
    }
  }

  return (
    <div className="content-wrap">
      <div className="greeting">
        <div>
          <div className="eyebrow">STEP 1 · SELECT CONTENT</div>
          <h1>
            Bring your files <em>together.</em>
          </h1>
          <p>
            {activeTab === 'upload'
              ? 'Upload files or mixed slides to group them by topic and download a tidy ZIP.'
              : 'Scan your Desktop, Downloads, Documents, or any folder for loose files and organize them directly into folders.'}
          </p>
        </div>
        <div className="greeting-icon">
          {activeTab === 'upload' ? <FolioIcon name="upload" size={28} /> : <FolioIcon name="computer" size={28} />}
        </div>
      </div>

      {/* Mode Switcher */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '18px' }}>
        <button
          onClick={() => setActiveTab('upload')}
          style={{
            padding: '9px 16px',
            borderRadius: '7px',
            border: activeTab === 'upload' ? '1px solid #344e37' : '1px solid #dce2d8',
            background: activeTab === 'upload' ? '#344e37' : '#fff',
            color: activeTab === 'upload' ? '#fff' : '#555',
            fontWeight: 600,
            fontSize: '11px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <FolioIcon name="upload" size={18} /> Upload Files & Download ZIP
        </button>
        <button
          onClick={() => {
            setActiveTab('local')
            if (localScanResults.length === 0) handleLocalScan('Desktop')
          }}
          style={{
            padding: '9px 16px',
            borderRadius: '7px',
            border: activeTab === 'local' ? '1px solid #344e37' : '1px solid #dce2d8',
            background: activeTab === 'local' ? '#344e37' : '#fff',
            color: activeTab === 'local' ? '#fff' : '#555',
            fontWeight: 600,
            fontSize: '11px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <FolioIcon name="computer" size={18} /> Organize Local Folder
        </button>
      </div>

      {activeTab === 'upload' ? (
        /* UPLOAD MODE */
        <section className="upload-card">
          <div className="section-top">
            <div>
              <div className="section-icon">
                <FolioIcon name="upload" size={21} />
              </div>
              <h2>Choose what to organize</h2>
              <p>Upload mixed slide decks, PDFs, documents, or spreadsheets.</p>
            </div>
            <button className="quiet-button" onClick={() => picker.current?.click()}>
              <Plus size={16} /> Add files
            </button>
            <input ref={picker} type="file" multiple hidden onChange={select} />
            <input ref={folderPicker} type="file" multiple hidden onChange={select} />
          </div>

          <div className="dropzone" onDragOver={(e) => e.preventDefault()} onDrop={drop} onClick={() => picker.current?.click()}>
            <div className="upload-icon">
              <FolioIcon name="upload" size={26} />
            </div>
            <b>
              Drop your files here, or <span>browse files</span>
            </b>
            <small>PPTX slides, PDF, Word DOCX, text and data · up to 50 MB total</small>
          </div>

          <div className="upload-options">
            <span>Have a whole folder of mixed files?</span>
            <button className="text-button" onClick={chooseFolder}>
              Choose a folder <ArrowRight size={14} />
            </button>
            <small>Your browser will ask you to select it.</small>
          </div>

          {files.length > 0 && (
            <div className="file-queue">
              <div className="queue-heading">
                <b>
                  {files.length} {files.length === 1 ? 'file' : 'files'} ready for AI organizing
                </b>
                <button onClick={() => setFiles([])}>Clear all</button>
              </div>
              {files.map((file, index) => (
                <div className="queue-file" key={`${file.name}-${index}`}>
                  <span className="file-mark blue">
                    <FolioIcon name="file" size={18} />
                  </span>
                  <span className="queue-name">
                    {(file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name}
                    <small>{(file.size / 1024 / 1024).toFixed(2)} MB</small>
                  </span>
                  <button aria-label={`Remove ${file.name}`} onClick={() => setFiles(files.filter((_, i) => i !== index))}>
                    <X size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {error && <div className="error">{error}</div>}

          {files.length > 0 && (
            <button className="primary organize-button" onClick={submitUpload} disabled={busy}>
              {busy ? (
                <>
                  <span className="spinner" /> Analyzing context & building ZIP…
                </>
              ) : (
                <>
                  <Sparkles size={16} /> Organize {files.length} {files.length === 1 ? 'file' : 'files'} by Context{' '}
                  <ArrowRight size={16} />
                </>
              )}
            </button>
          )}
        </section>
      ) : (
        /* LOCAL FOLDER ACCESS MODE */
        <section className="upload-card">
          <div className="section-top">
            <div>
              <div className="section-icon">
                <FolioIcon name="computer" size={22} />
              </div>
              <h2>Direct Local Folder Access</h2>
              <p>Reads files that are not in folders already and moves them into context-based folders.</p>
            </div>
          </div>

          {/* Quick presets */}
          <div style={{ display: 'flex', gap: '8px', marginTop: '16px', alignItems: 'center' }}>
            <span className="local-folder-quick-label">Quick select:</span>
            <button
              className={`quiet-button local-folder-preset ${localTarget.toLowerCase().includes('desktop') ? 'selected' : ''}`}
              onClick={() => handleLocalScan('Desktop')}
            >
              <FolioIcon name="computer" size={16} /> Desktop
            </button>
            <button
              className={`quiet-button local-folder-preset ${localTarget.toLowerCase().includes('downloads') ? 'selected' : ''}`}
              onClick={() => handleLocalScan('Downloads')}
            >
              <FolioIcon name="folder" size={16} /> Downloads
            </button>
            <button
              className={`quiet-button local-folder-preset ${localTarget.toLowerCase().includes('documents') ? 'selected' : ''}`}
              onClick={() => handleLocalScan('Documents')}
            >
              <FolioIcon name="file" size={16} /> Documents
            </button>
          </div>

          {/* Custom path input */}
          <div style={{ display: 'flex', gap: '8px', marginTop: '14px' }}>
            <input
              type="text"
              value={localTarget}
              onChange={(e) => setLocalTarget(e.target.value)}
              placeholder="Enter folder path (e.g. ~/Desktop, ~/Downloads, or ~/Documents)"
              style={{
                flex: 1,
                padding: '10px 14px',
                borderRadius: '6px',
                border: '1px solid #dce2d8',
                fontSize: '11px',
              }}
            />
            <button className="primary" onClick={() => handleLocalScan()} disabled={busy} style={{ padding: '8px 16px' }}>
              <RefreshCw size={14} className={busy ? 'spinner' : ''} /> Scan Folder
            </button>
          </div>

          {localSuccess && (
            <div style={{ color: '#2e6b36', background: '#eef8ef', padding: '10px 14px', borderRadius: '6px', marginTop: '12px', fontSize: '11px' }}>
              <Check size={14} style={{ display: 'inline', marginRight: '6px' }} /> {localSuccess}
            </div>
          )}

          {error && <div className="error">{error}</div>}

          {/* Unorganized files preview */}
          {localScanResults.length > 0 ? (
            <div className="file-queue" style={{ marginTop: '20px' }}>
              <div className="queue-heading">
                <b>
                  Found {localScanResults.length} loose {localScanResults.length === 1 ? 'file' : 'files'} in {localTarget} (not in any folder yet)
                </b>
              </div>
              <div style={{ maxHeight: '250px', overflowY: 'auto' }}>
                {localScanResults.map((file, i) => (
                  <div className="queue-file" key={`${file.name}-${i}`}>
                    <span className="file-mark green">
                      <FolioIcon name="file" size={18} />
                    </span>
                    <span className="queue-name">
                      {file.name}
                      <small>
                        {(file.size / 1024).toFixed(1)} KB · {file.extension || 'file'}
                      </small>
                    </span>
                  </div>
                ))}
              </div>

              <button
                className="primary organize-button"
                style={{ marginTop: '18px' }}
                onClick={handleLocalOrganize}
                disabled={busy}
              >
                {busy ? (
                  <>
                    <span className="spinner" /> Analyzing context & creating folders…
                  </>
                ) : (
                  <>
                    <Sparkles size={16} /> Create Folders & Move {localScanResults.length} Loose Files <ArrowRight size={16} />
                  </>
                )}
              </button>
            </div>
          ) : (
            !busy && (
              <div style={{ padding: '24px 0', textAlign: 'center', color: '#888', fontSize: '11px' }}>
                Click <b>Scan Folder</b> to discover unorganized loose files waiting to be organized.
              </div>
            )
          )}
        </section>
      )}

      <div className="footnote">
        <span>Files are organized based on their semantic context and extracted contents.</span>
        <span>FOLIO © 2026</span>
      </div>
    </div>
  )
}
