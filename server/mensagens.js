// Modelos de mensagem e renderização: o texto enviado é INFORMAÇÃO gerada pelo narrador
// (posição, ritmo necessário, próxima faixa, clientes a atacar...), não uma tabela de números.
import { db, agoraISO, lerConfig } from './db.js';
import { boletins, frasesCampanha, resumoEquipes, fmt, fmtMoeda, fmtPct, fmtDataBR } from './narrativa.js';

export const MODELOS_PADRAO = [
  {
    nome: 'Boletim do vendedor (WhatsApp)',
    destino: 'participantes',
    assunto: '{campanha}: você está em {posicao}º, com {atingimento} da meta',
    corpo: `*{campanha}* · atualização de {data_referencia}

Olá, {primeiro_nome}! Você está em *{posicao}º de {total_participantes}* {movimento}
Situação: *{status}* · {atingimento} da meta · projeção {projecao}

{criterios}

{destaques}

{oportunidades}

Faltam {dias_restantes} dias {tipo_dia}. Boletim completo: {link_boletim}`,
  },
  {
    nome: 'Alerta rápido: quem precisa acelerar',
    destino: 'participantes',
    assunto: '{campanha}: faltam {dias_restantes} dias',
    corpo: `{primeiro_nome}, atenção na *{campanha}*: você está em {atingimento} da meta e a projeção é {projecao}.

{destaque_principal}
{proxima_faixa}

{oportunidades}`,
  },
  {
    nome: 'Resumo da equipe (gerente)',
    destino: 'gerentes',
    assunto: '{campanha}: sua equipe está em {equipe_media}',
    corpo: `*{campanha}* · equipe de {primeiro_nome} · {data_referencia}

Média da equipe: *{equipe_media}* (projeção {equipe_projecao})
✔ {equipe_atingiram} já bateram · ↗ {equipe_no_ritmo} no ritmo · ⚠ {equipe_risco} precisam acelerar
Prêmios projetados da equipe: {equipe_premio_projetado}

{equipe_lista}

Faltam {dias_restantes} dias {tipo_dia}. Apuração completa: {link_campanha}`,
  },
  {
    nome: 'Resumo executivo (diretoria)',
    destino: 'geral',
    assunto: 'Resumo da campanha {campanha}',
    corpo: `*{campanha}* ({fornecedor}) · {data_referencia}

{resumo}

Top 5:
{top5}

Participantes: {participantes} · atingiram {atingiram} · em risco {em_risco}
Prêmios: {premio_total} apurados · {premio_projetado} projetados{orcamento}

Apuração completa: {link_campanha}`,
  },
];

