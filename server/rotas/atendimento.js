/*
 * Central de Atendimento — API
 *
 * GET    /api/atendimento/resumo                         → { nao_lidas, abertas, por_status, por_canal, paradas, responsaveis }
 * GET    /api/atendimento/conversas?status=&canal=&responsavel=&q=   (status aceita lista "novo,em_atendimento"; responsavel=_sem)
 * GET    /api/atendimento/conversas/:id?antes=&limite=    → { conversa, mensagens (crescente), tem_mais }
 * POST   /api/atendimento/conversas/:id/mensagens         { texto, autor } → mensagem (envia pelo canal da conversa)
 * POST   /api/atendimento/conversas/:id/status            { status: novo|em_atendimento|aguardando|resolvido }
 * POST   /api/atendimento/conversas/:id/responsavel       { responsavel }
 * POST   /api/atendimento/conversas/:id/etiquetas         { etiquetas: [] }
 * POST   /api/atendimento/conversas/:id/prioridade        { prioridade: baixa|normal|alta|urgente }
 * POST   /api/atendimento/conversas/:id/lida
 * GET    /api/atendimento/contatos?q=
 * PUT    /api/atendimento/contatos/:id                    { nome, telefone, email, id_vendedor, id_cliente, verificado }
 * GET    /api/atendimento/contatos/:id/contexto           → { contato, vinculo, campanhas }
 * GET    /api/atendimento/boletim?vendedor=&campanha=     → { texto, html, campanhas }
 * GET    /api/atendimento/respostas-rapidas
 * GET    /api/atendimento/canais                          → { telegram, email, simulacao }
 * POST   /api/atendimento/canais/telegram/testar | /canais/email/testar | /canais/email/ler
 * POST   /api/atendimento/simular                         { texto?, id_vendedor?, desconhecido? } (canal "simulado", para testes)
 * DELETE /api/atendimento/simulados                       (remove contatos/conversas simulados)
 * GET    /api/atendimento/eventos                         SSE: mensagem | conversa | status_canal | recarregar
 */
import { db } from '../db.js';
import {
  atribuirConversa, etiquetarConversa, eventos, limparSimulados, listarContatos, listarConversas, marcarLida, mensagensDaConversa,
  moverConversa, obterContato, obterConversa, obterOuCriarContato, priorizarConversa, resumo, atualizarContato, vinculoDe,
} from '../atendimento/conversas.js';
import { enviarResposta, receberMensagem } from '../atendimento/entrada.js';
import { boletimVendedor, campanhasDoVendedor, htmlParaTexto, COMANDOS } from '../atendimento/bot.js';
import { iniciarTelegram, statusTelegram, testarTelegram } from '../atendimento/telegram.js';
import { iniciarEmail, lerCaixa, statusEmail, testarEmail } from '../atendimento/email.js';

const erro = (msg, status = 400) => Object.assign(new Error(msg), { status });

export const RESPOSTAS_RAPIDAS = [
  { titulo: 'Saudação', texto: 'Olá! Tudo bem? Sou do time comercial e vou te ajudar por aqui.' },
  { titulo: 'Verificando', texto: 'Vou verificar e te retorno em instantes.' },
  { titulo: 'Pedido em análise', texto: 'Seu pedido está em análise no faturamento. Assim que liberar, te aviso por aqui.' },
  { titulo: 'Campanha', texto: 'Para ver sua situação atualizada nas campanhas, envie /boletim a qualquer momento. 😉' },
  { titulo: 'Clientes a atacar', texto: 'Enviei seu plano de ataque com os clientes prioritários. Envie /plano para ver de novo.' },
  { titulo: 'Encerrar', texto: 'Posso ajudar em algo mais? Se estiver tudo certo, vou encerrar este atendimento.' },
];

const AMOSTRAS = [
  'Bom dia! Como estou na campanha?',
  'Preciso de ajuda com um pedido que não faturou.',
  'O cliente pediu um prazo maior no boleto, consegue liberar?',
  'Tem estoque de Sensodyne? O cliente quer 40 unidades.',
  'Qual é a meta da campanha da Hypera?',
  'Fechei um pedido grande hoje! Já conta para a campanha?',
  'Não estou conseguindo acessar o app de pedidos.',
  'O cliente está pedindo material de ponto de venda.',
];

