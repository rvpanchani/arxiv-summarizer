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
  const initialParam = useMemo(() => getQueryParam('paper') || '', [])
  const [input, setInput] = useState(initialParam)
  const [activePaper, setActivePaper] = useState(initialParam)
  const paperUrl = useMemo(() => normalizeArxivUrl(activePaper), [activePaper])
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
        const nextUrl = new URL(window.location.href)
        nextUrl.searchParams.set('paper', activePaper)
        window.history.replaceState({}, '', nextUrl.toString())
      } catch (e) {
        setError(e.message || 'Failed to summarize')
        setStatus('error')
      }
    }
    run()
  }, [paperUrl, activePaper])

  function submit(e) {
    e.preventDefault()
    if (!input.trim()) return
    setActivePaper(input.trim())
  }

  return (
    <div className="container fade-in">
      <div className="card header">
        <h1>arXiv Clarity</h1>
        <p className="muted">Turn dense research papers into actionable insight: plain-language summary, innovation breakdown, benchmarks, resources & adoption readiness scores.</p>
        <form className="paper-form" onSubmit={submit}>
          <input
            type="text"
            placeholder="Paste arXiv URL or ID (e.g. 2506.01667)"
            value={input}
            onChange={e => setInput(e.target.value)}
            aria-label="Paper URL or ID"
          />
          <button type="submit" disabled={status === 'loading'}>{status === 'loading' ? 'Summarizing…' : 'Summarize'}</button>
        </form>
        {!activePaper && (
          <pre>{`${window.location.origin}${window.location.pathname}?paper=https://arxiv.org/abs/2506.01667`}</pre>
        )}
        {error && <div className="error" style={{ marginTop: '.5rem' }}>{error}</div>}
      </div>
      {status === 'done' && summary && (
        <StructuredSummaryView data={summary} key={summary.arxiv_id || 'summary'} />
      )}
      {status === 'loading' && (
        <div className="card section" aria-busy="true">Processing paper… extracting metadata & generating structured insight.</div>
      )}
      <footer>
        <div>Summaries generated via server-side Gemini API. No user text stored.</div>
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
    simplified_summary,
    practical_problem,
    impact_potential = [],
    use_cases = [],
    benchmarks = [],
    resources = {},
    reliability_score,
    applicability_score,
    overall_score,
    authors_affiliations = [],
    affiliation_breakdown,
  } = data || {}

  const appShareUrl = useMemo(() => {
    const base = window.location.origin + window.location.pathname
    if (arxiv_abs_url) return `${base}?paper=${encodeURIComponent(arxiv_abs_url)}`
    if (arxiv_pdf_url) return `${base}?paper=${encodeURIComponent(arxiv_pdf_url)}`
    return window.location.href
  }, [arxiv_abs_url, arxiv_pdf_url])

  const shareText = buildShareText({ title, arxiv_abs_url: appShareUrl, one_liner, problems_solved, key_innovations, takeaways }) + `\n\nInteractive summary: ${appShareUrl}`
  const shareMail = `mailto:?subject=${encodeURIComponent(`[Paper Summary] ${title || 'arXiv'}`)}&body=${encodeURIComponent(shareText)}`
  const shareLinkedIn = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(appShareUrl)}`

  const hasCode = !!resources?.code?.length
  const hasVideo = !!resources?.video?.length
  const hasCheckpoints = !!resources?.checkpoints?.length

  const groupedAffiliations = useMemo(() => {
    const groups = {}
    authors_affiliations.forEach(a => {
      const key = (a.affiliation || 'Unspecified').trim()
      groups[key] = groups[key] || []
      groups[key].push(a.name)
    })
    return Object.entries(groups).sort((a,b) => b[1].length - a[1].length)
  }, [authors_affiliations])

  return (
    <div className="grid condensed">
        <div className="card section hero" style={{ gridColumn: '1 / -1' }}>
          <div className="hero-top">
            <div className="hero-main">
              <div className="paper-title">{title || 'Unknown title'}</div>
              <div className="chips">
                <span className={`chip ${hasCode ? 'ok' : 'none'}`}>Code {hasCode ? '✓' : '—'}</span>
                <span className={`chip ${hasCheckpoints ? 'ok' : 'none'}`}>Model {hasCheckpoints ? '✓' : '—'}</span>
                <span className={`chip ${hasVideo ? 'ok' : 'none'}`}>Video {hasVideo ? '✓' : '—'}</span>
                <span className="chip none">Authors {total_authors ?? 0}</span>
                {collaboration_type && <span className="chip warn">{collaboration_type}</span>}
              </div>
            </div>
            {/* Scores moved to dedicated row below for clarity */}
          </div>
          <div className="hero-actions buttons-inline">
            {arxiv_abs_url && <a className="button" href={arxiv_abs_url} target="_blank" rel="noreferrer">Abstract</a>}
            {arxiv_pdf_url && <a className="button" href={arxiv_pdf_url} target="_blank" rel="noreferrer">PDF</a>}
            <button onClick={() => copyToClipboard(shareText)} title="Copy summary text">Copy</button>
            <a className="button" href={shareMail}>Email</a>
            <a className="button share-linkedin" href={shareLinkedIn} target="_blank" rel="noreferrer" title="Share on LinkedIn">
              <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M4.98 3.5a2.5 2.5 0 1 1 0 5.001 2.5 2.5 0 0 1 0-5ZM3 9h4v12H3zM14.25 9c-2.071 0-3.25 1.138-3.25 1.138V9H7v12h4V14.5s0-2.5 2.25-2.5c1.5 0 1.5 1.75 1.5 2.625V21h4v-6.125C18.75 11.25 17.5 9 14.25 9Z"/></svg>
              Share
            </a>
          </div>
          <div className="one-liner"><span className="label">One-Liner</span><p>{one_liner}</p></div>
        </div>

        {(overall_score != null || reliability_score != null || applicability_score != null) && (
          <div className="card section scores-row" style={{ gridColumn: '1 / -1' }}>
            <h2>Adoption & Quality Scores</h2>
            <div className="scores large" title="Derived from reliability (method soundness) & applicability (ease of adoption, openness)">
              {overall_score != null && <Score label="Overall" value={overall_score} />}
              {reliability_score != null && <Score label="Reliability" value={reliability_score} />}
              {applicability_score != null && <Score label="Applicability" value={applicability_score} />}
            </div>
          </div>
        )}

        {simplified_summary && (
          <div className="card section" style={{ gridColumn: '1 / -1' }}>
            <h2>Simplified Summary</h2>
            <p style={{ whiteSpace: 'pre-wrap' }}>{simplified_summary}</p>
          </div>
        )}
        {practical_problem && (
          <div className="card section group-context">
            <h2>Real-World Problem</h2>
            <p>{practical_problem}</p>
          </div>
        )}
        <div className="card section group-context">
          <h2>Pain Points Addressed</h2>
          <List items={problems_solved} />
        </div>
        <div className="card section group-solution">
          <h2>Key Innovations</h2>
          <List items={key_innovations} />
        </div>
        {impact_potential?.length ? (
          <div className="card section group-impact">
            <h2>Impact Potential</h2>
            <List items={impact_potential} />
          </div>
        ) : null}
        {use_cases?.length ? (
          <div className="card section group-impact">
            <h2>Use Cases</h2>
            <List items={use_cases} />
          </div>
        ) : null}
        {benchmarks?.length ? (
          <div className="card section" style={{ gridColumn: '1 / -1' }}>
            <h2>Benchmarks</h2>
            <table className="benchmarks">
              <thead>
                <tr><th>Metric</th><th>Value</th><th>Baseline</th><th>Improvement</th></tr>
              </thead>
              <tbody>
                {benchmarks.map((b,i)=>(
                  <tr key={i}>
                    <td>{b.metric}</td>
                    <td>{b.value || '—'}</td>
                    <td>{b.baseline || '—'}</td>
                    <td>{b.improvement || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        <div className="card section group-outcomes">
          <h2>Takeaways</h2>
          <List items={takeaways} />
        </div>
        {notes?.length ? (
          <div className="card section group-outcomes">
            <h2>Limitations / Notes</h2>
            <List items={notes} />
          </div>
        ) : null}
        {(hasCode || hasVideo || hasCheckpoints) && (
          <div className="card section">
            <h2>Resources</h2>
            <div className="resource-row">
              {resources.code?.map((l,i)=>(<a className="chip ok" key={'c'+i} href={l} target="_blank" rel="noreferrer">Code {i+1}</a>))}
              {resources.video?.map((l,i)=>(<a className="chip ok" key={'v'+i} href={l} target="_blank" rel="noreferrer">Video {i+1}</a>))}
              {resources.checkpoints?.map((l,i)=>(<a className="chip ok" key={'m'+i} href={l} target="_blank" rel="noreferrer">Model {i+1}</a>))}
            </div>
          </div>
        )}
        {/* Scores now moved to hero section */}
        {authors_affiliations?.length ? (
          <div className="card section" style={{ gridColumn: '1 / -1' }}>
            <h2>Authorship & Collaboration</h2>
            {affiliation_breakdown && (
              <div className="chips" style={{ marginBottom: '.6rem' }}>
                <span className="chip">Academia {affiliation_breakdown.Academia}</span>
                <span className="chip">Industry {affiliation_breakdown.Industry}</span>
                <span className="chip">Other {affiliation_breakdown.Other}</span>
                <span className="chip">Total {total_authors}</span>
              </div>
            )}
            {groupedAffiliations.length && groupedAffiliations.every(g=>g[0]==='Unspecified') ? (
              <div className="notice" style={{ fontSize: '.65rem' }}>Detailed affiliations not exposed via arXiv API for this paper (often only present inside the PDF header). Parsing PDF is disabled for performance. </div>
            ) : null}
            <details>
              <summary>Affiliation Groups</summary>
              <div className="aff-groups" style={{ marginTop: '.6rem' }}>
                {groupedAffiliations.map(([aff, names]) => (
                  <div key={aff} className="aff-group">
                    <strong>{aff}</strong>
                    <span>{names.join(', ')}</span>
                  </div>
                ))}
              </div>
            </details>
          </div>
        ) : null}
    </div>
  )
}
function List({ items }) {
  if (!items?.length) return <p style={{ opacity: 0.6 }}>—</p>
  return (
    <ul className="summary">
      {items.map((it, idx) => <li key={idx}>{it}</li>)}
    </ul>
  )
}

function Score({ label, value }) {
  const pct = Math.max(0, Math.min(100, value))
  return (
    <div className="score meter chip" style={{ '--pct': pct + '%' }}>
      <div className="score-bar"><span style={{ '--pct': pct + '%' }} /></div>
      {label}: {pct}
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
