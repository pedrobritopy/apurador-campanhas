// =====================================================================
// Base comercial realista: clientes, força de vendas, praças e carteiras.
// Gera dados/base/dm_cliente.csv, dados/base/dm_vendedor.csv e dados/pracas.json, que o gerador
// (scripts/gerar-dados.js) usa no lugar das dimensões sintéticas originais.
//
// Clientes: farmácias REAIS e ativas da Receita Federal (CNPJ, razão social, fantasia, endereço, CNAE, porte,
//   abertura), só pessoas jurídicas (LTDA e S.A.), sem empresário individual nem MEI, sem razão social que seja
//   nome de pessoa e sem as grandes redes nacionais (compram direto da indústria). Concentração na região de
//   atuação da distribuidora (GO e vizinhos, Sudeste com o ES de demonstração) e presença menor no resto.
//   Os ids 1..1000 do cadastro antigo viram farmácias reais da mesma cidade (e do mesmo bairro quando dá).
// Força de vendas: pessoas FICTÍCIAS (nomes plausíveis, fotos sintéticas). Hierarquia regional:
//   coordenador regional → gerente de equipe (praça) → vendedor. Cada vendedor mora na praça que atende.
// Praças: em cada UF, cidades e bairros (malha IBGE/OSM quando há) são ordenados por uma curva de Hilbert
//   e cortados em zonas com o mesmo número de clientes; cada zona é a carteira de um vendedor.
// Exceções realistas: ~1% dos clientes de divisa atendidos por vendedor da UF vizinha (o gerador ainda
//   sorteia ~7% dos pedidos tirados por um colega da equipe).
//
// Uso: node scripts/preparar-base.js [--semente=2026]   (precisa da Receita importada e do Postgres no .env)
// =====================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';
import pg from 'pg';
import { db } from '../server/db.js';
import { bairrosEmCache, bairrosMunicipio, caixaAneis, decodificarAnel, dentroAneis } from '../server/malhas.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORIG = path.join(RAIZ, 'dados', 'originais');
const BASE = path.join(RAIZ, 'dados', 'base');
const FOTOS = path.join(RAIZ, 'dados', 'imagens', 'vendedores');
try {
  process.loadEnvFile(path.join(RAIZ, '.env'));
} catch {
  /* sem .env */
}
const arg = (n, p) => process.argv.find((x) => x.startsWith(`--${n}=`))?.split('=')[1] ?? p;
const SEMENTE = Number(arg('semente', '2026'));
const PASTA_CANDIDATAS = arg('fotos', null); // pasta com candidatas SFHQ classificadas (opcional)
const BAIXAR_BAIRROS = process.argv.includes('--baixar-bairros'); // tenta baixar malhas que faltam (IBGE/OSM)

