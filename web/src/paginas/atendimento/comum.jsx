import { HelpCircle } from 'lucide-react';
import { iniciais } from '../../lib/formato.js';
import { Selo } from '../../componentes/ui.jsx';
import { CANAIS_ATD, VINCULO } from './util.js';

const CORES_AVATAR = ['var(--s1)', 'var(--s3)', 'var(--s7)', 'var(--s5)', 'var(--s2)', 'var(--s6)', 'var(--s4)'];
const corDe = (texto) => {
  let h = 0;
  for (const ch of String(texto || '?')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return CORES_AVATAR[h % CORES_AVATAR.length];
};

/** Avatar com iniciais e o ícone do canal no canto. */
export function AvatarContato({ nome, canal, tamanho = 'm', semCanal, foto }) {
  const c = CANAIS_ATD[canal];
  return (
    <span className={`atd-av ${tamanho === 'm' ? '' : tamanho}`} style={{ background: corDe(nome) }} aria-hidden>
      {foto ? <img src={foto} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' }} onError={(e) => { e.currentTarget.style.display = 'none'; }} /> : iniciais(nome) || '?'}
      {!semCanal && c && (
        <span className="canal" style={{ background: c.cor }} title={c.rotulo}>
          <c.icone size={tamanho === 'g' ? 12 : 10} strokeWidth={2.4} />
        </span>
      )}
    </span>
  );
}

export function SeloVinculo({ tipo, compacto }) {
  const v = VINCULO[tipo];
  if (!v) return <Selo cor="neutro" icone={HelpCircle}>{compacto ? 'Não identificado' : 'Não identificado'}</Selo>;
  return <Selo cor={v.cor}>{v.rotulo}</Selo>;
}

export function RotuloCanal({ canal }) {
  const c = CANAIS_ATD[canal] || { rotulo: canal, icone: HelpCircle, cor: 'var(--tinta-3)' };
  return (
    <span className="linha g4" style={{ display: 'inline-flex', fontSize: 12, color: 'var(--tinta-2)' }}>
      <c.icone size={13} style={{ color: c.cor }} />
      {c.rotulo}
    </span>
  );
}
