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
  authorsDetailed: { name: string; affiliation?: string | null; category: 'Academia' | 'Industry' | 'Other' }[]
  codeLinks: string[]
  videoLinks: string[]
  modelLinks: string[]
}

async function fetchArxivMeta(url: string): Promise<ArxivMeta> {
  const id = extractArxivId(url)
  let title: string | null = null
  let abstract: string | null = null
  let authors: string[] = []
  let absUrl: string | null = null
  let pdfUrl: string | null = null
  let authorsDetailed: { name: string; affiliation?: string | null; category: 'Academia' | 'Industry' | 'Other' }[] = []
  const codeLinks: string[] = []
  const videoLinks: string[] = []
  const modelLinks: string[] = []

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
    const authorBlocks = [...xml.matchAll(/<author>([\s\S]*?)<\/author>/gi)]
    authorBlocks.forEach(block => {
      const raw = block[1]
      const nameMatch = raw.match(/<name>([\s\S]*?)<\/name>/i)
      const affMatch = raw.match(/<arxiv:affiliation[^>]*>([\s\S]*?)<\/arxiv:affiliation>/i)
      const name = nameMatch ? nameMatch[1].replace(/\s+/g, ' ').trim() : null
      if (name) {
        authors.push(name)
        const affiliation = affMatch ? affMatch[1].replace(/\s+/g, ' ').trim() : null
        authorsDetailed.push({ name, affiliation, category: categorizeAffiliation(affiliation) })
      }
    })
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
        if (aMatches.length) {
          authors = aMatches.map(m => m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()).filter(Boolean)
          authorsDetailed = authors.map(name => ({ name, affiliation: null, category: 'Other' }))
        }
        // Resource links
        const linkMatches = [...html.matchAll(/<a[^>]+href="(https?:[^"#]+)"/gi)]
        linkMatches.forEach(m => {
          const link = m[1].replace(/&amp;/g, '&').trim()
            .replace(/#.*$/, '')
          if (/github\.com\//i.test(link)) codeLinks.push(link)
          else if (/youtu(be)?\.com|vimeo\.com/i.test(link)) videoLinks.push(link)
          else if (/huggingface\.co\//i.test(link)) modelLinks.push(link)
        })
      }
    } catch {}
  }

  return { id, title, abstract, authors, absUrl, pdfUrl, authorsDetailed, codeLinks, videoLinks, modelLinks }
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
  simplified_summary?: string
  practical_problem?: string
  impact_potential?: string[]
  use_cases?: string[]
  benchmarks?: { metric: string; value?: string; baseline?: string; improvement?: string }[]
  resources?: { code?: string[]; video?: string[]; checkpoints?: string[] }
  reliability_score?: number
  applicability_score?: number
  overall_score?: number
  authors_affiliations?: { name: string; affiliation?: string | null; category: string }[]
  affiliation_breakdown?: { Academia: number; Industry: number; Other: number }
}

function buildPrompt(meta: ArxivMeta): string {
  const authorsTxt = meta.authors.length ? `Authors: ${meta.authors.join(', ')}.` : ''
  const affiliationsTxt = meta.authorsDetailed?.length ? `Affiliations: ${meta.authorsDetailed.map(a => `${a.name}${a.affiliation ? ' (' + a.affiliation + ')' : ''}`).join('; ')}.` : ''
  const titleTxt = meta.title ? `Title: ${meta.title}.` : ''
  const abstractTxt = meta.abstract ? `Abstract: ${meta.abstract}` : ''
  const resourcesPrompt = [
    meta.codeLinks.length ? `Code links observed: ${meta.codeLinks.join(', ')}` : null,
    meta.videoLinks.length ? `Video links observed: ${meta.videoLinks.join(', ')}` : null,
    meta.modelLinks.length ? `Model/checkpoint links observed: ${meta.modelLinks.join(', ')}` : null,
  ].filter(Boolean).join('\n')
  return [
    'You are an assistant creating a practitioner-friendly structured summary of a research paper.',
    'Return ONLY strict JSON (no markdown fences) matching this full schema:',
    '{"one_liner": string, "simplified_summary": string, "practical_problem": string, "problems_solved": string[], "key_innovations": string[], "impact_potential": string[], "use_cases": string[], "benchmarks": [{"metric": string, "value": string, "baseline": string, "improvement": string}], "collaboration_type": "Academia-only"|"Industry-only"|"Academia-Industry"|"Unknown", "takeaways": string[], "notes": string[], "resources": {"code": string[], "video": string[], "checkpoints": string[]}, "reliability_score": number, "applicability_score": number, "overall_score": number }',
    'Definitions & Rules:',
    '- one_liner: <= 25 words plain language value prop.',
    '- simplified_summary: Plain, non-academic explanation (<=300 words) covering what, how, why it matters.',
    '- practical_problem: Real-world problem addressed in one concise sentence.',
    '- problems_solved: 3-6 concrete pain points; each <= 12 words.',
    '- key_innovations: 3-6 technical or methodological novelties.',
    '- impact_potential: 3-5 bullets broader potential (societal/economic/scientific).',
    '- use_cases: 3-6 practical scenarios.',
    '- benchmarks: Only include reported quantitative results. {metric, value, baseline, improvement}. No invention. [] if none.',
    '- collaboration_type: Infer from affiliations; Academia-Industry if >=1 of each.',
    '- takeaways: 3-6 actionable distilled lessons.',
    '- notes: Limitations/risks (0-5).',
    '- resources.*: Only URLs given or clearly present; no hallucinated domains.',
    '- reliability_score: 0-100 (soundness: clarity, evidence, benchmarks, openness).',
    '- applicability_score: 0-100 (ease of adoption, code/resources, clarity).',
    '- overall_score: Weighted 0-100 (0.6*reliability + 0.4*applicability).',
    '- NEVER fabricate benchmarks or links. Use empty collections if absent.',
    '- Keep wording neutral, concise, concrete. No hype.',
    titleTxt,
    authorsTxt,
    affiliationsTxt,
    abstractTxt,
    resourcesPrompt,
  ].filter(Boolean).join('\n')
}

function categorizeAffiliation(aff?: string | null): 'Academia' | 'Industry' | 'Other' {
  if (!aff) return 'Other'
  const a = aff.toLowerCase()
  if (/(univ|institute|college|school|laborator|centre|center)/.test(a)) return 'Academia'
  if (/(inc|corp|labs|technolog|systems|company|ltd|llc|google|microsoft|meta|ibm|amazon|nvidia|openai|deepmind)/.test(a)) return 'Industry'
  return 'Other'
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
    const rel = typeof parsed.reliability_score === 'number' ? parsed.reliability_score : null
    const app = typeof parsed.applicability_score === 'number' ? parsed.applicability_score : null
    const overall = typeof parsed.overall_score === 'number' ? parsed.overall_score : (rel != null && app != null ? Math.round(rel * 0.6 + app * 0.4) : null)
    const affiliationBreakdown = meta.authorsDetailed.reduce((acc, a) => { (acc as any)[a.category] = ((acc as any)[a.category] || 0) + 1; return acc }, { Academia: 0, Industry: 0, Other: 0 } as { Academia: number; Industry: number; Other: number })
    const base: StructuredSummary = {
      one_liner: parsed.one_liner || '',
      simplified_summary: parsed.simplified_summary || undefined,
      practical_problem: parsed.practical_problem || undefined,
      problems_solved: Array.isArray(parsed.problems_solved) ? parsed.problems_solved : [],
      key_innovations: Array.isArray(parsed.key_innovations) ? parsed.key_innovations : [],
      impact_potential: Array.isArray(parsed.impact_potential) ? parsed.impact_potential : [],
      use_cases: Array.isArray(parsed.use_cases) ? parsed.use_cases : [],
      benchmarks: Array.isArray(parsed.benchmarks) ? parsed.benchmarks : [],
      collaboration_type: parsed.collaboration_type || inferCollabType(meta.authorsDetailed),
      takeaways: Array.isArray(parsed.takeaways) ? parsed.takeaways : [],
      notes: Array.isArray(parsed.notes) ? parsed.notes : [],
      resources: {
        code: Array.isArray(parsed?.resources?.code) ? parsed.resources.code : meta.codeLinks,
        video: Array.isArray(parsed?.resources?.video) ? parsed.resources.video : meta.videoLinks,
        checkpoints: Array.isArray(parsed?.resources?.checkpoints) ? parsed.resources.checkpoints : meta.modelLinks,
      },
      reliability_score: rel ?? undefined,
      applicability_score: app ?? undefined,
      overall_score: overall ?? undefined,
      total_authors: meta.authors.length,
      authors: meta.authors,
      authors_affiliations: meta.authorsDetailed,
      affiliation_breakdown: affiliationBreakdown,
      title: meta.title || undefined,
      arxiv_id: meta.id,
      arxiv_abs_url: meta.absUrl,
      arxiv_pdf_url: meta.pdfUrl,
    }
    if (!base.one_liner) base.one_liner = meta.abstract ? meta.abstract.slice(0, 150) + '…' : 'Summary unavailable.'
    return base
  } catch {
    // Fallback: build simple structure from text
    const bullets = text.split(/\n+/).map((s: string) => s.replace(/^[-*\d.\s]+/, '').trim()).filter(Boolean)
    const affiliationBreakdown = meta.authorsDetailed.reduce((acc, a) => { (acc as any)[a.category] = ((acc as any)[a.category] || 0) + 1; return acc }, { Academia: 0, Industry: 0, Other: 0 } as { Academia: number; Industry: number; Other: number })
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
      simplified_summary: meta.abstract?.slice(0, 300) + '…',
      benchmarks: [],
      resources: { code: meta.codeLinks, video: meta.videoLinks, checkpoints: meta.modelLinks },
      authors_affiliations: meta.authorsDetailed,
      affiliation_breakdown: affiliationBreakdown,
    }
  }
}

function inferCollabType(list: { category: 'Academia' | 'Industry' | 'Other' }[]): 'Academia-only' | 'Industry-only' | 'Academia-Industry' | 'Unknown' {
  if (!list.length) return 'Unknown'
  const hasAcad = list.some(a => a.category === 'Academia')
  const hasInd = list.some(a => a.category === 'Industry')
  if (hasAcad && hasInd) return 'Academia-Industry'
  if (hasAcad) return 'Academia-only'
  if (hasInd) return 'Industry-only'
  return 'Unknown'
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
