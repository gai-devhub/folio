'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { ArrowLeft, Download, LoaderCircle, Minus, Plus } from 'lucide-react'
import { useWorkspace } from '@/components/WorkspaceProvider'
import FolioIcon from '@/components/FolioIcon'
import aiIconWhite from '@/assets/ai/icon-white.png'
import GilAssistantPanel, { type GilModel, type GilThinkingLevel } from '@/components/GilAssistantPanel'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

type PreviewResult = {
  filename: string
  folder: string
  summary: string
  content_preview: string
  image_data?: string | null
  is_image?: boolean
}

function splitSections(content: string, label: 'Slide' | 'Sheet') {
  const parts = content.split(new RegExp(`(?=^${label} \\d+\\s*$)`, 'm'))
  return parts.map((part) => part.trim()).filter(Boolean)
}

function requestPdfPage(
  filename: string,
  folder: string,
  index: number,
  token: string,
  uploaded: File | undefined,
  targetPath?: string,
) {
  if (uploaded) {
    const form = new FormData()
    form.append('file', uploaded)
    form.append('page', String(index))
    return fetch(`${API}/api/file/pdf-page`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    })
  }
  return fetch(`${API}/api/local/file/pdf-page`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ path: targetPath || null, filename, folder, page: index }),
  })
}

