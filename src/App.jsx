import { useEffect, useMemo, useState } from 'react'
import './App.css'

function getQueryParam(name) {
  const params = new URLSearchParams(window.location.search)
  return params.get(name)
}

function normalizeArxivUrl(url) {
  if (!url) return null
  try {
    const u = new URL(url)
    // Accept /abs/ or /pdf/, normalize to PDF URL for fetching text later
    if (u.hostname.endsWith('arxiv.org')) {
      const parts = u.pathname.split('/').filter(Boolean)
      const id = parts.pop()
      if (parts.includes('pdf')) return `https://arxiv.org/pdf/${id}`
      if (parts.includes('abs')) return `https://arxiv.org/pdf/${id}.pdf`
    }
    return url
  } catch {
    return url
  }
}

function App() {
  const paperParamRaw = useMemo(() => getQueryParam('paper'), [])
  const paperUrl = useMemo(() => normalizeArxivUrl(paperParamRaw), [paperParamRaw])
  const [status, setStatus] = useState('idle') // idle|loading|done|error
  const [summary, setSummary] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    async function run() {
      if (!paperUrl) return
      setStatus('loading')
      setError('')
      setSummary('')
      try {
        const backendUrl = import.meta.env.VITE_API_BASE || ''
        const res = await fetch(`${backendUrl}/api/summarize?paper=${encodeURIComponent(paperUrl)}`)
        if (!res.ok) throw new Error(`Backend error ${res.status}`)
        const data = await res.json()
        if (data.error) throw new Error(data.error)
        setSummary(data)
        setStatus('done')
      } catch (e) {
        setError(e.message || 'Failed to summarize')
        setStatus('error')
      }
    }
    run()
  }, [paperUrl])

  return (
    <div className="container">
      <h1>arXiv Summarizer</h1>
      <p>Use <code>?paper=</code> with an arXiv URL. Example:</p>
      <pre>
        {`${window.location.origin}${window.location.pathname}?paper=https://arxiv.org/abs/2506.01667`}
      </pre>
      {!paperParamRaw && (
        <div className="notice">Add a <code>paper</code> param to begin.</div>
      )}
      {paperParamRaw && (
        <div className="card">
          <div className="row">
            <div>
              <div className="label">Paper</div>
              <a href={paperUrl} target="_blank" rel="noreferrer">{paperUrl}</a>
            </div>
          </div>
          {status === 'loading' && <div className="loading">Summarizing…</div>}
          {status === 'error' && <div className="error">{error}</div>}
          {status === 'done' && summary && (
            <StructuredSummaryView data={summary} />
          )}
        </div>
      )}
      <footer>
        <small>Summaries generated via server-side Gemini API.</small>
      </footer>
    </div>
  )
}

export default App

