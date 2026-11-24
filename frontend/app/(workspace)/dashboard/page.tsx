'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import {
  ArrowRight,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import { useWorkspace } from '@/components/WorkspaceProvider'
import FolioIcon from '@/components/FolioIcon'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

type StatsData = {
  username: string
  checkboss: boolean
  total_organized_files: number
  total_folders_created: number
  total_jobs: number
  recent_folders: { name: string; count: number }[]
}

export default function DashboardPage() {
  const { files, organization, folderHistory, setCurrentFolder, setCurrentFile, scanLocalFolder } = useWorkspace()
  const [stats, setStats] = useState<StatsData | null>(null)

  useEffect(() => {
    const user = JSON.parse(localStorage.getItem('folio-user') || 'null')
    if (user?.token) {
      fetch(`${API}/api/dashboard/stats`, {
        headers: { Authorization: `Bearer ${user.token}` },
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data) setStats(data)
        })
        .catch(() => {})
    }
  }, [organization])

  const totalFiles = (stats?.total_organized_files || 0) + (organization?.count || 0)
  const totalFolders = (stats?.total_folders_created || 0) + (organization?.folders.length || 0)
  const recentFolders = [...folderHistory]
    .sort((first, second) => new Date(second.date).getTime() - new Date(first.date).getTime())
    .slice(0, 4)

  return (
    <div className="content-wrap">
      <div className="greeting">
        <div>
          <div className="eyebrow">YOUR PERSONAL WORKSPACE</div>
          <h1>
            Make room for <em>what matters.</em>
          </h1>
          <p>Bring in scattered slides, documents, and downloads, and give them a place to belong.</p>
        </div>
        <div className="greeting-icon">
          <Sparkles size={24} />
        </div>
      </div>

      <section className="dashboard-workspace-grid">
        <div className="upload-card workspace-stat-card">
          <Image src="/file-icon.svg" alt="" width={34} height={34} aria-hidden="true" />
          <strong>{files.length}</strong>
          <span>files in queue</span>
        </div>
        <div className="upload-card workspace-stat-card">
          <Image src="/folder-icon.png" alt="" width={38} height={34} aria-hidden="true" />
          <strong>{totalFolders}</strong>
          <span>folders created</span>
        </div>
        <div className="upload-card workspace-stat-card">
          <Image src="/folder-open-icon.svg" alt="" width={38} height={38} aria-hidden="true" />
          <strong>{totalFiles}</strong>
          <span>files organized</span>
        </div>
      </section>

      <section className="dashboard-recent-section" aria-labelledby="dashboard-recent-title">
        <div className="dashboard-recent-heading">
          <div>
            <div className="mini-label">PICK UP WHERE YOU LEFT OFF</div>
            <h2 id="dashboard-recent-title">Recent folders</h2>
          </div>
          <Link href="/organized" className="dashboard-recent-view-all">View all <ArrowRight size={13} /></Link>
        </div>
        {recentFolders.length ? (
          <div className="dashboard-recent-list">
            {recentFolders.map((folder) => (
              <Link
                key={folder.id}
                href="/organized"
                className="dashboard-recent-card"
                onClick={() => {
                  setCurrentFolder(folder.name)
                  setCurrentFile(null)
                }}
              >
                <FolioIcon name="folderOpen" size={54} />
                <span className="dashboard-recent-card-copy">
                  <b>{folder.name}</b>
                  <small>{folder.count} {folder.count === 1 ? 'item' : 'items'}</small>
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <div className="dashboard-recent-empty">Your recently organized folders will appear here.</div>
        )}
      </section>

      {/* Quick Local Folder Actions */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '15px', marginTop: '15px' }}>
        <div className="how-card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            <div className="mini-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <FolioIcon name="computer" size={15} /> QUICK SCAN
            </div>
            <h3 style={{ marginTop: '8px' }}>Desktop Cleanup</h3>
            <p>Scan your Desktop for loose files not currently in folders and categorize them by context.</p>
          </div>
          <Link
            className="quiet-button"
            style={{ marginTop: '14px', width: 'fit-content' }}
            href="/uploads"
            onClick={() => scanLocalFolder('Desktop')}
          >
            Scan Desktop <ArrowRight size={13} />
          </Link>
        </div>

        <div className="how-card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            <div className="mini-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <FolioIcon name="folder" size={15} /> QUICK SCAN
            </div>
            <h3 style={{ marginTop: '8px' }}>Downloads Cleanup</h3>
            <p>Scan loose downloads, extract their content, and sort into organized subject folders.</p>
          </div>
          <Link
            className="quiet-button"
            style={{ marginTop: '14px', width: 'fit-content' }}
            href="/uploads"
            onClick={() => scanLocalFolder('Downloads')}
          >
            Scan Downloads <ArrowRight size={13} />
          </Link>
        </div>

        <div className="how-card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            <div className="mini-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <FolioIcon name="file" size={15} /> QUICK SCAN
            </div>
            <h3 style={{ marginTop: '8px' }}>Documents Cleanup</h3>
            <p>Scan your Documents folder for scattered notes and files to organize into subject folders.</p>
          </div>
          <Link
            className="quiet-button"
            style={{ marginTop: '14px', width: 'fit-content' }}
            href="/uploads"
            onClick={() => scanLocalFolder('Documents')}
          >
            Scan Documents <ArrowRight size={13} />
          </Link>
        </div>
      </div>

      <div className="lower-grid">
        <section className="how-card">
          <div className="mini-label">A THOUGHTFUL LITTLE PROCESS</div>
          <h3>From scattered to sorted.</h3>
          <p>Folio reads slide and document content, spots common themes, and gives each group a home.</p>
          <div className="steps">
            <div>
              <span>01</span>
              <div>
                <b>Bring it in</b>
                <small>Select slides, files or a folder.</small>
              </div>
            </div>
            <ArrowRight size={15} />
            <div>
              <span>02</span>
              <div>
                <b>Find the thread</b>
                <small>Related ideas come together.</small>
              </div>
            </div>
            <ArrowRight size={15} />
            <div>
              <span>03</span>
              <div>
                <b>Take it with you</b>
                <small>Download ZIP or move locally.</small>
              </div>
            </div>
          </div>
        </section>

        <section className="privacy-card">
          <div className="privacy-icon">
            <ShieldCheck size={19} />
          </div>
          <div className="mini-label">A NOTE ON PRIVACY</div>
          <h3>Your files stay yours.</h3>
          <p>
            Files uploaded to the web system are analyzed in memory to produce your ZIP and are not retained on the
            server.
          </p>
        </section>
      </div>

      <div className="footnote">
        <span>MADE FOR A CLEARER KIND OF WORK.</span>
        <span>FOLIO © 2026</span>
      </div>
    </div>
  )
}
