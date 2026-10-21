import { useEffect, useState } from 'react';
import { get } from '../lib/api.js';
import { cx } from './ui.jsx';

/* =====================================================================
   Imagens de produto e logos de fabricante/marca.
   Os arquivos ficam em /imagens (dados/imagens); o índice diz o que é foto real ("r") ou
   embalagem ilustrada ("i") e quais fabricantes/marcas têm logo. Carregamento preguiçoso.
   ===================================================================== */

let indice = null;
let pedido = null;
const ouvintes = new Set();

function carregarIndice() {
  if (!pedido) {
    pedido = get('/imagens/indice')
      .then((r) => {
        indice = { produtos: r.produtos || {}, fabricantes: new Set(r.fabricantes || []), marcas: new Set(r.marcas || []) };
        ouvintes.forEach((f) => f(indice));
        return indice;
      })
      .catch(() => {
        pedido = null;
        return null;
      });
  }
  return pedido;
}

/** Índice das imagens (compartilhado por todos os componentes). */
export function useIndiceImagens() {
  const [i, setI] = useState(indice);
  useEffect(() => {
    if (indice) return undefined;
    ouvintes.add(setI);
    carregarIndice();
    return () => ouvintes.delete(setI);
  }, []);
  return i;
}

export const slugImagem = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/&/g, ' e ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const iniciaisDe = (s) => String(s || '?').replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || '?';

/**
 * Foto do produto num quadro branco. Tamanho em px; até 96 usa a miniatura.
 * Mostra "ilustração" na dica quando não é foto real.
 */
export function FotoProduto({ id, nome, tamanho = 40, className, style, titulo = true }) {
  const idx = useIndiceImagens();
  const [falhou, setFalhou] = useState(false);
  const tipo = idx?.produtos?.[id];
  const ilustr = tipo === 'i';
  const src = `/imagens/produtos/${tamanho <= 96 ? 'mini/' : ''}produto_${id}.webp?v=${tipo || 'x'}`;
  const dica = titulo ? `${nome || `Produto ${id}`}${ilustr ? ' (ilustração, sem foto real disponível)' : ''}` : undefined;
  return (
    <span className={cx('foto-produto', className)} style={{ width: tamanho, height: tamanho, ...style }} title={dica}>
      {id != null && !falhou ? (
        <img src={src} alt={nome || ''} loading="lazy" decoding="async" width={tamanho} height={tamanho} onError={() => setFalhou(true)} />
      ) : (
        <span className="foto-produto-vazia" style={{ fontSize: Math.max(9, tamanho * 0.3) }}>{iniciaisDe(nome)}</span>
      )}
    </span>
  );
}

function corDe(s) {
  let h = 0;
  for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `var(--s${(h % 8) + 1})`;
}

function Logo({ tipo, nome, tamanho, className, style }) {
  const idx = useIndiceImagens();
  const [falhou, setFalhou] = useState(false);
  const s = slugImagem(nome);
  const tem = idx?.[tipo === 'fabricante' ? 'fabricantes' : 'marcas']?.has(s);
  return (
    <span className={cx('logo-empresa', className)} style={{ width: tamanho, height: tamanho, ...style }} title={nome}>
      {tem && !falhou ? (
        <img src={`/imagens/${tipo === 'fabricante' ? 'fabricantes' : 'marcas'}/${tipo}_${s}.webp`} alt={nome} loading="lazy" decoding="async" onError={() => setFalhou(true)} />
      ) : (
        <span className="logo-monograma" style={{ background: corDe(s), fontSize: Math.max(9, tamanho * 0.36) }}>{iniciaisDe(nome)}</span>
      )}
    </span>
  );
}

/** Logo do fabricante (real quando há fonte aberta; senão monograma). */
export const LogoFabricante = ({ nome, tamanho = 28, className, style }) => <Logo tipo="fabricante" nome={nome} tamanho={tamanho} className={className} style={style} />;
/** Logo da marca (Sensodyne, Dorflex...). */
export const LogoMarca = ({ nome, tamanho = 28, className, style }) => <Logo tipo="marca" nome={nome} tamanho={tamanho} className={className} style={style} />;
