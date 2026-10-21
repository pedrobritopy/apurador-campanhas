import { useState } from 'react';
import { Archive, ArrowLeft, Landmark, Plus, Settings2, ShieldAlert } from 'lucide-react';
import { post, useApi } from '../../lib/api.js';
import { fmtData, fmtMoeda, fmtPerc, fmtPeriodo } from '../../lib/formato.js';
import {
  Aviso, Botao, BotaoIcone, Cabecalho, Cartao, ErroCarga, Esqueleto, Explica, Menu, Progresso, Selo, Vazio, useToast,
} from '../../componentes/ui.jsx';
import { GraficoBarras, GraficoLinha } from '../../componentes/graficos.jsx';
import Extrato from './Extrato.jsx';
import ModalConta from './ModalConta.jsx';
import ModalLancamento from './ModalLancamento.jsx';
import { EXPLICA, POLITICAS, SITUACAO_CONTA, TIPO_ALERTA } from './util.js';

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const maiuscula = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const mesCurto = (iso) => `${MESES[Number(iso.slice(5, 7)) - 1]}/${iso.slice(2, 4)}`;

export function fraseSaldo(conta, s, situacao) {
  if (conta.bloqueada) return `Conta bloqueada${conta.motivo_bloqueio ? ` (${conta.motivo_bloqueio})` : ''}. Nenhuma campanha nova usa esta verba até desbloquear.`;
  if (situacao === 'estourada') {
    return `A conta está ${fmtMoeda(-s.capacidade)} abaixo do permitido${s.limite ? `, já contando o limite de ${fmtMoeda(s.limite)}` : ''}. Campanhas novas ficam bloqueadas até entrar verba ou com exceção autorizada.`;
  }
  if (situacao === 'no_limite') return `A conta está negativa em ${fmtMoeda(-s.disponivel)}, dentro do limite de ${fmtMoeda(s.limite)}. Ainda dá para reservar ${fmtMoeda(s.capacidade)}.`;
  return `Dá para comprometer até ${fmtMoeda(s.capacidade)} em campanhas novas${s.limite ? ` (${fmtMoeda(s.disponivel)} de saldo e ${fmtMoeda(s.limite)} de limite)` : ''}.`;
}

