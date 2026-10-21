// Exportação da apuração para Excel (a equipe continua podendo abrir tudo no Excel, mas agora com a apuração pronta).
import ExcelJS from 'exceljs';
import { linhasConsideradas, STATUS_PARTICIPANTE } from './motor.js';
import { frasesCampanha } from './narrativa.js';

const FORMATO_EXCEL = { moeda: '"R$" #,##0.00', perc: '0.0"%"', decimal: '#,##0.00', numero: '#,##0' };
const COR_STATUS = { atingiu: 'FFDDF3DD', no_ritmo: 'FFE3EEFC', atencao: 'FFFDF0D2', risco: 'FFF9DEDE', nao_atingiu: 'FFF9DEDE' };
const CINZA = 'FFF3F3EF';

function cabecalho(ws, cor = 'FF2A78D6') {
  const linha = ws.getRow(1);
  linha.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  linha.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: cor } };
  linha.alignment = { vertical: 'middle' };
  linha.height = 22;
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } };
}

export async function gerarExcelCampanha(camp, r) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Apurador de Campanhas';
  wb.created = new Date();
  const c = r.campanha;
  const corArgb = `FF${(c.cor || '#2a78d6').slice(1).toUpperCase()}`;

  // ---------------------------------------------------------------- Resumo
  const res = wb.addWorksheet('Resumo', { properties: { tabColor: { argb: corArgb } } });
  res.columns = [{ width: 34 }, { width: 22 }, { width: 22 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 18 }];
  res.addRow([c.nome]).font = { bold: true, size: 16 };
  res.addRow([c.fornecedor ? `Fornecedor: ${c.fornecedor}` : '']).font = { color: { argb: 'FF52514E' } };
  res.addRow([`Período: ${r.tempo.inicio} a ${r.tempo.fim} · referência dos dados: ${r.tempo.referencia} · dia ${r.tempo.decorridos} de ${r.tempo.total} (${r.tempo.calendario})`]);
  res.addRow([`Participantes: ${c.nivel_rotulo} · regra: ${c.apuracao.regra} · premiação: ${c.premiacao.tipo}`]);
  res.addRow([]);
  for (const f of frasesCampanha(r)) res.addRow([f]).font = { italic: true };
  res.addRow([]);
  const kpis = [
    ['Atingimento geral', r.resumo.atingimento_geral, 'perc'],
    ['Atingimento projetado', r.resumo.atingimento_geral_proj, 'perc'],
    ['Participantes', r.resumo.participantes, 'numero'],
    ['Atingiram', r.resumo.atingiram, 'numero'],
    ['No ritmo', r.resumo.no_ritmo, 'numero'],
    ['Atenção', r.resumo.atencao, 'numero'],
    ['Em risco', r.resumo.risco, 'numero'],
    ['Prêmios apurados (R$)', r.resumo.premio_total, 'moeda'],
    ['Prêmios projetados (R$)', r.resumo.premio_proj_total, 'moeda'],
    ['Orçamento (R$)', r.resumo.orcamento, 'moeda'],
  ];
  for (const [k, v, f] of kpis) {
    const row = res.addRow([k, v ?? '-']);
    row.getCell(1).font = { color: { argb: 'FF52514E' } };
    if (typeof v === 'number') row.getCell(2).numFmt = FORMATO_EXCEL[f];
    row.getCell(2).font = { bold: true };
  }
  res.addRow([]);
  const cab = res.addRow(['Critério', 'Realizado', 'Meta', 'Atingimento', 'Projeção', 'Ating. projetado', 'Período anterior']);
  cab.font = { bold: true };
  cab.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CINZA } };
  for (const cr of r.criterios) {
    const row = res.addRow([cr.nome, cr.total.realizado, cr.total.meta, cr.total.atingimento, cr.total.projecao, cr.total.atingimento_proj, cr.total.base]);
    for (const i of [2, 3, 5, 7]) row.getCell(i).numFmt = FORMATO_EXCEL[cr.formato] || FORMATO_EXCEL.numero;
    for (const i of [4, 6]) row.getCell(i).numFmt = FORMATO_EXCEL.perc;
  }
  if (r.avisos?.length) {
    res.addRow([]);
    res.addRow(['Avisos']).font = { bold: true };
    for (const a of r.avisos) res.addRow([a]);
  }

  // ---------------------------------------------------------------- Apuração
  const ap = wb.addWorksheet('Apuração', { properties: { tabColor: { argb: 'FF1BAF7A' } } });
  const colunas = [
    { header: 'Posição', key: 'pos', width: 9 },
    { header: c.nivel_singular, key: 'nome', width: 32 },
    { header: 'Grupo', key: 'grupo', width: 26 },
    { header: 'Situação', key: 'status', width: 14 },
    { header: 'Pontuação %', key: 'score', width: 13 },
    { header: 'Projeção %', key: 'proj', width: 12 },
  ];
  r.criterios.forEach((cr, i) => {
    colunas.push(
      { header: `${cr.nome}: realizado`, key: `r${i}`, width: 18 },
      { header: `${cr.nome}: meta`, key: `m${i}`, width: 16 },
      { header: `${cr.nome}: %`, key: `a${i}`, width: 12 },
      { header: `${cr.nome}: projeção`, key: `p${i}`, width: 18 },
      { header: `${cr.nome}: falta`, key: `f${i}`, width: 14 },
    );
  });
  colunas.push({ header: 'Prêmio (R$)', key: 'premio', width: 14 }, { header: 'Prêmio projetado (R$)', key: 'premio_proj', width: 18 }, { header: 'Próxima faixa', key: 'prox', width: 28 });
  ap.columns = colunas;
  for (const l of r.participantes) {
    const row = { pos: l.posicao, nome: l.nome, grupo: l.grupo || '', status: STATUS_PARTICIPANTE[l.status], score: l.score, proj: l.score_proj, premio: l.premio, premio_proj: l.premio_proj };
    l.criterios.forEach((x, i) => {
      row[`r${i}`] = x.realizado;
      row[`m${i}`] = x.meta;
      row[`a${i}`] = x.atingimento;
      row[`p${i}`] = x.projecao;
      row[`f${i}`] = x.falta;
    });
    const pf = l.proxima_faixa;
    const alvo = !pf ? '' : pf.tipo === 'bloco' ? 'próximo bloco' : pf.tipo === 'gatilho' && pf.exigencia === 'quantidade' ? `mínimo de ${pf.min}` : `${pf.min}%`;
    row.prox = pf ? `${alvo}${pf.falta_unidades != null ? ` (faltam ${pf.falta_unidades})` : ''}` : '';
    const linha = ap.addRow(row);
    const cor = COR_STATUS[l.status];
    if (cor) linha.getCell('status').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: cor } };
  }
  ap.getColumn('score').numFmt = FORMATO_EXCEL.perc;
  ap.getColumn('proj').numFmt = FORMATO_EXCEL.perc;
  ap.getColumn('premio').numFmt = FORMATO_EXCEL.moeda;
  ap.getColumn('premio_proj').numFmt = FORMATO_EXCEL.moeda;
  r.criterios.forEach((cr, i) => {
    for (const k of ['r', 'm', 'p', 'f']) ap.getColumn(`${k}${i}`).numFmt = FORMATO_EXCEL[cr.formato] || FORMATO_EXCEL.numero;
    ap.getColumn(`a${i}`).numFmt = FORMATO_EXCEL.perc;
  });
  cabecalho(ap, corArgb);

  // ---------------------------------------------------------------- Vendas consideradas + por produto
  if (r._interno && r.tempo.status !== 'futura') {
    const blocos = linhasConsideradas(r);
    const porProduto = new Map();
    const vc = wb.addWorksheet('Vendas consideradas', { properties: { tabColor: { argb: 'FFEDA100' } } });
    vc.columns = [
      { header: 'Critério', key: 'criterio', width: 26 },
      { header: c.nivel_singular, key: 'pk', width: 14 },
      { header: 'Data', key: 'dia', width: 12 },
      { header: 'Pedido', key: 'id_pedido', width: 14 },
      { header: 'Cód. produto', key: 'id_produto', width: 12 },
      { header: 'Produto', key: 'produto', width: 44 },
      { header: 'Marca', key: 'marca', width: 18 },
      { header: 'Cód. cliente', key: 'id_cliente', width: 12 },
      { header: 'Cliente', key: 'cliente', width: 30 },
      { header: 'Vendedor', key: 'vendedor', width: 26 },
      { header: 'Quantidade', key: 'qtd', width: 12 },
      { header: 'Valor (R$)', key: 'valor', width: 14 },
      { header: 'Margem (R$)', key: 'margem', width: 14 },
    ];
    for (const b of blocos) {
      for (const l of b.linhas) {
        vc.addRow({ ...l, criterio: b.criterio });
        const k = `${b.criterio}|${l.id_produto}`;
        const p = porProduto.get(k) || { criterio: b.criterio, id_produto: l.id_produto, produto: l.produto, marca: l.marca, qtd: 0, valor: 0, clientes: new Set() };
        p.qtd += l.qtd;
        p.valor += l.valor;
        p.clientes.add(l.id_cliente);
        porProduto.set(k, p);
      }
      if (b.truncado) vc.addRow({ criterio: b.criterio, produto: '... (limite de linhas atingido)' });
    }
    vc.getColumn('qtd').numFmt = FORMATO_EXCEL.numero;
    vc.getColumn('valor').numFmt = FORMATO_EXCEL.moeda;
    vc.getColumn('margem').numFmt = FORMATO_EXCEL.moeda;
    cabecalho(vc, 'FF52514E');

    const pp = wb.addWorksheet('Por produto', { properties: { tabColor: { argb: 'FF6250D6' } } });
    pp.columns = [
      { header: 'Critério', key: 'criterio', width: 26 },
      { header: 'Cód. produto', key: 'id_produto', width: 12 },
      { header: 'Produto', key: 'produto', width: 44 },
      { header: 'Marca', key: 'marca', width: 18 },
      { header: 'Quantidade', key: 'qtd', width: 12 },
      { header: 'Valor (R$)', key: 'valor', width: 14 },
      { header: 'Clientes', key: 'clientes', width: 10 },
    ];
    for (const p of [...porProduto.values()].sort((a, b) => b.valor - a.valor)) pp.addRow({ ...p, clientes: p.clientes.size });
    pp.getColumn('qtd').numFmt = FORMATO_EXCEL.numero;
    pp.getColumn('valor').numFmt = FORMATO_EXCEL.moeda;
    cabecalho(pp, 'FF6250D6');
  }

  return wb.xlsx.writeBuffer();
}