export const VARIAVEIS_MENSAGEM = [
  ['{nome}', 'Nome do participante (ou do gerente / destinatário)', 'Ulisses Nascimento', 'todos'],
  ['{primeiro_nome}', 'Primeiro nome', 'Ulisses', 'todos'],
  ['{campanha}', 'Nome da campanha', 'Sensodyne em Dobro', 'todos'],
  ['{fornecedor}', 'Fornecedor/fabricante', 'Haleon', 'todos'],
  ['{data_referencia}', 'Data dos dados', '19/10/2026', 'todos'],
  ['{fim}', 'Último dia da campanha', '31/10/2026', 'todos'],
  ['{dias_restantes}', 'Dias que faltam (úteis ou corridos)', '9', 'todos'],
  ['{tipo_dia}', '"úteis" ou "corridos"', 'úteis', 'todos'],
  ['{status}', 'Situação: Atingiu, No ritmo, Atenção, Em risco…', 'No ritmo', 'participantes'],
  ['{posicao}', 'Posição no ranking', '7', 'participantes'],
  ['{total_participantes}', 'Total de participantes', '162', 'todos'],
  ['{movimento}', 'Subiu/caiu no ranking na última semana', '▲ 3 posições', 'participantes'],
  ['{atingimento}', 'Atingimento atual (pontuação)', '87%', 'participantes'],
  ['{projecao}', 'Atingimento projetado para o fim', '104%', 'participantes'],
  ['{realizado}', 'Realizado do critério principal', '87 un', 'participantes'],
  ['{meta}', 'Meta do critério principal', '100 un', 'participantes'],
  ['{falta}', 'Quanto falta no critério principal', '13 un', 'participantes'],
  ['{ritmo_necessario}', 'Quanto vender por dia para bater a meta', '1,5 un/dia', 'participantes'],
  ['{premio}', 'Prêmio já garantido', 'R$ 150,00', 'participantes'],
  ['{premio_projetado}', 'Prêmio projetado', 'R$ 210,00', 'todos'],
  ['{proxima_faixa}', 'Frase sobre a próxima faixa de prêmio', 'Faltam 23 un para a faixa de 120%: +R$ 100 no seu prêmio', 'participantes'],
  ['{criterios}', 'Uma linha por critério, com realizado, meta, falta e ritmo', '• Unidades: 87 de 100 un (87%). Faltam 13 un (1,5/dia)', 'participantes'],
  ['{destaques}', 'Frases de informação geradas pelo motor (ritmo, ranking, comparativos…)', '• Seu ritmo nos últimos dias está 20% acima da sua média', 'participantes'],
  ['{destaque_principal}', 'A frase mais importante para o participante', 'Para bater a meta você precisa de 2 un/dia…', 'participantes'],
  ['{oportunidades}', 'Clientes da carteira para atacar (já compraram esses produtos e ainda não compraram nesta campanha)', '🎯 Clientes para atacar: …', 'participantes'],
  ['{lider}', 'Líder do ranking e seu atingimento', 'Larissa (135%)', 'todos'],
  ['{media}', 'Média geral de atingimento', '92%', 'todos'],
  ['{link_boletim}', 'Link para o boletim individual (página bonita, imprimível)', 'http://…/#/boletim/1/19', 'participantes'],
  ['{link_campanha}', 'Link para a apuração completa', 'http://…/#/campanhas/1', 'todos'],
  ['{equipe_media}', 'Média de atingimento da equipe', '96%', 'gerentes'],
  ['{equipe_projecao}', 'Projeção média da equipe', '104%', 'gerentes'],
  ['{equipe_atingiram}', 'Quantos da equipe já bateram', '3', 'gerentes'],
  ['{equipe_no_ritmo}', 'Quantos estão no ritmo', '2', 'gerentes'],
  ['{equipe_risco}', 'Quantos precisam acelerar', '4', 'gerentes'],
  ['{equipe_premio_projetado}', 'Prêmios projetados da equipe', 'R$ 1.230,00', 'gerentes'],
  ['{equipe_lista}', 'Uma linha por membro da equipe com situação e próxima ação', '✔ Ana Souza: 112% (proj. 120%)', 'gerentes'],
  ['{resumo}', 'Resumo da campanha em frases', 'No ritmo atual a campanha fecha em 104%…', 'geral'],
  ['{top5}', 'Os 5 primeiros do ranking', '1. Larissa Melo: 135%', 'geral'],
  ['{participantes}', 'Total de participantes', '162', 'geral'],
  ['{atingiram}', 'Quantos já atingiram', '44', 'geral'],
  ['{em_risco}', 'Quantos estão em risco/atenção', '61', 'geral'],
  ['{premio_total}', 'Prêmios já apurados', 'R$ 12.300,00', 'geral'],
  ['{orcamento}', 'Uso do orçamento (texto)', ' (orçamento R$ 30.000, 72%)', 'geral'],
].map(([chave, descricao, exemplo, destino]) => ({ chave, descricao, exemplo, destino }));

export function criarModelosMensagem() {
  const st = db.prepare('INSERT INTO modelo_mensagem (nome, destino, assunto, corpo, criado_em) VALUES (?, ?, ?, ?, ?)');
  for (const m of MODELOS_PADRAO) st.run(m.nome, m.destino, m.assunto, m.corpo, agoraISO());
}

