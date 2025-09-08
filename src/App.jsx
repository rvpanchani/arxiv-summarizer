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
  const [summary, setSummary] = useState('')
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
        setSummary(data.summary)
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
          {status === 'done' && (
            <div>
              <div className="label">Summary</div>
              <SummaryView text={summary} />
            </div>
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

function SummaryView({ text }) {
  const html = useMemo(() => renderMarkdownish(text || ''), [text])
  return <div className="summary markdown" dangerouslySetInnerHTML={{ __html: html }} />
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
