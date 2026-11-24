'use client'

import { ReactNode, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname, useRouter } from 'next/navigation'
import { LogOut, Sparkles, Moon, Sun, Settings } from 'lucide-react'
import { WorkspaceProvider, useWorkspace } from './WorkspaceProvider'
import WorkspaceSettingsModal from './WorkspaceSettingsModal'
import FolioIcon from './FolioIcon'

function TopbarBreadcrumb({ pathname, title, username, darkTheme, toggleTheme }: { pathname: string; title: string; username: string; darkTheme: boolean; toggleTheme: () => void }) {
  const { currentFolder, setCurrentFolder, currentFile, setCurrentFile } = useWorkspace()

  const isOrganized = pathname === '/organized'

  return (
    <header className="topbar">
      <span style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
        <Link href="/dashboard" style={{ color: 'inherit', textDecoration: 'none' }}>
          Workspace
        </Link>
        <span className="crumb">/</span>

        {isOrganized && currentFolder ? (
          <>
            <span
              onClick={() => {
                setCurrentFolder(null)
                setCurrentFile(null)
              }}
              style={{ cursor: 'pointer', color: '#687364', textDecoration: 'underline' }}
              title="Return to all folders"
            >
              Organized files
            </span>
            <span className="crumb">/</span>
            <span
              onClick={() => setCurrentFile(null)}
              style={{
                cursor: currentFile ? 'pointer' : 'default',
                color: currentFile ? '#687364' : 'inherit',
                fontWeight: currentFile ? 500 : 700,
                textDecoration: currentFile ? 'underline' : 'none',
              }}
              title={currentFile ? 'Return to folder' : undefined}
            >
              {currentFolder}
            </span>
            {currentFile && (
              <>
                <span className="crumb">/</span>
                <b style={{ color: '#252b22', fontWeight: 700 }}>{currentFile}</b>
              </>
            )}
          </>
        ) : (
          <b>{title}</b>
        )}
      </span>

      <div className="top-actions">
        <span className="today">Your files, at a glance</span>
        <div className="profile-avatar small-avatar">{username[0]?.toUpperCase()}</div>
        <button className="theme-toggle" onClick={toggleTheme} aria-label={`Switch to ${darkTheme ? 'light' : 'dark'} theme`} title={`Switch to ${darkTheme ? 'light' : 'dark'} theme`}>
          {darkTheme ? <Sun size={15} /> : <Moon size={15} />}
          <span>{darkTheme ? 'Light mode' : 'Dark mode'}</span>
        </button>
      </div>
    </header>
  )
}

