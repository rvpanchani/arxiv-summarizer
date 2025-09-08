export interface Env {
  GOOGLE_API_KEY: string
  ALLOWED_ORIGINS?: string
}

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

function normalizePaperInput(input: string): string {
  input = input.trim()
  // Check if it's already a URL
  try {
    const url = new URL(input)
    if (url.hostname === 'arxiv.org') {
      const pathParts = url.pathname.split('/').filter(Boolean)
      if (pathParts[0] === 'abs' && pathParts[1]) {
        // Already abs URL
        return input
      } else if (pathParts[0] === 'pdf' && pathParts[1]) {
        // PDF URL, convert to abs
        const id = pathParts[1].replace(/\.pdf$/i, '')
        return `https://arxiv.org/abs/${id}`
      } else if (pathParts.length === 1) {
        // Probably ID in path
        const id = pathParts[0].replace(/\.pdf$/i, '')
        return `https://arxiv.org/abs/${id}`
      }
    } else {
      // Non-arXiv URL, prepare HTML archive URL
      return `https://web.archive.org/web/2/${input}`
    }
  } catch {
    // Not a URL, assume arXiv ID
    return `https://arxiv.org/abs/${input}`
  }
  // Fallback, though shouldn't reach
  return input
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

function buildPrompt(paperMeta: ArxivMeta): string {
  const { title, abstract, authors, absUrl, pdfUrl, id } = paperMeta
  return [
    'You are an assistant creating a practitioner-friendly structured summary of a research paper.',
    'Here is the paper information:',
    `Title: ${title || 'Unknown'}`,
    `arXiv ID: ${id || 'Unknown'}`,
    `Abstract: ${abstract || 'No abstract available'}`,
    `Authors: ${authors.join(', ') || 'Unknown authors'}`,
    `Abstract URL: ${absUrl || 'Unknown'}`,
    `PDF URL: ${pdfUrl || 'Unknown'}`,
    '',
    'Based on this paper information, create a structured summary and return ONLY strict JSON (no markdown fences) matching this full schema:',
    '{"title": string, "arxiv_id": string, "arxiv_abs_url": string, "arxiv_pdf_url": string, "one_liner": string, "simplified_summary": string, "practical_problem": string, "problems_solved": string[], "key_innovations": string[], "impact_potential": string[], "use_cases": string[], "benchmarks": [{"metric": string, "value": string, "baseline": string, "improvement": string}], "collaboration_type": "Academia-only"|"Industry-only"|"Academia-Industry"|"Unknown", "takeaways": string[], "notes": string[], "resources": {"code": string[], "video": string[], "checkpoints": string[]}, "reliability_score": number, "applicability_score": number, "overall_score": number, "total_authors": number, "authors": string[], "authors_affiliations": [{"name": string, "affiliation": string, "category": string}], "affiliation_breakdown": {"Academia": number, "Industry": number, "Other": number}}',
    'Definitions & Rules:',
    '- title: The paper title.',
    '- arxiv_id: The arXiv ID if applicable.',
    '- arxiv_abs_url: The abstract URL.',
    '- arxiv_pdf_url: The PDF URL.',
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
    '- resources.*: Only URLs found in the paper or clearly present; no hallucinated domains.',
    '- reliability_score: 0-100 (soundness: clarity, evidence, benchmarks, openness).',
    '- applicability_score: 0-100 (ease of adoption, code/resources, clarity).',
    '- overall_score: Weighted 0-100 (0.6*reliability + 0.4*applicability).',
    '- total_authors: Number of authors.',
    '- authors: List of author names.',
    '- authors_affiliations: List with name, affiliation, category (Academia/Industry/Other).',
    '- affiliation_breakdown: Count of each category.',
    '- NEVER fabricate benchmarks or links. Use empty collections if absent.',
    '- Keep wording neutral, concise, concrete. No hype.',
  ].join('\n')
}

function categorizeAffiliation(aff?: string | null): 'Academia' | 'Industry' | 'Other' {
  if (!aff) return 'Other'
  const a = aff.toLowerCase()
  if (/(univ|institute|college|school|laborator|centre|center)/.test(a)) return 'Academia'
  if (/(inc|corp|labs|technolog|systems|company|ltd|llc|google|microsoft|meta|ibm|amazon|nvidia|openai|deepmind)/.test(a)) return 'Industry'
  return 'Other'
}

async function summarizeWithGemini(apiKey: string, paperUrl: string): Promise<StructuredSummary> {
  // First fetch the arXiv paper metadata
  const paperMeta = await fetchArxivMeta(paperUrl)
  
  // Uses Google Generative Language API for Gemini 2.5 Flash
  // See: https://ai.google.dev
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`
  const body = {
    contents: [
      {
        parts: [
          { text: buildPrompt(paperMeta) },
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
    const authorsDetailed = Array.isArray(parsed.authors_affiliations) ? parsed.authors_affiliations.map((a: any) => ({ name: a.name, affiliation: a.affiliation, category: a.category })) : []
    const affiliationBreakdown = parsed.affiliation_breakdown || authorsDetailed.reduce((acc: { Academia: number; Industry: number; Other: number }, a: { category: string }) => { acc[a.category as keyof typeof acc] = (acc[a.category as keyof typeof acc] || 0) + 1; return acc }, { Academia: 0, Industry: 0, Other: 0 })
    return {
      title: parsed.title || paperMeta.title || undefined,
      arxiv_id: parsed.arxiv_id || paperMeta.id || undefined,
      arxiv_abs_url: parsed.arxiv_abs_url || paperMeta.absUrl || undefined,
      arxiv_pdf_url: parsed.arxiv_pdf_url || paperMeta.pdfUrl || undefined,
      one_liner: parsed.one_liner || '',
      simplified_summary: parsed.simplified_summary || undefined,
      practical_problem: parsed.practical_problem || undefined,
      problems_solved: Array.isArray(parsed.problems_solved) ? parsed.problems_solved : [],
      key_innovations: Array.isArray(parsed.key_innovations) ? parsed.key_innovations : [],
      impact_potential: Array.isArray(parsed.impact_potential) ? parsed.impact_potential : [],
      use_cases: Array.isArray(parsed.use_cases) ? parsed.use_cases : [],
      benchmarks: Array.isArray(parsed.benchmarks) ? parsed.benchmarks : [],
      collaboration_type: parsed.collaboration_type || inferCollabType(authorsDetailed),
      takeaways: Array.isArray(parsed.takeaways) ? parsed.takeaways : [],
      notes: Array.isArray(parsed.notes) ? parsed.notes : [],
      resources: {
        code: Array.isArray(parsed?.resources?.code) ? parsed.resources.code : [],
        video: Array.isArray(parsed?.resources?.video) ? parsed.resources.video : [],
        checkpoints: Array.isArray(parsed?.resources?.checkpoints) ? parsed.resources.checkpoints : [],
      },
      reliability_score: rel ?? undefined,
      applicability_score: app ?? undefined,
      overall_score: overall ?? undefined,
      total_authors: parsed.total_authors || (parsed.authors ? parsed.authors.length : 0),
      authors: Array.isArray(parsed.authors) ? parsed.authors : [],
      authors_affiliations: authorsDetailed,
      affiliation_breakdown: affiliationBreakdown,
    }
  } catch {
    // Fallback: use fetched metadata
    return {
      title: paperMeta.title || undefined,
      arxiv_id: paperMeta.id || undefined,
      arxiv_abs_url: paperMeta.absUrl || undefined,
      arxiv_pdf_url: paperMeta.pdfUrl || undefined,
      one_liner: 'Summary generation failed, but paper metadata was retrieved.',
      problems_solved: [],
      key_innovations: [],
      collaboration_type: inferCollabType(paperMeta.authorsDetailed),
      total_authors: paperMeta.authors.length,
      authors: paperMeta.authors,
      takeaways: [],
      notes: ['Summary generation failed - please try again'],
      benchmarks: [],
      resources: { 
        code: paperMeta.codeLinks, 
        video: paperMeta.videoLinks, 
        checkpoints: paperMeta.modelLinks 
      },
      authors_affiliations: paperMeta.authorsDetailed,
      affiliation_breakdown: paperMeta.authorsDetailed.reduce(
        (acc: { Academia: number; Industry: number; Other: number }, a: { category: string }) => {
          acc[a.category as keyof typeof acc] = (acc[a.category as keyof typeof acc] || 0) + 1
          return acc
        }, 
        { Academia: 0, Industry: 0, Other: 0 }
      ),
    }
  }
}

function inferCollabType(list: { category: string }[]): 'Academia-only' | 'Industry-only' | 'Academia-Industry' | 'Unknown' {
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
        const normalizedPaper = normalizePaperInput(paper)
        const structured = await summarizeWithGemini(env.GOOGLE_API_KEY, normalizedPaper)
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
