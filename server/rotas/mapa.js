import zlib from 'node:zlib';
import ExcelJS from 'exceljs';
import { db } from '../db.js';
import {
  statusReceita, importarReceita, postgresConfigurado, garantirMunicipios, definirAposGeolocalizar,
} from '../receita.js';
import { baseUfs, resumoMapa, pontosMapa, detalhePonto, detalheCidade, buscarProspects, todosProspects, listarCidades } from '../geo.js';
import { municipiosUf, contornoUfs, bairrosComNumeros, statusMalhas, manutencaoGeo, malhaComprimida } from '../malhas.js';

const erro = (msg, status = 400) => Object.assign(new Error(msg), { status });
const sim = (v) => v === '1' || v === 'true' || v === 'sim';

function filtrosDaQuery(q) {
  return {
    uf: q.uf || null,
    cidade: q.cidade || null,
    bairro: q.bairro || null,
    independentes: sim(q.independentes),
    abertas_meses: Number(q.abertas_meses) || 0,
    porte: q.porte || null,
    cnae: q.cnae || null,
    score_min: Number(q.score_min) || 0,
    busca: q.busca || null,
    incluir_clientes: sim(q.incluir_clientes),
    ordenar: q.ordenar || 'score',
    pagina: Number(q.pagina) || 1,
    por_pagina: Number(q.por_pagina) || 50,
  };
}