export default function DetalheConta({ id }) {
  const toast = useToast();
  const { dados, erro, recarregar } = useApi(`/conta-corrente/contas/${id}`);
  const [lancando, setLancando] = useState(false);
  const [ajustando, setAjustando] = useState(false);
  const [versao, setVersao] = useState(0);
  const atualizar = () => { recarregar(); setVersao((v) => v + 1); };

  if (erro) return <ErroCarga erro={erro} aoTentar={recarregar} />;
  if (!dados) {
    return (
      <div className="coluna" style={{ gap: 16 }}>
        <Esqueleto altura={40} largura="40%" />
        <div className="grade-2"><Esqueleto altura={260} /><Esqueleto altura={260} /></div>
        <Esqueleto altura={320} />
      </div>
    );
  }
  const { conta, saldos: s, situacao, reservas, alertas, serie, composicao_12m: comp } = dados;
  const sit = SITUACAO_CONTA[situacao];
  const pol = POLITICAS[conta.politica];

  const subtitulo = [
    conta.perc_acordo ? `Acordo de ${String(conta.perc_acordo).replace('.', ',')}% sobre compras` : conta.propria ? 'Orçamento interno da diretoria comercial' : 'Sem acordo cadastrado',
    `ND em ${conta.prazo_nd_dias} dias`,
    `verba vale ${conta.validade_meses} ${conta.validade_meses === 1 ? 'mês' : 'meses'}`,
    conta.responsavel,
  ].filter(Boolean).join(' · ');

  const termos = [
    { rotulo: 'Recebido', valor: s.realizado, sinal: '', info: { texto: 'Créditos que já entraram (ND abatida, depósito ou mercadoria) menos o que já foi usado de verdade.' } },
    conta.politica !== 'realizado' && { rotulo: 'NDs a receber', valor: s.a_receber, sinal: '+', info: EXPLICA.a_receber },
    conta.politica === 'previsto' && { rotulo: 'Provisões', valor: s.previsto, sinal: '+', info: EXPLICA.previsto },
    { rotulo: 'Reservado', valor: s.reservado, sinal: '-', info: EXPLICA.reservado },
    s.vencido > 0 && { rotulo: 'Vencido sem uso', valor: s.vencido, sinal: '-', info: EXPLICA.vencendo },
  ].filter(Boolean);

  const baixar = async () => {
    try {
      await post(`/conta-corrente/contas/${conta.id}/baixar-vencidas`);
      toast.ok('Baixa da verba vencida lançada.');
      atualizar();
    } catch (e) {
      toast.erro(e.message);
    }
  };

  return (
    <div className="coluna pagina-entrada" style={{ gap: 18 }}>
      <Cabecalho
        sobre={<a href="#/conta-corrente" className="linha g4" style={{ display: 'inline-flex' }}><ArrowLeft size={13} /> Conta corrente</a>}
        titulo={conta.nome}
        subtitulo={subtitulo}
        info={{ texto: 'Extrato e saldos da verba deste fornecedor.', como: ['Lance aqui as NDs, bonificações, rebaixas e ações.', 'As campanhas reservam e debitam sozinhas.'] }}
        acoes={(
          <>
            <Botao icone={Settings2} onClick={() => setAjustando(true)}>Ajustar conta</Botao>
            <Botao variante="primario" icone={Plus} onClick={() => setLancando(true)}>Novo lançamento</Botao>
            {s.vencido > 0 && (
              <Menu gatilho={<BotaoIcone icone={Archive} rotulo="Mais ações" variante="padrao" />}
                itens={[{ rotulo: `Baixar verba vencida (${fmtMoeda(s.vencido)})`, icone: Archive, aoClicar: baixar }]} />
            )}
          </>
        )}
      />

      <div className="ccr-topo">
        <Cartao className="ccr-heroi" titulo="Disponível para campanhas" info={EXPLICA.disponivel}
          acoes={<Selo cor={sit.cor} icone={sit.icone}>{sit.rotulo}</Selo>}>
          <div className="coluna" style={{ gap: 14 }}>
            <div className={`ccr-valor-heroi num ${s.disponivel < 0 ? 'negativo' : ''}`}>{fmtMoeda(s.disponivel)}</div>
            <p className="ccr-frase">{fraseSaldo(conta, s, situacao)}</p>
            <div className="ccr-conta">
              {termos.map((t) => (
                <div key={t.rotulo} className="ccr-termo">
                  <span className="sinal">{t.sinal}</span>
                  <span className="r com-explica">{t.rotulo}<Explica titulo={t.rotulo} {...t.info} tamanho={12} /></span>
                  <span className="v num">{fmtMoeda(t.valor)}</span>
                </div>
              ))}
              <div className="ccr-termo total">
                <span className="sinal">=</span>
                <span className="r">Disponível</span>
                <span className="v num">{fmtMoeda(s.disponivel)}</span>
              </div>
            </div>
            <div className="linha quebra" style={{ gap: 18 }}>
              <div className="ccr-mini"><span className="r com-explica">Limite<Explica titulo="Limite" {...EXPLICA.limite} tamanho={12} /></span><span className="v num">{fmtMoeda(s.limite)}</span></div>
              <div className="ccr-mini"><span className="r com-explica">Provisões fora do saldo<Explica titulo="Provisões" {...EXPLICA.previsto} tamanho={12} /></span><span className="v num">{fmtMoeda(conta.politica === 'previsto' ? 0 : s.previsto)}</span></div>
              {s.vencendo > 0 && <div className="ccr-mini"><span className="r com-explica">Vence até {fmtData(s.proximo_vencimento)}<Explica titulo="Verba vencendo" {...EXPLICA.vencendo} tamanho={12} /></span><span className="v num">{fmtMoeda(s.vencendo)}</span></div>}
            </div>
            <div className="mudo mini">Política: {pol?.rotulo}. {pol?.texto}</div>
          </div>
        </Cartao>

        <Cartao titulo="Evolução do saldo" subtitulo="Fim de cada mês" info={EXPLICA.evolucao}>
          <GraficoLinha rotulos={serie.map((p) => p.data)} formatarX={mesCurto} formatarDica={(r) => fmtData(r)} formato="moeda" altura={250}
            series={[
              { id: 'realizado', nome: 'Saldo recebido', valores: serie.map((p) => p.realizado), cor: 'var(--s1)', area: true },
              { id: 'confirmado', nome: 'Com NDs a receber', valores: serie.map((p) => p.confirmado), cor: 'var(--s2)' },
            ]} />
        </Cartao>
      </div>

      {alertas.length > 0 && (
        <Cartao titulo="O que pede ação" info={EXPLICA.alertas}>
          <div className="coluna" style={{ gap: 8 }}>
            {alertas.map((a, i) => {
              const t = TIPO_ALERTA[a.tipo] || TIPO_ALERTA.info;
              return (
                <div key={i} className="ccr-alerta">
                  <Selo cor={t.cor} icone={t.icone}>{t.rotulo}</Selo>
                  <span className="cresce">{maiuscula(a.texto.replace(`${conta.nome}: `, ''))}</span>
                  {a.id_campanha && <a className="pequeno" href={`#/campanhas/${a.id_campanha}`}>Abrir campanha</a>}
                </div>
              );
            })}
          </div>
        </Cartao>
      )}

      <div className="grade-2">
        <Cartao titulo="Reservas por campanha" info={EXPLICA.reservas} subtitulo={reservas.length ? `${reservas.length} ${reservas.length === 1 ? 'campanha segurando' : 'campanhas segurando'} ${fmtMoeda(s.reservado)}` : 'Nenhuma campanha ativa usa esta conta'}>
          {reservas.length ? (
            <div className="coluna" style={{ gap: 14 }}>
              {reservas.map((r) => {
                const futura = r.inicio && r.inicio > new Date().toISOString().slice(0, 10);
                const uso = !futura && r.projetado != null && r.reservado > 0 ? (r.projetado / r.reservado) * 100 : null;
                return (
                  <div key={r.id_lancamento} className="coluna" style={{ gap: 6 }}>
                    <div className="linha entre" style={{ gap: 8 }}>
                      <a href={`#/campanhas/${r.id_campanha}`} className="forte truncar">{r.nome}</a>
                      <span className="num forte">{fmtMoeda(r.reservado)}</span>
                    </div>
                    {uso != null && <Progresso valor={uso} cor={uso > 100 ? 'critico' : uso > 90 ? 'aviso' : 'neutro'} espessura="p" titulo="Prêmio projetado sobre a reserva" />}
                    <div className="linha entre quebra mini mudo" style={{ gap: 6 }}>
                      <span>{r.inicio ? fmtPeriodo(r.inicio, r.fim) : ''}{futura ? ` · começa em ${fmtData(r.inicio)}, reserva estimada` : r.projetado != null ? ` · prêmio projetado ${fmtMoeda(r.projetado)} (${fmtPerc(uso)} da reserva)` : ''}</span>
                      {r.excecao && (
                        <span className="linha g4"><ShieldAlert size={12} /> Exceção<Explica titulo="Exceção autorizada" texto={r.justificativa} exemplo={r.autorizado_por ? `Autorizado por: ${r.autorizado_por}` : undefined} tamanho={12} /></span>
                      )}
                    </div>
                    {r.base && <div className="mini mudo">{r.base}</div>}
                  </div>
                );
              })}
            </div>
          ) : <Vazio icone={Landmark} titulo="Sem reservas" texto="Quando uma campanha deste fornecedor for ativada, a verba dela aparece aqui." />}
        </Cartao>

        <Cartao titulo="De onde veio e para onde foi" subtitulo="Últimos 12 meses, só realizados" info={EXPLICA.composicao}>
          {comp.length ? (
            <div className="coluna" style={{ gap: 16 }}>
              <div className="coluna" style={{ gap: 8 }}>
                <span className="ccr-rot">Entradas</span>
                <GraficoBarras formato="moeda" largRotulo={170} corPadrao="var(--s1)" itens={comp.filter((c) => c.creditos > 0).map((c) => ({ rotulo: c.rotulo, valor: c.creditos }))} />
              </div>
              <div className="coluna" style={{ gap: 8 }}>
                <span className="ccr-rot">Saídas</span>
                <GraficoBarras formato="moeda" largRotulo={170} corPadrao="var(--s2)" itens={comp.filter((c) => c.debitos > 0).map((c) => ({ rotulo: c.rotulo, valor: c.debitos }))} />
              </div>
            </div>
          ) : <Vazio titulo="Sem movimento realizado" />}
        </Cartao>
      </div>

      {conta.observacao && <Aviso tipo="info">{conta.observacao}</Aviso>}

      <Extrato key={versao} idConta={conta.id} aoMudar={recarregar} />

      <ModalLancamento aberto={lancando} conta={conta} aoFechar={() => setLancando(false)} aoSalvar={atualizar} />
      <ModalConta aberto={ajustando} conta={conta} aoFechar={() => setAjustando(false)} aoSalvar={atualizar} />
      
    </div>
  );
}
