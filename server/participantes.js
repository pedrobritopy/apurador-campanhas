import { db } from './db.js';

// chaveSql: expressão que identifica o participante numa linha de venda
// (aliases: v = fato_vendas, c = dm_cliente, vd = dm_vendedor)
export const NIVEIS = {
  vendedor: { rotulo: 'Vendedores', singular: 'Vendedor', chaveSql: 'v.id_vendedor' },
  equipe: { rotulo: 'Equipes', singular: 'Equipe', chaveSql: 'COALESCE(vd.id_superior, v.id_vendedor)' },
  cliente: { rotulo: 'Clientes', singular: 'Cliente', chaveSql: 'v.id_cliente' },
  canal: { rotulo: 'Canais de venda', singular: 'Canal', chaveSql: 'v.id_canal' },
  estado: { rotulo: 'Estados (UF)', singular: 'UF', chaveSql: 'c.estado' },
  segmento: { rotulo: 'Segmentos de cliente', singular: 'Segmento', chaveSql: 'c.segmento' },
  empresa: { rotulo: 'Empresa (total)', singular: 'Empresa', chaveSql: "'empresa'" },
};

const contato = (telefone, email) => ({ telefone: telefone || null, email: email || null });

function vendedores() {
  return db
    .prepare(
      `SELECT v.id_vendedor, v.nome_vendedor, v.telefone, v.email, v.id_superior,
              g.nome_vendedor AS gerente, g.telefone AS g_tel, g.email AS g_email
         FROM dm_vendedor v
         LEFT JOIN dm_vendedor g ON g.id_vendedor = v.id_superior
        WHERE lower(COALESCE(v.nivel, '')) <> 'gerente'
           OR v.id_vendedor IN (SELECT DISTINCT id_vendedor FROM fato_vendas)
        ORDER BY v.nome_vendedor`,
    )
    .all();
}

function gerentes() {
  return db
    .prepare(
      `SELECT g.id_vendedor, g.nome_vendedor, g.telefone, g.email,
              (SELECT COUNT(*) FROM dm_vendedor x WHERE x.id_superior = g.id_vendedor) AS membros
         FROM dm_vendedor g
        WHERE lower(COALESCE(g.nivel, '')) = 'gerente'
           OR g.id_vendedor IN (SELECT DISTINCT id_superior FROM dm_vendedor WHERE id_superior IS NOT NULL)
        ORDER BY g.nome_vendedor`,
    )
    .all();
}

/**
 * Universo de participantes de uma campanha (inclusive quem ainda não vendeu nada).
 * @returns {{chave: string, nome: string, grupo: string|null, id_grupo: string|null, contato: object, responsavel: object|null}[]}
 */
