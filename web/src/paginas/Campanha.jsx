import { useMemo, useState } from 'react';
import {
  AlertTriangle, Camera, CalendarClock, ChevronRight, Copy, Download, History, Lock, Megaphone, MoreHorizontal, Package,
  Pencil, RotateCcw, Trophy, Users,
} from 'lucide-react';
import { baixar, post, qs, useApi } from '../lib/api.js';
import { definirQuery, navegar } from '../lib/rotas.js';
import { fmtData, fmtDataHora, fmtPeriodo } from '../lib/formato.js';
import {
  Abas, Aviso, Botao, BotaoIcone, Cabecalho, Campo, Entrada, ErroCarga, Esqueleto, Explica, Menu, Modal, Progresso, Selo, SeloCampanha, useToast,
} from '../componentes/ui.jsx';
import { EXPLICA } from '../lib/explicacoes.jsx';
import Heroi, { KpisApuracao } from './campanha/Heroi.jsx';
import CartaoCriterio from './campanha/CartaoCriterio.jsx';
import Ranking from './campanha/Ranking.jsx';
import Equipes from './campanha/Equipes.jsx';
import Estoque from './campanha/Estoque.jsx';
import Fotografias from './campanha/Fotografias.jsx';
import GavetaParticipante from './campanha/GavetaParticipante.jsx';
import { useAcoesCampanha } from './campanha/acoes.jsx';
import { corDaCampanha, textoTempo } from './campanha/util.js';
import './campanha/campanha.css';

const ROTULO_GRUPOS = { vendedor: 'Equipes', cliente: 'Cidades', canal: 'Tipos de canal' };

function EsqueletoApuracao() {
  return (
    <div className="coluna" style={{ gap: 16 }}>
      <Esqueleto altura={30} largura="40%" />
      <div className="cartao" style={{ padding: 24 }}><Esqueleto altura={150} /></div>
      <div className="grade-4">{[0, 1, 2, 3].map((i) => <div key={i} className="cartao" style={{ padding: 18 }}><Esqueleto altura={60} /></div>)}</div>
      <div className="cartao" style={{ padding: 18 }}><Esqueleto altura={260} /></div>
    </div>
  );
}