// ------------------------------------------------------------------ renderização
/** Substitui {variaveis}; linhas que ficam vazias por causa de variáveis vazias são removidas. */
export function renderizar(modelo, dados) {
  const linhas = String(modelo || '').split('\n');
  const out = [];
  for (const l of linhas) {
    const tinhaVariavel = /\{[a-z_0-9]+\}/i.test(l);
    const r = l.replace(/\{([a-z_0-9]+)\}/gi, (m, k) => (k in dados ? String(dados[k] ?? '') : m));
    if (tinhaVariavel && !r.trim()) continue;
    out.push(r.replace(/\s+$/, ''));
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

const escapar = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Texto com *negrito* estilo WhatsApp → HTML de e-mail simples e legível. */
export function textoParaHtml(texto, { cor = '#2a78d6', titulo = '' } = {}) {
  const corpo = escapar(texto)
    .replace(/\*([^*\n]+)\*/g, '<strong>$1</strong>')
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:' + cor + '">$1</a>')
    .split('\n')
    .map((l) => (l.trim() ? `<p style="margin:0 0 8px">${l}</p>` : '<div style="height:6px"></div>'))
    .join('');
  return `<!doctype html><html><body style="margin:0;background:#f4f4f1;font-family:Segoe UI,Arial,sans-serif;color:#0b0b0b">
<div style="max-width:600px;margin:24px auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e8e7e1">
<div style="height:6px;background:${cor}"></div>
${titulo ? `<div style="padding:18px 24px 0;font-size:13px;color:#52514e">${escapar(titulo)}</div>` : ''}
<div style="padding:16px 24px 20px;font-size:14px;line-height:1.5">${corpo}</div>
<div style="padding:12px 24px;background:#f9f9f7;font-size:11px;color:#898781">Enviado pelo Apurador de Campanhas</div>
</div></body></html>`;
}

export function whatsappUrl(telefone, texto) {
  let d = String(telefone || '').replace(/\D/g, '');
  if (!d) return `https://wa.me/?text=${encodeURIComponent(texto)}`;
  if (!d.startsWith('55') && (d.length === 10 || d.length === 11)) d = `55${d}`;
  return `https://wa.me/${d}?text=${encodeURIComponent(texto)}`;
}

export function baseUrlPublica(req) {
  const cfg = lerConfig();
  if (cfg.url_publica) return cfg.url_publica.replace(/\/+$/, '');
  if (req) return `${req.protocol}://${req.get('host')}`;
  return `http://localhost:${process.env.PORT || 3210}`;
}

const linhas = (arr, prefixo = '• ') => arr.map((x) => `${prefixo}${x}`).join('\n');

function dadosParticipante(b, r, idCampanha, baseUrl) {
  const t = r.tempo;
  const lider = r.participantes[0];
  const comScore = r.participantes.filter((p) => p.score != null);
  const media = comScore.length ? comScore.reduce((a, p) => a + p.score, 0) / comScore.length : null;
  const principal = b.criterios[Math.max(0, r.campanha.criterios.findIndex((c) => c.id === r.campanha.premiacao.criterio_base))] || b.criterios[0];
  const u = principal?.unidade ? ` ${principal.unidade}` : '';
  const acao = b.destaques.find((d) => d.tipo === 'acao' && /faixa|bloco|começar a ganhar|garantir o prêmio/.test(d.texto));
  const ops = b.oportunidades || [];
  return {
    nome: b.nome,
    primeiro_nome: b.primeiro_nome,
    campanha: r.campanha.nome,
    fornecedor: r.campanha.fornecedor || '-',
    data_referencia: fmtDataBR(t.referencia),
    fim: fmtDataBR(t.fim),
    dias_restantes: t.restantes,
    tipo_dia: t.calendario === 'corridos' ? 'corridos' : 'úteis',
    status: b.status_rotulo,
    posicao: b.posicao,
    total_participantes: b.total_participantes,
    movimento: b.movimento > 0 ? `▲ ${b.movimento} ${b.movimento === 1 ? 'posição' : 'posições'} na semana` : b.movimento < 0 ? `▼ ${-b.movimento} ${b.movimento === -1 ? 'posição' : 'posições'} na semana` : '',
    atingimento: fmtPct(b.score),
    projecao: fmtPct(b.score_proj),
    realizado: principal ? `${fmt(principal.realizado, principal.formato)}${principal.formato === 'numero' ? u : ''}` : '-',
    meta: principal?.meta != null ? `${fmt(principal.meta, principal.formato)}${principal.formato === 'numero' ? u : ''}` : '-',
    falta: principal?.falta != null ? `${fmt(principal.falta, principal.formato)}${principal.formato === 'numero' ? u : ''}` : '-',
    ritmo_necessario: principal?.ritmo_necessario ? `${fmt(principal.ritmo_necessario, principal.formato === 'numero' ? 'decimal' : principal.formato).replace(/,00$/, '')}${principal.formato === 'numero' ? u : ''}/dia` : '-',
    premio: fmtMoeda(b.premio || 0),
    premio_projetado: fmtMoeda(b.premio_proj || 0),
    proxima_faixa: acao ? `🎯 ${acao.texto}` : '',
    criterios: linhas(b.criterios.map((c) => `${c.nome}: ${c.texto}`)),
    destaques: linhas(b.destaques.filter((d) => d !== acao).slice(0, 4).map((d) => d.texto)),
    destaque_principal: b.destaques[0]?.texto || '',
    oportunidades: ops.length ? `🎯 Clientes para atacar:\n${linhas(ops.slice(0, 4).map((o) => `${o.cliente}${o.cidade ? ` (${o.cidade})` : ''}: ${o.motivo}`))}` : '',
    lider: lider ? `${String(lider.nome).split(' ')[0]} (${fmtPct(lider.score)})` : '-',
    media: fmtPct(media),
    link_boletim: idCampanha ? `${baseUrl}/#/boletim/${idCampanha}/${encodeURIComponent(b.chave)}` : '',
    link_campanha: idCampanha ? `${baseUrl}/#/campanhas/${idCampanha}` : '',
  };
}

/**
 * Gera as mensagens prontas de uma campanha.
 * @returns {{chave, destinatario, contato: {telefone, email}, assunto, texto, html, whatsapp_url}[]}
 */
export function gerarMensagens(camp, r, { destino = 'participantes', filtro = 'todos', chaves, corpo, assunto, baseUrl, movimentos, lista } = {}) {
  const cor = r.campanha.cor || '#2a78d6';
  const t = r.tempo;
  const comum = {
    campanha: r.campanha.nome,
    fornecedor: r.campanha.fornecedor || '-',
    data_referencia: fmtDataBR(t.referencia),
    fim: fmtDataBR(t.fim),
    dias_restantes: t.restantes,
    tipo_dia: t.calendario === 'corridos' ? 'corridos' : 'úteis',
    total_participantes: r.participantes.length,
    link_campanha: `${baseUrl}/#/campanhas/${camp.id}`,
  };
  const montar = (chave, destinatario, contato, dados) => {
    const texto = renderizar(corpo, dados);
    const assuntoR = renderizar(assunto || '{campanha}', dados).split('\n')[0];
    return { chave, destinatario, foto: dados.foto || null, contato, assunto: assuntoR, texto, html: textoParaHtml(texto, { cor, titulo: assuntoR }), whatsapp_url: whatsappUrl(contato?.telefone, texto) };
  };

  if (destino === 'gerentes') {
    const set = chaves?.length ? new Set(chaves.map(String)) : null;
    return resumoEquipes(r)
      .filter((g) => !set || set.has(g.responsavel.chave))
      .map((g) => {
        const membros = [...g.membros].sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
        const filtrados = membros.filter((m) => filtro === 'todos' || (filtro === 'risco' ? ['risco', 'atencao'].includes(m.status) : filtro === 'atingiu' ? m.status === 'atingiu' : !['atingiu', 'sem_meta'].includes(m.status)));
        const st = { atingiu: '✔', no_ritmo: '↗', atencao: '⚠', risco: '✖', nao_atingiu: '✖', sem_meta: '·', aguardando: '·' };
        const dados = {
          ...comum,
          nome: g.responsavel.nome,
          foto: g.responsavel.foto || null,
          primeiro_nome: String(g.responsavel.nome).split(' ')[0],
          equipe_media: fmtPct(g.media_score),
          equipe_projecao: fmtPct(g.media_score_proj),
          equipe_atingiram: g.atingiram,
          equipe_no_ritmo: g.no_ritmo,
          equipe_risco: g.risco + g.atencao,
          equipe_premio_projetado: fmtMoeda(g.premio_proj),
          equipe_lista: linhas(
            filtrados.slice(0, 15).map((m) => {
              const pf = m.proxima_faixa?.falta_unidades != null && m.status !== 'atingiu' ? ` · faltam ${fmt(m.proxima_faixa.falta_unidades)} p/ ${fmtPct(m.proxima_faixa.min)}` : '';
              return `${st[m.status] || '·'} ${m.nome.split(' ').slice(0, 2).join(' ')}: ${fmtPct(m.score)} (proj. ${fmtPct(m.score_proj)})${pf}`;
            }),
            '',
          ),
        };
        return montar(g.responsavel.chave, g.responsavel.nome, { telefone: g.responsavel.telefone, email: g.responsavel.email }, dados);
      });
  }

  if (destino === 'geral') {
    const res = r.resumo;
    const dados = {
      ...comum,
      nome: 'Diretoria',
      primeiro_nome: '',
      resumo: frasesCampanha(r).join('\n'),
      top5: r.participantes.slice(0, 5).map((p, i) => `${i + 1}. ${p.nome}: ${fmtPct(p.score ?? p.criterios[0]?.realizado)}${p.premio_proj ? ` · ${fmtMoeda(p.premio_proj)}` : ''}`).join('\n'),
      participantes: res.participantes,
      atingiram: res.atingiram,
      em_risco: res.risco + res.atencao,
      premio_total: fmtMoeda(res.premio_total),
      premio_projetado: fmtMoeda(res.premio_proj_total),
      orcamento: res.orcamento ? ` (orçamento ${fmtMoeda(res.orcamento)}, ${fmtPct((res.uso_orcamento_proj || 0) * 100)} projetado)` : '',
    };
    const destinos = String(lista ?? lerConfig().destinatarios_gerais ?? '')
      .split(/[,;\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const alvos = destinos.length ? destinos : ['Diretoria'];
    return alvos.map((d) => montar(d, d, d.includes('@') ? { email: d, telefone: null } : { telefone: /\d{8,}/.test(d.replace(/\D/g, '')) ? d : null, email: null }, dados));
  }

  // participantes
  return boletins(r, { filtro, chaves, idCampanha: camp.id, movimentos }).map((b) => {
    const contato = b.contato?.telefone || b.contato?.email ? b.contato : { telefone: b.responsavel?.telefone || null, email: b.responsavel?.email || null };
    return montar(b.chave, b.nome, contato, { ...dadosParticipante(b, r, camp.id, baseUrl), foto: b.foto });
  });
}

export function listarModelos() {
  return db.prepare('SELECT id, nome, destino, assunto, corpo, criado_em FROM modelo_mensagem ORDER BY id').all();
}

export function obterModelo(id) {
  return db.prepare('SELECT id, nome, destino, assunto, corpo FROM modelo_mensagem WHERE id = ?').get(Number(id));
}
