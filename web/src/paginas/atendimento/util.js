import { FlaskConical, Mail, Send } from 'lucide-react';

export const CANAIS_ATD = {
  telegram: { rotulo: 'Telegram', icone: Send, cor: 'var(--s1)' },
  email: { rotulo: 'E-mail', icone: Mail, cor: 'var(--s2)' },
  simulado: { rotulo: 'Simulado', icone: FlaskConical, cor: 'var(--s7)' },
};

export const COLUNAS = [
  { id: 'novo', rotulo: 'Novos', cor: 'var(--s1)', descricao: 'Chegaram e ninguém pegou ainda' },
  { id: 'em_atendimento', rotulo: 'Em atendimento', cor: 'var(--s3)', descricao: 'Alguém está cuidando' },
  { id: 'aguardando', rotulo: 'Aguardando', cor: 'var(--s4)', descricao: 'Esperando retorno do contato' },
  { id: 'resolvido', rotulo: 'Resolvidos', cor: 'var(--tinta-3)', descricao: 'Concluídos' },
];
export const STATUS_ROTULO = Object.fromEntries(COLUNAS.map((c) => [c.id, c.rotulo]));

export const VINCULO = {
  vendedor: { rotulo: 'Vendedor', cor: 'acento' },
  gerente: { rotulo: 'Gerente', cor: 'acento' },
  cliente: { rotulo: 'Cliente', cor: 'bom' },
};

export const PRIORIDADES = [
  { valor: 'baixa', rotulo: 'Baixa' },
  { valor: 'normal', rotulo: 'Normal' },
  { valor: 'alta', rotulo: 'Alta' },
  { valor: 'urgente', rotulo: 'Urgente' },
];

const pad = (n) => String(n).padStart(2, '0');
const mesmoDia = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** Horário curto estilo app de mensagens: 14:32 · ontem · seg · 12/10 */
export function horaCurta(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const hoje = new Date();
  if (mesmoDia(d, hoje)) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const ontem = new Date(hoje);
  ontem.setDate(hoje.getDate() - 1);
  if (mesmoDia(d, ontem)) return 'ontem';
  if (hoje - d < 6 * 86400000) return ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][d.getDay()];
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
}

export const horaMinuto = (iso) => {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export function rotuloDia(iso) {
  const d = new Date(iso);
  const hoje = new Date();
  if (mesmoDia(d, hoje)) return 'Hoje';
  const ontem = new Date(hoje);
  ontem.setDate(hoje.getDate() - 1);
  if (mesmoDia(d, ontem)) return 'Ontem';
  return d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
}

export const chaveDia = (iso) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

/** Tempo esperando resposta humana (última mensagem foi do contato). */
export function espera(conversa) {
  if (!conversa || conversa.status === 'resolvido' || conversa.ultima_direcao === 'saida' || !conversa.ultima_entrada_em) return null;
  const min = (Date.now() - new Date(conversa.ultima_entrada_em).getTime()) / 60000;
  if (min < 0) return null;
  const texto = min < 60 ? `${Math.max(1, Math.round(min))} min` : min < 1440 ? `${Math.round(min / 60)} h` : `${Math.round(min / 1440)} d`;
  return { minutos: min, texto, nivel: min >= 1440 ? 'critico' : min >= 120 ? 'aviso' : 'ok' };
}

export const nomeContato = (c) => c?.vinculo?.nome || c?.contato?.nome || c?.contato?.username || c?.contato?.identificador || 'Contato';