export default function WorkspaceFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [username, setUsername] = useState('')
  const [darkTheme, setDarkTheme] = useState(false)
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [defaultUploadMode, setDefaultUploadMode] = useState<'upload' | 'local'>('upload')
  const accountMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setDarkTheme(localStorage.getItem('folio-theme') === 'dark')
    setDefaultUploadMode(localStorage.getItem('folio-default-upload-mode') === 'local' ? 'local' : 'upload')
    const saved = localStorage.getItem('folio-user')
    if (!saved) {
      router.replace('/login')
      return
    }
    try {
      setUsername(JSON.parse(saved).username || '')
    } catch {
      localStorage.removeItem('folio-user')
      router.replace('/login')
    }
  }, [router])

  useEffect(() => {
    if (!settingsOpen) return
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setSettingsOpen(false)
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [settingsOpen])

  useEffect(() => {
    if (!accountMenuOpen) return
    function closeOnOutsideClick(event: MouseEvent) {
      if (event.target instanceof Node && !accountMenuRef.current?.contains(event.target)) setAccountMenuOpen(false)
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setAccountMenuOpen(false)
    }
    document.addEventListener('mousedown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [accountMenuOpen])

  function signOut() {
    localStorage.removeItem('folio-user')
    router.replace('/login')
  }

  function toggleTheme() {
    const next = !darkTheme
    const root = document.documentElement
    const transitionRoot = document as Document & {
      startViewTransition?: (callback: () => void) => { finished: Promise<void> }
    }
    const updateTheme = () => {
      setDarkTheme(next)
      localStorage.setItem('folio-theme', next ? 'dark' : 'light')
    }

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !transitionRoot.startViewTransition) {
      updateTheme()
      return
    }

    root.classList.remove('theme-reveal-dark', 'theme-reveal-light')
    root.classList.add(next ? 'theme-reveal-dark' : 'theme-reveal-light')
    const transition = transitionRoot.startViewTransition(updateTheme)
    const clearRevealClass = () => root.classList.remove('theme-reveal-dark', 'theme-reveal-light')
    transition.finished.then(clearRevealClass, clearRevealClass)
  }

  function chooseDefaultUploadMode(mode: 'upload' | 'local') {
    setDefaultUploadMode(mode)
    localStorage.setItem('folio-default-upload-mode', mode)
  }

  if (!username) return <div className="loading-screen">Opening your workspace…</div>

  const links = [
    { href: '/dashboard', label: 'Dashboard', folioIcon: 'workspace' as const },
    { href: '/uploads', label: 'Uploads', folioIcon: 'upload' as const },
    { href: '/organized', label: 'Organized', folioIcon: 'folder' as const },
  ]
  const title = pathname === '/uploads'
    ? 'Uploads'
    : pathname === '/organized'
      ? 'Organized files'
      : pathname === '/preview'
        ? 'Document preview'
        : 'Overview'

  return (
    <WorkspaceProvider>
      <div className="app-shell" data-theme={darkTheme ? 'dark' : 'light'}>
        <aside className="sidebar">
          <Link className="brand" href="/dashboard">
            <Image src="/logo.png" alt="Folio logo" width={38} height={38} className="brand-logo" priority /> folio
            <span className="brand-dot">.</span>
          </Link>
          <div className="workspace-label">WORKSPACE</div>
          <div className="workspace-card">
            <div className="workspace-avatar">{username[0]?.toUpperCase()}</div>
            <span>
              <b>{username}&apos;s space</b>
              <small>Personal workspace</small>
            </span>
          </div>
          <nav>
            <span className="nav-heading">PAGES</span>
            {links.map(({ href, label, folioIcon }) => (
              <Link key={href} className={`nav-link ${pathname === href ? 'active' : ''}`} href={href}>
                <FolioIcon name={folioIcon} size={18} className="nav-folder-image" />
                {label}
              </Link>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <div className="help-card">
              <Sparkles size={16} />
              <b>
                Good files,
                <br />
                good thoughts.
              </b>
              <small>Give your ideas a little space to find each other.</small>
            </div>
            <div className="profile-menu-wrap" ref={accountMenuRef}>
              {accountMenuOpen && (
                <div className="account-popover" role="menu" aria-label="Account menu">
                  <div className="account-popover-summary">
                    <div className="profile-avatar">{username[0]?.toUpperCase()}</div>
                    <span><b>{username}</b><small>Personal account</small></span>
                  </div>
                  <div className="account-popover-divider" />
                  <button className="account-menu-item" type="button" role="menuitem" onClick={() => { setAccountMenuOpen(false); setSettingsOpen(true) }}>
                    <Settings size={17} />
                    <span><b>Settings</b><small>AI, files, memory, and account</small></span>
                  </button>
                  <div className="account-popover-divider" />
                  <button className="account-menu-item account-menu-logout" type="button" role="menuitem" onClick={signOut}>
                    <LogOut size={17} />
                    <span><b>Log out</b></span>
                  </button>
                </div>
              )}
              <div className="profile">
                <button
                  className="profile-account-button"
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded={accountMenuOpen}
                  onClick={() => setAccountMenuOpen((open) => !open)}
                >
                  <div className="profile-avatar">{username[0]?.toUpperCase()}</div>
                  <span>
                    <b>{username}</b>
                    <small>Personal account</small>
                  </span>
                </button>
                <button className="profile-logout" type="button" onClick={signOut} aria-label="Log out" title="Log out">
                  <LogOut size={16} />
                </button>
              </div>
            </div>
          </div>
        </aside>

        <main className="main-content">
          <TopbarBreadcrumb pathname={pathname} title={title} username={username} darkTheme={darkTheme} toggleTheme={toggleTheme} />
          {children}
        </main>
        {settingsOpen && (
          <WorkspaceSettingsModal
            username={username}
            darkTheme={darkTheme}
            toggleTheme={toggleTheme}
            defaultUploadMode={defaultUploadMode}
            onUploadModeChange={chooseDefaultUploadMode}
            onSignOut={signOut}
            onClose={() => setSettingsOpen(false)}
          />
        )}
      </div>
    </WorkspaceProvider>
  )
}
