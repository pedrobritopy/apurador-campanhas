import { ArrowDownRight, Gauge, Scale, ShieldCheck } from 'lucide-react';
import { fmtData, fmtDataCurta, fmtDiaSemana, fmtNumero, fmtPerc, fmtPeriodo } from '../../lib/formato.js';
import { Cartao, Delta, Progresso, Selo } from '../../componentes/ui.jsx';
import { EXPLICA } from '../../lib/explicacoes.jsx';
import { GraficoLinha } from '../../componentes/graficos.jsx';
import { TIPO_META, fmtCrit } from './util.js';
import { useMemo } from 'react';
import { useProdutos } from '../../lib/dados.js';
import { FotoProduto } from '../../componentes/Imagens.jsx';

/** Miniaturas dos produtos do critério (amostra do motor, casada pelo nome com o cadastro). */
function AmostraProdutos({ crit }) {
  const { dados: produtos } = useProdutos();
  const itens = useMemo(() => {
    const porNome = new Map((produtos || []).map((p) => [p.nome, p.id]));
    return (crit.produtos_amostra || []).map((nome) => ({ nome, id: porNome.get(nome) })).filter((x) => x.id != null);
  }, [produtos, crit.produtos_amostra]);
  if (!itens.length) return null;
  const resto = (crit.n_produtos || 0) - itens.length;
  return (
    <div className="cmp-amostra" aria-label="Produtos do critério">
      {itens.map((x) => <FotoProduto key={x.id} id={x.id} nome={x.nome} tamanho={34} />)}
      {resto > 0 && <span className="mudo pequeno">e mais {fmtNumero(resto)}</span>}
    </div>
  );
}

function Estat({ rotulo, valor, sub, dica }) {
  return (
    <div className="cmp-estat" title={dica}>
      <span className="cmp-estat-rotulo">{rotulo}</span>
      <span className="cmp-estat-valor">{valor}</span>
      {sub && <span className="cmp-estat-sub">{sub}</span>}
    </div>
  );
}

/** Cartão de um critério: números, barra de atingimento e linha do tempo (realizado × meta × projeção). */
export default function CartaoCriterio({ crit, tempo, cheio }) {
  const tot = crit.total || {};
  const temMeta = crit.serie?.meta?.some((v) => v != null);
  const temProj = crit.serie?.projecao?.some((v) => v != null);
  const series = [{ id: 'real', nome: 'Realizado', valores: crit.serie?.realizado || [], cor: 'var(--s1)', area: true }];
  if (temMeta) series.push({ id: 'meta', nome: crit.totalizar === 'soma' ? 'Meta (ritmo ideal)' : 'Meta', valores: crit.serie.meta, cor: 'var(--tinta-3)', estilo: 'tracejada' });
  if (temProj) series.push({ id: 'proj', nome: 'Projeção', valores: crit.serie.projecao, cor: 'var(--acento)', estilo: 'tracejada' });
  const menorMelhor = crit.sentido === 'menor';

  return (
    <Cartao
      titulo={crit.nome}
      info={{ titulo: 'Como ler este critério', ...EXPLICA.criterio }}
      subtitulo={`${crit.metrica_nome} · ${crit.produtos_descricao}${crit.n_produtos ? ` · ${fmtNumero(crit.n_produtos)} ${crit.n_produtos === 1 ? 'produto' : 'produtos'}` : ''}`}
      acoes={<Selo>{TIPO_META[crit.meta_tipo] || crit.meta_tipo}</Selo>}
    >
      <AmostraProdutos crit={crit} />
      <div className="cmp-crit-estats">
        <Estat rotulo="Realizado" valor={fmtCrit(tot.realizado, crit, { compacto: true })} />
        <Estat rotulo={menorMelhor ? 'Meta (máximo)' : 'Meta'} valor={tot.meta != null ? fmtCrit(tot.meta, crit, { compacto: true }) : '-'} />
        <Estat rotulo="Atingimento" valor={fmtPerc(tot.atingimento)} />
        <Estat
          rotulo="Projeção"
          valor={tot.projecao != null ? fmtCrit(tot.projecao, crit, { compacto: true }) : '-'}
          sub={tot.atingimento_proj != null ? `${fmtPerc(tot.atingimento_proj)} da meta` : null}
        />
        <Estat
          rotulo="Período anterior"
          dica={crit.periodo_base ? `Base: ${fmtPeriodo(crit.periodo_base.inicio, crit.periodo_base.fim)}` : undefined}
          valor={fmtCrit(tot.base, crit, { compacto: true })}
          sub={tot.variacao_proj != null ? <Delta valor={tot.variacao_proj} bomQuandoSobe={!menorMelhor} sufixo="na projeção" casas={Math.abs(tot.variacao_proj) < 10 ? 1 : 0} /> : null}
        />
      </div>

      {tot.atingimento != null && (
        <Progresso valor={tot.atingimento} projecao={tot.atingimento_proj} titulo={`Atingimento ${fmtPerc(tot.atingimento)} · projeção ${fmtPerc(tot.atingimento_proj)}`} />
      )}

      <div style={{ marginTop: 16 }}>
        <GraficoLinha
          rotulos={tempo.dias}
          formatarX={fmtDataCurta}
          formatarDica={(d) => `${fmtDiaSemana(d)}, ${fmtData(d)}`}
          series={series}
          formato={crit.formato}
          altura={cheio ? 280 : 220}
          marcadorX={tempo.status === 'andamento' ? tempo.idx_ref : undefined}
          zeroBase={crit.totalizar === 'soma'}
        />
      </div>

      {(crit.peso !== 1 || crit.gatilho > 0 || crit.teto != null || menorMelhor) && (
        <div className="cmp-crit-tags">
          {crit.peso !== 1 && <Selo icone={Scale}>peso {fmtNumero(crit.peso, crit.peso % 1 ? 1 : 0)}</Selo>}
          {crit.gatilho > 0 && <Selo icone={ShieldCheck}>mínimo {fmtPerc(crit.gatilho)}</Selo>}
          {crit.teto != null && <Selo icone={Gauge}>teto {fmtPerc(crit.teto)}</Selo>}
          {menorMelhor && <Selo icone={ArrowDownRight}>quanto menor, melhor</Selo>}
        </div>
      )}
    </Cartao>
  );
}
