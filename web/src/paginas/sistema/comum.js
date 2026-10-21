import {
  AlertCircle, AlertOctagon, AlertTriangle, Archive, Building2, CheckCircle2, Clock, FlaskConical, Info, Mail,
  MessageCircle, UserCog, Users, Webhook, XCircle,
} from 'lucide-react';

// Constantes compartilhadas pelas telas de Painel, Acompanhamentos, Dados e Configurações.

export const SEVERIDADE = {
  critica: { rotulo: 'Crítico', cor: 'critico', icone: AlertOctagon, ordem: 0 },
  alta: { rotulo: 'Alto', cor: 'serio', icone: AlertTriangle, ordem: 1 },
  media: { rotulo: 'Médio', cor: 'aviso', icone: AlertCircle, ordem: 2 },
  info: { rotulo: 'Informativo', cor: 'neutro', icone: Info, ordem: 3 },
  positiva: { rotulo: 'Positivo', cor: 'bom', icone: CheckCircle2, ordem: 4 },
};

export const DESTINOS = [
  { valor: 'participantes', rotulo: 'Participantes', icone: Users, dica: 'Uma mensagem individual para cada participante' },
  { valor: 'gerentes', rotulo: 'Gerentes', icone: UserCog, dica: 'Um resumo da equipe para cada gerente' },
  { valor: 'geral', rotulo: 'Geral', icone: Building2, dica: 'Um resumo da campanha para a lista geral' },
];
export const ROTULO_DESTINO = Object.fromEntries(DESTINOS.map((d) => [d.valor, d.rotulo]));

export const FILTROS = [
  { valor: 'todos', rotulo: 'Todos' },
  { valor: 'risco', rotulo: 'Em risco' },
  { valor: 'nao_atingiu', rotulo: 'Ainda não atingiram' },
  { valor: 'atingiu', rotulo: 'Já atingiram' },
  { valor: 'perto_faixa', rotulo: 'Perto da próxima faixa' },
];
export const ROTULO_FILTRO = Object.fromEntries(FILTROS.map((f) => [f.valor, f.rotulo]));

export const CANAIS = [
  { valor: 'whatsapp', rotulo: 'WhatsApp', icone: MessageCircle, descricao: 'Mensagem pronta; você abre e envia com um clique por pessoa.' },
  { valor: 'email', rotulo: 'E-mail', icone: Mail, descricao: 'Envia pelo SMTP configurado. Sem SMTP, fica como simulado.' },
  { valor: 'webhook', rotulo: 'Webhook', icone: Webhook, descricao: 'Entrega para sua integração (WhatsApp Business API, Teams, Slack…).' },
  { valor: 'registro', rotulo: 'Só registrar', icone: Archive, descricao: 'Guarda na caixa de saída sem enviar.' },
];
export const CANAL = Object.fromEntries(CANAIS.map((c) => [c.valor, c]));

export const STATUS_DISPARO = {
  enviado: { rotulo: 'Enviado', cor: 'bom', icone: CheckCircle2 },
  registrado: { rotulo: 'Registrado', cor: 'neutro', icone: Archive },
  simulado: { rotulo: 'Simulado', cor: 'neutro', icone: FlaskConical },
  pendente: { rotulo: 'Pendente', cor: 'aviso', icone: Clock },
  erro: { rotulo: 'Erro', cor: 'critico', icone: XCircle },
};

// 0 = domingo … 6 = sábado (mesma convenção de Date.getDay())
export const DIAS_SEMANA = [
  { valor: 1, curto: 'Seg', longo: 'segunda' },
  { valor: 2, curto: 'Ter', longo: 'terça' },
  { valor: 3, curto: 'Qua', longo: 'quarta' },
  { valor: 4, curto: 'Qui', longo: 'quinta' },
  { valor: 5, curto: 'Sex', longo: 'sexta' },
  { valor: 6, curto: 'Sáb', longo: 'sábado' },
  { valor: 0, curto: 'Dom', longo: 'domingo' },
];

/** Normaliza dias da semana vindos como array ou texto "1,2,3". */
export function diasComoLista(v) {
  if (Array.isArray(v)) return v.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
  if (typeof v === 'string') return v.split(',').map((x) => Number(x.trim())).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
  return [];
}

export function descreverDias(v) {
  const d = new Set(diasComoLista(v));
  if (d.size === 7) return 'Todos os dias';
  if (d.size === 5 && [1, 2, 3, 4, 5].every((x) => d.has(x))) return 'Dias úteis (seg a sex)';
  if (!d.size) return 'Nenhum dia';
  return DIAS_SEMANA.filter((x) => d.has(x.valor)).map((x) => x.curto).join(', ');
}

/** Link wa.me com o texto (telefone no formato brasileiro). */
export function linkWhatsapp(telefone, texto) {
  let dig = String(telefone || '').replace(/\D/g, '');
  if (!dig) return null;
  if (dig.length <= 11) dig = `55${dig}`;
  return `https://wa.me/${dig}?text=${encodeURIComponent(texto || '')}`;
}

/** Ordena campanhas para seletores: ativas em andamento primeiro, depois agendadas/a fechar, encerradas e o resto. */
export function ordenarCampanhas(lista = []) {
  const peso = { ativa: 0, encerrada: 1, rascunho: 2, arquivada: 3 };
  const tempo = { andamento: 0, encerrada: 1, futura: 2 };
  return [...lista].sort((a, b) =>
    (peso[a.status] ?? 9) - (peso[b.status] ?? 9)
    || (tempo[a.resumo?.tempo_status] ?? 3) - (tempo[b.resumo?.tempo_status] ?? 3)
    || String(b.inicio || '').localeCompare(String(a.inicio || '')));
}

export function opcoesCampanhas(lista = [], { incluirTodas } = {}) {
  const ops = ordenarCampanhas(lista).map((c) => ({
    valor: String(c.id),
    rotulo: `${c.nome}${c.fornecedor ? ` · ${c.fornecedor}` : ''}${c.status !== 'ativa' ? ` (${c.status})` : ''}`,
  }));
  return incluirTodas ? [{ valor: '', rotulo: incluirTodas }, ...ops] : ops;
}
