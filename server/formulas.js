// Biblioteca de fórmulas: prontas (do sistema) e criadas pelo usuário (ou pela IA), reutilizáveis em qualquer
// critério de campanha com métrica "personalizada" — sem precisar criar uma campanha para guardá-las.
import { db, agoraISO } from './db.js';
import { compilar } from './expressao.js';
import { VARIAVEIS, MEDIDAS_PARAMETRIZAVEIS } from './motor.js';

db.exec(`
CREATE TABLE IF NOT EXISTS formula_salva (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  descricao TEXT,
  expressao TEXT NOT NULL,
  formato TEXT NOT NULL DEFAULT 'decimal',
  totalizar TEXT NOT NULL DEFAULT 'soma',
  sentido TEXT NOT NULL DEFAULT 'maior',
  categoria TEXT,
  origem TEXT NOT NULL DEFAULT 'usuario',
  pedido_ia TEXT,
  usos INTEGER NOT NULL DEFAULT 0,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);
`);

const PRONTAS = [
  ['Canais digitais', 'Participação do App Mobile no faturamento', 'Quanto do faturamento passa pelo App Mobile.', 'valor{canal: "App Mobile"} / valor * 100', 'perc', 'media', 'maior'],
  ['Canais digitais', 'Participação dos canais digitais', 'App, e-commerce e WhatsApp sobre o total.', 'valor{canal: ["App Mobile", "E-commerce", "WhatsApp"]} / valor * 100', 'perc', 'media', 'maior'],
  ['Rentabilidade', 'Margem por cliente positivado', 'Margem bruta gerada por cliente que comprou.', 'margem / clientes', 'moeda', 'media', 'maior'],
  ['Carteira', 'Faturamento em clientes curva A', 'Faturamento só nos clientes mais importantes (curva ABC).', 'valor{curva: "A"}', 'moeda', 'soma', 'maior'],
  ['Carteira', 'Clientes curva A positivados', 'Quantos clientes curva A compraram os produtos.', 'clientes{curva: "A"}', 'numero', 'soma', 'maior'],
  ['Crescimento', 'Crescimento no mesmo ponto do período', 'Faturamento contra o período anterior, comparando o mesmo ponto.', '(valor / valor_ant - 1) * 100', 'perc', 'media', 'maior'],
  ['Produtividade', 'Unidades por dia', 'Unidades vendidas por dia decorrido da campanha.', 'qtd / dias_uteis', 'decimal', 'media', 'maior'],
  ['Qualidade', 'Bonificação sobre o faturamento', 'Peso das remessas em bonificação (CFOP 5.910/6.910). Quanto menor, melhor.', 'valor{cfop: ["5.910", "6.910"]} / valor * 100', 'perc', 'media', 'menor'],
  ['Qualidade', 'Unidades líquidas de devolução', 'Vendido menos devolvido.', 'qtd - qtd_dev', 'numero', 'soma', 'maior'],
  ['Segmentos', 'Ticket médio em hospitais', 'Faturamento por pedido só no segmento Hospital.', 'valor{segmento: "Hospital"} / pedidos{segmento: "Hospital"}', 'moeda', 'media', 'maior'],
  ['Mix', 'Mix médio por cliente', 'SKUs distintos por cliente positivado.', 'cli_skus / clientes', 'decimal', 'media', 'maior'],
  ['Gamificação', 'Pontos: R$ 100 = 1 ponto, cliente novo = 5', 'Pontuação para campeonatos: faturamento e conquista de clientes.', 'valor / 100 + clientes_novos * 5', 'numero', 'soma', 'maior'],
  ['Gamificação', 'Faturamento só com 5+ clientes', 'Faturamento conta apenas se positivar pelo menos 5 clientes (corte).', 'se(clientes >= 5, valor, 0)', 'moeda', 'soma', 'maior'],
  ['Participação', 'Share do Dorflex em analgésicos', 'Participação do Dorflex no faturamento da subcategoria.', 'valor{marca: "Dorflex"} / valor{subcategoria: "Analgésicos e Antitérmicos"} * 100', 'perc', 'media', 'maior'],
  ['Cobertura', 'Cobertura geográfica', 'Cidades com pelo menos um cliente positivado.', 'cidades', 'numero', 'soma', 'maior'],
];

