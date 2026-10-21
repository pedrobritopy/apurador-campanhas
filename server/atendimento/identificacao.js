// Identificação de quem escreve: casa telefone (Telegram) e e-mail com vendedores e clientes do DW.
import { db } from '../db.js';

export const digitos = (s) => String(s ?? '').replace(/\D/g, '');

/** Telefone sem DDI 55 e sem o 9 extra opcional, para comparar números escritos de jeitos diferentes. */
export function chaveTelefone(tel) {
  let d = digitos(tel);
  if (d.length > 11 && d.startsWith('55')) d = d.slice(2);
  if (d.length === 11 && d[2] === '9') return `${d.slice(0, 2)}${d.slice(3)}`; // DDD + 8 dígitos
  return d.slice(-10);
}

let cacheVendedores = null;
let carregadoEm = 0;
function vendedores() {
  if (!cacheVendedores || Date.now() - carregadoEm > 60000) {
    cacheVendedores = db.prepare('SELECT id_vendedor AS id, nome_vendedor AS nome, telefone, email, nivel FROM dm_vendedor').all().map((v) => ({ ...v, chave: chaveTelefone(v.telefone) }));
    carregadoEm = Date.now();
  }
  return cacheVendedores;
}

export function vendedorPorTelefone(tel) {
  const k = chaveTelefone(tel);
  if (k.length < 8) return null;
  return vendedores().find((v) => v.chave && (v.chave === k || v.chave.slice(-8) === k.slice(-8) && v.chave.slice(0, 2) === k.slice(0, 2))) || null;
}

export function vendedorPorEmail(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!e.includes('@')) return null;
  return vendedores().find((v) => String(v.email || '').toLowerCase() === e) || null;
}

/** Tenta identificar e vincular um contato ainda sem vínculo. Retorna { id_vendedor } ou null. */
export function identificarAutomatico({ telefone, email }) {
  const v = (telefone && vendedorPorTelefone(telefone)) || (email && vendedorPorEmail(email));
  return v ? { id_vendedor: v.id, nome: v.nome } : null;
}