export default function (app) {
  app.get('/api/atendimento/resumo', (req, res) => res.json(resumo()));

  app.get('/api/atendimento/conversas', (req, res) => {
    res.json(listarConversas({ status: req.query.status, canal: req.query.canal, responsavel: req.query.responsavel, q: req.query.q, limite: req.query.limite }));
  });

  app.get('/api/atendimento/conversas/:id', (req, res) => {
    const conversa = obterConversa(req.params.id);
    if (!conversa) throw erro('Conversa não encontrada.', 404);
    res.json({ conversa, ...mensagensDaConversa(conversa.id, { antes: req.query.antes, limite: req.query.limite }) });
  });

  app.post('/api/atendimento/conversas/:id/mensagens', async (req, res) => {
    res.json(await enviarResposta(Number(req.params.id), req.body?.texto, String(req.body?.autor || 'Atendente').slice(0, 60)));
  });
  app.post('/api/atendimento/conversas/:id/status', (req, res) => res.json(moverConversa(req.params.id, String(req.body?.status || ''))));
  app.post('/api/atendimento/conversas/:id/responsavel', (req, res) => res.json(atribuirConversa(req.params.id, req.body?.responsavel)));
  app.post('/api/atendimento/conversas/:id/etiquetas', (req, res) => res.json(etiquetarConversa(req.params.id, req.body?.etiquetas)));
  app.post('/api/atendimento/conversas/:id/prioridade', (req, res) => res.json(priorizarConversa(req.params.id, req.body?.prioridade)));
  app.post('/api/atendimento/conversas/:id/lida', (req, res) => res.json(marcarLida(req.params.id)));

  // ------------------------------------------------------------------ contatos
  app.get('/api/atendimento/contatos', (req, res) => res.json(listarContatos({ q: req.query.q })));
  app.put('/api/atendimento/contatos/:id', (req, res) => res.json(atualizarContato(req.params.id, req.body || {})));
  app.get('/api/atendimento/contatos/:id/contexto', (req, res) => {
    const contato = obterContato(req.params.id);
    if (!contato) throw erro('Contato não encontrado.', 404);
    const vinculo = vinculoDe(contato);
    let campanhas = [];
    if (vinculo.vendedor) {
      try {
        campanhas = campanhasDoVendedor(vinculo.vendedor.id);
      } catch (e) {
        campanhas = [];
        vinculo.erro_campanhas = e.message;
      }
    }
    const conversas = db.prepare('SELECT COUNT(*) AS n FROM atd_conversa WHERE id_contato = ?').get(contato.id).n;
    res.json({ contato: { ...contato, verificado: Boolean(contato.verificado) }, vinculo, campanhas, conversas });
  });

  app.get('/api/atendimento/boletim', (req, res) => {
    const vendedor = Number(req.query.vendedor);
    if (!vendedor) throw erro('Informe o vendedor.');
    const html = boletimVendedor(vendedor, { campanha: req.query.campanha ? Number(req.query.campanha) : undefined });
    if (!html) throw erro('Vendedor não encontrado.', 404);
    res.json({ html, texto: htmlParaTexto(html), campanhas: campanhasDoVendedor(vendedor) });
  });

  app.get('/api/atendimento/respostas-rapidas', (req, res) => res.json(RESPOSTAS_RAPIDAS));

  app.get('/api/atendimento/responsaveis', (req, res) => {
    const gerentes = db.prepare("SELECT nome_vendedor AS nome FROM dm_vendedor WHERE lower(COALESCE(nivel, '')) = 'gerente' ORDER BY 1").all().map((r) => r.nome);
    res.json([...new Set([...resumo().responsaveis, ...gerentes])]);
  });

  // ------------------------------------------------------------------ canais
  app.get('/api/atendimento/canais', (req, res) => {
    const simulados = db.prepare("SELECT COUNT(*) AS n FROM atd_contato WHERE canal = 'simulado'").get().n;
    res.json({ telegram: statusTelegram(), email: statusEmail(), simulacao: { contatos: simulados }, comandos: COMANDOS });
  });
  app.post('/api/atendimento/canais/telegram/testar', async (req, res) => {
    try {
      res.json(await testarTelegram());
    } catch (e) {
      throw erro(`O Telegram recusou: ${e.message}`);
    }
  });
  app.post('/api/atendimento/canais/email/testar', async (req, res) => res.json(await testarEmail()));
  app.post('/api/atendimento/canais/email/ler', async (req, res) => res.json(await lerCaixa()));

  // ------------------------------------------------------------------ simulação (testes sem canal real)
  app.post('/api/atendimento/simular', async (req, res) => {
    const b = req.body || {};
    let contato;
    if (b.desconhecido) {
      const n = Math.floor(Math.random() * 9000 + 1000);
      contato = { identificador: `sim-x${n}`, nome: `Contato ${n}`, username: `@contato${n}` };
    } else {
      const v = b.id_vendedor
        ? db.prepare('SELECT id_vendedor, nome_vendedor, telefone, email FROM dm_vendedor WHERE id_vendedor = ?').get(Number(b.id_vendedor))
        : db.prepare("SELECT id_vendedor, nome_vendedor, telefone, email FROM dm_vendedor WHERE lower(COALESCE(nivel,'')) NOT IN ('gerente', 'coordenador') ORDER BY RANDOM() LIMIT 1").get();
      if (!v) throw erro('Vendedor não encontrado.', 404);
      contato = { identificador: `sim-v${v.id_vendedor}`, nome: v.nome_vendedor, telefone: v.telefone, email: v.email, username: `@${String(v.nome_vendedor).split(' ')[0].toLowerCase()}` };
      // vendedor simulado já vem identificado (no Telegram real isso acontece ao compartilhar o telefone)
      const c = obterOuCriarContato({ canal: 'simulado', ...contato });
      if (!c.id_vendedor) atualizarContato(c.id, { id_vendedor: v.id_vendedor, verificado: true });
    }
    const texto = String(b.texto || AMOSTRAS[Math.floor(Math.random() * AMOSTRAS.length)]);
    const r = await receberMensagem({ canal: 'simulado', contato, texto, criado_em: new Date().toISOString() });
    res.json(r);
  });
  app.delete('/api/atendimento/simulados', (req, res) => res.json(limparSimulados()));

  // ------------------------------------------------------------------ tempo real (SSE)
  app.get('/api/atendimento/eventos', (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(`event: pronto\ndata: ${JSON.stringify({ agora: new Date().toISOString() })}\n\n`);
    const ouvir = ({ tipo, dados }) => {
      try {
        res.write(`event: ${tipo}\ndata: ${JSON.stringify(dados)}\n\n`);
      } catch {
        /* conexão fechada */
      }
    };
    eventos.on('evento', ouvir);
    const pulso = setInterval(() => res.write(': pulso\n\n'), 20000);
    req.on('close', () => {
      clearInterval(pulso);
      eventos.off('evento', ouvir);
    });
  });
}

export async function iniciar() {
  iniciarTelegram();
  iniciarEmail();
}