// ------------------------------------------------------------------ aleatoriedade reproduzível
let estado = SEMENTE >>> 0;
const rand = () => {
  estado = (estado + 0x6d2b79f5) >>> 0;
  let t = estado;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const inteiro = (a, b) => a + Math.floor(rand() * (b - a + 1));
const escolher = (l) => l[Math.floor(rand() * l.length)];

// ------------------------------------------------------------------ utilitários
const lerCsv = (prefixo) => {
  const arq = fs.readdirSync(ORIG).find((f) => f.toLowerCase().startsWith(prefixo));
  const texto = fs.readFileSync(path.join(ORIG, arq), 'utf8').replace(/^﻿/, '');
  return { linhas: parse(texto, { delimiter: ';', columns: true, skip_empty_lines: true }), cabecalho: texto.split(/\r?\n/)[0] };
};
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const MINUSC = new Set(['da', 'de', 'do', 'das', 'dos', 'e', 'em', 'na', 'no']);
const titulo = (s) =>
  String(s ?? '')
    .toLowerCase()
    .split(/(\s+)/)
    .map((p, i) => (i > 0 && MINUSC.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join('')
    .replace(/\b(Ltda|Me|Epp|S\/a|S\.a\.?)\b/gi, (m) => m.toUpperCase().replace('LTDA', 'LTDA'))
    .trim();
const fmtCep = (c) => {
  const d = String(c ?? '').replace(/\D/g, '').padStart(8, '0');
  return `${d.slice(0, 5)}-${d.slice(5)}`;
};
const fmtCnpj = (c) => {
  const d = String(c).replace(/\D/g, '').padStart(14, '0');
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
};
const km = (a, b) => {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};
/** Índice na curva de Hilbert (grade 1024×1024): pontos próximos ficam próximos na ordem. */
function hilbert(x, y, n = 1024) {
  let d = 0;
  for (let s = n / 2; s >= 1; s = Math.floor(s / 2)) {
    const rx = (x & s) > 0 ? 1 : 0;
    const ry = (y & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    if (ry === 0) {
      if (rx === 1) {
        x = s - 1 - x;
        y = s - 1 - y;
      }
      [x, y] = [y, x];
    }
  }
  return d;
}
const ordemHilbert = (itens) => {
  const xs = itens.map((i) => i.lng);
  const ys = itens.map((i) => i.lat);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const esc = Math.max(x1 - x0, y1 - y0) || 1;
  return itens
    .map((i) => ({ i, h: hilbert(Math.min(1023, Math.floor(((i.lng - x0) / esc) * 1023)), Math.min(1023, Math.floor(((i.lat - y0) / esc) * 1023))) }))
    .sort((a, b) => a.h - b.h)
    .map((x) => x.i);
};

// ------------------------------------------------------------------ parâmetros comerciais
const SIGLA_UF = { 11: 'RO', 12: 'AC', 13: 'AM', 14: 'RR', 15: 'PA', 16: 'AP', 17: 'TO', 21: 'MA', 22: 'PI', 23: 'CE', 24: 'RN', 25: 'PB', 26: 'PE', 27: 'AL', 28: 'SE', 29: 'BA', 31: 'MG', 32: 'ES', 33: 'RJ', 35: 'SP', 41: 'PR', 42: 'SC', 43: 'RS', 50: 'MS', 51: 'MT', 52: 'GO', 53: 'DF' };
const NOME_UF = { GO: 'Goiás', DF: 'Distrito Federal', MG: 'Minas Gerais', SP: 'São Paulo', RJ: 'Rio de Janeiro', ES: 'Espírito Santo', BA: 'Bahia', MT: 'Mato Grosso', MS: 'Mato Grosso do Sul', PR: 'Paraná', TO: 'Tocantins', CE: 'Ceará', PE: 'Pernambuco', SC: 'Santa Catarina', RS: 'Rio Grande do Sul' };
// clientes por UF (distribuidora sediada em GO) e polos de atendimento (concentram a base)
const PRACAS = {
  GO: { clientes: 1800, polos: ['Goiânia', 'Anápolis', 'Aparecida de Goiânia', 'Rio Verde', 'Itumbiara', 'Catalão'] },
  MG: { clientes: 1500, polos: ['Belo Horizonte', 'Uberlândia', 'Uberaba', 'Juiz de Fora', 'Contagem', 'Montes Claros'] },
  SP: { clientes: 1300, polos: ['São Paulo', 'Campinas', 'Ribeirão Preto', 'São José do Rio Preto', 'Santos', 'São José dos Campos', 'Guarulhos'] },
  DF: { clientes: 900, polos: ['Brasília'] },
  RJ: { clientes: 800, polos: ['Rio de Janeiro', 'Niterói', 'Petrópolis', 'Volta Redonda', 'Campos dos Goytacazes'] },
  ES: { clientes: 700, polos: ['Vitória', 'Vila Velha', 'Serra', 'Cariacica', 'Linhares', 'Cachoeiro de Itapemirim', 'Colatina', 'Guarapari', 'São Mateus'] },
  BA: { clientes: 600, polos: ['Salvador', 'Feira de Santana', 'Vitória da Conquista', 'Barreiras'] },
  MT: { clientes: 400, polos: ['Cuiabá', 'Várzea Grande', 'Rondonópolis', 'Sinop'] },
  MS: { clientes: 350, polos: ['Campo Grande', 'Dourados', 'Três Lagoas'] },
  PR: { clientes: 350, polos: ['Curitiba', 'Londrina', 'Maringá'] },
  TO: { clientes: 300, polos: ['Palmas', 'Araguaína', 'Gurupi'] },
  CE: { clientes: 250, polos: ['Fortaleza', 'Caucaia'] },
  PE: { clientes: 250, polos: ['Recife', 'Olinda', 'Jaboatão dos Guararapes'] },
  SC: { clientes: 200, polos: ['Florianópolis', 'Joinville', 'Blumenau'] },
  RS: { clientes: 200, polos: ['Porto Alegre', 'Canoas', 'Caxias do Sul'] },
};
const CLIENTES_POR_VENDEDOR = 37;
const VENDEDORES_POR_EQUIPE = 9;
const REGIOES = [
  { id: 'centro-oeste', nome: 'Centro-Oeste e Tocantins', ufs: ['GO', 'DF', 'MT', 'MS', 'TO'], base: ['GO', 'Goiânia'] },
  { id: 'sudeste', nome: 'Sudeste', ufs: ['MG', 'SP', 'RJ', 'ES'], base: ['MG', 'Belo Horizonte'] },
  { id: 'nordeste', nome: 'Nordeste', ufs: ['BA', 'CE', 'PE'], base: ['BA', 'Salvador'] },
  { id: 'sul', nome: 'Sul', ufs: ['PR', 'SC', 'RS'], base: ['PR', 'Curitiba'] },
];
const NATUREZAS_OK = new Set(['2062', '2046', '2054']); // LTDA, S.A. aberta, S.A. fechada
// razão social precisa ter cara de empresa (evita "MARIA DA SILVA LTDA")
const RE_EMPRESA = /(FARM|DROG|MEDIC|PHARM|SAUDE|SA[UÚ]DE|MANIPUL|BOTIC|FORMUL|HOMEOP|COMERCI|DISTRIB|REDE |EMPREEND|PARTICIPA|SERVI|PRODUTO|NATURA|VIDA|BEM ESTAR|POPULAR| S\.?A\.?$| S\/A)/i;
const MAX_REDE = 30; // redes nacionais grandes compram direto da indústria

const SEGMENTOS = {
  manipulacao: 'Manipulação',
  rede: 'Rede regional',
  pequena: 'Pequena rede',
  independente: 'Drogaria independente',
};
const segmentoDe = (f) => {
  if (f.cnae === '4771702' || f.cnae === '4771703') return SEGMENTOS.manipulacao;
  if ((f.rede || 1) >= 5) return SEGMENTOS.rede;
  if ((f.rede || 1) >= 2) return SEGMENTOS.pequena;
  return SEGMENTOS.independente;
};
const porteDe = (f) => {
  const cap = Number(f.capital_social) || 0;
  let s = 0;
  if (f.porte === 'Demais') s += 2;
  else if (f.porte === 'EPP') s += 1;
  if ((f.rede || 1) >= 3) s += 1;
  if (cap >= 200000) s += 1;
  if (cap >= 1000000) s += 1;
  return s >= 4 ? 'Grande' : s >= 2 ? 'Médio' : s >= 1 ? 'Pequeno' : 'Micro';
};

// ------------------------------------------------------------------ nomes fictícios
const NOMES_M = 'Adriano Alexandre Anderson Antônio Arthur Augusto Bruno Caio Cauã Cláudio Daniel Davi Diego Diogo Edson Emerson Enzo Fábio Fernando Francisco Guilherme Gustavo Heitor Hugo Ivan Jefferson Jorge Júlio Kaique Leandro Luiz Marcelo Márcio Mateus Maurício Miguel Murilo Otávio Paulo Rafael Raul Roberto Rodrigo Rogério Sérgio Silvio Tiago Vinícius Vítor'.split(' ');
const NOMES_F = 'Adriana Alessandra Alice Amanda Ana Bianca Bruna Carla Carolina Cecília Clara Cláudia Cristina Débora Eduarda Elaine Eliane Fabiana Gabriela Heloísa Isadora Jéssica Joana Juliana Kátia Laura Letícia Lívia Lorena Luana Luciana Manuela Marcela Márcia Marina Melissa Mônica Patrícia Paula Raquel Regina Renata Roberta Sandra Simone Tânia Thaís Vera Vitória'.split(' ');
const SOBRENOMES = 'Almeida Alves Andrade Araújo Azevedo Barros Batista Borges Cabral Campos Cardoso Carvalho Castro Costa Cunha Dias Duarte Farias Fernandes Ferraz Figueiredo Fonseca Freitas Gomes Gonçalves Guimarães Lacerda Leite Lima Lopes Macedo Machado Magalhães Martins Medeiros Mendes Miranda Monteiro Moraes Moreira Moura Nascimento Neves Nogueira Nunes Oliveira Pacheco Pereira Pinheiro Pires Queiroz Ramos Reis Resende Ribeiro Rocha Rodrigues Sales Santana Santos Siqueira Soares Souza Tavares Teixeira Vasconcelos Viana Vieira'.split(' ');

// ------------------------------------------------------------------ principal
async function principal() {
  const t0 = Date.now();
  const vendOrig = lerCsv('dm_vendedor');
  const cliOrig = lerCsv('dm_cliente');
  const mun = parse(fs.readFileSync(path.join(RAIZ, 'dados', 'geo', 'municipios.csv'), 'utf8'), { columns: true }).map((m) => ({
    ibge: m.codigo_ibge, nome: m.nome, lat: Number(m.latitude), lng: Number(m.longitude), uf: SIGLA_UF[m.codigo_uf], ddd: m.ddd, capital: m.capital === '1',
  }));
  const munPorIbge = new Map(mun.map((m) => [m.ibge, m]));
  const munPorNome = new Map(mun.map((m) => [`${norm(m.nome)}|${m.uf}`, m]));
  const cidade = (nome, uf) => munPorNome.get(`${norm(nome)}|${uf}`);

  // ---------------- natureza jurídica e MEI (Postgres da Receita)
  console.log('Lendo natureza jurídica no Postgres...');
  const cli = new pg.Client({ host: process.env.POSTGRES_HOST, port: Number(process.env.POSTGRES_PORT || 5432), database: process.env.POSTGRES_DB, user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD });
  await cli.connect();
  const nat = new Map(
    (
      await cli.query(
        "SELECT cnpj, natureza_juridica, opcao_mei FROM dw.estabelecimentos WHERE cnae_principal IN ('4771701','4771702','4771703') AND situacao_cadastral = 2",
      )
    ).rows.map((r) => [String(r.cnpj).trim(), { nat: r.natureza_juridica, mei: r.opcao_mei }]),
  );
  await cli.end();

  // ---------------- farmácias elegíveis
  const ufsAtuacao = Object.keys(PRACAS);
  const farm = db
    .prepare(
      `SELECT cnpj, razao_social, nome_fantasia, cnae, data_inicio, porte, capital_social, rede, tipo_logradouro, logradouro, numero, complemento,
              bairro, cep, uf, municipio_ibge AS ibge, lat, lng, aproximado
         FROM rf_farmacia WHERE uf IN (${ufsAtuacao.map(() => '?').join(',')}) AND lat IS NOT NULL AND aproximado = 0`,
    )
    .all(...ufsAtuacao)
    .map((f) => ({ ...f }))
    .filter((f) => {
      const n = nat.get(f.cnpj);
      return n && NATUREZAS_OK.has(n.nat) && n.mei !== 'S' && (f.rede || 1) <= MAX_REDE && RE_EMPRESA.test(`${f.razao_social} `) && munPorIbge.has(f.ibge);
    });
  console.log(`  ${farm.length.toLocaleString('pt-BR')} farmácias elegíveis nas ${ufsAtuacao.length} UFs de atuação`);
  const farmPorUf = new Map(ufsAtuacao.map((u) => [u, []]));
  for (const f of farm) farmPorUf.get(f.uf).push(f);

  // ---------------- escolha dos clientes
  const usados = new Set();
  const clientes = []; // { id, f, orig? }
  // ids antigos: farmácia real da mesma cidade (mesmo bairro quando der)
  for (const c of cliOrig.linhas) {
    const m = cidade(c.cidade, c.estado);
    const doUf = farmPorUf.get(c.estado) || [];
    const naCidade = doUf.filter((f) => !usados.has(f.cnpj) && f.ibge === m?.ibge);
    const noBairro = naCidade.filter((f) => norm(f.bairro) === norm(c.bairro));
    const f = noBairro.length ? escolher(noBairro) : naCidade.length ? escolher(naCidade) : null;
    if (!f) throw new Error(`Sem farmácia elegível para o cliente ${c.id_cliente} (${c.cidade}/${c.estado})`);
    usados.add(f.cnpj);
    clientes.push({ id: Number(c.id_cliente), f, orig: c });
  }
  // novos ids: amostragem ponderada pela proximidade dos polos (Efraimidis-Spirakis)
  let proximo = 1001;
  for (const [uf, p] of Object.entries(PRACAS)) {
    const polos = p.polos.map((n) => cidade(n, uf)).filter(Boolean);
    const ja = clientes.filter((c) => c.f.uf === uf).length;
    const falta = Math.max(0, p.clientes - ja);
    const cands = farmPorUf
      .get(uf)
      .filter((f) => !usados.has(f.cnpj))
      .map((f) => {
        const d = Math.min(...polos.map((q) => km(f, q)));
        const w = Math.exp(-d / 110) + 0.025;
        return { f, k: Math.log(rand() || 1e-12) / w };
      })
      .sort((a, b) => b.k - a.k)
      .slice(0, falta);
    for (const { f } of cands.sort((a, b) => a.f.cnpj.localeCompare(b.f.cnpj))) {
      usados.add(f.cnpj);
      clientes.push({ id: proximo++, f });
    }
  }
  console.log(`  ${clientes.length.toLocaleString('pt-BR')} clientes (ids 1 a ${proximo - 1})`);

  // ---------------- bairros (malha) das cidades grandes
  const porCidade = new Map();
  for (const c of clientes) {
    if (!porCidade.has(c.f.ibge)) porCidade.set(c.f.ibge, []);
    porCidade.get(c.f.ibge).push(c);
  }
  const vendedoresUf = Object.fromEntries(Object.entries(PRACAS).map(([uf, p]) => [uf, Math.max(2, Math.round(p.clientes / CLIENTES_POR_VENDEDOR))]));
  const alvoPorVendedor = (uf) => clientes.filter((c) => c.f.uf === uf).length / vendedoresUf[uf];
  const malhaBairros = new Map(); // ibge -> [{ id, nome, aneis, caixa, lat, lng }]
  for (const [ibge, cs] of porCidade) {
    const uf = cs[0].f.uf;
    if (cs.length < alvoPorVendedor(uf) * 1.25 && uf !== 'ES') continue;
    // só a malha já baixada (sem rede): cidades sem malha usam o nome do bairro do cadastro
    let dados = bairrosEmCache(ibge);
    if (!dados && BAIXAR_BAIRROS) {
      try {
        dados = await Promise.race([bairrosMunicipio(ibge), new Promise((_, rej) => setTimeout(() => rej(new Error('tempo esgotado')), 20000))]);
      } catch (e) {
        console.log(`  bairros de ${munPorIbge.get(ibge)?.nome}: ${e.message}`);
      }
    }
    if (!dados?.bairros?.length) continue;
    malhaBairros.set(
      ibge,
      dados.bairros.map((b) => {
        const aneis = b.a.map(decodificarAnel);
        const anel = aneis[0];
        return { id: b.id, nome: b.nome, aneis, caixa: caixaAneis(aneis), lng: anel.reduce((a, p) => a + p[0], 0) / anel.length, lat: anel.reduce((a, p) => a + p[1], 0) / anel.length };
      }),
    );
  }
  const bairroDoPonto = (ibge, lng, lat) => {
    const bs = malhaBairros.get(ibge);
    if (!bs) return null;
    return bs.find((b) => lng >= b.caixa[0] && lng <= b.caixa[2] && lat >= b.caixa[1] && lat <= b.caixa[3] && dentroAneis(lng, lat, b.aneis)) || null;
  };
  for (const c of clientes) {
    const b = bairroDoPonto(c.f.ibge, c.f.lng, c.f.lat);
    c.bairro = b ? b.nome : titulo(c.f.bairro || 'Centro');
    c.bairroId = b?.id || null;
  }

  // ---------------- praças (zonas) por UF: unidades → curva de Hilbert → cortes com o mesmo nº de clientes
  const zonas = [];
  for (const uf of Object.keys(PRACAS)) {
    const cs = clientes.filter((c) => c.f.uf === uf);
    const k = vendedoresUf[uf];
    const alvo = cs.length / k;
    const cidadesUf = [...new Set(cs.map((c) => c.f.ibge))].map((ibge) => {
      const l = cs.filter((c) => c.f.ibge === ibge);
      const m = munPorIbge.get(ibge);
      return { ibge, nome: m.nome, lat: m.lat, lng: m.lng, clientes: l };
    });
    const seq = [];
    for (const cid of ordemHilbert(cidadesUf)) {
      const dividir = cid.clientes.length > alvo * 1.25 || (uf === 'ES' && malhaBairros.has(cid.ibge));
      if (!dividir) {
        seq.push({ tipo: 'cidade', ibge: cid.ibge, nome: cid.nome, lat: cid.lat, lng: cid.lng, clientes: cid.clientes });
        continue;
      }
      // unidades de bairro: polígonos (todos, mesmo sem cliente, para a cidade ficar coberta) ou nomes
      const unidades = new Map();
      if (malhaBairros.has(cid.ibge)) {
        for (const b of malhaBairros.get(cid.ibge)) unidades.set(b.id, { tipo: 'bairro', ibge: cid.ibge, cidade: cid.nome, bairro_id: b.id, nome: b.nome, lat: b.lat, lng: b.lng, clientes: [] });
        for (const c of cid.clientes) {
          const u = c.bairroId ? unidades.get(c.bairroId) : null;
          if (u) u.clientes.push(c);
          else {
            // ponto fora da malha (divisa): vai para o bairro mais próximo
            const perto = [...unidades.values()].reduce((a, b) => (km(c.f, b) < km(c.f, a) ? b : a));
            perto.clientes.push(c);
            c.bairro = perto.nome;
            c.bairroId = perto.bairro_id;
          }
        }
      } else {
        for (const c of cid.clientes) {
          const chave = norm(c.bairro) || 'centro';
          if (!unidades.has(chave)) unidades.set(chave, { tipo: 'bairro', ibge: cid.ibge, cidade: cid.nome, bairro_id: null, nome: c.bairro, lat: 0, lng: 0, clientes: [] });
          unidades.get(chave).clientes.push(c);
        }
        for (const u of unidades.values()) {
          u.lat = u.clientes.reduce((a, c) => a + c.f.lat, 0) / u.clientes.length;
          u.lng = u.clientes.reduce((a, c) => a + c.f.lng, 0) / u.clientes.length;
        }
      }
      seq.push(...ordemHilbert([...unidades.values()]));
    }
    // cortes: cada zona acumula ~alvo clientes; unidade sem cliente acompanha a zona corrente
    let atual = null;
    let acumulado = 0;
    let feitas = 0;
    const total = cs.length;
    for (const u of seq) {
      const limite = ((feitas + 1) * total) / k;
      if (!atual || (acumulado + u.clientes.length / 2 > limite && feitas < k - 1 && atual.unidades.some((x) => x.clientes.length))) {
        if (atual) feitas++;
        atual = { uf, unidades: [] };
        zonas.push(atual);
      }
      atual.unidades.push(u);
      acumulado += u.clientes.length;
    }
  }
  // nome e cidade-base de cada zona
  for (const z of zonas) {
    const contagem = new Map();
    for (const u of z.unidades) for (const c of u.clientes) contagem.set(c.f.ibge, (contagem.get(c.f.ibge) || 0) + 1);
    const baseIbge = [...contagem.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || z.unidades[0].ibge;
    z.base = munPorIbge.get(baseIbge);
    z.clientes = z.unidades.flatMap((u) => u.clientes);
    z.lat = z.clientes.reduce((a, c) => a + c.f.lat, 0) / (z.clientes.length || 1);
    z.lng = z.clientes.reduce((a, c) => a + c.f.lng, 0) / (z.clientes.length || 1);
    const cidades = new Set(z.unidades.map((u) => u.ibge));
    const soBairros = z.unidades.every((u) => u.tipo === 'bairro') && cidades.size === 1;
    z.nome = soBairros ? `${z.base.nome}: ${z.unidades.filter((u) => u.clientes.length).slice(0, 2).map((u) => u.nome).join(', ')}${z.unidades.filter((u) => u.clientes.length).length > 2 ? ' e região' : ''}` : cidades.size > 1 ? `Região de ${z.base.nome}` : z.base.nome;
  }

  // ---------------- equipes (consecutivas na curva) e coordenações
  const equipes = [];
  for (const uf of Object.keys(PRACAS)) {
    const zs = zonas.filter((z) => z.uf === uf);
    const n = Math.max(1, Math.ceil(zs.length / VENDEDORES_POR_EQUIPE));
    for (let i = 0; i < n; i++) {
      const parte = zs.slice(Math.round((i * zs.length) / n), Math.round(((i + 1) * zs.length) / n));
      const cont = new Map();
      for (const z of parte) for (const c of z.clientes) cont.set(c.f.ibge, (cont.get(c.f.ibge) || 0) + 1);
      const base = munPorIbge.get([...cont.entries()].sort((a, b) => b[1] - a[1])[0][0]);
      equipes.push({ uf, zonas: parte, base, regiao: REGIOES.find((r) => r.ufs.includes(uf)).id });
    }
  }
  const nomesUsados = new Map();
  for (const e of equipes) {
    const qtdUf = equipes.filter((x) => x.uf === e.uf).length;
    let nome = qtdUf === 1 ? NOME_UF[e.uf] : `${e.uf} ${e.base.nome}`;
    const n = (nomesUsados.get(nome) || 0) + 1;
    nomesUsados.set(nome, n);
    if (n > 1) nome = `${nome} ${['', '', 'II', 'III', 'IV', 'V'][n] || n}`;
    e.nome = nome;
  }

  // ---------------- pessoas: vendedores, gerentes e coordenadores
  const pessoas = new Map(vendOrig.linhas.map((v) => [Number(v.id_vendedor), { ...v, id: Number(v.id_vendedor) }]));
  const residencia = (p) => cidade(p.cidade, p.estado);
  const morarEm = (p, m) => {
    if (p.estado === m.uf && norm(p.cidade) === norm(m.nome)) return;
    const ref = farm.filter((f) => f.ibge === m.ibge);
    const f = ref.length ? escolher(ref) : null;
    Object.assign(p, {
      estado: m.uf, cidade: m.nome,
      bairro: f ? titulo(f.bairro || 'Centro') : 'Centro',
      rua: f ? titulo(`${f.tipo_logradouro || ''} ${f.logradouro || ''}`.trim()) : p.rua,
      numero: String(inteiro(10, 2999)),
      cep: f ? fmtCep(f.cep) : p.cep,
    });
  };
  // vendedores antigos: primeiro na zona mais próxima de onde moram (mesma UF), depois remanejados
  const vendAntigos = [...pessoas.values()].filter((p) => p.nivel === 'vendedor').sort((a, b) => a.id - b.id);
  const livres = new Set(zonas);
  const semZona = [];
  for (const p of vendAntigos) {
    const casa = residencia(p);
    const opcoes = [...livres].filter((z) => z.uf === p.estado).sort((a, b) => (casa ? km(casa, a.base) - km(casa, b.base) : 0));
    if (opcoes.length) {
      opcoes[0].vendedor = p.id;
      livres.delete(opcoes[0]);
    } else semZona.push(p);
  }
  // remanejados vão para as UFs com mais zonas vagas (de preferência na mesma região)
  for (const p of semZona) {
    const reg = REGIOES.find((r) => r.ufs.includes(p.estado))?.id;
    const vagas = [...livres].sort((a, b) => Number(REGIOES.find((r) => r.ufs.includes(b.uf))?.id === reg) - Number(REGIOES.find((r) => r.ufs.includes(a.uf))?.id === reg));
    if (!vagas.length) break;
    vagas[0].vendedor = p.id;
    livres.delete(vagas[0]);
  }
  let idNovo = Math.max(...pessoas.keys()) + 1;
  const novos = [];
  const criarPessoa = (nivel, m, genero) => {
    let nome;
    do nome = `${escolher(genero === 'F' ? NOMES_F : NOMES_M)} ${escolher(SOBRENOMES)}`;
    while ([...pessoas.values()].some((p) => p.nome_vendedor === nome));
    const email = `${norm(nome).replace(/ /g, '.')}@empresa.com`;
    const f = escolher(farm.filter((x) => x.ibge === m.ibge).concat(farm.filter((x) => x.uf === m.uf)).slice(0, 400));
    const p = {
      id: idNovo, id_vendedor: String(idNovo), id_empresa: '1', nome_vendedor: nome, nivel, id_superior: '',
      data_nascimento: `${inteiro(1968, 2001)}-${String(inteiro(1, 12)).padStart(2, '0')}-${String(inteiro(1, 28)).padStart(2, '0')}`,
      telefone: `(${m.ddd}) 9${inteiro(8000, 9999)}-${String(inteiro(0, 9999)).padStart(4, '0')}`, email,
      estado: m.uf, cidade: m.nome, bairro: titulo(f?.bairro || 'Centro'), rua: titulo(`${f?.tipo_logradouro || ''} ${f?.logradouro || ''}`.trim()) || 'Rua Principal',
      numero: String(inteiro(10, 2999)), cep: fmtCep(f?.cep || '00000000'), imagem: `vendedor_${idNovo}.jpg`, genero,
    };
    pessoas.set(idNovo, p);
    novos.push(p);
    idNovo++;
    return p;
  };
  // gêneros dos novos: ~45% homens (limitado às fotos disponíveis)
  const estoqueM = (() => {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(RAIZ, 'scripts', 'fotos-classificadas.json'), 'utf8'));
      const usadas = new Set(fs.readFileSync(path.join(RAIZ, 'dados', 'imagens', 'origem.csv'), 'utf8').split(/\r?\n/).slice(1).map((l) => l.split(';')[2]));
      return j.M.filter((x) => !usadas.has(x.arquivo)).length;
    } catch {
      return Infinity;
    }
  })();
  let homensNovos = 0;
  const generoNovo = () => {
    const g = rand() < 0.42 && homensNovos < estoqueM ? 'M' : 'F';
    if (g === 'M') homensNovos++;
    return g;
  };
  for (const z of zonas) {
    if (!z.vendedor) z.vendedor = criarPessoa('vendedor', z.base, generoNovo()).id;
    morarEm(pessoas.get(z.vendedor), z.base);
  }
  // gerentes: os 18 antigos ficam com as equipes da própria UF (ou região), os demais são novos
  const gerAntigos = [...pessoas.values()].filter((p) => p.nivel === 'gerente').sort((a, b) => a.id - b.id);
  const eqLivres = new Set(equipes);
  for (const g of gerAntigos) {
    const casa = residencia(g);
    const reg = REGIOES.find((r) => r.ufs.includes(g.estado))?.id;
    const op = [...eqLivres].sort((a, b) => (a.uf === g.estado ? 0 : a.regiao === reg ? 1 : 2) - (b.uf === g.estado ? 0 : b.regiao === reg ? 1 : 2) || (casa ? km(casa, a.base) - km(casa, b.base) : 0));
    if (!op.length) break;
    op[0].gerente = g.id;
    eqLivres.delete(op[0]);
  }
  for (const e of equipes) {
    if (!e.gerente) e.gerente = criarPessoa('gerente', e.base, generoNovo()).id;
    const g = pessoas.get(e.gerente);
    morarEm(g, e.base);
    for (const z of e.zonas) pessoas.get(z.vendedor).id_superior = String(e.gerente);
  }
  const coordenacoes = REGIOES.map((r) => {
    const m = cidade(r.base[1], r.base[0]);
    const c = criarPessoa('coordenador', m, generoNovo());
    for (const e of equipes.filter((x) => x.regiao === r.id)) pessoas.get(e.gerente).id_superior = String(c.id);
    return { ...r, coordenador: c.id };
  });

  // ---------------- dono de cada cliente (+ exceções de divisa)
  const donoDe = new Map();
  for (const z of zonas) for (const c of z.clientes) donoDe.set(c.id, z.vendedor);
  const excecoes = [];
  const baseZonas = zonas.map((z) => ({ z, lat: z.base.lat, lng: z.base.lng }));
  for (const c of clientes) {
    const propria = zonas.find((z) => z.vendedor === donoDe.get(c.id));
    const dP = km(c.f, propria.base);
    const viz = baseZonas.filter((b) => b.z.uf !== c.f.uf).map((b) => ({ ...b, d: km(c.f, b) })).sort((a, b) => a.d - b.d)[0];
    if (viz && viz.d < 90 && viz.d < dP && rand() < 0.35) {
      donoDe.set(c.id, viz.z.vendedor);
      excecoes.push({ id_cliente: c.id, id_vendedor: viz.z.vendedor, uf_cliente: c.f.uf, uf_vendedor: viz.z.uf, km: Math.round(viz.d), motivo: `Divisa ${c.f.uf}/${viz.z.uf}: atendido pela praça de ${viz.z.base.nome}` });
    }
  }

  // ---------------- fotos dos novos (rostos sintéticos SFHQ já classificados por gênero)
  const fotosLivres = { M: [], F: [] };
  const classif = path.join(RAIZ, 'scripts', 'fotos-classificadas.json');
  if (fs.existsSync(classif)) {
    const j = JSON.parse(fs.readFileSync(classif, 'utf8'));
    const usadas = new Set(fs.readFileSync(path.join(RAIZ, 'dados', 'imagens', 'origem.csv'), 'utf8').split(/\r?\n/).slice(1).map((l) => l.split(';')[2]).filter(Boolean));
    for (const g of ['M', 'F']) fotosLivres[g] = j[g].filter((x) => !usadas.has(x.arquivo));
  }

  // ---------------- saída
  fs.mkdirSync(BASE, { recursive: true });
  const csv = (arq, cab, linhas) => fs.writeFileSync(path.join(BASE, arq), `${cab}\n${linhas.map((l) => l.map((v) => String(v ?? '').replace(/;/g, ',')).join(';')).join('\n')}\n`);
  const colsV = vendOrig.cabecalho.split(';');
  const ordemP = [...pessoas.values()].sort((a, b) => a.id - b.id);
  csv('dm_vendedor.csv', vendOrig.cabecalho, ordemP.map((p) => colsV.map((c) => p[c] ?? '')));
  const colsC = cliOrig.cabecalho.split(';');
  const fimCad = new Date(Date.now() - 40 * 86400000).toISOString().slice(0, 10);
  const linhasCli = clientes
    .sort((a, b) => a.id - b.id)
    .map((c) => {
      const f = c.f;
      const abertura = f.data_inicio || '2010-01-01';
      let cadastro = c.orig?.data_cadastro || null;
      if (!cadastro) {
        const ini = Math.max(Date.parse(abertura), Date.parse('2012-01-01'));
        const fim = Date.parse(fimCad);
        cadastro = new Date(ini + (rand() < 0.86 ? rand() ** 0.7 * Math.max(0, Date.parse('2024-12-31') - ini) : Math.max(0, Date.parse('2025-01-01') - ini) + rand() * (fim - Date.parse('2025-01-01')))).toISOString().slice(0, 10);
      }
      if (cadastro < abertura) cadastro = abertura;
      const fantasia = titulo(f.nome_fantasia || f.razao_social);
      const v = {
        id_cliente: c.id, id_empresa: 1, id_vendedor: donoDe.get(c.id), nome_cliente: fantasia, razao_social: f.razao_social, nome_fantasia: fantasia,
        cpf: '', cnpj: fmtCnpj(f.cnpj), data_cadastro: cadastro, estado: f.uf, cidade: munPorIbge.get(f.ibge).nome, bairro: c.bairro,
        rua: titulo(`${f.tipo_logradouro || ''} ${f.logradouro || ''}`.trim()), numero: f.numero || 'S/N', cep: fmtCep(f.cep),
        segmento: segmentoDe(f), porte: porteDe(f), ativo: 'True', imagem: `cliente_${c.id}.jpg`,
      };
      return colsC.map((k) => v[k] ?? '');
    });
  csv('dm_cliente.csv', cliOrig.cabecalho, linhasCli);

  const regraDe = (u) => (u.tipo === 'cidade' ? { nivel: 'cidade', ibge: u.ibge, nome: u.nome } : { nivel: 'bairro', ibge: u.ibge, bairro_id: u.bairro_id, nome: u.nome, cidade: u.cidade });
  const plano = {
    versao: 2,
    gerado_em: new Date().toISOString(),
    semente: SEMENTE,
    descricao: 'Praças comerciais: farmácias reais da Receita como clientes, força de vendas fictícia com hierarquia regional e carteiras por cidade e bairro.',
    regioes: coordenacoes.map((r) => ({ id: r.id, nome: r.nome, ufs: r.ufs, id_coordenador: r.coordenador })),
    equipes: equipes.map((e) => ({ id_gerente: e.gerente, nome: e.nome, uf: e.uf, regiao: e.regiao, cidade_base: e.base.nome, vendedores: e.zonas.map((z) => z.vendedor) })),
    carteiras: zonas.map((z) => ({
      id_vendedor: z.vendedor, nome: z.nome, uf: z.uf, cidade_base: z.base.nome, clientes: z.clientes.length,
      regras: z.unidades.map(regraDe),
    })),
    excecoes_uf: excecoes,
    invasao: { prob_base: 0.07, prob_ferias: 0.5, descricao: 'Pedido tirado por um colega da mesma equipe (cobertura de férias, visita conjunta, televendas).' },
    fotos_novas: novos.map((p) => ({ id: p.id, genero: p.genero })),
    criterios_clientes: { naturezas: [...NATUREZAS_OK], sem_mei: true, max_rede: MAX_REDE, regex_razao_social: RE_EMPRESA.source },
  };
  fs.writeFileSync(path.join(RAIZ, 'dados', 'pracas.json'), JSON.stringify(plano));

  // fotos
  const origem = fs.readFileSync(path.join(RAIZ, 'dados', 'imagens', 'origem.csv'), 'utf8').trimEnd().split(/\r?\n/);
  const jaTem = new Set(origem.slice(1).map((l) => Number(l.split(';')[0])));
  let semFoto = 0;
  if (!PASTA_CANDIDATAS) console.log('  fotos: informe --fotos=<pasta das candidatas SFHQ> para copiar as fotos dos novos');
  else {
    for (const p of novos.filter((x) => !jaTem.has(x.id))) {
      const lista = fotosLivres[p.genero];
      const foto = lista.shift();
      if (!foto) {
        semFoto++;
        continue;
      }
      fs.copyFileSync(path.join(PASTA_CANDIDATAS, foto.candidata), path.join(FOTOS, `vendedor_${p.id}.jpg`));
      origem.push(`${p.id};${p.nome_vendedor};${foto.arquivo}`);
    }
    fs.writeFileSync(path.join(RAIZ, 'dados', 'imagens', 'origem.csv'), `${origem.join('\n')}\n`);
  }

  // ---------------- relatório
  const porUf = Object.keys(PRACAS).map((uf) => ({
    uf, clientes: clientes.filter((c) => c.f.uf === uf).length, vendedores: zonas.filter((z) => z.uf === uf).length, equipes: equipes.filter((e) => e.uf === uf).length,
  }));
  console.table(porUf);
  console.log(`pessoas: ${pessoas.size} (${ordemP.filter((p) => p.nivel === 'vendedor').length} vendedores, ${ordemP.filter((p) => p.nivel === 'gerente').length} gerentes, ${ordemP.filter((p) => p.nivel === 'coordenador').length} coordenadores) · novas ${novos.length} · sem foto ${semFoto}`);
  console.log(`exceções de divisa: ${excecoes.length} · segmentos:`, Object.fromEntries(Object.values(SEGMENTOS).map((s) => [s, linhasCli.filter((l) => l[colsC.indexOf('segmento')] === s).length])));
  console.log(`concluído em ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

principal()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
