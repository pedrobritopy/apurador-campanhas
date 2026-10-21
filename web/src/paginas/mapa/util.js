import { Layers, RotateCcw, Rocket, Shield } from 'lucide-react';

export const fmtCnpj = (c) => {
  const d = String(c || '').replace(/\D/g, '');
  return d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : c || '';
};

/** '5562991657575' -> '(62) 99165-7575' */
export function fmtTelefone(t) {
  let d = String(t || '').replace(/\D/g, '');
  if (!d) return null;
  if (d.length >= 12 && d.startsWith('55')) d = d.slice(2);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return d;
}

/** Link de WhatsApp só para celular (9 dígitos começando com 9 depois do DDD). */
export function linkWhatsapp(t) {
  let d = String(t || '').replace(/\D/g, '');
  if (d.length >= 12 && d.startsWith('55')) d = d.slice(2);
  return d.length === 11 && d[2] === '9' ? `https://wa.me/55${d}` : null;
}

export const linkMapas = (lat, lng) => (lat != null && lng != null ? `https://www.google.com/maps/search/?api=1&query=${lat},${lng}` : null);

export function mesesDesde(iso) {
  if (!iso) return null;
  const [a, m, d] = iso.split('-').map(Number);
  const hoje = new Date();
  return (hoje.getFullYear() - a) * 12 + (hoje.getMonth() + 1 - m) - (hoje.getDate() < d ? 1 : 0);
}

export function textoIdade(iso) {
  const m = mesesDesde(iso);
  if (m == null) return 'abertura desconhecida';
  if (m < 1) return 'aberta este mês';
  if (m < 12) return `aberta há ${m} ${m === 1 ? 'mês' : 'meses'}`;
  const anos = Math.floor(m / 12);
  return `aberta há ${anos} ${anos === 1 ? 'ano' : 'anos'}`;
}

export const ACOES = {
  expandir: { rotulo: 'Expandir', icone: Rocket, cor: 'acento', descricao: 'Mercado sem nenhum cliente nosso' },
  aprofundar: { rotulo: 'Aprofundar', icone: Layers, cor: 'neutro', descricao: 'Já vendemos, mas com baixa penetração' },
  reativar: { rotulo: 'Reativar', icone: RotateCcw, cor: 'neutro', descricao: 'Clientes parados há 90 dias' },
  defender: { rotulo: 'Defender', icone: Shield, cor: 'neutro', descricao: 'Penetração alta: proteger a base' },
};

/** Cor da prioridade (mesma rampa do mapa). */
export const corPrioridade = (p) => `var(--mapa-p${p >= 80 ? 5 : p >= 70 ? 4 : p >= 58 ? 3 : p >= 45 ? 2 : 1})`;

export const rotuloRede = (rede) => (!rede || rede <= 1 ? 'Independente' : `Rede · ${rede} lojas`);

export const UFS_SIGLAS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'];

export const CNAE_CURTO = { 4771701: 'Drogaria', 4771702: 'Manipulação', 4771703: 'Homeopática' };
