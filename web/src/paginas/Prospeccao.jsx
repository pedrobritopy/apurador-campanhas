import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Database, Download, ExternalLink, Mail, Map as MapaIcone, MapPin, MessageCircle, Search, Sparkles, Store } from 'lucide-react';
import { baixar, qs, useApi } from '../lib/api.js';
import { definirQuery, navegar } from '../lib/rotas.js';
import { useAtrasado } from '../lib/anim.js';
import { fmtData, fmtDecimal, fmtNumero } from '../lib/formato.js';
import {
  Aviso, Botao, BotaoIcone, Cabecalho, Campo, Cartao, Carregando, Entrada, ErroCarga, Explica, Gaveta, Kpi, Segmentado, Selo, Seletor, Tabela, Vazio,
} from '../componentes/ui.jsx';
import MultiSelecao from '../componentes/MultiSelecao.jsx';
import { ConteudoPonto, ScoreMini } from './mapa/Detalhes.jsx';
import { CNAE_CURTO, fmtCnpj, fmtTelefone, linkMapas, linkWhatsapp, mesesDesde, rotuloRede, textoIdade, UFS_SIGLAS } from './mapa/util.js';
import './mapa/mapa.css';

const POR_PAGINA = 50;

export default function Prospeccao({ query, status }) {
  const [f, setF] = useState(() => ({
    uf: query.get('uf') || '',
    cidade: query.get('cidade') || '',
    bairro: query.get('bairro') || '',
    independentes: query.get('independentes') === '1',
    abertas_meses: Number(query.get('abertas_meses')) || 0,
    porte: query.get('porte') || '',
    cnae: query.get('cnae') || '',
    busca: query.get('busca') || '',
    ordenar: query.get('ordenar') || 'score',
    pagina: 1,
  }));
  const [aberto, setAberto] = useState(null);
  const busca = useAtrasado(f.busca, 350);
  const bairro = useAtrasado(f.bairro, 350);
  const mudar = (parcial) => setF((x) => ({ ...x, ...parcial, pagina: parcial.pagina ?? 1 }));

  const parametros = {
    uf: f.uf, cidade: f.cidade, bairro, independentes: f.independentes ? 1 : '', abertas_meses: f.abertas_meses || '',
    porte: f.porte, cnae: f.cnae, busca, ordenar: f.ordenar,
  };
  const { dados, erro, carregando, recarregar } = useApi(`/prospeccao${qs({ ...parametros, pagina: f.pagina, por_pagina: POR_PAGINA })}`);
  const { dados: cidades } = useApi(`/mapa/cidades${qs({ uf: f.uf })}`);
  const { dados: det, carregando: carregandoDet } = useApi(aberto ? `/mapa/farmacia/${aberto}` : null);

  // filtros principais ficam na URL (link compartilhável)
  useEffect(() => {
    definirQuery({ uf: f.uf, cidade: f.cidade, independentes: f.independentes ? 1 : null, abertas_meses: f.abertas_meses || null, ordenar: f.ordenar !== 'score' ? f.ordenar : null });
  }, [f.uf, f.cidade, f.independentes, f.abertas_meses, f.ordenar]);

  const opcoesCidades = useMemo(
    () => (Array.isArray(cidades) ? cidades.map((c) => ({ valor: c.ibge, rotulo: `${c.nome} · ${c.uf}`, detalhe: `${fmtNumero(c.farmacias)} farmácias` })) : []),
    [cidades],
  );
  const semBase = status?.receita && status.receita.farmacias === 0;
  const r = dados?.resumo;
  const total = dados?.total ?? 0;
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));

  const colunas = [
    { chave: 'score', titulo: 'Score', largura: 90, render: (l) => <ScoreMini valor={l.score} /> },
    {
      chave: 'nome',
      titulo: 'Farmácia',
      render: (l) => (
        <div className="coluna" style={{ gap: 2, minWidth: 200, maxWidth: 300 }}>
          <span className="linha g4">
            <span className="forte truncar" style={{ maxWidth: 230 }}>{l.nome}</span>
            {mesesDesde(l.abertura) < 12 && <Selo cor="acento" icone={Sparkles}>Nova</Selo>}
          </span>
          <span className="mudo mini truncar" style={{ maxWidth: 290 }}>{l.razao_social}</span>
        </div>
      ),
    },
    {
      chave: 'endereco',
      titulo: 'Endereço',
      render: (l) => (
        <div className="coluna" style={{ gap: 2, maxWidth: 250 }}>
          <span className="truncar pequeno">{l.endereco || 'Sem endereço'}</span>
          <span className="mudo mini truncar">{[l.bairro, `${l.cidade}/${l.uf}`].filter(Boolean).join(' · ')}</span>
        </div>
      ),
    },
    {
      chave: 'perfil',
      titulo: 'Perfil',
      render: (l) => (
        <div className="coluna" style={{ gap: 2, whiteSpace: 'nowrap' }}>
          <span className="pequeno">{rotuloRede(l.rede)}</span>
          <span className="mudo mini">{[l.porte, CNAE_CURTO[l.cnae] || l.cnae_descricao].filter(Boolean).join(' · ')}</span>
        </div>
      ),
    },
    {
      chave: 'abertura',
      titulo: 'Abertura',
      render: (l) => (
        <div className="coluna" style={{ gap: 2, whiteSpace: 'nowrap' }}>
          <span className="num pequeno">{fmtData(l.abertura)}</span>
          <span className="mudo mini">{textoIdade(l.abertura)}</span>
        </div>
      ),
    },
    {
      chave: 'contato',
      titulo: 'Contato',
      render: (l) => {
        const wa = linkWhatsapp(l.telefone);
        return (
          <div className="linha g4" onClick={(e) => e.stopPropagation()}>
            <span className="num pequeno" style={{ whiteSpace: 'nowrap' }}>{fmtTelefone(l.telefone) || 'sem telefone'}</span>
            {wa && <a className="botao fantasma p icone" href={wa} target="_blank" rel="noopener noreferrer" title="WhatsApp"><MessageCircle size={14} /></a>}
            {l.email && <a className="botao fantasma p icone" href={`mailto:${l.email}`} title={l.email}><Mail size={14} /></a>}
          </div>
        );
      },
    },
    {
      chave: 'acoes',
      titulo: '',
      alinhar: 'direita',
      largura: 76,
      render: (l) => (
        <div className="linha g4" style={{ justifyContent: 'flex-end' }} onClick={(e) => e.stopPropagation()}>
          <BotaoIcone icone={MapPin} rotulo="Ver no mapa comercial" tamanho="p" onClick={() => navegar(`/mapa?cnpj=${l.cnpj}`)} />
          {linkMapas(l.lat, l.lng) && (
            <a className="botao fantasma p icone" href={linkMapas(l.lat, l.lng)} target="_blank" rel="noopener noreferrer" title="Abrir no Google Maps"><ExternalLink size={14} /></a>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <Cabecalho
        sobre={<><Store size={13} />Inteligência comercial</>}
        titulo="Prospecção de farmácias"
        info={{
          texto: 'Lista das farmácias ativas na Receita Federal que ainda não compram de nós, da mais atraente para a menos atraente.',
          como: ['Filtre por estado, cidade, bairro, porte ou tipo.', 'Clique numa farmácia para ver contato, sócios e por que ela tem aquele score.', 'Exporte para Excel e distribua para a equipe visitar.'],
          exemplo: 'Filtre "Só independentes" e "até 12 meses" para achar lojas novas, que ainda estão escolhendo fornecedor.',
        }}
        subtitulo={`Farmácias ativas da Receita Federal que ainda não são clientes, ordenadas pela atratividade${status?.receita?.competencia ? ` · base ${status.receita.competencia}` : ''}`}
        acoes={
          <>
            <Botao icone={MapaIcone} onClick={() => navegar(`/mapa${qs({ uf: f.uf, cidade: f.cidade })}`)}>Ver no mapa</Botao>
            <Botao variante="primario" icone={Download} disabled={!total} onClick={() => baixar(`/prospeccao/excel${qs(parametros)}`)}>Exportar Excel</Botao>
          </>
        }
      />

      {semBase && (
        <Aviso tipo="aviso" titulo="A base de farmácias da Receita ainda não foi importada" className="nao-imprimir"
          acao={<Botao tamanho="p" icone={Database} onClick={() => navegar('/mapa')}>Importar no mapa</Botao>}>
          A prospecção usa as farmácias ativas (CNAE 4771-7/01, 02 e 03) do Postgres local.
        </Aviso>
      )}

      <div className="grade-4 escalonado" style={{ marginBottom: 16, marginTop: semBase ? 16 : 0 }}>
        <Kpi rotulo={<>Farmácias para prospectar <Explica titulo="Farmácias para prospectar" texto="Farmácias ativas que ainda não são clientes e passam nos filtros escolhidos." tamanho={12} /></>} valor={r?.total ?? null} icone={Store} />
        <Kpi rotulo={<>Independentes <Explica titulo="Independentes" texto="Farmácias de loja única, sem rede. São o público natural da distribuidora: compram de vários fornecedores e decidem rápido." tamanho={12} /></>} valor={r?.independentes ?? null} />
        <Kpi rotulo="Abertas nos últimos 12 meses" valor={r?.abertas_12m ?? null} icone={Sparkles} />
        <Kpi rotulo={<>Cidades <Explica titulo="Score de prospecção" texto="Cada farmácia recebe uma nota de 0 a 100: independente (até 30), abertura recente (até 14), saúde cadastral (até 20), qualidade do contato (até 10), porte (até 8) e proximidade de onde já vendemos (até 18)." tamanho={12} /></>} valor={r?.cidades ?? null} rodape={r?.score_medio != null && <span className="mudo pequeno">score médio {fmtDecimal(r.score_medio, 1)}</span>} />
      </div>

      <div className="prosp-filtros">
        <Campo rotulo="Buscar" dica="Procura no nome fantasia, na razão social e no nome do sócio principal. Também aceita o começo do CNPJ." style={{ minWidth: 240, flex: '1 1 240px' }}>
          <Entrada icone={Search} placeholder="Nome, CNPJ ou sócio" value={f.busca} onChange={(e) => mudar({ busca: e.target.value })} />
        </Campo>
        <Campo rotulo="UF" style={{ minWidth: 110 }}>
          <Seletor valor={f.uf} vazio="Todas" opcoes={UFS_SIGLAS} aoMudar={(v) => mudar({ uf: v, cidade: '' })} />
        </Campo>
        <Campo rotulo="Cidade" style={{ minWidth: 230, flex: '1 1 230px' }}>
          <MultiSelecao unico opcoes={opcoesCidades} valores={f.cidade ? [f.cidade] : []} aoMudar={(v) => mudar({ cidade: v[0] || '' })} placeholder="Todas as cidades" />
        </Campo>
        <Campo rotulo="Bairro" style={{ minWidth: 160 }}>
          <Entrada placeholder="Ex.: Centro" value={f.bairro} onChange={(e) => mudar({ bairro: e.target.value })} />
        </Campo>
        <Campo rotulo="Porte" dica="Porte declarado na Receita: ME (microempresa), EPP (empresa de pequeno porte) ou Demais." style={{ minWidth: 120 }}>
          <Seletor valor={f.porte} vazio="Todos" opcoes={[{ valor: 'ME', rotulo: 'ME' }, { valor: 'EPP', rotulo: 'EPP' }, { valor: 'Demais', rotulo: 'Demais' }]} aoMudar={(v) => mudar({ porte: v })} />
        </Campo>
        <Campo rotulo="Tipo" dica="Atividade principal na Receita: drogaria comum, farmácia de manipulação ou homeopática." style={{ minWidth: 170 }}>
          <Seletor valor={f.cnae} vazio="Todos" opcoes={[{ valor: '4771701', rotulo: 'Drogaria' }, { valor: '4771702', rotulo: 'Manipulação' }, { valor: '4771703', rotulo: 'Homeopática' }]} aoMudar={(v) => mudar({ cnae: v })} />
        </Campo>
      </div>
      <div className="linha quebra entre" style={{ marginBottom: 14, gap: 10 }}>
        <div className="linha quebra" style={{ gap: 10 }}>
          <Segmentado tamanho="p" valor={f.independentes} aoMudar={(v) => mudar({ independentes: v })} opcoes={[{ valor: false, rotulo: 'Todas' }, { valor: true, rotulo: 'Só independentes' }]} />
          <Segmentado tamanho="p" valor={f.abertas_meses} aoMudar={(v) => mudar({ abertas_meses: v })}
            opcoes={[{ valor: 0, rotulo: 'Qualquer abertura' }, { valor: 6, rotulo: 'Até 6 meses' }, { valor: 12, rotulo: 'Até 12 meses' }, { valor: 24, rotulo: 'Até 24 meses' }]} />
        </div>
        <div className="linha" style={{ gap: 8 }}>
          <span className="mudo pequeno">Ordenar por</span>
          <Seletor tamanho="p" valor={f.ordenar} style={{ width: 150 }} aoMudar={(v) => mudar({ ordenar: v })}
            opcoes={[{ valor: 'score', rotulo: 'Maior score' }, { valor: 'abertura', rotulo: 'Mais novas' }, { valor: 'nota', rotulo: 'Melhor nota' }, { valor: 'nome', rotulo: 'Nome' }]} />
        </div>
      </div>

      <Cartao semMargem>
        {erro && <div style={{ padding: 16 }}><ErroCarga erro={erro} aoTentar={recarregar} /></div>}
        {!dados && carregando && <Carregando altura={260} texto="Buscando farmácias…" />}
        {dados && (
          <div style={{ opacity: carregando ? 0.6 : 1, transition: 'opacity 160ms' }}>
            <Tabela
              colunas={colunas}
              linhas={dados.itens}
              chaveLinha={(l) => l.cnpj}
              aoClicarLinha={(l) => setAberto(l.cnpj)}
              selecionada={aberto}
              vazio={<Vazio icone={Search} titulo="Nenhuma farmácia com esses filtros" texto="Afrouxe os filtros de cidade, bairro ou abertura." />}
            />
            {total > 0 && (
              <div className="prosp-paginacao">
                <span>Mostrando {fmtNumero((f.pagina - 1) * POR_PAGINA + 1)} a {fmtNumero(Math.min(total, f.pagina * POR_PAGINA))} de {fmtNumero(total)}</span>
                <div className="linha g4">
                  <Botao tamanho="p" icone={ChevronLeft} disabled={f.pagina <= 1} onClick={() => mudar({ pagina: f.pagina - 1 })}>Anterior</Botao>
                  <span className="num pequeno" style={{ padding: '0 6px' }}>{f.pagina} / {fmtNumero(paginas)}</span>
                  <Botao tamanho="p" iconeDireita={ChevronRight} disabled={f.pagina >= paginas} onClick={() => mudar({ pagina: f.pagina + 1 })}>Próxima</Botao>
                </div>
              </div>
            )}
          </div>
        )}
      </Cartao>

      <Gaveta aberto={Boolean(aberto)} aoFechar={() => setAberto(null)} largura={520} titulo={det?.nome || 'Farmácia'} subtitulo={det ? `${fmtCnpj(det.cnpj)} · ${det.cidade}/${det.uf}` : null}>
        {carregandoDet && !det && <Carregando />}
        {det && det.cnpj === aberto && (
          <div style={{ margin: '-20px' }}>
            <ConteudoPonto dados={det} mostrarMapa />
          </div>
        )}
      </Gaveta>
    </div>
  );
}
