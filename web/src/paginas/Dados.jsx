import { useMemo, useRef, useState } from 'react';
import {
  Boxes, CalendarRange, Database, FileUp, FolderSync, MapPin, Package, Radio, Receipt, ShieldCheck, Store, Target, Upload, Users,
} from 'lucide-react';
import { api, post, qs, useApi } from '../lib/api.js';
import { invalidarRecurso } from '../lib/dados.js';
import { navegar } from '../lib/rotas.js';
import { fmtData, fmtDataHora, fmtNumero, fmtRelativo } from '../lib/formato.js';
import {
  Aviso, Botao, Cabecalho, Campo, Cartao, Carregando, ErroCarga, Numero, Segmentado, Selo, Seletor, Tabela, Vazio, cx, useToast,
} from '../componentes/ui.jsx';
import { EXPLICA } from '../lib/explicacoes.jsx';
import { useConfirmar } from './sistema/Confirmar.jsx';
import CampoGrupo from './sistema/CampoGrupo.jsx';
import CartaoPipeline from './sistema/CartaoPipeline.jsx';
import './sistema/sistema.css';

const TABELAS = {
  fato_vendas: { nome: 'Vendas', descricao: 'Itens de pedido/nota, a base de toda apuração', icone: Receipt },
  fato_estoque: { nome: 'Estoque diário', descricao: 'Posição por produto e dia (alertas de ruptura)', icone: Boxes },
  fato_metas: { nome: 'Metas gerais', descricao: 'Metas mensais por vendedor (valor e quantidade)', icone: Target },
  dm_cliente: { nome: 'Clientes', descricao: 'Cadastro, carteira, segmento e porte', icone: Store },
  dm_produto: { nome: 'Produtos', descricao: 'Fabricante, marca, subcategoria e preço', icone: Package },
  dm_vendedor: { nome: 'Vendedores e gerentes', descricao: 'Hierarquia e contatos (WhatsApp/e-mail)', icone: Users },
  dm_canal: { nome: 'Canais de venda', descricao: 'Presencial, televendas, e-commerce…', icone: Radio },
};

const normalizar = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9_]+/g, '_');
function detectarTabela(nome) {
  const n = normalizar(nome);
  return Object.keys(TABELAS).sort((a, b) => b.length - a.length).find((t) => n.startsWith(t)) || '';
}
const tamanhoArquivo = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

