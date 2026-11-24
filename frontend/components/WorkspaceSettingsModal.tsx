'use client'

import { useEffect, useState } from 'react'
import { Activity, LogOut, Moon, Settings, Sun, UserRound, X } from 'lucide-react'
import { useWorkspace } from './WorkspaceProvider'
import type { GilModel, GilThinkingLevel } from './GilAssistantPanel'
import FolioIcon, { type FolioIconName } from './FolioIcon'

type SettingsTab = 'general' | 'ai' | 'files' | 'memory' | 'account'

type WorkspaceSettingsModalProps = {
  username: string
  darkTheme: boolean
  toggleTheme: () => void
  defaultUploadMode: 'upload' | 'local'
  onUploadModeChange: (mode: 'upload' | 'local') => void
  onSignOut: () => void
  onClose: () => void
}

const tabItems: { id: SettingsTab; label: string; icon?: typeof Settings; folioIcon?: FolioIconName }[] = [
  { id: 'general', label: 'General', icon: Settings },
  { id: 'ai', label: 'AI & summaries', icon: Activity },
  { id: 'files', label: 'Files & organization', folioIcon: 'file' },
  { id: 'memory', label: 'Memory & data', folioIcon: 'folderOpen' },
  { id: 'account', label: 'Account', icon: UserRound },
]