export default function Campanha({ params, query, status }) {
  const id = params.id;
  const toast = useToast();
  const aba = query.get('aba') || 'ranking';
  const referencia = query.get('referencia') || undefined;
  const recalcular = query.get('recalcular') === '1';
  const fotografia = query.get('fotografia');
  const participante = query.get('participante');
  const grupo = query.get('grupo') || '';

  const caminho = fotografia ? `/fotografias/${fotografia}` : `/campanhas/${id}/apuracao${qs({ referencia, recalcular: recalcular ? 1 : undefined, comparar: 7 })}`;
  const { dados: ap, erro, carregando, recarregar } = useApi(caminho, { vivo: true });
  const { dados: info, recarregar: recarregarInfo } = useApi(`/campanhas/${id}`);
  const [modalFoto, setModalFoto] = useState(false);
  const [obsFoto, setObsFoto] = useState('');
  const [salvandoFoto, setSalvandoFoto] = useState(false);
  const [versaoFotos, setVersaoFotos] = useState(0);

  const camp = useMemo(
    () => ({ id, nome: ap?.campanha?.nome || info?.definicao?.nome || 'Campanha', status: ap?.status_campanha || info?.status || 'ativa', fornecedor: ap?.campanha?.fornecedor }),
    [id, ap, info],
  );
  const { acoes, itensMenu, dialogo } = useAcoesCampanha({
    aoMudar: () => {
      recarregar();
      recarregarInfo();
    },
  });

  const fotografar = async () => {
    setSalvandoFoto(true);
    try {
      await post(`/campanhas/${id}/fotografias`, { observacao: obsFoto.trim() || null, referencia });
      toast.ok('Fotografia salva. Ela fica disponível na aba Fotografias.');
      setModalFoto(false);
      setObsFoto('');
      setVersaoFotos((v) => v + 1);
    } catch (e) {
      toast.erro(e.message);
    } finally {
      setSalvandoFoto(false);
    }
  };

  if (erro && !ap) {
    return (
      <div>
        <Cabecalho sobre={<a href="#/campanhas">Campanhas</a>} titulo="Apuração" />
        <ErroCarga erro={erro} aoTentar={recarregar} />
      </div>
    );
  }
  if (!ap) return <EsqueletoApuracao />;

  const t = ap.tempo;
  const c = ap.campanha;
  const nivel = c.participantes?.nivel;
  const temGrupos = new Set(ap.participantes.map((l) => l.grupo).filter(Boolean)).size > 1;
  const cor = corDaCampanha({ ...c, id }, 0);
  const abas = [
    { id: 'ranking', rotulo: 'Ranking', icone: Trophy, contador: ap.participantes.length },
    temGrupos && { id: 'equipes', rotulo: ROTULO_GRUPOS[nivel] || 'Grupos', icone: Users },
    { id: 'estoque', rotulo: 'Produtos e estoque', icone: Package },
    { id: 'fotografias', rotulo: 'Fotografias', icone: History },
    ap.avisos?.length > 0 && { id: 'avisos', rotulo: 'Avisos', icone: AlertTriangle, contador: ap.avisos.length },
  ].filter(Boolean);
  const abaAtiva = abas.some((a) => a.id === aba) ? aba : 'ranking';
  const encerrada = camp.status === 'encerrada';

  return (
    <div>
      <Cabecalho
        sobre={
          <>
            <a href="#/campanhas">Campanhas</a>
            <ChevronRight size={12} />
            <span>{c.fornecedor || 'Sem fornecedor'}</span>
          </>
        }
        titulo={
          <span className="linha" style={{ gap: 10 }}>
            <span className="cmp-ponto-cor" style={{ background: cor, width: 12, height: 12, borderRadius: 4 }} />
            {c.nome}
          </span>
        }
        subtitulo={
          <span className="linha quebra" style={{ gap: 8 }}>
            <SeloCampanha status={camp.status} tempo={t.status} />
            {ap.congelada && <Selo cor="bom" icone={Lock}>Apuração congelada</Selo>}
            <span className="sec">{fmtPeriodo(t.inicio, t.fim)}</span>
            <span className="mudo">·</span>
            <span className="sec">{c.nivel_rotulo}</span>
            {c.descricao && <span className="mudo truncar" style={{ maxWidth: 420 }} title={c.descricao}>· {c.descricao}</span>}
          </span>
        }
        acoes={
          <>
            <Botao icone={Download} onClick={() => baixar(`/campanhas/${id}/excel`)}>Excel</Botao>
            <Botao variante="primario" icone={Megaphone} onClick={() => navegar(`/acompanhamentos?campanha=${id}`)}>Acompanhar</Botao>
            <Menu
              gatilho={<BotaoIcone icone={MoreHorizontal} rotulo="Mais ações" variante="padrao" />}
              itens={[
                { rotulo: 'Editar campanha', icone: Pencil, aoClicar: () => acoes.editar(camp) },
                { rotulo: 'Duplicar', icone: Copy, aoClicar: () => acoes.duplicar(camp) },
                { rotulo: 'Fotografar agora', icone: Camera, aoClicar: () => setModalFoto(true) },
                '-',
                ...itensMenu(camp, { semAbrir: true, depoisExcluir: () => navegar('/campanhas') }).filter((i) => i !== '-' && !['Editar', 'Duplicar'].includes(i.rotulo)),
              ]}
            />
          </>
        }
      />

      <div className="cmp-faixa-tempo">
        <span className="linha g4 sec pequeno">
          <CalendarClock size={14} />
          {textoTempo(t)}
        </span>
        {t.status !== 'futura' && <Progresso valor={(t.progresso || 0) * 100} cor="tempo" espessura="p" titulo="Tempo decorrido" />}
        <div className="cresce" />
        {!fotografia && t.status !== 'futura' && (
          <span className="cmp-referencia pequeno sec">
            Posição em
            <Explica titulo="Posição em uma data" {...EXPLICA.posicaoEm} tamanho={13} />
            <input
              type="date"
              className="entrada p"
              value={referencia || (t.referencia && t.referencia > t.fim ? t.fim : t.referencia) || ''}
              min={t.inicio}
              max={status?.hoje && status.hoje < t.fim ? status.hoje : t.fim}
              onChange={(e) => definirQuery({ referencia: e.target.value || null, participante: null })}
            />
            {referencia && <Botao tamanho="p" variante="fantasma" icone={RotateCcw} onClick={() => definirQuery({ referencia: null })}>Hoje</Botao>}
          </span>
        )}
      </div>

      {fotografia && (
        <Aviso tipo="info" titulo="Você está vendo uma fotografia" className="cmp-bloco"
          acao={<Botao tamanho="p" onClick={() => definirQuery({ fotografia: null })}>Voltar ao vivo</Botao>}>
          Apuração congelada com dados até {fmtData(ap.tempo?.referencia)}{ap.gerado_em ? `, gerada em ${fmtDataHora(ap.gerado_em)}` : ''}.
        </Aviso>
      )}
      {!fotografia && ap.congelada && (
        <Aviso tipo="info" titulo="Apuração oficial congelada no fechamento" className="cmp-bloco"
          acao={<Botao tamanho="p" icone={RotateCcw} onClick={() => definirQuery({ recalcular: 1 })}>Recalcular com dados atuais</Botao>}>
          Este é o resultado registrado ao encerrar a campanha{ap.fotografia?.criado_em ? ` (${fmtDataHora(ap.fotografia.criado_em)})` : ''}. Mudanças posteriores nos dados não o alteram.
        </Aviso>
      )}
      {!fotografia && recalcular && encerrada && (
        <Aviso tipo="aviso" titulo="Recálculo com os dados atuais" className="cmp-bloco"
          acao={<Botao tamanho="p" onClick={() => definirQuery({ recalcular: null })}>Ver apuração oficial</Botao>}>
          Esta visão é só para conferência. A apuração oficial continua sendo a fotografia de fechamento.
        </Aviso>
      )}
      {referencia && !fotografia && (
        <Aviso tipo="info" className="cmp-bloco" titulo={`Posição em ${fmtData(referencia)}`}
          acao={<Botao tamanho="p" onClick={() => definirQuery({ referencia: null })}>Voltar para hoje</Botao>}>
          Os números mostram a campanha como estava nesta data, com a projeção calculada a partir dela.
        </Aviso>
      )}

      <div style={{ opacity: carregando ? 0.62 : 1, transition: 'opacity 200ms' }}>
        <div className="coluna" style={{ gap: 16, marginBottom: 24 }}>
          <Heroi ap={ap} />
          <KpisApuracao ap={ap} />
        </div>

        <div className="cmp-criterios" style={{ marginBottom: 28 }}>
          {ap.criterios.map((crit) => (
            <CartaoCriterio key={crit.id} crit={crit} tempo={t} cheio={ap.criterios.length === 1} />
          ))}
        </div>

        <Abas abas={abas} ativa={abaAtiva} aoMudar={(a) => definirQuery({ aba: a === 'ranking' ? null : a })} />

        {abaAtiva === 'ranking' && (
          <Ranking ap={ap} selecionada={participante} aoAbrir={(k) => definirQuery({ participante: k })}
            grupo={grupo} aoMudarGrupo={(g) => definirQuery({ grupo: g || null })} />
        )}
        {abaAtiva === 'equipes' && <Equipes ap={ap} aoFiltrar={(g) => definirQuery({ aba: null, grupo: g })} />}
        {abaAtiva === 'estoque' && <Estoque idCampanha={id} />}
        {abaAtiva === 'fotografias' && <Fotografias key={versaoFotos} idCampanha={id} atual={fotografia} aoFotografar={() => setModalFoto(true)} />}
        {abaAtiva === 'avisos' && (
          <div className="coluna" style={{ gap: 8 }}>
            {ap.avisos.map((a, i) => <Aviso key={i} tipo="aviso">{a}</Aviso>)}
          </div>
        )}
      </div>

      <GavetaParticipante idCampanha={id} chave={participante} ap={ap} referencia={referencia} aoFechar={() => definirQuery({ participante: null })} />

      <Modal
        aberto={modalFoto}
        aoFechar={() => setModalFoto(false)}
        titulo="Fotografar a apuração"
        subtitulo={`Congela os números como estão agora (dados até ${fmtData(t.referencia)}).`}
        largura={520}
        rodape={
          <>
            <Botao onClick={() => setModalFoto(false)}>Cancelar</Botao>
            <Botao variante="primario" icone={Camera} carregando={salvandoFoto} onClick={fotografar}>Salvar fotografia</Botao>
          </>
        }
      >
        <Campo rotulo="Observação (opcional)" ajuda="Ex.: posição apresentada na reunião de segunda; fechamento parcial da 1ª quinzena.">
          <Entrada value={obsFoto} onChange={(e) => setObsFoto(e.target.value)} placeholder="Para que serve esta fotografia?" autoFocus
            onKeyDown={(e) => e.key === 'Enter' && fotografar()} />
        </Campo>
      </Modal>
      {dialogo}
    </div>
  );
}
