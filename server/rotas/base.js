import { db, lerConfig, salvarConfig, contarLinhas, agoraISO, versaoDados, CONFIG_PADRAO } from '../db.js';
import { importarArquivo, importarPasta } from '../importador.js';
import { catalogoProdutos, resolverProdutos, produtoPorId } from '../seletor.js';
import { listarEquipes, listarVendedores, NIVEIS } from '../participantes.js';
import { METRICAS, VARIAVEIS, TIPOS_META, STATUS_PARTICIPANTE, dataReferencia } from '../motor.js';
import { compilar, DIMENSOES_VARIAVEL } from '../expressao.js';
import { listaFeriados, hojeISO } from '../calendario.js';
import { chamarOpcional, existeTabela, opcional } from '../opcional.js';
import { assinaturaBase, servirPronto } from '../pipeline.js';

const erro = (msg, status = 400) => Object.assign(new Error(msg), { status });

const CFOPS = {
  '5.101': 'Venda de produção própria',
  '5.102': 'Venda de mercadoria de terceiros',
  '5.405': 'Venda com substituição tributária',
  '5.910': 'Bonificação, doação ou brinde',
  '6.101': 'Venda de produção própria (interestadual)',
  '6.102': 'Venda de mercadoria de terceiros (interestadual)',
  '6.108': 'Venda a não contribuinte (interestadual)',
  '6.910': 'Bonificação, doação ou brinde (interestadual)',
};

export const FUNCOES_FORMULA = [
  { nome: 'min', assinatura: 'min(a, b, ...)', descricao: 'Menor valor entre os argumentos.' },
  { nome: 'max', assinatura: 'max(a, b, ...)', descricao: 'Maior valor entre os argumentos.' },
  { nome: 'abs', assinatura: 'abs(x)', descricao: 'Valor absoluto.' },
  { nome: 'arred', assinatura: 'arred(x, casas)', descricao: 'Arredonda para N casas decimais.' },
  { nome: 'se', assinatura: 'se(condição, valor_se_sim, valor_se_não)', descricao: 'Condicional. Ex.: se(clientes >= 10, valor, 0).' },
  { nome: 'raiz', assinatura: 'raiz(x)', descricao: 'Raiz quadrada.' },
];

const DIMENSOES_ROTULOS = {
  fabricante: { rotulo: 'Fabricante', fonte: 'fabricantes' },
  marca: { rotulo: 'Marca', fonte: 'marcas' },
  subcategoria: { rotulo: 'Subcategoria', fonte: 'subcategorias' },
  grupo: { rotulo: 'Linha (grupo salvo)', fonte: 'grupos' },
  produto: { rotulo: 'Produto (código)', fonte: 'produtos' },
  canal: { rotulo: 'Canal de venda', fonte: 'canais' },
  segmento: { rotulo: 'Segmento do cliente', fonte: 'segmentos' },
  porte: { rotulo: 'Porte do cliente', fonte: 'portes' },
  estado: { rotulo: 'UF do cliente', fonte: 'estados' },
  cidade: { rotulo: 'Cidade do cliente', fonte: 'cidades' },
  curva: { rotulo: 'Curva ABC do cliente', fonte: 'curvas' },
  cfop: { rotulo: 'CFOP', fonte: 'cfops' },
  status: { rotulo: 'Situação da venda', fonte: 'status_venda' },
  periodo: { rotulo: 'Período', fonte: 'periodos' },
};

function mascarar(cfg) {
  const c = structuredClone(cfg);
  if (c.smtp?.senha) c.smtp.senha = '••••••••';
  if (c.webhook?.token) c.webhook.token = '••••••••';
  if (c.telegram?.token) c.telegram.token = '••••••••';
  if (c.imap?.senha) c.imap.senha = '••••••••';
  return c;
}

// Partes pesadas (varrem fato_vendas), pré-calculadas pela pipeline (server/etapas/base.js) por assinatura da base.
export function montarStatusDados() {
  const vendas = db.prepare('SELECT MIN(data_pedido) AS min, MAX(data_pedido) AS max FROM fato_vendas').get();
  const tabelas = ['fato_vendas', 'dm_produto', 'dm_cliente', 'dm_vendedor', 'dm_canal', 'fato_estoque', 'fato_metas'].map((t) => ({ tabela: t, linhas: contarLinhas(t) }));
  return { tabelas, vendas: { ...vendas } };
}