export default function DocumentPreview({ filename, folder }: { filename: string; folder: string }) {
  const { files, organization, setCurrentFile } = useWorkspace()
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [sourceUrl, setSourceUrl] = useState<string | null>(null)
  const [pdfPageUrls, setPdfPageUrls] = useState<string[]>([])
  const [pdfPageCount, setPdfPageCount] = useState(0)
  const [currentPdfPage, setCurrentPdfPage] = useState(1)
  const [pdfZoom, setPdfZoom] = useState(100)
  const [aiOpen, setAiOpen] = useState(false)
  const [chatInput, setChatInput] = useState('')
  const [chatMessages, setChatMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([])
  const [sendingChat, setSendingChat] = useState(false)
  const pdfStageRef = useRef<HTMLDivElement>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const extension = filename.split('.').pop()?.toLowerCase() || ''
  const isSpreadsheet = ['xlsx', 'xlsm', 'xls', 'csv'].includes(extension)
  const isPresentation = ['pptx', 'ppt'].includes(extension)
  const isPdf = extension === 'pdf'

  const sections = useMemo(() => {
    if (!preview?.content_preview) return []
    if (isPresentation) return splitSections(preview.content_preview, 'Slide')
    if (extension === 'csv') {
      const lines = preview.content_preview.split(/\r?\n/).filter(Boolean)
      return lines.length
        ? [`Sheet 1\n${lines.map((line) => line.split(',').join(' | ')).join('\n')}`]
        : []
    }
    if (isSpreadsheet && /(^|\n)Sheet \d+/m.test(preview.content_preview)) {
      return splitSections(preview.content_preview, 'Sheet')
    }
    return []
  }, [extension, isPresentation, isSpreadsheet, preview])

  useEffect(() => {
    return () => {
      if (sourceUrl?.startsWith('blob:')) URL.revokeObjectURL(sourceUrl)
    }
  }, [sourceUrl])

  useEffect(() => () => {
    pdfPageUrls.forEach((url) => {
      if (url.startsWith('blob:')) URL.revokeObjectURL(url)
    })
  }, [pdfPageUrls])

  useEffect(() => {
    let cancelled = false
    async function loadPreview() {
      setLoading(true)
      setError('')
      setPreview(null)
      setSourceUrl(null)
      setPdfPageUrls([])
      setPdfPageCount(0)
      setCurrentPdfPage(1)
      setPdfZoom(100)
      if (!filename) {
        setError('Choose a file from Organized to preview it.')
        setLoading(false)
        return
      }

      try {
        const user = JSON.parse(localStorage.getItem('folio-user') || 'null')
        const token = user?.token || ''
        const uploaded = files.find((file) => file.name === filename)
        let previewResponse: Response

        async function collectPdfPages(firstPage: Response | null) {
          if (!firstPage) return
          if (!firstPage.ok) {
            const body = await firstPage.json().catch(() => null)
            throw new Error(body?.detail || 'Could not render this PDF.')
          }
          const pageCount = Number(firstPage.headers.get('X-PDF-Page-Count') || 1)
          const pageBlobs = await Promise.all([
            firstPage.blob(),
            ...Array.from({ length: Math.max(0, pageCount - 1) }, (_, index) =>
              requestPdfPage(filename, folder, index + 1, token, uploaded, organization?.targetPath).then(async (response) => {
                if (!response.ok) throw new Error(`Could not render PDF page ${index + 2}.`)
                return response.blob()
              }),
            ),
          ])
          const pageUrls = pageBlobs.map((blob) => URL.createObjectURL(blob))
          if (cancelled) pageUrls.forEach((url) => URL.revokeObjectURL(url))
          else {
            setPdfPageCount(pageCount)
            setPdfPageUrls(pageUrls)
          }
        }

        if (uploaded) {
          if (isPdf || /^(png|jpe?g|gif|webp|svg|bmp)$/.test(extension)) {
            setSourceUrl(URL.createObjectURL(uploaded))
          }
          const form = new FormData()
          form.append('file', uploaded)
          form.append('folder', folder)
          form.append('custom_instructions', localStorage.getItem('folio-ai-instructions') || '')
          const previewRequest = fetch(`${API}/api/file/preview`, {
            method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form,
          })
          const pageRequest = isPdf
            ? requestPdfPage(filename, folder, 0, token, uploaded, organization?.targetPath)
            : Promise.resolve(null)
          const [previewRes, pageRes] = await Promise.all([previewRequest, pageRequest])
          await collectPdfPages(pageRes)
          previewResponse = previewRes
        } else {
          const payload = JSON.stringify({
            path: organization?.targetPath || null,
            filename,
            folder,
            custom_instructions: localStorage.getItem('folio-ai-instructions') || '',
          })
          const headers = {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          }
          const previewRequest = fetch(`${API}/api/local/file/preview`, {
            method: 'POST', headers, body: payload,
          })
          const sourceRequest = fetch(`${API}/api/local/file/open`, {
            method: 'POST', headers, body: payload,
          })
          const pageRequest = isPdf
            ? requestPdfPage(filename, folder, 0, token, undefined, organization?.targetPath)
            : Promise.resolve(null)
          const [previewRes, sourceRes, pageRes] = await Promise.all([
            previewRequest,
            sourceRequest,
            pageRequest,
          ])
          if (sourceRes.ok && (isPdf || /^(png|jpe?g|gif|webp|svg|bmp)$/.test(extension))) {
            setSourceUrl(URL.createObjectURL(await sourceRes.blob()))
          }
          await collectPdfPages(pageRes)
          previewResponse = previewRes
        }

        if (!previewResponse.ok) {
          const body = await previewResponse.json().catch(() => null)
          throw new Error(body?.detail || 'Folio could not read this file.')
        }
        const result = (await previewResponse.json()) as PreviewResult
        if (!cancelled) {
          setPreview(result)
          setChatMessages([])
        }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Folio could not open this file.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadPreview()
    return () => {
      cancelled = true
    }
  }, [extension, filename, files, folder, isPdf, organization?.targetPath])

  useEffect(() => {
    setCurrentFile(filename || null)
  }, [filename, setCurrentFile])

  function downloadOriginal() {
    if (!sourceUrl) return
    const link = document.createElement('a')
    link.href = sourceUrl
    link.download = filename
    link.click()
  }

  function updateCurrentPdfPage() {
    const stage = pdfStageRef.current
    if (!stage) return
    const pageFrames = Array.from(stage.querySelectorAll<HTMLElement>('.folio-pdf-page-frame'))
    if (!pageFrames.length) return
    const stageBounds = stage.getBoundingClientRect()
    const centerY = stageBounds.top + stage.clientHeight / 2
    let nearestPage = 0
    let nearestDistance = Number.POSITIVE_INFINITY
    pageFrames.forEach((pageFrame, index) => {
      const bounds = pageFrame.getBoundingClientRect()
      if (bounds.top <= centerY && bounds.bottom >= centerY) {
        nearestPage = index
        nearestDistance = 0
        return
      }
      const distance = Math.min(Math.abs(bounds.top - centerY), Math.abs(bounds.bottom - centerY))
      if (distance < nearestDistance) {
        nearestPage = index
        nearestDistance = distance
      }
    })
    setCurrentPdfPage(nearestPage + 1)
  }

  async function sendChat(message = chatInput, assistantMode: GilModel = 'auto', thinkingLevel: GilThinkingLevel = 'medium', customInstructions = '', attachmentContext = '') {
    const text = message.trim()
    if (!text || sendingChat || !preview) return
    const history = [...chatMessages, { role: 'user' as const, content: text }]
    setChatMessages(history)
    setChatInput('')
    setSendingChat(true)
    try {
      const user = JSON.parse(localStorage.getItem('folio-user') || 'null')
      const response = await fetch(`${API}/api/file/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${user?.token || ''}` },
        body: JSON.stringify({
          filename, folder,
          content: preview.content_preview || preview.summary || '',
          message: text,
          assistant_mode: assistantMode,
          thinking_level: thinkingLevel,
          custom_instructions: customInstructions,
          attachment_context: attachmentContext,
          history: history.map(({ role, content }) => ({ role, content })),
        }),
      })
      if (!response.ok) throw new Error('Gil could not answer right now.')
      const data = await response.json()
      setChatMessages((previous) => [...previous, { role: 'assistant', content: data.reply }])
    } catch {
      setChatMessages((previous) => [...previous, { role: 'assistant', content: 'I couldn’t answer right now. Please try again in a moment.' }])
    } finally {
      setSendingChat(false)
    }
  }

  const paragraphs = preview?.content_preview
    ?.split(/\n{2,}/)
    .map((item) => item.trim())
    .filter(Boolean) || []

  return (
    <section className="folio-preview-page">
      <header className="folio-preview-toolbar">
        <Link className="folio-preview-back" href="/organized" aria-label="Back to organized files">
          <ArrowLeft size={17} />
        </Link>
        <div className="folio-preview-title">
          <FolioIcon name="file" size={24} />
          <div>
            <h1>{filename || 'Document preview'}</h1>
            <p>{folder ? `Organized in ${folder}` : 'Folio document preview'}</p>
          </div>
        </div>
        <div className="folio-preview-actions">
          <span>{extension.toUpperCase()} FILE</span>
          {sourceUrl && (
            <button type="button" className="quiet-button" onClick={downloadOriginal}>
              <Download size={15} /> Download original
            </button>
          )}
          <Link className="quiet-button" href="/organized">Done</Link>
        </div>
      </header>

      <main className={`folio-preview-content ${isPdf && !loading && !error ? 'pdf-content' : ''} ${loading || error ? 'center-state' : ''}`}>
        {loading ? (
          <div className="folio-preview-loading">
            <LoaderCircle size={28} className="folio-preview-spinner" />
            <b>Opening {filename}…</b>
            <span>Loading and preparing the in-app preview.</span>
          </div>
        ) : error ? (
          <div className="folio-preview-error">
            <FolioIcon name="file" size={38} />
            <h2>Preview unavailable</h2>
            <p>{error}</p>
            <Link className="primary" href="/organized">Back to organized files</Link>
          </div>
        ) : preview?.is_image || preview?.image_data ? (
          <div className="folio-preview-image-stage">
            <img src={preview.image_data || sourceUrl || ''} alt={filename} />
          </div>
        ) : isPdf ? (
          <section className="folio-pdf-reader" aria-label="PDF preview">
          <div className="folio-pdf-stage" ref={pdfStageRef} onScroll={updateCurrentPdfPage}>
              {!pdfPageUrls.length ? (
                <div className="folio-pdf-page-loading">
                  <LoaderCircle size={24} className="folio-preview-spinner" />
                  <span>Rendering PDF pages…</span>
                </div>
              ) : (
                <div className="folio-pdf-pages">
                  {pdfPageUrls.map((pageUrl, index) => (
                    <figure className="folio-pdf-page-frame" key={`pdf-page-${index}`}>
                      <img
                        className="folio-pdf-page-image"
                        src={pageUrl}
                        alt={`${filename}, page ${index + 1}`}
                        style={{ width: `${pdfZoom}%` }}
                      />
                    </figure>
                  ))}
                </div>
              )}
            </div>
          </section>
        ) : isSpreadsheet && sections.length > 0 ? (
          <div className="folio-preview-sheets">
            {sections.map((sheet, index) => {
              const rows = sheet.split('\n').slice(1).filter(Boolean)
              return (
                <article className="folio-sheet" key={`sheet-${index}`}>
                  <h2>{sheet.split('\n')[0] || `Sheet ${index + 1}`}</h2>
                  <table>
                    <tbody>
                      {rows.map((row, rowIndex) => (
                        <tr key={`row-${rowIndex}`}>
                          {row.split(' | ').map((cell, cellIndex) => (
                            <td key={`cell-${cellIndex}`}>{cell}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </article>
              )
            })}
          </div>
        ) : isPresentation && sections.length > 0 ? (
          <div className="folio-preview-slides">
            {sections.map((slide, index) => (
              <article className="folio-slide" key={`slide-${index}`}>
                <span>{slide.split('\n')[0] || `Slide ${index + 1}`}</span>
                <p>{slide.split('\n').slice(1).join('\n')}</p>
              </article>
            ))}
          </div>
        ) : (
          <article className="folio-document-page">
            <span className="folio-document-kind">{extension.toUpperCase()} DOCUMENT</span>
            <h2>{filename}</h2>
            {paragraphs.length ? paragraphs.map((text, index) => (
              <p key={`paragraph-${index}`}>{text}</p>
            )) : <p>No readable text was found in this document.</p>}
          </article>
        )}
      </main>
      <button type="button" className="side-reader-tab-btn" onClick={() => setAiOpen((open) => !open)} aria-expanded={aiOpen} title="Ask Gil about this file">
        <Image src={aiIconWhite} alt="" width={21} height={21} className="ask-gil-tab-logo" />
        <span className="side-reader-tab-text">Ask Gil</span>
      </button>
      {isPdf && !loading && !error && (
        <div className="folio-preview-bottom-zoom" aria-label="PDF zoom controls">
          <span className="folio-pdf-total-pages">Page {currentPdfPage} of {pdfPageCount || '—'}</span>
          <button type="button" onClick={() => setPdfZoom((zoom) => Math.max(60, zoom - 10))} aria-label="Zoom out">
            <Minus size={15} />
          </button>
          <span>{pdfZoom}%</span>
          <button type="button" onClick={() => setPdfZoom((zoom) => Math.min(160, zoom + 10))} aria-label="Zoom in">
            <Plus size={15} />
          </button>
        </div>
      )}
      {aiOpen && (
        <GilAssistantPanel
          filename={filename}
          folder={folder}
          summary={preview?.summary}
          loading={loading}
          messages={chatMessages}
          input={chatInput}
          sending={sendingChat}
          onInputChange={setChatInput}
          onSend={sendChat}
          onClose={() => setAiOpen(false)}
        />
      )}
    </section>
  )
}