// JSON grande (milhares de cidades/pontos) vai comprimido; o buffer fica em cache por objeto.
const comprimidos = new WeakMap();
function jsonComprimido(req, res, obj) {
  const aceita = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  if (!aceita) return res.json(obj);
  let buf = comprimidos.get(obj);
  if (!buf) {
    buf = zlib.gzipSync(Buffer.from(JSON.stringify(obj)), { level: 6 });
    comprimidos.set(obj, buf);
  }
  res.set({ 'Content-Type': 'application/json; charset=utf-8', 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' });
  res.send(buf);
}

const fmtCnpj = (c) => (c && c.length === 14 ? `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}` : c);

let base = null;
const BASE = () => (base ||= { ufs: baseUfs() });

export default function (app) {
  // ------------------------------------------------------------------ Receita Federal
  app.get('/api/receita/status', (req, res) => res.json(statusReceita()));

  // Por padrão espera terminar (contrato). Com ?assincrono=1 só dispara e o cliente acompanha em /api/receita/status.
  app.post('/api/receita/importar', async (req, res) => {
    if (!postgresConfigurado()) throw erro('Postgres da Receita não configurado (POSTGRES_HOST/DB/USER no .env).');
    const promessa = importarReceita();
    if (sim(req.query.assincrono)) {
      promessa.catch(() => {});
      return res.status(202).json({ iniciado: true, ...statusReceita() });
    }
    res.json(await promessa);
  });

  // ------------------------------------------------------------------ mapa
  app.get('/api/mapa/base', (req, res) => {
    res.set('Cache-Control', 'public, max-age=86400');
    jsonComprimido(req, res, BASE());
  });

  app.get('/api/mapa/resumo', (req, res) => {
    jsonComprimido(req, res, resumoMapa({ campanha: req.query.campanha || null }));
  });

  app.get('/api/mapa/pontos', (req, res) => {
    const bbox = String(req.query.bbox || '').split(',').map(Number);
    if (bbox.length !== 4 || bbox.some((x) => !Number.isFinite(x))) throw erro('Informe bbox=oeste,sul,leste,norte');
    jsonComprimido(
      req,
      res,
      pontosMapa({
        bbox,
        limite: Number(req.query.limite) || 20000,
        independentes: sim(req.query.independentes),
        abertasMeses: Number(req.query.abertas_meses) || 0,
        prospects: req.query.prospects !== '0',
        clientes: req.query.clientes !== '0',
      }),
    );
  });

  app.get('/api/mapa/farmacia/:id', (req, res) => {
    const d = detalhePonto(req.params.id);
    if (!d) throw erro('Ponto não encontrado', 404);
    res.json(d);
  });

  app.get('/api/mapa/cidade/:ibge', (req, res) => {
    const d = detalheCidade(req.params.ibge);
    if (!d) throw erro('Cidade não encontrada', 404);
    res.json(d);
  });

  app.get('/api/mapa/cidades', (req, res) => res.json(listarCidades(req.query.uf || null)));

  // ------------------------------------------------------------------ malhas (limites de cidades, UFs e bairros)
  app.get('/api/mapa/municipios/:uf', async (req, res) => {
    res.set('Cache-Control', 'public, max-age=86400');
    if (/gzip/.test(req.headers['accept-encoding'] || '')) {
      res.set({ 'Content-Type': 'application/json; charset=utf-8', 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' });
      return res.send(await malhaComprimida(req.params.uf, req.query.qualidade));
    }
    res.json(await municipiosUf(req.params.uf, { qualidade: req.query.qualidade }));
  });

  app.get('/api/mapa/contorno-ufs', async (req, res) => {
    const d = await contornoUfs(req.query.qualidade);
    res.set('Cache-Control', 'public, max-age=86400');
    jsonComprimido(req, res, d);
  });

  app.get('/api/mapa/bairros/:ibge', async (req, res) => {
    try {
      jsonComprimido(req, res, await bairrosComNumeros(req.params.ibge, { atualizar: sim(req.query.atualizar) }));
    } catch (e) {
      if (e.temporario) return res.status(503).json({ erro: e.message, temporario: true });
      throw e;
    }
  });

  app.get('/api/mapa/malhas/status', (req, res) => res.json(statusMalhas()));

  // ------------------------------------------------------------------ prospecção
  app.get('/api/prospeccao', (req, res) => res.json(buscarProspects(filtrosDaQuery(req.query))));

  app.get('/api/prospeccao/excel', async (req, res) => {
    const itens = todosProspects(filtrosDaQuery(req.query));
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Apurador de Campanhas';
    const ws = wb.addWorksheet('Prospecção', { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = [
      { header: 'Score', key: 'score', width: 8 },
      { header: 'CNPJ', key: 'cnpj', width: 20 },
      { header: 'Nome fantasia', key: 'nome', width: 34 },
      { header: 'Razão social', key: 'razao_social', width: 40 },
      { header: 'Tipo', key: 'tipo', width: 26 },
      { header: 'Rede', key: 'rede', width: 14 },
      { header: 'Porte', key: 'porte', width: 9 },
      { header: 'Abertura', key: 'abertura', width: 12 },
      { header: 'Endereço', key: 'endereco', width: 40 },
      { header: 'Bairro', key: 'bairro', width: 22 },
      { header: 'Cidade', key: 'cidade', width: 22 },
      { header: 'UF', key: 'uf', width: 5 },
      { header: 'CEP', key: 'cep', width: 11 },
      { header: 'Telefone', key: 'telefone', width: 16 },
      { header: 'E-mail', key: 'email', width: 30 },
      { header: 'Sócio principal', key: 'socio', width: 30 },
      { header: 'Nota cadastral', key: 'nota', width: 13 },
      { header: 'Latitude', key: 'lat', width: 11 },
      { header: 'Longitude', key: 'lng', width: 11 },
      { header: 'Mapa', key: 'mapa', width: 14 },
    ];
    for (const f of itens) {
      ws.addRow({
        score: f.score,
        cnpj: fmtCnpj(f.cnpj),
        nome: f.nome,
        razao_social: f.razao_social,
        tipo: f.cnae_descricao,
        rede: f.rede <= 1 ? 'Independente' : `Rede (${f.rede} lojas)`,
        porte: f.porte,
        abertura: f.abertura ? new Date(`${f.abertura}T12:00:00Z`) : null,
        endereco: f.endereco,
        bairro: f.bairro,
        cidade: f.cidade,
        uf: f.uf,
        cep: f.cep,
        telefone: f.telefone,
        email: f.email,
        socio: f.socio_principal,
        nota: f.nota,
        lat: f.lat,
        lng: f.lng,
        mapa: f.lat != null ? { text: 'Abrir no mapa', hyperlink: `https://www.google.com/maps?q=${f.lat},${f.lng}` } : null,
      });
    }
    const cab = ws.getRow(1);
    cab.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cab.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1C5CAB' } };
    cab.alignment = { vertical: 'middle' };
    cab.height = 20;
    ws.getColumn('abertura').numFmt = 'dd/mm/yyyy';
    ws.autoFilter = { from: 'A1', to: `T${Math.max(1, itens.length + 1)}` };
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="prospeccao-farmacias-${new Date().toISOString().slice(0, 10)}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  });
}

// ------------------------------------------------------------------ inicialização
// Nada pesado aqui: posições, scores, resumo, bairros e territórios saem das etapas em server/etapas/mapa.js
// (pipeline em segundo plano, só roda o que mudou). A rota só lê o pronto.
export async function iniciar() {
  garantirMunicipios();
  // importação manual da Receita feita no processo principal: confere as posições logo depois
  definirAposGeolocalizar(() => {
    manutencaoGeo({ assincrono: false }).catch((e) => console.error('[mapa] posições em terra:', e.message));
  });
  const nFarm = db.prepare('SELECT COUNT(*) AS n FROM rf_farmacia').get().n;
  if (nFarm === 0 && postgresConfigurado()) {
    console.log('[receita] base de farmácias vazia: importando da Receita Federal em segundo plano...');
    importarReceita().catch(() => {});
  }
}
