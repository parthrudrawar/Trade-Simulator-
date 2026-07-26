const EMBEDDING_DIM = 1536;

export function getEmbeddingDim() {
  return EMBEDDING_DIM;
}

function mockEmbed(text) {
  const vector = new Array(EMBEDDING_DIM).fill(0);
  let h1 = 5381, h2 = 65537;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = ((h1 << 5) + h1 + c) | 0;
    h2 = ((h2 << 7) ^ c) | 0;
    vector[i % EMBEDDING_DIM] += (h1 % 1000) / 1000;
    vector[(i + 1) % EMBEDDING_DIM] += (h2 % 1000) / 1000;
  }
  const magnitude = Math.sqrt(vector.reduce((s, v) => s + v * v, 0)) || 1;
  return vector.map(v => v / magnitude);
}

export async function generateEmbedding(text) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey) {
    try {
      const res = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ input: text, model: 'text-embedding-3-small' }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}`);
      const data = await res.json();
      return data.data[0].embedding;
    } catch (err) {
      console.warn('[RAG:Embedding] OpenAI failed, using mock:', err.message);
    }
  }
  return mockEmbed(text);
}
