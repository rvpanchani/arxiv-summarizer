export interface Env {
  GOOGLE_API_KEY: string
  ALLOWED_ORIGINS?: string
}

// Very small PDF text extractor for arXiv PDFs using PDF.js is heavy; instead,
// we rely on arXiv's text when available or a simple fallback. For robust parsing,
// you can integrate a PDF-to-text service or Cloudflare AI bindings.

function extractArxivId(input: string): string | null {
  try {
    const u = new URL(input)
    if (!u.hostname.endsWith('arxiv.org')) return null
    const parts = u.pathname.split('/').filter(Boolean)
    const last = (parts.pop() || '').replace(/\.pdf$/i, '')
    return last || null
  } catch {
    return null
  }
}

type ArxivMeta = {
  id: string | null
  title: string | null
  abstract: string | null
  authors: string[]
  absUrl: string | null
  pdfUrl: string | null
}

async function fetchArxivMeta(url: string): Promise<ArxivMeta> {
  const id = extractArxivId(url)
  let title: string | null = null
  let abstract: string | null = null
  let authors: string[] = []
  let absUrl: string | null = null
  let pdfUrl: string | null = null

  if (id) {
    const apiUrl = `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}`
    const res = await fetch(apiUrl)
    if (!res.ok) throw new Error(`arXiv API error ${res.status}`)
    const xml = await res.text()
    // Extract title
    const t = xml.match(/<entry>[\s\S]*?<title>([\s\S]*?)<\/title>/i)
    if (t) title = t[1].replace(/\s+/g, ' ').trim()
    // Extract summary/abstract
    const s = xml.match(/<summary>([\s\S]*?)<\/summary>/i)
    if (s) abstract = s[1].replace(/\s+/g, ' ').trim()
    // Extract authors
    const authorMatches = [...xml.matchAll(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/gi)]
    authors = authorMatches.map(m => m[1].replace(/\s+/g, ' ').trim()).filter(Boolean)
    absUrl = `https://arxiv.org/abs/${id}`
    pdfUrl = `https://arxiv.org/pdf/${id}.pdf`
  } else {
    // Fallback to abs HTML extraction
    try {
      const u = new URL(url)
      if (u.hostname.endsWith('arxiv.org')) {
        const parts = u.pathname.split('/').filter(Boolean)
        const id2 = (parts.pop() || '').replace(/\.pdf$/i, '')
        absUrl = `https://arxiv.org/abs/${id2}`
        pdfUrl = `https://arxiv.org/pdf/${id2}.pdf`
        const res = await fetch(absUrl)
        const html = await res.text()
        const mTitle = html.match(/<h1 class="title">[\s\S]*?<span[^>]*>.*?<\/span>\s*([\s\S]*?)<\/h1>/i)
        if (mTitle) title = mTitle[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
        const m2 = html.match(/<blockquote class="abstract[^"]*">\s*<span[^>]*>.*?<\/span>([\s\S]*?)<\/blockquote>/i)
        if (m2) abstract = m2[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
        const aMatches = [...html.matchAll(/<div class="authors">[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/gi)]
        if (aMatches.length) authors = aMatches.map(m => m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()).filter(Boolean)
      }
    } catch {}
  }

  return { id, title, abstract, authors, absUrl, pdfUrl }
}

type StructuredSummary = {
  title?: string
  arxiv_id?: string | null
  arxiv_abs_url?: string | null
  arxiv_pdf_url?: string | null
  one_liner: string
  problems_solved: string[]
  key_innovations: string[]
  collaboration_type: 'Academia-only' | 'Industry-only' | 'Academia-Industry' | 'Unknown'
  total_authors: number
  authors?: string[]
  takeaways: string[]
  notes?: string[]
}

function buildPrompt(meta: ArxivMeta): string {
  const authorsTxt = meta.authors.length ? `Authors: ${meta.authors.join(', ')}.` : ''
  const titleTxt = meta.title ? `Title: ${meta.title}.` : ''
  const abstractTxt = meta.abstract ? `Abstract: ${meta.abstract}` : ''
  return [
    'Summarize the paper below in a compact, practical, non-academic tone.',
    'Return ONLY valid JSON matching this schema, no prose and no Markdown code fences:',
    '{"one_liner": string, "problems_solved": string[], "key_innovations": string[], "collaboration_type": "Academia-only"|"Industry-only"|"Academia-Industry"|"Unknown", "takeaways": string[], "notes": string[] }',
    'Rules:',
    '- Keep bullets short (<= 12 words), actionable, simple language.',
    '- Prefer 3-6 items per list. Avoid redundancy.',
    '- Infer collaboration_type from any clues (affiliations, context); use Unknown if unclear.',
    titleTxt,
    authorsTxt,
    abstractTxt,
  ].filter(Boolean).join('\n')
}

async function summarizeWithGemini(apiKey: string, meta: ArxivMeta): Promise<StructuredSummary> {
  // Uses Google Generative Language API for Gemini 2.5 Flash
  // See: https://ai.google.dev
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`
  const body = {
    contents: [
      {
        parts: [
          { text: buildPrompt(meta) },
        ],
      },
    ],
  }
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`Gemini error ${res.status}: ${txt}`)
  }
  const data = await res.json()
  // Extract the text output
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || ''
  // Try to extract JSON (handle plain JSON or ```json fenced blocks)
  let jsonStr = text.trim()
  const fenced = jsonStr.match(/```json\s*([\s\S]*?)\s*```/i) || jsonStr.match(/```\s*([\s\S]*?)\s*```/i)
  if (fenced) jsonStr = fenced[1].trim()
  try {
    const parsed = JSON.parse(jsonStr)
    const base: StructuredSummary = {
      one_liner: parsed.one_liner || '',
      problems_solved: Array.isArray(parsed.problems_solved) ? parsed.problems_solved : [],
      key_innovations: Array.isArray(parsed.key_innovations) ? parsed.key_innovations : [],
      collaboration_type: parsed.collaboration_type || 'Unknown',
      takeaways: Array.isArray(parsed.takeaways) ? parsed.takeaways : [],
      notes: Array.isArray(parsed.notes) ? parsed.notes : [],
      total_authors: meta.authors.length,
      authors: meta.authors,
      title: meta.title || undefined,
      arxiv_id: meta.id,
      arxiv_abs_url: meta.absUrl,
      arxiv_pdf_url: meta.pdfUrl,
    }
    // Minimal sanity defaults
    if (!base.one_liner) base.one_liner = meta.abstract ? meta.abstract.slice(0, 150) + '…' : 'Summary unavailable.'
    return base
  } catch {
    // Fallback: build simple structure from text
    const bullets = text.split(/\n+/).map((s: string) => s.replace(/^[-*\d.\s]+/, '').trim()).filter(Boolean)
    return {
      title: meta.title || undefined,
      arxiv_id: meta.id,
      arxiv_abs_url: meta.absUrl,
      arxiv_pdf_url: meta.pdfUrl,
      one_liner: bullets[0] || (meta.abstract ? meta.abstract.slice(0, 150) + '…' : 'Summary unavailable.'),
      problems_solved: bullets.slice(1, 4),
      key_innovations: bullets.slice(4, 7),
      collaboration_type: 'Unknown',
      total_authors: meta.authors.length,
      authors: meta.authors,
      takeaways: bullets.slice(7, 10),
      notes: bullets.slice(10, 12),
    }
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const origin = request.headers.get('origin') || ''
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)
    const isAllowed = allowed.length === 0 || allowed.includes(origin)
    const corsBase: Record<string, string> = {
      'access-control-allow-origin': isAllowed && origin ? origin : 'null',
      'access-control-allow-headers': 'content-type',
      'access-control-allow-methods': 'GET,OPTIONS',
      'vary': 'origin'
    }
    if (url.pathname === '/api/summarize') {
      if (request.method === 'OPTIONS') {
        return new Response(null, { headers: corsBase })
      }
      if (!isAllowed) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'content-type': 'application/json', ...corsBase } })
      }
      const paper = url.searchParams.get('paper')
      if (!paper) return new Response(JSON.stringify({ error: 'Missing paper param' }), { status: 400, headers: { 'content-type': 'application/json', ...corsBase } })
      try {
        const meta = await fetchArxivMeta(paper)
        const structured = await summarizeWithGemini(env.GOOGLE_API_KEY, meta)
        return new Response(JSON.stringify(structured), { headers: { 'content-type': 'application/json', ...corsBase } })
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message || 'Failed to summarize' }), { status: 500, headers: { 'content-type': 'application/json', ...corsBase } })
      }
    }
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsBase })
    }
    return new Response('OK', { headers: corsBase })
  },
}
