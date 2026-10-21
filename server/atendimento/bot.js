// Bot de atendimento: comandos automáticos que respondem com INFORMAÇÃO da apuração
// (/boletim, /ranking, /plano) para vendedores identificados.
import { db } from '../db.js';
import { apurarComCache, detalharParticipante } from '../motor.js';
import { boletimParticipante, fmt, fmtMoeda, fmtPct } from '../narrativa.js';
import { atualizarContato, vinculoDe } from './conversas.js';
import { vendedorPorEmail, vendedorPorTelefone, digitos } from './identificacao.js';

export const COMANDOS = [
  { comando: 'boletim', descricao: 'Sua situação em cada campanha ativa' },
  { comando: 'ranking', descricao: 'Top 5 e sua posição nas campanhas' },
  { comando: 'plano', descricao: 'Clientes para atacar hoje' },
  { comando: 'vincular', descricao: 'Vincular pelo e-mail: /vincular seu@email.com' },
  { comando: 'ajuda', descricao: 'Lista de comandos' },
];

export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** HTML do Telegram → texto puro (para registro e para o compositor). */
export const htmlParaTexto = (h) => String(h || '').replace(/<br\s*\/?>/g, '\n').replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');

export function ehComando(texto) {
  return /^\/[a-z_]+/i.test(String(texto || '').trim());
}

const primeiroNome = (n = '') => String(n).split(/\s+/)[0];
const STATUS_EMOJI = { atingiu: '✅', no_ritmo: '📈', atencao: '⚠️', risco: '🔻', nao_atingiu: '❌', sem_meta: '•', aguardando: '⏳' };

/** Campanhas ativas onde o vendedor participa (direto, pela equipe ou pela empresa). */
function participacoes(idVendedor) {
  const v = db.prepare('SELECT id_vendedor, nivel, id_superior FROM dm_vendedor WHERE id_vendedor = ?').get(Number(idVendedor));
  if (!v) return [];
  const out = [];
  for (const camp of db.prepare("SELECT id, nome, definicao FROM campanha WHERE status = 'ativa' ORDER BY fim").all()) {
    let r;
    try {
      r = apurarComCache(JSON.parse(camp.definicao));
    } catch {
      continue;
    }
    if (r.tempo.status === 'encerrada') continue;
    const nivel = r.campanha.participantes.nivel;
    let chave = null;
    let escopo = 'você';
    if (nivel === 'vendedor') chave = String(v.id_vendedor);
    else if (nivel === 'equipe') {
      chave = String(v.nivel === 'gerente' ? v.id_vendedor : v.id_superior ?? v.id_vendedor);
      escopo = 'sua equipe';
    } else if (nivel === 'empresa') {
      chave = 'empresa';
      escopo = 'a empresa';
    }
    const linha = chave ? r.participantes.find((l) => l.chave === chave) : null;
    if (linha) out.push({ camp, r, linha, escopo });
  }
  return out;
}

function blocoBoletim({ camp, r, linha, escopo }) {
  const b = boletimParticipante(r, linha, { idCampanha: camp.id, comOportunidades: false });
  const t = r.tempo;
  const partes = [`📊 <b>${esc(camp.nome)}</b>${r.campanha.fornecedor ? ` · ${esc(r.campanha.fornecedor)}` : ''}`];
  if (t.status === 'futura') {
    partes.push(`⏳ Começa em ${t.inicio.split('-').reverse().join('/')}.`);
    return partes.join('\n');
  }
  const mov = b.movimento > 0 ? ` ▲${b.movimento}` : b.movimento < 0 ? ` ▼${-b.movimento}` : '';
  partes.push(`${STATUS_EMOJI[b.status] || '•'} ${escopo === 'você' ? '' : `${esc(escopo[0].toUpperCase() + escopo.slice(1))}: `}<b>${b.posicao}º de ${b.total_participantes}</b>${mov} · ${esc(b.status_rotulo)}`);
  if (b.score != null) partes.push(`Atingimento <b>${fmtPct(b.score)}</b> · projeção <b>${fmtPct(b.score_proj)}</b>`);
  for (const c of b.criterios) partes.push(`• ${esc(c.nome)}: ${esc(c.texto)}`);
  const destaque = b.destaques.find((d) => d.tipo === 'acao') || b.destaques[0];
  if (destaque) partes.push(`💡 ${esc(destaque.texto)}`);
  if (b.premio_proj > 0) partes.push(`🏆 Prêmio projetado: <b>${fmtMoeda(b.premio_proj)}</b>${b.premio > 0 ? ` (garantido ${fmtMoeda(b.premio)})` : ''}`);
  // clientes a atacar (só deste participante, para responder rápido)
  if (['vendedor', 'equipe'].includes(r.campanha.participantes.nivel) && b.status !== 'atingiu') {
    try {
      const det = detalharParticipante(r, linha.chave, r.campanha.premiacao.criterio_base);
      const ops = (det?.oportunidades || []).filter((o) => o.valor_hist > 0).slice(0, 3);
      if (ops.length) partes.push(`🎯 Clientes para atacar: ${ops.map((o) => `${esc(o.nome)} (${fmtMoeda(o.valor_hist)} antes)`).join('; ')}`);
    } catch {
      /* oportunidades são um extra; sem elas o boletim continua válido */
    }
  }
  partes.push(`⏱ Faltam ${t.restantes} dias ${t.calendario === 'corridos' ? 'corridos' : 'úteis'}.`);
  return partes.join('\n');
}

