// Tabelas de dados vindas do ERP/DW (mesmos nomes dos CSVs exportados).
// Tipos: INTEGER, REAL, TEXT, BOOL (gravado como 0/1).
export const TABELAS_DADOS = {
  dm_canal: {
    pk: 'id_canal',
    colunas: { id_canal: 'INTEGER', nome_canal: 'TEXT', tipo: 'TEXT', comissao_perc: 'REAL' },
  },
  dm_cliente: {
    pk: 'id_cliente',
    colunas: {
      id_cliente: 'INTEGER', id_empresa: 'INTEGER', id_vendedor: 'INTEGER', nome_cliente: 'TEXT',
      razao_social: 'TEXT', nome_fantasia: 'TEXT', cpf: 'TEXT', cnpj: 'TEXT', data_cadastro: 'TEXT',
      estado: 'TEXT', cidade: 'TEXT', bairro: 'TEXT', rua: 'TEXT', numero: 'TEXT', cep: 'TEXT',
      segmento: 'TEXT', porte: 'TEXT', ativo: 'BOOL', imagem: 'TEXT',
    },
    indices: ['id_vendedor', 'estado'],
  },
  dm_produto: {
    pk: 'id_produto',
    colunas: {
      id_produto: 'INTEGER', id_empresa: 'INTEGER', nome_produto: 'TEXT', fabricante: 'TEXT', marca: 'TEXT',
      categoria: 'TEXT', subcategoria: 'TEXT', ean: 'TEXT', preco_lista: 'REAL', custo_compra: 'REAL',
      margem_minima: 'REAL', status: 'BOOL', imagem: 'TEXT',
    },
    indices: ['fabricante', 'marca'],
  },
  dm_vendedor: {
    pk: 'id_vendedor',
    colunas: {
      id_vendedor: 'INTEGER', id_empresa: 'INTEGER', nome_vendedor: 'TEXT', nivel: 'TEXT', id_superior: 'INTEGER',
      data_nascimento: 'TEXT', telefone: 'TEXT', email: 'TEXT', estado: 'TEXT', cidade: 'TEXT', bairro: 'TEXT',
      rua: 'TEXT', numero: 'TEXT', cep: 'TEXT', imagem: 'TEXT',
    },
    indices: ['id_superior'],
  },
  fato_vendas: {
    pk: 'id_fato',
    colunas: {
      id_fato: 'INTEGER', id_empresa: 'INTEGER', id_pedido: 'TEXT', data_pedido: 'TEXT', data_faturamento: 'TEXT',
      id_produto: 'INTEGER', id_cliente: 'INTEGER', id_vendedor: 'INTEGER', quantidade: 'REAL', preco_lista: 'REAL',
      desconto_perc: 'REAL', valor_unitario: 'REAL', valor_total: 'REAL', custo_unitario: 'REAL', custo_total: 'REAL',
      margem_bruta: 'REAL', valor_icms: 'REAL', valor_pis: 'REAL', valor_cofins: 'REAL', valor_impostos_total: 'REAL',
      id_canal: 'INTEGER', cfop: 'TEXT', numero_nf: 'TEXT', status: 'TEXT',
    },
    indices: ['data_pedido', 'data_faturamento', 'id_produto', 'id_vendedor', 'id_cliente', 'id_pedido', 'data_pedido, id_produto', 'data_faturamento, id_produto', 'id_cliente, data_pedido', 'id_vendedor, data_pedido'],
  },
  fato_estoque: {
    pk: 'id_estoque',
    colunas: {
      id_estoque: 'INTEGER', id_empresa: 'INTEGER', id_produto: 'INTEGER', data: 'TEXT', estoque_inicial: 'REAL',
      quantidade_vendida: 'REAL', quantidade_entrada: 'REAL', estoque_final: 'REAL', estoque_minimo: 'REAL',
      custo_estoque: 'REAL',
    },
    indices: ['id_produto, data'],
  },
  fato_metas: {
    pk: 'id_meta',
    colunas: {
      id_meta: 'INTEGER', id_empresa: 'INTEGER', id_vendedor: 'INTEGER', ano: 'INTEGER', mes: 'INTEGER',
      meta_valor: 'REAL', meta_quantidade: 'REAL', realizado_valor: 'REAL', realizado_quantidade: 'REAL',
      atingimento_perc: 'REAL',
    },
    indices: ['id_vendedor, ano, mes'],
  },
};

export const ESQUEMA_APP = `
CREATE TABLE IF NOT EXISTS campanha (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  fornecedor TEXT,
  status TEXT NOT NULL DEFAULT 'rascunho',
  inicio TEXT NOT NULL,
  fim TEXT NOT NULL,
  definicao TEXT NOT NULL,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS fotografia (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  id_campanha INTEGER NOT NULL REFERENCES campanha(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL DEFAULT 'manual',
  observacao TEXT,
  data_referencia TEXT,
  resultado TEXT NOT NULL,
  criado_em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_fotografia_campanha ON fotografia(id_campanha);
CREATE TABLE IF NOT EXISTS modelo_mensagem (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  destino TEXT NOT NULL DEFAULT 'participantes',
  assunto TEXT,
  corpo TEXT NOT NULL,
  criado_em TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agendamento (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  id_campanha INTEGER,
  id_modelo INTEGER NOT NULL,
  canal TEXT NOT NULL DEFAULT 'registro',
  filtro TEXT NOT NULL DEFAULT 'todos',
  lista TEXT,
  dias_semana TEXT NOT NULL DEFAULT '1,2,3,4,5',
  hora TEXT NOT NULL DEFAULT '08:00',
  ativo INTEGER NOT NULL DEFAULT 1,
  ultima_execucao TEXT,
  criado_em TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS disparo (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  id_campanha INTEGER,
  id_agendamento INTEGER,
  canal TEXT NOT NULL,
  destinatario TEXT,
  contato TEXT,
  assunto TEXT,
  mensagem TEXT,
  status TEXT NOT NULL,
  erro TEXT,
  criado_em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_disparo_campanha ON disparo(id_campanha, criado_em);
CREATE TABLE IF NOT EXISTS importacao (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tabela TEXT NOT NULL,
  arquivo TEXT,
  modo TEXT,
  linhas INTEGER,
  criado_em TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS config (
  chave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);

-- Grupos/linhas de produtos reutilizáveis (ex.: "Linha Dor" = Dorflex + Novalgina + Neosaldina)
CREATE TABLE IF NOT EXISTS grupo_produto (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL UNIQUE,
  descricao TEXT,
  seletor TEXT NOT NULL,
  criado_em TEXT NOT NULL
);

-- Tabelas de inteligência (perfil, conhecimento, IA, recomendações) e da Receita Federal
-- são criadas pelos próprios módulos (server/perfil.js, conhecimento.js, ia.js, planos.js, receita.js).
`;