function EnvioArquivo({ aoImportar }) {
  const toast = useToast();
  const entrada = useRef(null);
  const [arrastando, setArrastando] = useState(false);
  const [arquivo, setArquivo] = useState(null);
  const [tabela, setTabela] = useState('');
  const [modo, setModo] = useState('substituir');
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState(null);

  const escolher = (f) => {
    if (!f) return;
    if (!/\.(csv|txt)$/i.test(f.name)) {
      toast.erro('Envie um arquivo .csv (separado por ponto e vírgula ou vírgula).');
      return;
    }
    setArquivo(f);
    setTabela(detectarTabela(f.name));
    setResultado(null);
  };

  async function importar() {
    setEnviando(true);
    try {
      const r = await api('POST', `/importar/arquivo${qs({ nome: arquivo.name, tabela, modo })}`, arquivo, { tipo: 'text/csv' });
      setResultado(r);
      toast.ok(`${fmtNumero(r?.linhas ?? 0)} linhas importadas em ${TABELAS[r?.tabela]?.nome || r?.tabela}`);
      setArquivo(null);
      aoImportar?.();
    } catch (e) {
      toast.erro(e.message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Cartao titulo="Enviar arquivo" subtitulo="Atualize uma tabela com o CSV exportado do ERP" info={{ texto: 'Troca o conteúdo de uma tabela pelo arquivo CSV que você enviar. O sistema reconhece a tabela pelo nome do arquivo ou pelas colunas.', como: ['Exporte do ERP em CSV (separado por ; ou ,).', 'Arraste o arquivo aqui ou clique para escolher.', 'Confira a tabela de destino e importe. As campanhas são recalculadas sozinhas.'], exemplo: 'fato_vendas_outubro.csv vai para a tabela Vendas.' }}>
      <div className="coluna" style={{ gap: 14 }}>
        <div
          className={cx('zona-envio', arrastando && 'ativa')}
          role="button"
          tabIndex={0}
          onClick={() => entrada.current?.click()}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && entrada.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setArrastando(true); }}
          onDragLeave={() => setArrastando(false)}
          onDrop={(e) => { e.preventDefault(); setArrastando(false); escolher(e.dataTransfer.files?.[0]); }}
        >
          <span className="icone-grande"><FileUp size={20} /></span>
          {arquivo ? (
            <>
              <strong style={{ color: 'var(--tinta)' }}>{arquivo.name}</strong>
              <span className="pequeno">{tamanhoArquivo(arquivo.size)} · clique para trocar</span>
            </>
          ) : (
            <>
              <strong style={{ color: 'var(--tinta)' }}>Arraste o CSV aqui ou clique para escolher</strong>
              <span className="pequeno">O nome do arquivo identifica a tabela (ex.: fato_vendas.csv). Aceita “;” ou “,”, datas dd/mm/aaaa e decimais com vírgula.</span>
            </>
          )}
          <input ref={entrada} type="file" accept=".csv,.txt,text/csv" hidden onChange={(e) => { escolher(e.target.files?.[0]); e.target.value = ''; }} />
        </div>

        {arquivo && (
          <>
            <div className="config-linha-2">
              <Campo rotulo="Tabela de destino" ajuda={tabela ? `Detectada: ${TABELAS[tabela]?.nome}` : 'Não reconhecida pelo nome. Escolha a tabela.'}>
                <Seletor opcoes={Object.entries(TABELAS).map(([k, v]) => ({ valor: k, rotulo: `${v.nome} (${k})` }))} valor={tabela} vazio="Detectar pelo conteúdo" aoMudar={setTabela} />
              </Campo>
              <CampoGrupo rotulo="Como importar">
                <Segmentado tamanho="p" valor={modo} aoMudar={setModo} opcoes={[
                  { valor: 'substituir', rotulo: 'Substituir tudo', dica: 'Apaga a tabela e carrega o arquivo' },
                  { valor: 'mesclar', rotulo: 'Mesclar', dica: 'Atualiza registros existentes e acrescenta os novos (exportação incremental)' },
                ]} />
              </CampoGrupo>
            </div>
            <div className="linha entre">
              <span className="mini mudo">{modo === 'substituir' ? 'A tabela inteira será trocada pelo conteúdo do arquivo.' : 'Linhas com a mesma chave são atualizadas; as novas são acrescentadas.'}</span>
              <Botao variante="primario" icone={Upload} carregando={enviando} onClick={importar}>Importar</Botao>
            </div>
          </>
        )}
        {resultado && (
          <Aviso tipo="ok" titulo={`${fmtNumero(resultado.linhas)} linhas em ${TABELAS[resultado.tabela]?.nome || resultado.tabela}`}>
            Modo: {resultado.modo}. As apurações já usam os dados novos.
            {resultado.colunas_ignoradas?.length > 0 && <> Colunas ignoradas: {resultado.colunas_ignoradas.join(', ')}.</>}
          </Aviso>
        )}
      </div>
    </Cartao>
  );
}

