// Worker — roteia POST /api/analyze para a OpenAI protegendo a OPENAI_API_KEY.
// Os arquivos estáticos em /public são servidos automaticamente pelos assets;
// este código só roda para rotas sem arquivo correspondente.

const CATEGORIAS = [
  'PONTO', 'ATRASO', 'FALTA', 'ABANDONO DE POSTO', 'CONDUTA', 'INSUBORDINACAO',
  'ERRO OPERACIONAL', 'NEGLIGENCIA', 'DESCUMPRIMENTO DE NORMA', 'ALCADA/APROVACAO',
  'FALHA DE COMUNICACAO', 'ATRASO DE ENTREGA', 'PREJUIZO FINANCEIRO', 'DANO A VEICULO',
  'ATENDIMENTO/PESQUISA', 'USO INDEVIDO DE VEICULO', 'USO INDEVIDO DE SISTEMA/SENHA',
  'USO DE CELULAR', 'SEGURANCA/EPI', 'UNIFORME/APRESENTACAO', 'AUSENCIA EM TREINAMENTO',
  'CORRECAO ADMINISTRATIVA'
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
Para cada item, atribua EXATAMENTE UMA categoria. Prefira SEMPRE uma desta lista (grafia exata):
${CATEGORIAS.join(', ')}.
Guia rápido:
- "PONTO" = ajustes/marcações irregulares de ponto; "ATRASO" = chegar atrasado ao trabalho.
- "ALCADA/APROVACAO" = agir sem aprovação do gestor (preço, desconto, liberação).
- "ATRASO DE ENTREGA" = atraso na entrega de veículo/serviço ao cliente.
- "ATENDIMENTO/PESQUISA" = falha com cliente ou nota baixa em pesquisa da montadora (CSI).
- "NEGLIGENCIA" = deixar processo parado, não acompanhar, esquecer.
- Pedidos de corrigir nome, prazo, parcelas ou arquivo = "CORRECAO ADMINISTRATIVA".
Se NENHUMA categoria da lista couber de verdade, crie você uma palavra-chave nova: 1 a 3 palavras, MAIÚSCULAS, sem acentos, específica ao fato (ex: "FUMAR EM SERVICO", "BRIGA ENTRE COLEGAS").
É PROIBIDO responder com termos vazios como OUTROS, DIVERSOS, GERAL, VARIADOS, NAO CLASSIFICADO — sempre existe algo específico a dizer sobre o fato.
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

  const GENERICOS = new Set(['OUTROS','OUTRO','DIVERSOS','GERAL','VARIADOS','NAO CLASSIFICADO','SEM CATEGORIA','N/A','NA']);
  const results = (parsed.results || [])
    .map(r => ({ id: r?.id, cat: String(r?.cat || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^A-Z0-9 \/]/g,'').trim().slice(0, 32) }))
    .filter(r => r.id && r.cat && r.cat.length >= 3 && !GENERICOS.has(r.cat));

  return json({ results });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
