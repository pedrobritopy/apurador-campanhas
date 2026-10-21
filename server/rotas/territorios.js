import ExcelJS from 'exceljs';
import {
  listarTerritorios, obterTerritorio, criarTerritorio, atualizarTerritorio, excluirTerritorio, medirArea, normalizarGeometria,
  vendedoresParaTerritorio, farmaciasDaArea,
} from '../territorios.js';
import { aneisMunicipio, bairrosMunicipio, decodificarAnel } from '../malhas.js';
import { endereco } from '../geo.js';
import { dispararPipeline } from '../pipeline.js';

// depois de salvar: a própria área já volta com números; as outras (sobreposição) o pipeline atualiza em segundo plano
const avisar = (id) => dispararPipeline('territorio', { id: Number(id) });

const erro = (msg, status = 400) => Object.assign(new Error(msg), { status });

export default function (app) {
  app.get('/api/territorios', (req, res) => {
    res.json({ territorios: listarTerritorios({ tipo: req.query.tipo, vendedor: req.query.vendedor }), vendedores: vendedoresParaTerritorio() });
  });

  // números de uma área ainda não salva (enquanto desenha)
  app.post('/api/territorios/medir', (req, res) => {
    const aneis = normalizarGeometria(req.body?.geometria);
    res.json(medirArea(aneis, { id: req.body?.id ?? null, idVendedor: req.body?.id_vendedor ?? null }));
  });

  // geometria pronta de uma cidade ou de um bairro (para virar território com um clique)
  app.get('/api/territorios/forma/cidade/:ibge', async (req, res) => {
    const aneis = await aneisMunicipio(req.params.ibge);
    if (!aneis) throw erro('Contorno da cidade não encontrado', 404);
    res.json({ geometria: aneis });
  });
  app.get('/api/territorios/forma/bairro/:ibge/:id', async (req, res) => {
    const d = await bairrosMunicipio(req.params.ibge);
    const b = d.bairros.find((x) => x.id === req.params.id);
    if (!b) throw erro('Bairro não encontrado', 404);
    res.json({ geometria: b.a.map(decodificarAnel), nome: b.nome });
  });

  app.get('/api/territorios/:id', (req, res) => {
    const t = obterTerritorio(req.params.id);
    if (!t) throw erro('Área não encontrada', 404);
    res.json(t);
  });

  app.post('/api/territorios', (req, res) => {
    const t = criarTerritorio(req.body || {});
    avisar(t.id);
    res.status(201).json(t);
  });
  app.put('/api/territorios/:id', (req, res) => {
    const t = atualizarTerritorio(req.params.id, req.body || {});
    avisar(t.id);
    res.json(t);
  });
  app.delete('/api/territorios/:id', (req, res) => {
    const r = excluirTerritorio(req.params.id);
    avisar(req.params.id);
    res.json(r);
  });

  // planilha com as farmácias não clientes de dentro da área
  app.get('/api/territorios/:id/excel', async (req, res) => {
    const t = obterTerritorio(req.params.id);
    if (!t) throw erro('Área não encontrada', 404);
    const lista = farmaciasDaArea(t.geometria);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Apurador de Campanhas';
    const ws = wb.addWorksheet('Farmácias da área', { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = [
      { header: 'Score', key: 'score', width: 8 },
      { header: 'CNPJ', key: 'cnpj', width: 18 },
      { header: 'Nome', key: 'nome', width: 36 },
      { header: 'Rede', key: 'rede', width: 14 },
      { header: 'Endereço', key: 'endereco', width: 40 },
      { header: 'Bairro', key: 'bairro', width: 22 },
      { header: 'Cidade', key: 'cidade', width: 22 },
      { header: 'UF', key: 'uf', width: 5 },
      { header: 'Telefone', key: 'telefone', width: 16 },
      { header: 'E-mail', key: 'email', width: 30 },
      { header: 'Mapa', key: 'mapa', width: 14 },
    ];
    for (const f of lista) {
      ws.addRow({
        score: Math.round(f.score ?? 0), cnpj: f.cnpj, nome: f.nome_fantasia || f.razao_social, rede: !f.rede || f.rede <= 1 ? 'Independente' : `Rede (${f.rede} lojas)`,
        endereco: endereco(f), bairro: f.bairro, cidade: f.municipio, uf: f.uf, telefone: f.telefone, email: f.email,
        mapa: { text: 'Abrir no mapa', hyperlink: `https://www.google.com/maps?q=${f.lat},${f.lng}` },
      });
    }
    const cab = ws.getRow(1);
    cab.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cab.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1C5CAB' } };
    ws.autoFilter = { from: 'A1', to: `K${Math.max(1, lista.length + 1)}` };
    const nome = t.nome.normalize('NFD').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'area';
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="farmacias-${nome}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  });
}