function CartaoReceita({ receita, aoImportar }) {
  const toast = useToast();
  const [confirmar, dialogo] = useConfirmar();
  const [importando, setImportando] = useState(false);
  const [resultado, setResultado] = useState(null);
  async function importar() {
    if (!(await confirmar({ titulo: 'Importar farmácias da Receita?', texto: 'Busca no PostgreSQL local todas as farmácias ativas (CNAE 4771-7/01, 02 e 03) com endereço e coordenadas. Pode levar alguns minutos.', rotulo: 'Importar' }))) return;
    setImportando(true);
    try {
      const r = await post('/receita/importar');
      setResultado(r);
      toast.ok(`${fmtNumero(r?.farmacias ?? 0)} farmácias ativas importadas`);
      aoImportar?.();
    } catch (e) {
      toast.erro(e.message);
    } finally {
      setImportando(false);
    }
  }
  return (
    <Cartao titulo="Receita Federal: farmácias ativas" subtitulo="Universo de prospecção usado no mapa comercial" info={EXPLICA.dadosReceita}
      acoes={<Botao tamanho="p" icone={MapPin} variante="fantasma" onClick={() => navegar('/mapa')}>Abrir mapa</Botao>}>
      {dialogo}
      {!receita?.configurada ? (
        <Aviso tipo="info" titulo="Conexão não configurada">
          Informe POSTGRES_HOST, POSTGRES_PORT, POSTGRES_DB, POSTGRES_USER e POSTGRES_PASSWORD no arquivo <code>.env</code> do projeto e reinicie o servidor.
        </Aviso>
      ) : (
        <div className="coluna" style={{ gap: 12 }}>
          <div className="linha" style={{ gap: 18 }}>
            <div>
              <div style={{ fontSize: 26, fontWeight: 650, letterSpacing: '-0.02em' }}><Numero valor={receita.farmacias ?? 0} /></div>
              <div className="mini mudo">farmácias ativas carregadas</div>
            </div>
            <div className="mini mudo">
              {receita.importado_em ? <>Última carga {fmtRelativo(receita.importado_em)}<br />{fmtDataHora(receita.importado_em)}</> : 'Ainda não importado'}
            </div>
          </div>
          <div className="linha entre">
            <span className="mini mudo">Somente situação cadastral ATIVA · CNAE 4771-7/01, 4771-7/02, 4771-7/03.</span>
            <Botao icone={FolderSync} carregando={importando} onClick={importar}>{receita.farmacias ? 'Atualizar' : 'Importar agora'}</Botao>
          </div>
          {importando && <Aviso tipo="info">Importando do PostgreSQL… pode levar alguns minutos. Você pode continuar usando o sistema.</Aviso>}
          {resultado && (
            <Aviso tipo="ok" titulo={`${fmtNumero(resultado.farmacias)} farmácias`}>
              {resultado.com_coordenadas != null && <>{fmtNumero(resultado.com_coordenadas)} com coordenadas. </>}
              {resultado.duracao_ms != null && <>Concluído em {(resultado.duracao_ms / 1000).toFixed(1).replace('.', ',')} s.</>}
            </Aviso>
          )}
        </div>
      )}
    </Cartao>
  );
}