export function montarDimensoesBase() {
  const produtos = catalogoProdutos();
  const fab = new Map();
  const mar = new Map();
  const sub = new Map();
  for (const p of produtos) {
    if (!p.fabricante || !p.marca) continue;
    const f = fab.get(p.fabricante) || { nome: p.fabricante, produtos: 0, marcas: new Set() };
    f.produtos++;
    f.marcas.add(p.marca);
    fab.set(p.fabricante, f);
    const m = mar.get(p.marca) || { nome: p.marca, fabricante: p.fabricante, produtos: 0 };
    m.produtos++;
    mar.set(p.marca, m);
    if (p.subcategoria) sub.set(p.subcategoria, (sub.get(p.subcategoria) || 0) + 1);
  }
  const distintos = (col) => db.prepare(`SELECT DISTINCT ${col} AS v FROM dm_cliente WHERE ${col} IS NOT NULL ORDER BY 1`).all().map((r) => r.v);
  return {
    fabricantes: [...fab.values()].map((f) => ({ ...f, marcas: [...f.marcas].sort() })).sort((a, b) => a.nome.localeCompare(b.nome)),
    marcas: [...mar.values()].sort((a, b) => a.nome.localeCompare(b.nome)),
    subcategorias: [...sub.entries()].map(([nome, n]) => ({ nome, produtos: n })).sort((a, b) => a.nome.localeCompare(b.nome)),
    canais: db.prepare('SELECT id_canal AS id, nome_canal AS nome, tipo FROM dm_canal ORDER BY id_canal').all(),
    segmentos: distintos('segmento'),
    portes: distintos('porte'),
    estados: distintos('estado'),
    cidades: db.prepare('SELECT cidade, estado, COUNT(*) AS clientes FROM dm_cliente WHERE cidade IS NOT NULL GROUP BY cidade, estado ORDER BY cidade').all(),
    status_venda: db.prepare('SELECT DISTINCT status AS v FROM fato_vendas WHERE status IS NOT NULL ORDER BY 1').all().map((r) => r.v),
    cfops: db.prepare('SELECT cfop, COUNT(*) AS linhas FROM fato_vendas GROUP BY cfop ORDER BY cfop').all().map((r) => ({ ...r, descricao: CFOPS[r.cfop] || '' })),
  };
}

