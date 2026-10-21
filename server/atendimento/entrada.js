// Fluxo comum de mensagens: recebe de qualquer canal (identifica, abre/continua conversa, aciona o bot)
// e envia respostas humanas pelo canal certo.
import { conversaParaContato, conversaAberta, obterOuCriarContato, obterContato, obterConversa, registrarMensagem, atualizarMensagem, atualizarContato, moverConversa, vinculoDe } from './conversas.js';
import { identificarAutomatico } from './identificacao.js';
import { ehComando, htmlParaTexto, responderAutomatico, MENSAGEM_RECEBIDA } from './bot.js';

const transportes = new Map(); // canal -> { enviar(contato, conversa, texto, { html, teclado }) => { externo_id } }

/** Cada canal registra como envia mensagens. */
export function registrarTransporte(canal, transporte) {
  transportes.set(canal, transporte);
}

async function enviarPeloCanal(contato, conversa, texto, opcoes = {}) {
  const t = transportes.get(contato.canal);
  if (!t) return { externo_id: null }; // canal sem envio (ex.: simulado) — apenas registra
  return t.enviar(contato, conversa, texto, opcoes);
}

/**
 * Mensagem que chegou de um canal.
 * @param {{ canal, contato: {identificador, nome, username, telefone, email}, texto, html?, anexos?, externo_id?, criado_em?,
 *   assunto?, compartilhado?: { telefone }, idConversa?: number }} m
 */
export async function receberMensagem(m) {
  let contato = obterOuCriarContato({ canal: m.canal, ...m.contato });
  if (!contato.id_vendedor && !contato.id_cliente) {
    const id = identificarAutomatico({ email: m.canal === 'email' ? m.contato.email : null });
    if (id) contato = atualizarContato(contato.id, { id_vendedor: id.id_vendedor, verificado: m.canal === 'email' });
  }
  const automatica = m.canal !== 'email' && (Boolean(m.compartilhado) || ehComando(m.texto));
  const tinhaAberta = Boolean(conversaAberta(contato.id, m.canal));
  const idConversa = m.idConversa || conversaParaContato(contato, { assunto: m.assunto || null, statusNova: automatica ? 'resolvido' : 'novo' });
  const textoEntrada = m.compartilhado ? `📱 Compartilhou o telefone ${m.compartilhado.telefone}` : m.texto;
  registrarMensagem({
    id_conversa: idConversa,
    direcao: 'entrada',
    canal: m.canal,
    texto: textoEntrada,
    html: m.html || null,
    anexos: m.anexos || [],
    autor: contato.nome || contato.identificador,
    externo_id: m.externo_id || null,
    status: 'recebida',
    criado_em: m.criado_em,
    automatica,
  });

  if (automatica) {
    let resp;
    try {
      resp = await responderAutomatico(obterContato(contato.id), m.texto, { compartilhado: m.compartilhado });
    } catch (e) {
      resp = { html: `Não consegui responder agora (${e.message}). Um atendente vai te ajudar.`, encaminhar: true };
    }
    if (resp?.html) await responderComoBot(idConversa, resp.html, { teclado: resp.teclado });
    if (resp?.encaminhar) moverConversa(idConversa, 'novo');
  } else if (!tinhaAberta && m.canal !== 'email') {
    // primeira mensagem de uma conversa nova: confirma o recebimento e lembra dos comandos
    await responderComoBot(idConversa, MENSAGEM_RECEBIDA);
  }
  return { id_conversa: idConversa, contato: obterContato(contato.id) };
}

/** Resposta automática do bot (HTML do Telegram), registrada como status "bot". */
export async function responderComoBot(idConversa, html, { teclado } = {}) {
  const conversa = obterConversa(idConversa);
  const contato = obterContato(conversa.contato.id);
  let externo = null;
  let erroEnvio = null;
  try {
    externo = (await enviarPeloCanal(contato, conversa, html, { html: true, teclado }))?.externo_id || null;
  } catch (e) {
    erroEnvio = e.message;
  }
  return registrarMensagem({
    id_conversa: idConversa,
    direcao: 'saida',
    canal: contato.canal,
    texto: htmlParaTexto(html),
    autor: 'Bot',
    externo_id: externo,
    status: erroEnvio ? 'erro' : 'bot',
    erro: erroEnvio,
    automatica: true,
  });
}

/** Resposta de um atendente pela tela (texto puro). */
export async function enviarResposta(idConversa, texto, autor = 'Atendente') {
  const conversa = obterConversa(idConversa);
  if (!conversa) throw Object.assign(new Error('Conversa não encontrada.'), { status: 404 });
  const limpo = String(texto || '').trim();
  if (!limpo) throw Object.assign(new Error('Escreva a mensagem.'), { status: 400 });
  const contato = obterContato(conversa.contato.id);
  const msg = registrarMensagem({ id_conversa: idConversa, direcao: 'saida', canal: contato.canal, texto: limpo, autor, status: 'enviando', automatica: true });
  if (conversa.status === 'novo') moverConversa(idConversa, 'em_atendimento');
  try {
    const r = await enviarPeloCanal(contato, conversa, limpo, { html: false });
    return atualizarMensagem(msg.id, { status: 'enviada', externo_id: r?.externo_id || null, erro: null });
  } catch (e) {
    return atualizarMensagem(msg.id, { status: 'erro', erro: e.message });
  }
}

export { vinculoDe };
