import Link from 'next/link'

export default function NotFound() {
  return (
    <main className="empty-state" style={{ minHeight: '100vh', display: 'grid', placeContent: 'center' }}>
      <h1>That page isn’t here.</h1>
      <p>Return to Folio and keep organizing your files.</p>
      <Link className="primary" href="/register">Go to Folio</Link>
    </main>
  )
}