if (!db.prepare("SELECT 1 FROM formula_salva WHERE origem = 'sistema' LIMIT 1").get()) {
  const st = db.prepare('INSERT INTO formula_salva (nome, descricao, expressao, formato, totalizar, sentido, categoria, origem, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const agora = agoraISO();
  for (const [categoria, nome, descricao, expressao, formato, totalizar, sentido] of PRONTAS) st.run(nome, descricao, expressao, formato, totalizar, sentido, categoria, 'sistema', agora, agora);
}

const erro = (msg, status = 400) => Object.assign(new Error(msg), { status });

/** Compila e confere medidas recortáveis. Lança erro amigável. */
export function validarExpressao(expressao) {
  const f = compilar(String(expressao || ''), Object.keys(VARIAVEIS));
  const ruim = f.parametrizadas.find((p) => !MEDIDAS_PARAMETRIZAVEIS.includes(p.medida));
  if (ruim) throw new Error(`A medida "${ruim.medida}" não pode ser recortada por filtros.`);
  return f;
}

function ler(b = {}) {
  const nome = String(b.nome || '').trim();
  if (!nome) throw erro('Dê um nome para a fórmula.');
  try {
    validarExpressao(b.expressao);
  } catch (e) {
    throw erro(`Fórmula inválida: ${e.message}`);
  }
  return {
    nome,
    descricao: String(b.descricao || ''),
    expressao: String(b.expressao).trim(),
    formato: ['numero', 'moeda', 'perc', 'decimal'].includes(b.formato) ? b.formato : 'decimal',
    totalizar: b.totalizar === 'media' ? 'media' : 'soma',
    sentido: b.sentido === 'menor' ? 'menor' : 'maior',
    categoria: String(b.categoria || 'Minhas fórmulas'),
    origem: b.origem === 'ia' ? 'ia' : 'usuario',
    pedido_ia: b.pedido_ia ? String(b.pedido_ia) : null,
  };
}

export function listarFormulas() {
  return db.prepare("SELECT * FROM formula_salva ORDER BY CASE origem WHEN 'sistema' THEN 1 ELSE 0 END, atualizado_em DESC").all();
}

export function criarFormula(b) {
  const f = ler(b);
  const agora = agoraISO();
  const r = db
    .prepare('INSERT INTO formula_salva (nome, descricao, expressao, formato, totalizar, sentido, categoria, origem, pedido_ia, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(f.nome, f.descricao, f.expressao, f.formato, f.totalizar, f.sentido, f.categoria, f.origem, f.pedido_ia, agora, agora);
  return { id: Number(r.lastInsertRowid) };
}

export function atualizarFormula(id, b) {
  const atual = db.prepare('SELECT * FROM formula_salva WHERE id = ?').get(Number(id));
  if (!atual) throw erro('Fórmula não encontrada.', 404);
  if (atual.origem === 'sistema') throw erro('Fórmulas prontas não podem ser alteradas. Salve uma cópia com outro nome.');
  const f = ler({ ...b, origem: atual.origem });
  db.prepare('UPDATE formula_salva SET nome = ?, descricao = ?, expressao = ?, formato = ?, totalizar = ?, sentido = ?, categoria = ?, atualizado_em = ? WHERE id = ?').run(
    f.nome, f.descricao, f.expressao, f.formato, f.totalizar, f.sentido, f.categoria, agoraISO(), atual.id,
  );
  return { ok: true };
}

export function excluirFormula(id) {
  const atual = db.prepare('SELECT origem FROM formula_salva WHERE id = ?').get(Number(id));
  if (!atual) throw erro('Fórmula não encontrada.', 404);
  if (atual.origem === 'sistema') throw erro('Fórmulas prontas não podem ser excluídas.');
  db.prepare('DELETE FROM formula_salva WHERE id = ?').run(Number(id));
  return { ok: true };
}

export function registrarUsoFormula(id) {
  db.prepare('UPDATE formula_salva SET usos = usos + 1 WHERE id = ?').run(Number(id));
}
