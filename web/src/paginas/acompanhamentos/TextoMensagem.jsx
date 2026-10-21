import {
  ArrowUpDown, CalendarClock, Coins, Crosshair, Flag, Gauge, PackageX, Target, TrendingUp, Trophy,
} from 'lucide-react';

// Renderiza o texto de uma mensagem (formatação estilo WhatsApp: *negrito*, _itálico_, ~riscado~)
// destacando os trechos que são INFORMAÇÃO: valores em R$, percentuais, posições e quantidades.
// Nada de innerHTML: tudo vira elemento React.

const RE_INFO = /(R\$\s?-?\d[\d.]*(?:,\d+)?(?:\s?(?:mil|mi|bi))?)|(-?\d[\d.]*(?:,\d+)?\s?%)|(\b\d{1,4}\s?[ºª](?:\s?lugar)?)|(\b\d[\d.]*(?:,\d+)?\s?(?:un\/dia|\/dia|un\b|unidades|clientes?|pedidos?|SKUs?|kits?|combos?|dias?\s(?:úteis|corridos)|dias?\b|posi[çc](?:ão|ões)))/gi;
const RE_FORMATO = /(\*[^*\n]+\*)|(_[^_\n]+_)|(~[^~\n]+~)/g;
const RE_VAR = /\{[a-z0-9_]+\}/gi;

function realcar(texto, base) {
  const out = [];
  let ultimo = 0;
  RE_INFO.lastIndex = 0;
  let m;
  while ((m = RE_INFO.exec(texto))) {
    if (m.index > ultimo) out.push(texto.slice(ultimo, m.index));
    const tipo = m[1] ? 'moeda' : m[2] ? 'perc' : m[3] ? 'posicao' : 'qtd';
    out.push(<mark key={`${base}-i${m.index}`} className={`msg-info msg-${tipo}`}>{m[0]}</mark>);
    ultimo = m.index + m[0].length;
  }
  if (ultimo < texto.length) out.push(texto.slice(ultimo));
  return out;
}

function realcarVariaveis(texto, base, conhecidas) {
  const out = [];
  let ultimo = 0;
  RE_VAR.lastIndex = 0;
  let m;
  while ((m = RE_VAR.exec(texto))) {
    if (m.index > ultimo) out.push(texto.slice(ultimo, m.index));
    const ok = !conhecidas || conhecidas.has(m[0].toLowerCase());
    out.push(<mark key={`${base}-v${m.index}`} className={`msg-var${ok ? '' : ' desconhecida'}`} title={ok ? undefined : 'Variável desconhecida'}>{m[0]}</mark>);
    ultimo = m.index + m[0].length;
  }
  if (ultimo < texto.length) out.push(texto.slice(ultimo));
  return out;
}

function linhaFormatada(linha, i, modo, conhecidas) {
  const destacar = (t, b) => (modo === 'modelo' ? realcarVariaveis(t, b, conhecidas) : modo === 'informacao' ? realcar(t, b) : [t]);
  const partes = [];
  let ultimo = 0;
  RE_FORMATO.lastIndex = 0;
  let m;
  while ((m = RE_FORMATO.exec(linha))) {
    if (m.index > ultimo) partes.push(...destacar(linha.slice(ultimo, m.index), `${i}-${ultimo}`));
    const filhos = destacar(m[0].slice(1, -1), `${i}-${m.index}f`);
    const k = `${i}-${m.index}e`;
    partes.push(m[1] ? <strong key={k}>{filhos}</strong> : m[2] ? <em key={k}>{filhos}</em> : <s key={k}>{filhos}</s>);
    ultimo = m.index + m[0].length;
  }
  if (ultimo < linha.length) partes.push(...destacar(linha.slice(ultimo), `${i}-${ultimo}z`));
  return partes;
}

/**
 * @param {{ texto: string, modo?: 'informacao'|'modelo'|'simples', variaveisConhecidas?: Set<string> }} p
 *  - informacao: destaca números/valores (prévia de mensagem renderizada)
 *  - modelo: destaca {variaveis} (editor de modelos)
 */
export default function TextoMensagem({ texto, modo = 'informacao', variaveisConhecidas }) {
  const linhas = String(texto ?? '').split('\n');
  return (
    <div className="msg-texto">
      {linhas.map((l, i) => (
        <div key={i} className="msg-linha">{l ? linhaFormatada(l, i, modo, variaveisConhecidas) : ' '}</div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ que informação a mensagem carrega
const INFOS = [
  { id: 'posicao', rotulo: 'Posição no ranking', icone: Trophy, re: /posi[cç][aã]o|\b\d{1,4}\s?[ºª]|lugar no ranking|ranking/i },
  { id: 'movimento', rotulo: 'Subiu/caiu no ranking', icone: ArrowUpDown, re: /subiu|caiu|ganhou \d+ posi|perdeu \d+ posi|posi[cç][oõ]es/i },
  { id: 'atingimento', rotulo: 'Atingimento', icone: Target, re: /\d\s?%/ },
  { id: 'projecao', rotulo: 'Projeção até o fim', icone: TrendingUp, re: /proje[cç]|projetad|nesse ritmo|neste ritmo|no ritmo atual|vai fechar|deve fechar/i },
  { id: 'ritmo', rotulo: 'Ritmo necessário', icone: Gauge, re: /ritmo necess|por dia|\/dia|ao dia|por dia útil/i },
  { id: 'faixa', rotulo: 'Próxima faixa', icone: Flag, re: /pr[oó]xima faixa|para a faixa|faixa/i },
  { id: 'premio', rotulo: 'Prêmio', icone: Coins, re: /pr[eê]mio|R\$/i },
  { id: 'clientes', rotulo: 'Clientes a atacar', icone: Crosshair, re: /atacar|oportunidade|ainda n[aã]o (compr|levar)|clientes? para (visitar|ligar)|recompra|n[aã]o compraram/i },
  { id: 'estoque', rotulo: 'Alerta de estoque', icone: PackageX, re: /estoque|ruptura/i },
  { id: 'prazo', rotulo: 'Prazo restante', icone: CalendarClock, re: /(faltam?|restam?) \d+ dias?|at[eé] \d{1,2}\/\d{1,2}|termina|encerra/i },
];

export function detectarInformacoes(texto = '') {
  return INFOS.filter((i) => i.re.test(texto));
}

export function InfosMensagem({ texto }) {
  const infos = detectarInformacoes(texto);
  if (!infos.length) return <span className="mini mudo">Mensagem sem indicadores de desempenho detectados.</span>;
  return (
    <div className="infos-msg" aria-label="Informações presentes na mensagem">
      {infos.map((i) => (
        <span key={i.id} className="info-tag"><i.icone size={12} />{i.rotulo}</span>
      ))}
    </div>
  );
}

/** Primeira linha "útil" do texto, sem marcadores, para listas compactas. */
export function resumoTexto(texto = '') {
  const linhas = String(texto).split('\n').map((l) => l.replace(/[*_~]/g, '').trim()).filter(Boolean);
  return linhas.find((l) => /\d\s?%|R\$|posi/i.test(l)) || linhas[1] || linhas[0] || '';
}