function StructuredSummaryView({ data }) {
  const {
    title,
    arxiv_abs_url,
    arxiv_pdf_url,
    one_liner,
    problems_solved = [],
    key_innovations = [],
    collaboration_type,
    total_authors,
    authors = [],
    takeaways = [],
    notes = [],
  } = data || {}

  const shareText = buildShareText({ title, arxiv_abs_url, one_liner, problems_solved, key_innovations, takeaways })
  const shareMail = `mailto:?subject=${encodeURIComponent(`[Paper Summary] ${title || 'arXiv'}`)}&body=${encodeURIComponent(shareText)}`
  const shareLinkedIn = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(arxiv_abs_url || arxiv_pdf_url || window.location.href)}`

  return (
    <div>
      <div className="row">
        <div>
          <div className="label">Title</div>
          <div>{title || 'Unknown title'}</div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button onClick={() => copyToClipboard(shareText)}>Copy</button>
          <a className="button" href={shareMail}>Email</a>
          <a className="button" href={shareLinkedIn} target="_blank" rel="noreferrer">LinkedIn</a>
        </div>
      </div>

      <div className="row" style={{ marginTop: '0.75rem' }}>
        <div>
          <div className="label">Links</div>
          <div style={{ display: 'flex', gap: '1rem' }}>
            {arxiv_abs_url && <a href={arxiv_abs_url} target="_blank" rel="noreferrer">arXiv Abs</a>}
            {arxiv_pdf_url && <a href={arxiv_pdf_url} target="_blank" rel="noreferrer">PDF</a>}
          </div>
        </div>
        <div>
          <div className="label">Authors</div>
          <div>{total_authors ?? 0} {total_authors === 1 ? 'author' : 'authors'}</div>
        </div>
      </div>

      <Section title="One-line Summary">
        <p>{one_liner}</p>
      </Section>
      <Section title="Problems Solved" items={problems_solved} />
      <Section title="Key Innovations" items={key_innovations} />
      <Section title="Collaboration Type">
        <p>{collaboration_type || 'Unknown'}</p>
        {authors?.length ? <details><summary>Authors</summary><ul>{authors.map((a,i)=>(<li key={i}>{a}</li>))}</ul></details> : null}
      </Section>
      <Section title="Takeaways" items={takeaways} />
      {notes?.length ? <Section title="Things to Note" items={notes} /> : null}
    </div>
  )
}

function Section({ title, items, children }) {
  return (
    <div style={{ marginTop: '1rem' }}>
      <div className="label">{title}</div>
      {items ? (
        <ul className="summary">
          {items.map((it, idx) => <li key={idx}>{it}</li>)}
        </ul>
      ) : (
        <div className="summary">{children}</div>
      )}
    </div>
  )
}

function buildShareText({ title, arxiv_abs_url, one_liner, problems_solved, key_innovations, takeaways }) {
  const lines = []
  if (title) lines.push(`Title: ${title}`)
  if (arxiv_abs_url) lines.push(`Link: ${arxiv_abs_url}`)
  if (one_liner) lines.push(`\nOne-liner: ${one_liner}`)
  if (problems_solved?.length) {
    lines.push('\nProblems solved:')
    problems_solved.forEach(b => lines.push(`- ${b}`))
  }
  if (key_innovations?.length) {
    lines.push('\nKey innovations:')
    key_innovations.forEach(b => lines.push(`- ${b}`))
  }
  if (takeaways?.length) {
    lines.push('\nTakeaways:')
    takeaways.forEach(b => lines.push(`- ${b}`))
  }
  return lines.join('\n')
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text)
    // Soft feedback without alert spam
  } catch (e) {
    console.error('Copy failed', e)
  }
}

function escapeHtml(s) {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function renderMarkdownish(input) {
  const lines = (input || '').replaceAll('\r\n', '\n').split('\n')
  const out = []
  let inCode = false
  let inList = false
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]
    if (line.trim().startsWith('```')) {
      if (!inCode) {
        inCode = true
        out.push('<pre><code>')
      } else {
        inCode = false
        out.push('</code></pre>')
      }
      continue
    }
    if (inCode) {
      out.push(escapeHtml(line))
      continue
    }
    // Headings
    if (/^\s*#{1,6}\s+/.test(line)) {
      const level = Math.min(6, line.match(/^\s*(#+)/)[1].length)
      const content = escapeHtml(line.replace(/^\s*#{1,6}\s+/, ''))
      if (inList) { out.push('</ul>'); inList = false }
      out.push(`<h${level}>${content}</h${level}>`)
      continue
    }
    // Bulleted or numbered lists
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      if (!inList) { out.push('<ul>'); inList = true }
      const item = escapeHtml(line.replace(/^\s*([-*]|\d+\.)\s+/, ''))
      out.push(`<li>${item}</li>`)
      continue
    }
    // Blank line
    if (line.trim() === '') {
      if (inList) { out.push('</ul>'); inList = false }
      out.push('<p></p>')
      continue
    }
    // Paragraph
    const para = escapeHtml(line)
    if (inList) { out.push('</ul>'); inList = false }
    out.push(`<p>${para}</p>`)
  }
  if (inList) out.push('</ul>')
  if (inCode) out.push('</code></pre>')
  return out.join('\n')
}
