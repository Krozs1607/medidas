// Worker — roteia POST /api/analyze para a OpenAI protegendo a OPENAI_API_KEY.
// Os arquivos estáticos em /public são servidos automaticamente pelos assets;
// este código só roda para rotas sem arquivo correspondente.

const CATEGORIAS = [
  'PONTO', 'ATRASO', 'FALTA', 'CONDUTA', 'INSUBORDINACAO',
  'ERRO OPERACIONAL', 'PREJUIZO', 'ATENDIMENTO', 'USO INDEVIDO',
  'SEGURANCA', 'CORRECAO ADMINISTRATIVA', 'OUTROS'
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/analyze') {
      if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);
      return analyze(request, env);
    }
    return json({ error: 'Rota não encontrada.' }, 404);
  }
};

async function analyze(request, env) {
  if (!env.OPENAI_API_KEY) {
    return json({ error: 'OPENAI_API_KEY não configurada no Worker.' }, 500);
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'JSON inválido.' }, 400); }
  const items = Array.isArray(body?.items) ? body.items.slice(0, 60) : [];
  if (!items.length) return json({ error: 'items vazio.' }, 400);

  const lista = items
    .map(i => ({ id: String(i.id).slice(0, 32), text: String(i.text || '').slice(0, 400) }))
    .filter(i => i.text.length >= 4);

  const system = `Você classifica motivos de medidas disciplinares de RH de um grupo de concessionárias de veículos no Brasil.
Para cada item, atribua EXATAMENTE UMA categoria desta lista (use a grafia exata):
${CATEGORIAS.join(', ')}.
Regras:
- "PONTO" cobre ajustes e marcações irregulares de ponto; "ATRASO" cobre chegar atrasado.
- Pedidos de alterar nome, prazo, parcelas ou qualidade de arquivo são "CORRECAO ADMINISTRATIVA".
- Use "OUTROS" apenas se nenhuma categoria couber.
Responda SOMENTE com JSON no formato {"results":[{"id":"...","cat":"..."}]} sem texto adicional.`;

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: JSON.stringify(lista) }
      ]
    })
  });

  if (!resp.ok) {
    const t = await resp.text();
    return json({ error: 'OpenAI ' + resp.status, detail: t.slice(0, 300) }, 502);
  }

  const data = await resp.json();
  let parsed;
  try {
    parsed = JSON.parse(data.choices?.[0]?.message?.content || '{}');
  } catch {
    return json({ error: 'Resposta da IA não é JSON válido.' }, 502);
  }

  const valid = new Set(CATEGORIAS);
  const results = (parsed.results || [])
    .filter(r => r?.id && valid.has(String(r.cat || '').toUpperCase()))
    .map(r => ({ id: r.id, cat: String(r.cat).toUpperCase() }));

  return json({ results });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