export default function (app) {
  // ------------------------------------------------------------------ status
  app.get('/api/status', async (req, res) => {
    const cfg = lerConfig();
    const { tabelas, vendas } = servirPronto('status_dados', { assinatura: assinaturaBase(), calcular: montarStatusDados }).conteudo;
    const ultima = db.prepare('SELECT tabela, arquivo, linhas, criado_em FROM importacao ORDER BY id DESC LIMIT 1').get() || null;
    const ia = await chamarOpcional('./ia.js', 'statusIa', [], null);
    const receita = await chamarOpcional('./receita.js', 'statusReceita', [], null);
    const conhecimento = await chamarOpcional('./conhecimento.js', 'resumoConhecimento', [], null);
    res.json({
      empresa: cfg.nome_empresa,
      hoje: hojeISO(),
      referencia: { pedido: dataReferencia('data_pedido', cfg), faturamento: dataReferencia('data_faturamento', cfg) },
      dados: { tabelas, vendas: { ...vendas }, ultima_importacao: ultima ? { ...ultima } : null },
      ia: ia || { configurada: Boolean(process.env.ANTHROPIC_API_KEY), modelo: cfg.ia?.modelo, gasto_hoje_usd: 0, limite_diario_usd: cfg.ia?.limite_diario_usd },
      receita: receita || { configurada: Boolean(process.env.POSTGRES_DB), farmacias: 0, importado_em: null },
      conhecimento: conhecimento || { fatos: 0, atualizado_em: null },
      versao: versaoDados(),
    });
  });

  // ------------------------------------------------------------------ dimensões
  app.get('/api/dimensoes', (req, res) => {
    const pesada = servirPronto('dimensoes', { assinatura: assinaturaBase(), calcular: montarDimensoesBase }).conteudo;
    // leves e editáveis na hora (grupos, equipes, vendedores): sempre ao vivo
    const grupos = db.prepare('SELECT id, nome, descricao, seletor FROM grupo_produto ORDER BY nome').all().map((g) => {
      const seletor = JSON.parse(g.seletor || '{}');
      return { id: g.id, nome: g.nome, descricao: g.descricao, seletor, n_produtos: resolverProdutos({ ...seletor, grupos: [] }).length };
    });
    const segmentosRfv = existeTabela(db, 'cliente_perfil')
      ? db.prepare('SELECT DISTINCT segmento_rfv AS v FROM cliente_perfil WHERE segmento_rfv IS NOT NULL ORDER BY 1').all().map((r) => r.v)
      : [];
    res.json({
      ...pesada,
      curvas: ['A', 'B', 'C'],
      segmentos_rfv: segmentosRfv,
      equipes: listarEquipes(),
      vendedores: listarVendedores(),
      grupos,
      niveis: Object.fromEntries(Object.entries(NIVEIS).map(([k, v]) => [k, v.rotulo])),
    });
  });

  app.get('/api/produtos', (req, res) => res.json(catalogoProdutos()));

  app.get('/api/clientes', (req, res) => {
    const temPerfil = existeTabela(db, 'cliente_perfil');
    res.json(
      db
        .prepare(
          `SELECT c.id_cliente AS id, COALESCE(c.nome_fantasia, c.nome_cliente) AS nome, c.razao_social, c.cidade, c.estado, c.segmento, c.porte,
                  c.id_vendedor, v.nome_vendedor AS vendedor
                  ${temPerfil ? ', p.curva, p.segmento_rfv, p.valor_90d, p.dias_sem_compra' : ''}
             FROM dm_cliente c
             LEFT JOIN dm_vendedor v ON v.id_vendedor = c.id_vendedor
             ${temPerfil ? 'LEFT JOIN cliente_perfil p ON p.id_cliente = c.id_cliente' : ''}
            ORDER BY nome`,
        )
        .all(),
    );
  });

  app.post('/api/produtos/resolver', (req, res) => {
    const ids = resolverProdutos(req.body?.seletor || {});
    res.json({ total: ids.length, produtos: ids.slice(0, 300).map((id) => produtoPorId(id)).filter(Boolean).map(({ id, nome, marca, fabricante, subcategoria, preco }) => ({ id, nome, marca, fabricante, subcategoria, preco })) });
  });

  // ------------------------------------------------------------------ grupos de produtos
  app.get('/api/grupos', (req, res) => {
    res.json(
      db.prepare('SELECT id, nome, descricao, seletor, criado_em FROM grupo_produto ORDER BY nome').all().map((g) => {
        const seletor = JSON.parse(g.seletor || '{}');
        return { ...g, seletor, n_produtos: resolverProdutos({ ...seletor, grupos: [] }).length };
      }),
    );
  });
  app.post('/api/grupos', (req, res) => {
    const { nome, descricao = '', seletor = {} } = req.body || {};
    if (!String(nome || '').trim()) throw erro('Dê um nome para a linha de produtos.');
    try {
      const r = db.prepare('INSERT INTO grupo_produto (nome, descricao, seletor, criado_em) VALUES (?, ?, ?, ?)').run(String(nome).trim(), descricao, JSON.stringify(seletor), agoraISO());
      res.json({ id: Number(r.lastInsertRowid) });
    } catch (e) {
      if (/UNIQUE/.test(e.message)) throw erro('Já existe uma linha com esse nome.');
      throw e;
    }
  });
  app.put('/api/grupos/:id', (req, res) => {
    const { nome, descricao = '', seletor = {} } = req.body || {};
    db.prepare('UPDATE grupo_produto SET nome = ?, descricao = ?, seletor = ? WHERE id = ?').run(String(nome).trim(), descricao, JSON.stringify(seletor), Number(req.params.id));
    res.json({ ok: true });
  });
  app.delete('/api/grupos/:id', (req, res) => {
    db.prepare('DELETE FROM grupo_produto WHERE id = ?').run(Number(req.params.id));
    res.json({ ok: true });
  });

  // ------------------------------------------------------------------ catálogo
  app.get('/api/catalogo', async (req, res) => {
    const modelos = (await opcional('./modelos.js'))?.MODELOS_CAMPANHA || [];
    res.json({
      metricas: Object.fromEntries(Object.entries(METRICAS).map(([k, m]) => [k, { ...m, sentido: m.sentido || 'maior', ref: Boolean(m.ref) }])),
      variaveis: VARIAVEIS,
      dimensoes_variavel: DIMENSOES_VARIAVEL.map((chave) => ({ chave, ...DIMENSOES_ROTULOS[chave] })),
      funcoes: FUNCOES_FORMULA,
      tipos_meta: TIPOS_META,
      niveis: Object.fromEntries(Object.entries(NIVEIS).map(([k, v]) => [k, v.rotulo])),
      status_participante: STATUS_PARTICIPANTE,
      modelos,
    });
  });

  app.post('/api/catalogo/validar-formula', (req, res) => {
    try {
      const f = compilar(String(req.body?.expressao || ''), Object.keys(VARIAVEIS));
      res.json({ ok: true, variaveis: f.variaveis, parametrizadas: f.parametrizadas });
    } catch (e) {
      res.json({ ok: false, erro: e.message });
    }
  });

  // ------------------------------------------------------------------ importação
  app.post('/api/importar/pasta', async (req, res) => {
    res.json(await importarPasta());
  });

  app.post('/api/importar/arquivo', async (req, res) => {
    const corpo = Buffer.isBuffer(req.body) ? req.body : Buffer.from(typeof req.body === 'string' ? req.body : '');
    if (!corpo.length) throw erro('Arquivo vazio.');
    const r = await importarArquivo(corpo, {
      nomeArquivo: String(req.query.nome || 'upload.csv'),
      tabela: req.query.tabela || undefined,
      modo: req.query.modo === 'mesclar' ? 'mesclar' : 'substituir',
    });
    res.json(r);
  });

  app.get('/api/importacoes', (req, res) => {
    res.json(db.prepare('SELECT id, tabela, arquivo, modo, linhas, criado_em FROM importacao ORDER BY id DESC LIMIT 100').all());
  });

  // ------------------------------------------------------------------ configuração
  app.get('/api/config', (req, res) => {
    const cfg = lerConfig();
    res.json({ ...mascarar(cfg), feriados_efetivos: listaFeriados(cfg.feriados), padrao: mascarar(CONFIG_PADRAO) });
  });

  app.put('/api/config', (req, res) => {
    const atual = lerConfig();
    const novo = { ...(req.body || {}) };
    delete novo.feriados_efetivos;
    delete novo.padrao;
    if (novo.smtp) {
      novo.smtp = { ...atual.smtp, ...novo.smtp };
      if (novo.smtp.senha === '••••••••') novo.smtp.senha = atual.smtp?.senha || '';
    }
    if (novo.webhook) {
      novo.webhook = { ...atual.webhook, ...novo.webhook };
      if (novo.webhook.token === '••••••••') novo.webhook.token = atual.webhook?.token || '';
    }
    if (novo.ia) novo.ia = { ...atual.ia, ...novo.ia };
    if (novo.telegram) {
      novo.telegram = { ...atual.telegram, ...novo.telegram };
      if (novo.telegram.token === '••••••••') novo.telegram.token = atual.telegram?.token || '';
    }
    if (novo.imap) {
      novo.imap = { ...atual.imap, ...novo.imap };
      if (novo.imap.senha === '••••••••') novo.imap.senha = atual.imap?.senha || '';
    }
    if (novo.data_referencia && novo.data_referencia !== 'auto' && !/^\d{4}-\d{2}-\d{2}$/.test(novo.data_referencia)) throw erro('Data de referência inválida.');
    salvarConfig(novo);
    res.json({ ok: true });
  });

  app.post('/api/config/testar-email', async (req, res) => {
    const disparos = await opcional('./disparos.js');
    if (!disparos) throw erro('Módulo de envio indisponível.', 503);
    res.json(await disparos.testarEmail(String(req.body?.para || '')));
  });

  app.post('/api/config/testar-webhook', async (req, res) => {
    const disparos = await opcional('./disparos.js');
    if (!disparos) throw erro('Módulo de envio indisponível.', 503);
    res.json(await disparos.testarWebhook());
  });
}
