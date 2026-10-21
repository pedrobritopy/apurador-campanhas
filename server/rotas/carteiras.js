import { dispararPipeline } from '../pipeline.js';
import {
  atualizarCarteira, camadaCarteiras, criarCarteira, donoDaUnidade, excluirCarteira, incluirRegra, obterCarteira, removerRegra, resumoCarteiras,
} from '../carteiras.js';
import { lerFicha } from '../ficha.js';
import { listarVendedores } from '../participantes.js';

// Carteiras de vendas e ficha do cliente. Leituras vêm prontas da pipeline (etapas "carteiras" e "clientes-ficha");
// gravações avisam a pipeline pelo evento "carteira".
export default function (app) {
  const avisar = () => dispararPipeline('carteira');

  app.get('/api/carteiras', (req, res) => {
    const r = resumoCarteiras();
    if (!r) {
      dispararPipeline('carteira');
      return res.json({ pendente: true, carteiras: [], equipes: [], regioes: [], sugestoes: [], conferencia: [] });
    }
    res.json(r);
  });
  app.get('/api/carteiras/mapa', (req, res) => res.json(camadaCarteiras()));
  app.get('/api/carteiras/vendedores', (req, res) => res.json(listarVendedores()));
  app.get('/api/carteiras/unidade', (req, res) => res.json(donoDaUnidade({ nivel: req.query.nivel, uf: req.query.uf, ibge: req.query.ibge, bairro_id: req.query.bairro_id, nome: req.query.nome, id_territorio: req.query.id_territorio })));
  app.get('/api/carteiras/:id', (req, res) => {
    const c = obterCarteira(req.params.id);
    if (!c) return res.status(404).json({ erro: 'Carteira não encontrada.' });
    res.json(c);
  });
  app.post('/api/carteiras', (req, res) => {
    const c = criarCarteira(req.body || {});
    avisar();
    res.status(201).json(c);
  });
  app.put('/api/carteiras/:id', (req, res) => {
    const c = atualizarCarteira(req.params.id, req.body || {});
    avisar();
    res.json(c);
  });
  app.delete('/api/carteiras/:id', (req, res) => {
    excluirCarteira(req.params.id);
    avisar();
    res.json({ ok: true });
  });
  app.post('/api/carteiras/:id/regras', (req, res) => {
    const r = incluirRegra(req.params.id, req.body || {}, { mover: Boolean(req.body?.mover) });
    avisar();
    res.status(201).json(r);
  });
  app.delete('/api/carteiras/regras/:idRegra', (req, res) => {
    removerRegra(req.params.idRegra);
    avisar();
    res.json({ ok: true });
  });

  app.get('/api/clientes/:id/ficha', (req, res) => {
    const f = lerFicha(req.params.id);
    if (!f) return res.status(404).json({ erro: 'Cliente não encontrado.' });
    res.json(f);
  });
}
