'use client'

import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import Image from 'next/image'
import { ArrowUp, BookOpen, Check, ChevronDown, ChevronLeft, ChevronRight, Lightbulb, ListChecks, Mic, Plus, RefreshCw, X } from 'lucide-react'
import aiIcon from '@/assets/ai/icon-black.png'
import aiIconWhite from '@/assets/ai/icon-white.png'
import FolioIcon from './FolioIcon'

export type GilMessage = { role: 'user' | 'assistant'; content: string }
export type GilModel = 'auto' | 'gil_v1' | 'gil_v2'
export type GilThinkingLevel = 'low' | 'medium' | 'high'

type BrowserSpeechResult = { 0: { transcript: string } }
type BrowserSpeechEvent = { results: ArrayLike<BrowserSpeechResult> }
type BrowserSpeechRecognition = {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((event: BrowserSpeechEvent) => void) | null
  onerror: (() => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
}
type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognition

type GilAssistantPanelProps = {
  filename?: string
  folder?: string
  summary?: string
  keyPoints?: string[]
  folderRelevance?: string
  loading?: boolean
  messages: GilMessage[]
  input: string
  sending: boolean
  onInputChange: (value: string) => void
  onSend: (message?: string, model?: GilModel, thinkingLevel?: GilThinkingLevel, customInstructions?: string, attachmentContext?: string) => void | Promise<void>
  onClose: () => void
}

const suggestions = [
  { icon: null, folioIcon: 'file' as const, title: 'Summarize this document', detail: 'Get the key points from this file', prompt: 'Summarize the key points in this document and explain why they matter.' },
  { icon: Lightbulb, title: 'Explain a concept', detail: 'Make a difficult idea easier to understand', prompt: 'Explain an important concept in this document in clear, simple terms.' },
  { icon: ListChecks, title: 'Find key details', detail: 'Review the important information', prompt: 'List the most important details, people, dates, and topics in this document.' },
  { icon: BookOpen, title: 'Help me study', detail: 'Practice with questions from this file', prompt: 'Create five study questions based on this document, with brief answers.' },
]

export default function GilAssistantPanel({
  filename,
  folder,
  summary,
  keyPoints = [],
  folderRelevance,
  loading = false,
  messages,
  input,
  sending,
  onInputChange,
  onSend,
  onClose,
}: GilAssistantPanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const [selectedModel, setSelectedModel] = useState<GilModel>('auto')
  const [thinkingLevel, setThinkingLevel] = useState<GilThinkingLevel>('medium')
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const [menuView, setMenuView] = useState<'models' | 'thinking'>('models')
  const [attachment, setAttachment] = useState<{ name: string; context: string } | null>(null)
  const [attachmentLoading, setAttachmentLoading] = useState(false)
  const [attachmentError, setAttachmentError] = useState('')
  const [voiceRecording, setVoiceRecording] = useState(false)
  const [voiceError, setVoiceError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const speechRecognitionRef = useRef<BrowserSpeechRecognition | null>(null)

  async function handleFileSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (file.size > 15 * 1024 * 1024) {
      setAttachmentError('Choose a file smaller than 15 MB.')
      return
    }

    setAttachmentLoading(true)
    setAttachmentError('')
    setAttachment(null)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('folder', folder || '')
      form.append('custom_instructions', localStorage.getItem('folio-ai-instructions') || '')
      const savedUser = JSON.parse(localStorage.getItem('folio-user') || 'null')
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'}/api/file/preview`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${savedUser?.token || ''}` },
        body: form,
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.detail || 'Could not read the attached file.')
      const extractedText = data?.content_preview || data?.summary || ''
      if (!extractedText) throw new Error('No readable text was found in that file.')
      setAttachment({
        name: file.name,
        context: `Additional file attached: ${file.name}\n\n${String(extractedText).slice(0, 12000)}`,
      })
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : 'Could not read the attached file.')
    } finally {
      setAttachmentLoading(false)
    }
  }

  function toggleVoiceRecording() {
    if (voiceRecording) {
      speechRecognitionRef.current?.stop()
      setVoiceRecording(false)
      return
    }
    const speechWindow = window as unknown as {
      SpeechRecognition?: BrowserSpeechRecognitionConstructor
      webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor
    }
    const SpeechRecognitionAPI = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition
    if (!SpeechRecognitionAPI) {
      setVoiceError('Voice input is not supported in this browser.')
      return
    }
    setVoiceError('')
    const recognition = new SpeechRecognitionAPI()
    const existingText = input.trim()
    recognition.lang = navigator.language || 'en-US'
    recognition.continuous = false
    recognition.interimResults = false
    recognition.onresult = (resultEvent) => {
      const transcript = Array.from(resultEvent.results).map((result) => result[0].transcript).join(' ').trim()
      if (transcript) onInputChange([existingText, transcript].filter(Boolean).join(' '))
    }
    recognition.onerror = () => {
      setVoiceRecording(false)
      setVoiceError('Voice recording could not start. Check microphone access and try again.')
    }
    recognition.onend = () => {
      setVoiceRecording(false)
      speechRecognitionRef.current = null
    }
    speechRecognitionRef.current = recognition
    try {
      recognition.start()
      setVoiceRecording(true)
    } catch {
      setVoiceRecording(false)
      setVoiceError('Voice recording could not start. Check microphone access and try again.')
    }
  }

  async function submitMessage() {
    const text = input.trim() || (attachment ? `Please read the attached file, ${attachment.name}, and use it as context for my question.` : '')
    if (!text) return
    await onSend(text, selectedModel, thinkingLevel, localStorage.getItem('folio-ai-instructions') || '', attachment?.context || '')
    setAttachment(null)
  }

  useEffect(() => {
    const savedModel = localStorage.getItem('folio-ai-model')
    const savedThinking = localStorage.getItem('folio-ai-thinking-level')
    if (savedModel === 'auto' || savedModel === 'gil_v1' || savedModel === 'gil_v2') setSelectedModel(savedModel)
    if (savedThinking === 'low' || savedThinking === 'medium' || savedThinking === 'high') setThinkingLevel(savedThinking)
  }, [])

  function chooseModel(model: GilModel) {
    setSelectedModel(model)
    localStorage.setItem('folio-ai-model', model)
    setModelMenuOpen(false)
    setMenuView('models')
  }

  function chooseThinkingLevel(level: GilThinkingLevel) {
    setThinkingLevel(level)
    localStorage.setItem('folio-ai-thinking-level', level)
    setModelMenuOpen(false)
    setMenuView('models')
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, sending])

  useEffect(() => () => {
    speechRecognitionRef.current?.stop()
  }, [])

  return (
    <div className="side-reader-backdrop" onClick={onClose}>
      <aside className="side-reader-panel folio-preview-ai-panel" onClick={(event) => event.stopPropagation()}>
        <header className="folio-preview-ai-header">
          <div className="folio-preview-ai-heading">
            <span className="gil-theme-logo ask-gil-panel-logo">
              <Image src={aiIcon} alt="" width={24} height={24} className="gil-logo-light" />
              <Image src={aiIconWhite} alt="" width={24} height={24} className="gil-logo-dark" />
            </span>
            <b>Gil</b>
          </div>
          <span className="folio-preview-ai-file" title={folder || filename}>{folder || filename || 'Your AI assistant'}</span>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close Gil">
            <X size={18} />
          </button>
        </header>

        <div className="folio-preview-ai-chat">
          {loading ? (
            <div className="folio-preview-loading">
              <RefreshCw size={24} className="folio-preview-spinner" />
              <b>Preparing this file…</b>
              <span>Gil is getting it ready to read.</span>
            </div>
          ) : messages.length === 0 ? (
            <div className="folio-preview-ai-welcome">
              <span className="gil-theme-logo folio-preview-ai-welcome-logo">
                <Image src={aiIcon} alt="Gil" width={78} height={78} className="gil-logo-light" />
                <Image src={aiIconWhite} alt="Gil" width={78} height={78} className="gil-logo-dark" />
              </span>
              <h2>{filename ? 'Welcome back, Gil!' : 'Welcome to Gil'}</h2>
              <p>{filename ? <>Ready to explore this file? Choose an action or ask Gil anything about <b>{filename}</b>.</> : 'Choose a file to see its overview and start a conversation with Gil.'}</p>
              <div className="folio-preview-ai-actions">
                {suggestions.map(({ icon: Icon, folioIcon, title, detail, prompt }) => (
                  <button type="button" key={title} disabled={!filename || loading || sending} onClick={() => void onSend(prompt, selectedModel, thinkingLevel, localStorage.getItem('folio-ai-instructions') || '', attachment?.context || '')}>
                    {Icon ? <Icon size={25} /> : <FolioIcon name={folioIcon || 'file'} size={29} />}
                    <span><b>{title}</b><small>{detail}</small></span>
                    <i>→</i>
                  </button>
                ))}
              </div>
              <div className="folio-preview-ai-prompt-divider"><span>Or just ask Gil anything…</span></div>
            </div>
          ) : (
            <div className="folio-preview-ai-messages">
              {messages.map((message, index) => (
                <div key={`message-${index}`} className={`chat-bubble ${message.role === 'user' ? 'user' : 'ai'}`}>{message.content}</div>
              ))}
              {sending && <div className="chat-bubble ai"><RefreshCw size={13} className="spinner" /> Gil is thinking…</div>}
              <div ref={bottomRef} />
            </div>
          )}

          {filename && summary && (
            <details className="gil-file-overview" open={messages.length === 0}>
              <summary>File overview</summary>
              <p>{summary}</p>
              {keyPoints.length > 0 && (
                <ul>{keyPoints.map((point, index) => <li key={`point-${index}`}>{point}</li>)}</ul>
              )}
              {folderRelevance && <p className="gil-file-relevance">{folderRelevance}</p>}
            </details>
          )}

          {attachment && (
            <div className="gil-composer-attachment">
              <FolioIcon name="file" size={18} /><span>{attachment.name}</span>
              <button type="button" onClick={() => setAttachment(null)} aria-label="Remove attached file"><X size={14} /></button>
            </div>
          )}
          {attachmentLoading && <div className="gil-composer-status">Reading attached file…</div>}
          <form className={`gil-composer ${input.trim() || attachment ? 'has-text' : ''}`} onSubmit={(event) => { event.preventDefault(); void submitMessage() }}>
            <button type="button" className="gil-composer-add" onClick={() => fileInputRef.current?.click()} disabled={sending || loading || attachmentLoading} aria-label="Attach a file" title="Attach a file"><Plus size={23} /></button>
            <input ref={fileInputRef} className="gil-composer-file-input" type="file" accept=".pdf,.doc,.docx,.txt,.md,.rtf,.csv,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg,.webp" onChange={handleFileSelected} />
            <input
              className="gil-composer-input"
              value={input}
              onChange={(event) => onInputChange(event.target.value)}
              placeholder="Ask Gil about this file…"
              disabled={sending || loading || (!filename && !attachment)}
            />
            <span className="gil-composer-model-wrap">
              <button type="button" className="gil-composer-model" onClick={() => { setModelMenuOpen((open) => !open); setMenuView('models') }} aria-expanded={modelMenuOpen} aria-label="Choose Gil model and thinking level">
                <span>{selectedModel === 'auto' ? 'Auto' : selectedModel === 'gil_v1' ? 'Gil.v1' : 'Gil.v2'}</span><ChevronDown size={16} />
              </button>
              {modelMenuOpen && (
                <div className="gil-model-menu">
                  {menuView === 'models' ? (
                    <>
                      <button type="button" className={`gil-model-option ${selectedModel === 'auto' ? 'selected' : ''}`} onClick={() => chooseModel('auto')}>
                        <span><b>Auto</b><small>Adapts to your needs</small></span>{selectedModel === 'auto' && <Check size={16} />}
                      </button>
                      <button type="button" className={`gil-model-option ${selectedModel === 'gil_v1' ? 'selected' : ''}`} onClick={() => chooseModel('gil_v1')}>
                        <span><b>Gil.v1</b><small>Everyday help · fast</small></span>{selectedModel === 'gil_v1' && <Check size={16} />}
                      </button>
                      <button type="button" className={`gil-model-option ${selectedModel === 'gil_v2' ? 'selected' : ''}`} onClick={() => chooseModel('gil_v2')}>
                        <span><b>Gil.v2</b><small>Deeper analysis</small></span>{selectedModel === 'gil_v2' && <Check size={16} />}
                      </button>
                      <div className="gil-model-menu-divider" />
                      <button type="button" className="gil-thinking-entry" onClick={() => setMenuView('thinking')}>
                        <span><b>Thinking level</b><small>{thinkingLevel[0].toUpperCase() + thinkingLevel.slice(1)}</small></span><ChevronRight size={17} />
                      </button>
                    </>
                  ) : (
                    <>
                      <button type="button" className="gil-thinking-back" onClick={() => setMenuView('models')}><ChevronLeft size={16} /> Thinking level</button>
                      {([
                        ['low', 'Fast and efficient'],
                        ['medium', 'Balanced depth'],
                        ['high', 'Extra thorough'],
                      ] as const).map(([level, description]) => (
                        <button type="button" key={level} className={`gil-model-option ${thinkingLevel === level ? 'selected' : ''}`} onClick={() => chooseThinkingLevel(level)}>
                          <span><b>{level[0].toUpperCase() + level.slice(1)}</b><small>{description}</small></span>{thinkingLevel === level && <Check size={16} />}
                        </button>
                      ))}
                    </>
                  )}
                </div>
              )}
            </span>
            {input.trim() || attachment ? (
              <button className="gil-composer-send" type="submit" disabled={sending || loading || (!filename && !attachment) || attachmentLoading} aria-label="Send message"><ArrowUp size={20} /></button>
            ) : (
              <button type="button" className={`gil-composer-mic ${voiceRecording ? 'recording' : ''}`} onClick={toggleVoiceRecording} disabled={sending || loading || (!filename && !attachment)} aria-label={voiceRecording ? 'Stop voice recording' : 'Start voice recording'} title={voiceRecording ? 'Stop recording' : 'Record a voice message'}><Mic size={19} /></button>
            )}
          </form>
          {(attachmentError || voiceError) && <div className="gil-composer-error" role="status">{attachmentError || voiceError}</div>}
        </div>
      </aside>
    </div>
  )
}