export default function Dados() {
  const toast = useToast();
  const [confirmar, dialogo] = useConfirmar();
  const { dados: status, erro, recarregar: recarregarStatus } = useApi('/status');
  const { dados: importacoes, recarregar: recarregarImportacoes } = useApi('/importacoes');
  const [reimportando, setReimportando] = useState(false);

  const tabelas = useMemo(() => {
    const lista = status?.dados?.tabelas || [];
    const max = Math.max(1, ...lista.map((t) => t.linhas || 0));
    return lista.map((t) => ({ ...t, ...(TABELAS[t.tabela] || { nome: t.tabela, descricao: '', icone: Database }), rel: (t.linhas || 0) / max }));
  }, [status]);
  const linhas = (nome) => status?.dados?.tabelas?.find((t) => t.tabela === nome)?.linhas;

  const aposImportar = () => {
    invalidarRecurso();
    recarregarStatus();
    recarregarImportacoes();
  };

  async function reimportarPasta() {
    if (!(await confirmar({ titulo: 'Reimportar a pasta dados/?', texto: 'Todos os CSVs reconhecidos na pasta dados/ substituem as tabelas atuais. As campanhas não são alteradas, só recalculadas com os dados novos.', rotulo: 'Reimportar' }))) return;
    setReimportando(true);
    try {
      const r = await post('/importar/pasta');
      const total = (r?.importados || []).reduce((a, x) => a + (x.linhas || 0), 0);
      toast.ok(`${r?.importados?.length ?? 0} tabelas · ${fmtNumero(total)} linhas importadas`);
      aposImportar();
    } catch (e) {
      toast.erro(e.message);
    } finally {
      setReimportando(false);
    }
  }

  const ultima = status?.dados?.ultima_importacao;
  const vendas = status?.dados?.vendas;

  return (
    <div>
      {dialogo}
      <Cabecalho
        titulo="Dados"
        subtitulo="De onde vêm os números das apurações e como mantê-los em dia."
        info={EXPLICA.dados}
        acoes={
          <>
            <Botao icone={ShieldCheck} onClick={() => navegar('/insights?aba=qualidade')}>Qualidade dos dados</Botao>
            <Botao variante="primario" icone={FolderSync} carregando={reimportando} onClick={reimportarPasta}>Reimportar pasta dados/</Botao>
          </>
        }
      />
      {erro && !status && <ErroCarga erro={erro} aoTentar={recarregarStatus} />}
      {!status && !erro && <Carregando />}
      {status && (
        <>
          <div className="dados-kpis escalonado">
            <div className="cartao kpi">
              <div className="kpi-rotulo"><Receipt size={15} />Linhas de venda</div>
              <div className="kpi-valor"><Numero valor={linhas('fato_vendas') ?? 0} /></div>
              <div className="mini mudo">itens de pedido carregados</div>
            </div>
            <div className="cartao kpi">
              <div className="kpi-rotulo"><CalendarRange size={15} />Período das vendas</div>
              <div className="kpi-valor" style={{ fontSize: 20 }}>{vendas?.min ? `${fmtData(vendas.min)} a ${fmtData(vendas.max)}` : '-'}</div>
              <div className="mini mudo">as projeções usam {vendas?.max ? fmtData(vendas.max) : 'a última data'} como “hoje”</div>
            </div>
            <div className="cartao kpi">
              <div className="kpi-rotulo"><Store size={15} />Clientes · Produtos</div>
              <div className="kpi-valor"><Numero valor={linhas('dm_cliente') ?? 0} /> <span className="mudo" style={{ fontSize: 18 }}>·</span> <Numero valor={linhas('dm_produto') ?? 0} /></div>
              <div className="mini mudo">{fmtNumero(linhas('dm_vendedor') ?? 0)} vendedores e gerentes</div>
            </div>
            <div className="cartao kpi">
              <div className="kpi-rotulo"><Upload size={15} />Última importação</div>
              <div className="kpi-valor" style={{ fontSize: 20 }}>{ultima ? fmtRelativo(ultima.criado_em) : '-'}</div>
              <div className="mini mudo truncar">{ultima ? `${TABELAS[ultima.tabela]?.nome || ultima.tabela} · ${fmtNumero(ultima.linhas)} linhas` : 'nenhuma ainda'}</div>
            </div>
          </div>

          <div className="dados-grade">
            <div className="coluna" style={{ gap: 16 }}>
              <Cartao titulo="Tabelas carregadas" subtitulo="Banco local (SQLite) alimentado pelos CSVs do ERP" info={EXPLICA.dadosTabelas}>
                {!tabelas.length ? <Vazio icone={Database} titulo="Nenhuma tabela" /> : (
                  <div>
                    {tabelas.map((t) => (
                      <div key={t.tabela} className="tabela-dados-linha">
                        <span className="ic"><t.icone size={16} /></span>
                        <div style={{ minWidth: 0 }}>
                          <div className="linha" style={{ gap: 8 }}><span className="forte pequeno">{t.nome}</span><span className="mono mudo mini">{t.tabela}</span></div>
                          <div className="mini mudo truncar">{t.descricao}</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div className="forte num pequeno">{fmtNumero(t.linhas)}</div>
                          <div className="barra-relativa"><span style={{ width: `${Math.max(2, t.rel * 100)}%` }} /></div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Cartao>
              <Cartao titulo="Histórico de importações" semMargem info={EXPLICA.dadosImportacoes}>
                {!importacoes ? <Carregando altura={120} /> : (
                  <Tabela
                    densa
                    maxAltura={360}
                    linhas={importacoes}
                    chaveLinha={(i) => i.id}
                    vazio={<Vazio icone={Upload} titulo="Nenhuma importação registrada" />}
                    colunas={[
                      { chave: 'criado_em', titulo: 'Quando', render: (i) => <span className="pequeno" title={fmtDataHora(i.criado_em)}>{fmtRelativo(i.criado_em)}</span> },
                      { chave: 'tabela', titulo: 'Tabela', render: (i) => <span className="pequeno">{TABELAS[i.tabela]?.nome || i.tabela}</span> },
                      { chave: 'arquivo', titulo: 'Arquivo', render: (i) => <span className="mini mono truncar" style={{ display: 'block', maxWidth: 220 }}>{i.arquivo}</span> },
                      { chave: 'modo', titulo: 'Modo', render: (i) => <Selo cor={i.modo === 'mesclar' ? 'acento' : 'neutro'}>{i.modo}</Selo> },
                      { chave: 'linhas', titulo: 'Linhas', alinhar: 'direita', render: (i) => <span className="num pequeno">{fmtNumero(i.linhas)}</span> },
                    ]}
                  />
                )}
              </Cartao>
            </div>
            <div className="coluna" style={{ gap: 16 }}>
              <CartaoPipeline />
              <EnvioArquivo aoImportar={aposImportar} />
              <CartaoReceita receita={status.receita} aoImportar={aposImportar} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
