'use client'

import { FormEvent, useState } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { ArrowRight, Check, Eye, EyeOff, ShieldCheck, Sparkles } from 'lucide-react'
import FolioIcon from './FolioIcon'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

export default function AuthForm({ mode }: { mode: 'register' | 'login' }) {
  const router = useRouter()
  const registering = mode === 'register'
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [checkboss, setCheckboss] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault(); setError(''); setBusy(true)
    try {
      const response = await fetch(`${API}/api/auth/${mode}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, ...(registering ? { checkboss } : {}) }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.detail || 'Could not sign in.')
      localStorage.setItem('folio-user', JSON.stringify(result))
      router.push('/dashboard')
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not connect to the organizer server.') }
    finally { setBusy(false) }
  }

  return <main className="auth-page"><div className="auth-card"><a className="brand" href="/register"><Image src="/logo.png" alt="Folio logo" width={42} height={42} className="brand-logo" priority /> folio<span className="brand-dot">.</span></a><div className="auth-copy"><span className="eyebrow"><Sparkles size={13}/> YOUR FILES, IN ORDER</span><h1>{registering ? <>A little more<br/>room to think.</> : <>Good to have<br/>you back.</>}</h1><p>Bring the scattered pieces together. Folio finds the story in your files and puts everything in its place.</p></div><form onSubmit={submit} className="auth-form"><label>Username<input autoComplete="username" required minLength={3} value={username} onChange={e => setUsername(e.target.value)} placeholder="e.g. alexm"/></label><label>Password<div className="password-wrap"><input autoComplete={registering ? 'new-password' : 'current-password'} required minLength={registering ? 8 : undefined} type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} placeholder={registering ? 'At least 8 characters' : 'Enter your password'}/><button type="button" className="password-toggle" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff size={16}/> : <Eye size={16}/>}</button></div></label>{registering && <label className="check-row"><input type="checkbox" checked={checkboss} onChange={e => setCheckboss(e.target.checked)}/><span>Enable the checkboss option</span><span className="info-tip" title="Saved with your account">i</span></label>}{error && <div className="error">{error}</div>}<button className="primary full" disabled={busy}>{busy ? 'Please wait…' : registering ? 'Create your account' : 'Sign in'}<ArrowRight size={16}/></button></form><p className="switch-auth">{registering ? 'Already have an account?' : 'New to Folio?'} <a href={registering ? '/login' : '/register'}>{registering ? 'Sign in' : 'Create account'}</a></p><div className="auth-foot"><ShieldCheck size={14}/> Your files stay yours. Always.</div></div><div className="auth-aside"><div className="aside-orb orb-a"/><div className="aside-orb orb-b"/><div className="preview-stack"><div className="float-file ff-one"><span className="file-mark coral"><FolioIcon name="file" size={20}/></span><span><b>Q3_strategy.pptx</b><small>Presentation · 24 slides</small></span><span className="tag">strategy</span></div><div className="float-file ff-two"><span className="file-mark blue"><FolioIcon name="file" size={20}/></span><span><b>market_research.pdf</b><small>PDF · 12 pages</small></span><span className="tag">research</span></div><div className="float-file ff-three"><span className="file-mark green"><FolioIcon name="file" size={20}/></span><span><b>audience_notes.docx</b><small>Document · 4 pages</small></span><span className="tag">research</span></div><div className="organizing-line"><span/><span/><span/></div><div className="folder-preview"><div><FolioIcon name="folder" size={22}/><b>Research & insights</b><small>2 files · 16 pages</small></div><Check size={17}/></div><div className="float-caption"><Sparkles size={14}/> A little context goes a long way.</div></div><div className="aside-bottom"><span>LESS SORTING. MORE DOING.</span><span>01 — 05</span></div></div></main>
}
