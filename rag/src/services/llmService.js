export function buildPrompt(articles, symbol) {
  const context = articles.map((a, i) =>
    `[${i + 1}] Source: ${a.source}\nTitle: ${a.title}\nPublished: ${a.publishedAt}\nContent: ${a.content}`
  ).join('\n\n');

  return `You are a financial analyst. Based ONLY on the following news articles, explain why ${symbol}'s price might be moving.

Rules:
- Use ONLY the provided context. Do not use your own knowledge.
- Return exactly 3 bullet points.
- Each bullet point must end with a citation in the format [Source: N] where N is the article number above.
- If no articles are relevant, say "No relevant news found."

Context:
${context || 'No articles provided.'}

Response:`;
}

function mockExplanation(articles, symbol) {
  if (!articles || articles.length === 0) {
    return [`No recent news articles found for ${symbol}. Price movement may be driven by technical factors or broader market trends not captured in available news.`];
  }

  const bullets = [];
  const used = new Set();

  const categories = [
    { keywords: /earnings|revenue|profit|quarterly|fiscal/i, prefix: 'Earnings impact' },
    { keywords: /guidance|outlook|forecast|expect/i, prefix: 'Guidance update' },
    { keywords: /launch|product|feature|upgrade/i, prefix: 'Product/feature news' },
    { keywords: /regulat|ban|approve|law|policy|sec|rbi|sebi/i, prefix: 'Regulatory development' },
    { keywords: /inflation|interest.rate|fed|rbi|gdp|economic/i, prefix: 'Macroeconomic factor' },
    { keywords: /upgrade|downgrade|buy|sell|target|analyst/i, prefix: 'Analyst action' },
    { keywords: /partner|acquir|merge|alliance/i, prefix: 'Corporate development' },
    { keywords: /lawsuit|settle|fine|penalty|court/i, prefix: 'Legal/regulatory' },
  ];

  for (const article of articles) {
    const idx = articles.indexOf(article) + 1;
    if (used.has(idx)) continue;
    used.add(idx);

    const lower = (article.content + ' ' + article.title).toLowerCase();
    const snippet = article.content.replace(/\s+/g, ' ').slice(0, 150).replace(/\s+\S*$/, '') + '...';
    let prefix = 'Market-moving news';

    for (const cat of categories) {
      if (cat.keywords.test(lower)) {
        prefix = cat.prefix;
        break;
      }
    }

    bullets.push(`${prefix}: ${snippet} [Source: ${idx}]`);
    if (bullets.length >= 3) break;
  }

  return bullets;
}

function parseBullets(text) {
  return text
    .split('\n')
    .map(l => l.replace(/^[-*•]\s*/, '').trim())
    .filter(l => l.length > 0 && /\[Source:\s*\d+\]/i.test(l))
    .slice(0, 3);
}

export async function generateExplanation(articles, symbol) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (apiKey) {
    const prompt = buildPrompt(articles, symbol);
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.3, maxOutputTokens: 500 },
          }),
          signal: AbortSignal.timeout(15000),
        }
      );
      if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      return parseBullets(text);
    } catch (err) {
      console.warn('[RAG:LLM] Gemini failed, using mock:', err.message);
    }
  }

  const apiKeyOpenAI = process.env.OPENAI_API_KEY;
  if (apiKeyOpenAI) {
    const prompt = buildPrompt(articles, symbol);
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKeyOpenAI}` },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.3,
          max_tokens: 500,
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}`);
      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content || '';
      return parseBullets(text);
    } catch (err) {
      console.warn('[RAG:LLM] OpenAI failed, using mock:', err.message);
    }
  }

  return mockExplanation(articles, symbol);
}