export default function WorkspaceSettingsModal({
  username,
  darkTheme,
  toggleTheme,
  defaultUploadMode,
  onUploadModeChange,
  onSignOut,
  onClose,
}: WorkspaceSettingsModalProps) {
  const { folderHistory, files, localTarget, setLocalTarget, clearMemory, clear } = useWorkspace()
  const [activeTab, setActiveTab] = useState<SettingsTab>('general')
  const [assistantMode, setAssistantMode] = useState<GilModel>('auto')
  const [thinkingLevel, setThinkingLevel] = useState<GilThinkingLevel>('medium')
  const [aiInstructions, setAiInstructions] = useState('')

  useEffect(() => {
    const savedMode = localStorage.getItem('folio-ai-model')
    const savedThinking = localStorage.getItem('folio-ai-thinking-level')
    if (savedMode === 'auto' || savedMode === 'gil_v1' || savedMode === 'gil_v2') setAssistantMode(savedMode)
    if (savedThinking === 'low' || savedThinking === 'medium' || savedThinking === 'high') setThinkingLevel(savedThinking)
    setAiInstructions(localStorage.getItem('folio-ai-instructions') || '')
  }, [])

  function saveAssistantMode(value: GilModel) {
    setAssistantMode(value)
    localStorage.setItem('folio-ai-model', value)
  }

  function saveThinkingLevel(value: GilThinkingLevel) {
    setThinkingLevel(value)
    localStorage.setItem('folio-ai-thinking-level', value)
  }

  function saveInstructions(value: string) {
    const limited = value.slice(0, 2000)
    setAiInstructions(limited)
    localStorage.setItem('folio-ai-instructions', limited)
  }

  function saveLocalTarget(value: string) {
    setLocalTarget(value)
    localStorage.setItem('folio-local-target', value)
  }

  function confirmClearMemory() {
    if (!folderHistory.length) return
    if (window.confirm('Clear all saved organized folders and file history for this account? This cannot be undone.')) clearMemory()
  }

  function confirmClearQueuedFiles() {
    if (!files.length) return
    if (window.confirm('Remove all files currently queued for upload?')) clear()
  }

  const totalRememberedFiles = folderHistory.reduce((total, record) => total + record.count, 0)

  return (
    <div className="settings-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="settings-modal settings-modal-workspace" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <header className="settings-modal-header">
          <div>
            <span className="mini-label">PERSONAL WORKSPACE</span>
            <h2 id="settings-title">Settings</h2>
          </div>
          <button className="modal-close-btn" type="button" onClick={onClose} aria-label="Close settings"><X size={18} /></button>
        </header>

        <div className="settings-modal-layout">
          <nav className="settings-tabs" aria-label="Settings sections">
            {tabItems.map(({ id, label, icon: Icon, folioIcon }) => (
              <button key={id} type="button" className={`settings-tab ${activeTab === id ? 'active' : ''}`} onClick={() => setActiveTab(id)}>
                {Icon ? <Icon size={16} /> : <FolioIcon name={folioIcon || 'file'} size={18} />}<span>{label}</span>
              </button>
            ))}
          </nav>

          <div className="settings-tab-page">
            {activeTab === 'general' && (
              <div className="settings-page-content">
                <div className="settings-page-heading"><h3>General</h3><p>Adjust the look and default behavior of your workspace.</p></div>
                <section className="settings-section">
                  <h3>Appearance</h3>
                  <p>Choose how Folio looks on this device.</p>
                  <div className="settings-choice-row">
                    <button type="button" className={`settings-choice ${!darkTheme ? 'selected' : ''}`} onClick={() => darkTheme && toggleTheme()}>
                      <Sun size={17} /><span><b>Light</b><small>Bright workspace</small></span>
                    </button>
                    <button type="button" className={`settings-choice ${darkTheme ? 'selected' : ''}`} onClick={() => !darkTheme && toggleTheme()}>
                      <Moon size={17} /><span><b>Dark</b><small>Charcoal workspace</small></span>
                    </button>
                  </div>
                </section>
                <div className="settings-inline-note">Your appearance preference is saved in this browser.</div>
              </div>
            )}

            {activeTab === 'ai' && (
              <div className="settings-page-content">
                <div className="settings-page-heading"><h3>AI & summaries</h3><p>Set Gil’s default response style for summaries, explanations, and file questions.</p></div>
                <section className="settings-section">
                  <label className="settings-field-label" htmlFor="settings-ai-model">Default assistant model</label>
                  <p>Choose a faster response or deeper document analysis.</p>
                  <select id="settings-ai-model" className="settings-select" value={assistantMode} onChange={(event) => saveAssistantMode(event.target.value as GilModel)}>
                    <option value="auto">Auto · adapt to the request</option>
                    <option value="gil_v1">Gil.v1 · quick and concise</option>
                    <option value="gil_v2">Gil.v2 · deeper analysis</option>
                  </select>
                </section>
                <section className="settings-section">
                  <label className="settings-field-label" htmlFor="settings-thinking">Default thinking level</label>
                  <p>Controls the depth and length of Gil’s answers.</p>
                  <select id="settings-thinking" className="settings-select" value={thinkingLevel} onChange={(event) => saveThinkingLevel(event.target.value as GilThinkingLevel)}>
                    <option value="low">Low · brief and fast</option>
                    <option value="medium">Medium · balanced detail</option>
                    <option value="high">High · thorough explanations</option>
                  </select>
                </section>
                <section className="settings-section">
                  <label className="settings-field-label" htmlFor="settings-ai-instructions">Your instructions for Gil</label>
                  <p>These preferences guide file summaries, explanations, and answers to your questions.</p>
                  <textarea id="settings-ai-instructions" className="settings-textarea" maxLength={2000} value={aiInstructions} onChange={(event) => saveInstructions(event.target.value)} placeholder="For example: Summarize in clear language, define technical terms, and finish with the most important takeaways." />
                  <small className="settings-character-count">{aiInstructions.length}/2000 · Saved automatically</small>
                </section>
              </div>
            )}

            {activeTab === 'files' && (
              <div className="settings-page-content">
                <div className="settings-page-heading"><h3>Files & organization</h3><p>Choose how Folio starts when you open Uploads.</p></div>
                <section className="settings-section">
                  <h3>Default upload view</h3>
                  <p>Select files to upload, or start by scanning a folder on this device.</p>
                  <div className="settings-choice-row">
                    <button type="button" className={`settings-choice ${defaultUploadMode === 'upload' ? 'selected' : ''}`} onClick={() => onUploadModeChange('upload')}>
                      <span><b>Upload files</b><small>Choose files from your device</small></span>
                    </button>
                    <button type="button" className={`settings-choice ${defaultUploadMode === 'local' ? 'selected' : ''}`} onClick={() => onUploadModeChange('local')}>
                      <span><b>Local folder</b><small>Scan a folder on this device</small></span>
                    </button>
                  </div>
                </section>
                <section className="settings-section">
                  <label className="settings-field-label" htmlFor="settings-local-folder">Default local folder</label>
                  <p>Used as the starting location for local scans. You can choose a different folder on the Uploads page.</p>
                  <select id="settings-local-folder" className="settings-select" value={localTarget} onChange={(event) => saveLocalTarget(event.target.value)}>
                    <option>Desktop</option><option>Downloads</option><option>Documents</option>
                    {!['Desktop', 'Downloads', 'Documents'].includes(localTarget) && <option value={localTarget}>{localTarget}</option>}
                  </select>
                </section>
              </div>
            )}

            {activeTab === 'memory' && (
              <div className="settings-page-content">
                <div className="settings-page-heading"><h3>Memory & data</h3><p>Manage the organization history and temporary file queue saved by Folio.</p></div>
                <section className="settings-data-card">
                  <div><b>Organized history</b><p>{folderHistory.length} saved folders · {totalRememberedFiles} remembered files</p></div>
                  <button type="button" className="settings-danger-button" disabled={!folderHistory.length} onClick={confirmClearMemory}>Clear memory</button>
                </section>
                <section className="settings-data-card">
                  <div><b>Queued files</b><p>{files.length} file{files.length === 1 ? '' : 's'} ready in the upload queue</p></div>
                  <button type="button" className="settings-danger-button" disabled={!files.length} onClick={confirmClearQueuedFiles}>Clear queue</button>
                </section>
                <div className="settings-inline-note">Clearing memory removes saved folder history from this browser. It does not delete files from your device.</div>
              </div>
            )}

            {activeTab === 'account' && (
              <div className="settings-page-content">
                <div className="settings-page-heading"><h3>Account</h3><p>Account details for this Folio workspace.</p></div>
                <section className="settings-account-detail"><span>Username</span><b>{username}</b></section>
                <section className="settings-account-detail"><span>Workspace</span><b>Personal account</b></section>
                <section className="settings-account-detail"><span>Preferences</span><b>Saved in this browser</b></section>
                <button type="button" className="settings-danger-button settings-account-signout" onClick={onSignOut}><LogOut size={15} /> Log out</button>
              </div>
            )}
          </div>
        </div>

      </section>
    </div>
  )
}