/** Texto do boletim do vendedor (HTML do Telegram). campanha opcional filtra uma só. */
export function boletimVendedor(idVendedor, { campanha } = {}) {
  const v = db.prepare('SELECT nome_vendedor AS nome FROM dm_vendedor WHERE id_vendedor = ?').get(Number(idVendedor));
  if (!v) return null;
  let lista = participacoes(idVendedor);
  if (campanha) lista = lista.filter((p) => p.camp.id === Number(campanha));
  if (!lista.length) return `Olá, ${esc(primeiroNome(v.nome))}! Não há campanhas ativas com a sua participação no momento.`;
  const ref = lista[0].r.tempo.referencia.split('-').reverse().join('/');
  return [`Olá, <b>${esc(primeiroNome(v.nome))}</b>! Sua situação com dados até ${ref}:`, ...lista.map(blocoBoletim)].join('\n\n');
}

export function campanhasDoVendedor(idVendedor) {
  return participacoes(idVendedor).map((p) => ({ id: p.camp.id, nome: p.camp.nome, status: p.linha.status, posicao: p.linha.posicao, total: p.r.participantes.length, score: p.linha.score, score_proj: p.linha.score_proj, premio_proj: p.linha.premio_proj, escopo: p.escopo, tempo_status: p.r.tempo.status }));
}

function rankingVendedor(idVendedor) {
  const lista = participacoes(idVendedor).filter((p) => p.r.tempo.status === 'andamento');
  if (!lista.length) return 'Não há campanhas em andamento com a sua participação.';
  return lista
    .map(({ camp, r, linha }) => {
      const idx = Math.max(0, r.campanha.criterios.findIndex((c) => c.id === r.campanha.premiacao.criterio_base));
      const cd = r.criterios[idx];
      const valor = (l) => (l.score != null ? fmtPct(l.score) : fmt(l.criterios[idx]?.realizado, cd.formato));
      const top = r.participantes.slice(0, 5).map((l, i) => `${['🥇', '🥈', '🥉', '4º', '5º'][i]} ${esc(l.nome.split(' ').slice(0, 2).join(' '))}: ${valor(l)}${l.chave === linha.chave ? ' ← você' : ''}`);
      const voce = linha.posicao > 5 ? `\n…\n<b>${linha.posicao}º ${esc(linha.nome.split(' ').slice(0, 2).join(' '))}: ${valor(linha)}</b> (você)` : '';
      return `🏁 <b>${esc(camp.nome)}</b>\n${top.join('\n')}${voce}`;
    })
    .join('\n\n');
}

async function planoVendedor(idVendedor) {
  let mod;
  try {
    mod = await import('../planos.js');
  } catch {
    return 'O plano de ataque ainda não está disponível.';
  }
  try {
    const p = mod.gerarPlano({ vendedor: idVendedor, limite: 5 });
    if (!p.itens.length) return 'Nenhuma oportunidade prioritária encontrada agora. Bom trabalho! 👏';
    const linhas = p.itens.map((it, i) => `${i + 1}. <b>${esc(it.cliente)}</b>${it.cidade ? ` (${esc(it.cidade)})` : ''}: ${esc(it.titulo || it.tipo_rotulo)}\n   ${esc(String(it.motivo || '').slice(0, 180))}`);
    return `🎯 <b>Seu plano de ataque</b> (potencial ${fmtMoeda(p.resumo.potencial_total)}):\n\n${linhas.join('\n\n')}`;
  } catch (e) {
    return `Não consegui montar o plano agora: ${esc(e.message)}`;
  }
}

