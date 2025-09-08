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

async function fetchArxivText(url: string): Promise<string> {
  const id = extractArxivId(url)
  if (id) {
    // Use arXiv API (Atom) to get a reliable abstract
    const apiUrl = `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}`
    const res = await fetch(apiUrl)
    if (!res.ok) throw new Error(`arXiv API error ${res.status}`)
    const xml = await res.text()
    const m = xml.match(/<summary>([\s\S]*?)<\/summary>/i)
    if (m) {
      return m[1].replace(/\s+/g, ' ').trim()
    }
  }
  // Fallback to abs HTML extraction
  try {
    const u = new URL(url)
    if (u.hostname.endsWith('arxiv.org')) {
      const parts = u.pathname.split('/').filter(Boolean)
      const id2 = (parts.pop() || '').replace(/\.pdf$/i, '')
      const absUrl = `https://arxiv.org/abs/${id2}`
      const res = await fetch(absUrl)
      const html = await res.text()
  const m2 = html.match(/<blockquote class="abstract[^"]*">\s*<span[^>]*>.*?<\/span>([\s\S]*?)<\/blockquote>/i)
      if (m2) {
        return m2[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
      }
    }
  } catch {}
  return `Paper at ${url}`
}

async function summarizeWithGemini(apiKey: string, prompt: string): Promise<string> {
  // Uses Google Generative Language API for Gemini 2.5 Flash
  // See: https://ai.google.dev
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`
  const body = {
    contents: [
      {
        parts: [
          { text: `Summarize the following arXiv paper content in 8-12 bullet points with key contributions, methods, datasets, and limitations. Keep it concise and accurate.\n\n${prompt}` },
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
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || 'No summary generated.'
  return text
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
        const text = await fetchArxivText(paper)
        const summary = await summarizeWithGemini(env.GOOGLE_API_KEY, text)
        return new Response(JSON.stringify({ summary }), { headers: { 'content-type': 'application/json', ...corsBase } })
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