export function listarParticipantes(participantes = {}, filtros = {}) {
  const nivel = NIVEIS[participantes.nivel] ? participantes.nivel : 'vendedor';
  const ids = new Set((participantes.ids || []).map(String));
  const equipes = new Set((participantes.equipes || []).map(String));
  let lista = [];

  switch (nivel) {
    case 'vendedor':
      lista = vendedores()
        .filter((v) => !equipes.size || equipes.has(String(v.id_superior)))
        .map((v) => ({
          chave: String(v.id_vendedor),
          nome: v.nome_vendedor,
          grupo: v.gerente ? `Equipe ${v.gerente}` : null,
          id_grupo: v.id_superior != null ? String(v.id_superior) : null,
          contato: contato(v.telefone, v.email),
          responsavel: v.gerente ? { chave: String(v.id_superior), nome: v.gerente, ...contato(v.g_tel, v.g_email) } : null,
        }));
      break;
    case 'equipe':
      lista = gerentes().map((g) => ({
        chave: String(g.id_vendedor),
        nome: `Equipe ${g.nome_vendedor}`,
        grupo: `${g.membros} vendedores`,
        id_grupo: null,
        contato: contato(g.telefone, g.email),
        responsavel: { chave: String(g.id_vendedor), nome: g.nome_vendedor, ...contato(g.telefone, g.email) },
      }));
      break;
    case 'cliente': {
      const where = [];
      const params = [];
      const em = (col, arr) => {
        if (arr?.length) {
          where.push(`${col} IN (${arr.map(() => '?').join(',')})`);
          params.push(...arr);
        }
      };
      em('c.segmento', filtros.segmentos);
      em('c.porte', filtros.portes);
      em('c.estado', filtros.estados);
      if (filtros.clientes?.length) where.push(`c.id_cliente IN (${filtros.clientes.map(Number).join(',')})`);
      lista = db
        .prepare(
          `SELECT c.id_cliente, COALESCE(c.nome_fantasia, c.nome_cliente) AS nome, c.cidade, c.estado, c.id_vendedor,
                  v.nome_vendedor, v.telefone, v.email
             FROM dm_cliente c LEFT JOIN dm_vendedor v ON v.id_vendedor = c.id_vendedor
            ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
            ORDER BY nome`,
        )
        .all(...params)
        .map((c) => ({
          chave: String(c.id_cliente),
          nome: `${c.nome} (#${c.id_cliente})`,
          grupo: [c.cidade, c.estado].filter(Boolean).join('/'),
          id_grupo: c.id_vendedor != null ? String(c.id_vendedor) : null,
          contato: contato(null, null),
          responsavel: c.nome_vendedor ? { chave: String(c.id_vendedor), nome: c.nome_vendedor, ...contato(c.telefone, c.email) } : null,
        }));
      break;
    }
    case 'canal':
      lista = db
        .prepare('SELECT id_canal, nome_canal, tipo FROM dm_canal ORDER BY nome_canal')
        .all()
        .filter((r) => !filtros.canais?.length || filtros.canais.map(Number).includes(r.id_canal))
        .map((r) => ({ chave: String(r.id_canal), nome: r.nome_canal, grupo: r.tipo, id_grupo: null, contato: contato(), responsavel: null }));
      break;
    case 'estado':
      lista = db
        .prepare('SELECT estado, COUNT(*) AS n FROM dm_cliente WHERE estado IS NOT NULL GROUP BY estado ORDER BY estado')
        .all()
        .filter((r) => !filtros.estados?.length || filtros.estados.includes(r.estado))
        .map((r) => ({ chave: r.estado, nome: r.estado, grupo: `${r.n} clientes`, id_grupo: null, contato: contato(), responsavel: null }));
      break;
    case 'segmento':
      lista = db
        .prepare('SELECT segmento, COUNT(*) AS n FROM dm_cliente WHERE segmento IS NOT NULL GROUP BY segmento ORDER BY segmento')
        .all()
        .filter((r) => !filtros.segmentos?.length || filtros.segmentos.includes(r.segmento))
        .map((r) => ({ chave: r.segmento, nome: r.segmento, grupo: `${r.n} clientes`, id_grupo: null, contato: contato(), responsavel: null }));
      break;
    case 'empresa':
      lista = [{ chave: 'empresa', nome: 'Empresa (total)', grupo: null, id_grupo: null, contato: contato(), responsavel: null }];
      break;
  }

  if (ids.size) lista = lista.filter((p) => ids.has(p.chave));
  return lista;
}

/** Vendedores que compõem um participante (para oportunidades e metas gerais). */
export function vendedoresDoParticipante(nivel, chave) {
  if (nivel === 'vendedor') return [Number(chave)];
  if (nivel === 'equipe') {
    return db.prepare('SELECT id_vendedor FROM dm_vendedor WHERE id_superior = ? OR id_vendedor = ?').all(Number(chave), Number(chave)).map((r) => r.id_vendedor);
  }
  return [];
}

export function listarEquipes() {
  return gerentes().map((g) => ({ id: String(g.id_vendedor), nome: `Equipe ${g.nome_vendedor}`, gerente: g.nome_vendedor, membros: g.membros }));
}

export function listarVendedores() {
  return vendedores().map((v) => ({ id: String(v.id_vendedor), nome: v.nome_vendedor, id_equipe: v.id_superior != null ? String(v.id_superior) : null, equipe: v.gerente || null }));
}