export function textoAjuda(identificado) {
  const lista = COMANDOS.map((c) => `/${c.comando}: ${c.descricao}`).join('\n');
  return identificado
    ? `Comandos disponíveis:\n${lista}\n\nOu escreva sua dúvida que um atendente responde por aqui.`
    : `Para eu mostrar seus números, preciso te identificar: toque em <b>📱 Compartilhar meu telefone</b> ou envie /vincular seu@email.com.\n\n${lista}`;
}

const TECLADO_TELEFONE = { keyboard: [[{ text: '📱 Compartilhar meu telefone', request_contact: true }]], resize_keyboard: true, one_time_keyboard: true };
const REMOVER_TECLADO = { remove_keyboard: true };

/**
 * Resposta automática para um comando ou para um contato compartilhado.
 * @returns {Promise<{ html: string, teclado?: object, vinculou?: object } | null>}
 */
export async function responderAutomatico(contato, texto, { compartilhado } = {}) {
  // telefone compartilhado pelo botão do Telegram
  if (compartilhado) {
    const v = vendedorPorTelefone(compartilhado.telefone);
    if (v) {
      atualizarContato(contato.id, { id_vendedor: v.id, telefone: digitos(compartilhado.telefone), verificado: true });
      return { html: `Pronto, <b>${esc(primeiroNome(v.nome))}</b>! Você foi identificado como ${v.nivel === 'gerente' ? 'gerente' : 'vendedor'}. ✅\n\n${textoAjuda(true)}`, teclado: REMOVER_TECLADO, vinculou: v };
    }
    atualizarContato(contato.id, { telefone: digitos(compartilhado.telefone) });
    return { html: 'Não encontrei esse telefone no cadastro de vendedores. Um atendente vai te ajudar por aqui. 🙂', teclado: REMOVER_TECLADO, encaminhar: true };
  }

  const [cmd, ...args] = String(texto || '').trim().split(/\s+/);
  const comando = cmd.replace(/^\//, '').replace(/@.*/, '').toLowerCase();
  const vinculo = vinculoDe(contato);
  const idVend = vinculo.vendedor?.id;

  switch (comando) {
    case 'start':
      if (idVend) return { html: `Olá de novo, <b>${esc(primeiroNome(vinculo.vendedor.nome))}</b>! 👋\n\n${textoAjuda(true)}` };
      return { html: `Olá! 👋 Sou o assistente das campanhas de vendas.\n\n${textoAjuda(false)}`, teclado: TECLADO_TELEFONE };
    case 'ajuda':
    case 'help':
      return { html: textoAjuda(Boolean(idVend)), teclado: idVend ? undefined : TECLADO_TELEFONE };
    case 'vincular': {
      const v = vendedorPorEmail(args[0]);
      if (!v) return { html: 'Não encontrei esse e-mail no cadastro de vendedores. Confira e envie de novo: /vincular seu@email.com' };
      atualizarContato(contato.id, { id_vendedor: v.id, email: args[0].toLowerCase(), verificado: false });
      return { html: `Vinculado a <b>${esc(v.nome)}</b> pelo e-mail. ✅\n\n${textoAjuda(true)}`, teclado: REMOVER_TECLADO, vinculou: v };
    }
    case 'boletim':
    case 'situacao':
    case 'meta':
      if (!idVend) return { html: textoAjuda(false), teclado: TECLADO_TELEFONE };
      return { html: boletimVendedor(idVend) };
    case 'ranking':
      if (!idVend) return { html: textoAjuda(false), teclado: TECLADO_TELEFONE };
      return { html: rankingVendedor(idVend) };
    case 'plano':
      if (!idVend) return { html: textoAjuda(false), teclado: TECLADO_TELEFONE };
      return { html: await planoVendedor(idVend) };
    default:
      return { html: `Não conheço o comando ${esc(cmd)}.\n\n${textoAjuda(Boolean(idVend))}` };
  }
}

export const MENSAGEM_RECEBIDA = 'Recebemos sua mensagem! Um atendente responde em breve por aqui. Enquanto isso, /boletim mostra sua situação nas campanhas. 🙂';
