import { Award, Boxes, Coins, ListOrdered, Medal, Plus, Sparkles, Target, Trash2, Trophy, Wallet, Zap } from 'lucide-react';
import { Alternador, Aviso, Botao, BotaoIcone, Campo, Entrada, Explica, Menu, Progresso, Segmentado, Seletor } from '../../componentes/ui.jsx';
import { EntradaNumero } from './campos.jsx';
import { fmtMoeda, fmtNumero, fmtPerc } from '../../lib/formato.js';
import { FAIXAS_PADRAO, frasesPremiacao, medidaBase } from './util.js';
import SaldoContaCorrente from '../contacorrente/SaldoContaCorrente.jsx';

const PRESETS = [
  { rotulo: 'Escada 90 / 100 / 120%', faixas: FAIXAS_PADRAO },
  { rotulo: 'Tudo ou nada (100%)', faixas: () => [{ min: 100, fixo: 200, variavel: 0, rotulo: 'Meta' }] },
  { rotulo: 'Acelerador por unidade', faixas: () => [
    { min: 80, fixo: 0, variavel: 0.3, rotulo: '80%' },
    { min: 100, fixo: 0, variavel: 0.5, rotulo: '100%' },
    { min: 120, fixo: 0, variavel: 0.8, rotulo: '120%' },
  ] },
  { rotulo: 'Fixo + variável', faixas: () => [
    { min: 90, fixo: 100, variavel: 0, rotulo: 'Quase lá' },
    { min: 100, fixo: 200, variavel: 0.5, rotulo: 'Meta' },
    { min: 120, fixo: 350, variavel: 0.8, rotulo: 'Supermeta' },
  ] },
];

const POSICOES_PADRAO = () => [{ de: 1, ate: 1, valor: 500 }, { de: 2, ate: 2, valor: 300 }, { de: 3, ate: 3, valor: 200 }];
const comPosicoes = (pr) => (pr.ranking.posicoes.length ? pr.ranking : { ...pr.ranking, posicoes: POSICOES_PADRAO() });

/** Formatos de prêmio mais comuns, prontos para ajustar. `ativo` reconhece o formato atual. */
const RAPIDOS = [
  {
    id: 'meta', icone: Target, titulo: 'Bateu a meta, ganhou', texto: 'Valor fixo para quem fizer 100% da meta.',
    ativo: (pr) => pr.tipo === 'faixas' && pr.faixas.length === 1,
    aplicar: (pr) => ({ ...pr, tipo: 'faixas', faixas: [{ min: 100, fixo: 150, variavel: 0, rotulo: 'Meta' }] }),
  },
  {
    id: 'bloco', icone: Boxes, titulo: 'A cada 15 un, R$ 10', texto: 'Ganha por bloco vendido. Não precisa de meta.',
    ativo: (pr) => pr.tipo === 'bloco' && pr.bloco.tamanho > 1,
    aplicar: (pr) => ({ ...pr, tipo: 'bloco', bloco: { ...pr.bloco, tamanho: 15, valor: 10, sobre: 'total', exigencia: 'nenhuma', minimo: 0 } }),
  },
  {
    id: 'unidade', icone: Coins, titulo: 'Valor por unidade vendida', texto: 'Ex.: R$ 0,50 por unidade, do primeiro item em diante.',
    ativo: (pr) => pr.tipo === 'bloco' && pr.bloco.tamanho === 1,
    aplicar: (pr) => ({ ...pr, tipo: 'bloco', bloco: { ...pr.bloco, tamanho: 1, valor: 0.5, sobre: 'total', exigencia: 'nenhuma', minimo: 0 } }),
  },
  {
    id: 'escada', icone: Award, titulo: 'Escada de faixas', texto: '90%, 100% e 120% da meta. Cada degrau paga mais.',
    ativo: (pr) => pr.tipo === 'faixas' && pr.faixas.length > 1,
    aplicar: (pr) => ({ ...pr, tipo: 'faixas', faixas: FAIXAS_PADRAO() }),
  },
  {
    id: 'ranking', icone: Trophy, titulo: 'Ranking dos melhores', texto: '1º, 2º e 3º lugar levam prêmio.',
    ativo: (pr) => pr.tipo === 'ranking' && !pr.bonus?.ativo,
    aplicar: (pr) => ({ ...pr, tipo: 'ranking', ranking: comPosicoes(pr), bonus: { ...pr.bonus, ativo: false } }),
  },
  {
    id: 'ranking_meta', icone: Medal, titulo: 'Ranking + prêmio por meta', texto: 'Pódio premiado e quem bater a meta também ganha.',
    ativo: (pr) => pr.tipo === 'ranking' && pr.bonus?.ativo,
    aplicar: (pr) => ({ ...pr, tipo: 'ranking', ranking: comPosicoes(pr), bonus: { ativo: true, min: 100, valor: pr.bonus?.valor || 50 } }),
  },
  {
    id: 'rateio', icone: Wallet, titulo: 'Verba dividida', texto: 'Um valor total repartido entre quem bater a meta.',
    ativo: (pr) => pr.tipo === 'rateio',
    aplicar: (pr) => ({ ...pr, tipo: 'rateio' }),
  },
];

const INFO_TIPO = {
  titulo: 'Tipos de prêmio',
  texto: 'Escolha como o dinheiro é calculado. Dá para combinar com o "prêmio para quem bater a meta" e com aceleradores.',
  como: [
    'Faixas: a pessoa ganha conforme quanto da meta fez (ex.: 100% paga R$ 150, 120% paga R$ 250).',
    'A cada N vendas: ganha um valor a cada bloco vendido (ex.: R$ 10 a cada 15 unidades). Funciona sem meta.',
    'Ranking: os primeiros colocados ganham (ex.: 1º R$ 500, 2º R$ 300).',
    'Rateio: uma verba fechada é dividida entre quem bater a meta.',
  ],
};

export default function EditorPremiacao({ def, aoMudar, catalogo, previa, idCampanha }) {
  const pr = def.premiacao;
  const set = (k, v) => aoMudar({ ...pr, [k]: v });
  const { info: infoBase, porUnidade, semMeta } = medidaBase(def, catalogo);
  const unidade = infoBase.formato === 'moeda' ? 'R$' : infoBase.unidade || 'un';
  const opCrit = def.criterios.map((c) => ({ valor: c.id, rotulo: `${c.id} · ${c.nome || catalogo?.metricas?.[c.metrica]?.nome || c.metrica}` }));
  const frases = frasesPremiacao(def, catalogo);
  const resumo = previa?.resumo;
  const premiados = previa?.participantes?.filter((p) => p.premio_proj > 0).length ?? null;
  const maiores = (previa?.participantes || []).filter((p) => p.premio_proj > 0).sort((a, b) => b.premio_proj - a.premio_proj).slice(0, 5);

  const mudarFaixa = (i, k, v) => set('faixas', pr.faixas.map((f, j) => (j === i ? { ...f, [k]: v } : f)));
  const mudarPos = (i, k, v) => set('ranking', { ...pr.ranking, posicoes: pr.ranking.posicoes.map((p, j) => (j === i ? { ...p, [k]: v } : p)) });
  const mudarMult = (i, k, v) => set('multiplicadores', pr.multiplicadores.map((m, j) => (j === i ? { ...m, [k]: v } : m)));
  const setBloco = (k, v) => set('bloco', { ...pr.bloco, [k]: v });
  const setBonus = (k, v) => set('bonus', { ...pr.bonus, [k]: v });
  const seletorBase = opCrit.length > 1 && (
    <div style={{ width: 230 }}>
      <Seletor tamanho="p" valor={pr.criterio_base} aoMudar={(v) => set('criterio_base', v)} opcoes={opCrit} title="Critério que conta para o prêmio" />
    </div>
  );

  return (
    <div className="coluna" style={{ gap: 16 }}>
      <div className="prem-regra" aria-live="polite">
        <span className="cons-subcampo-titulo">
          <Sparkles size={13} /> Como o prêmio vai funcionar
          <Explica titulo="Resumo da regra" texto="Este quadro reescreve, em português simples, o que você configurou abaixo. É o mesmo texto que vai para o regulamento. Se a frase não disser o que você quer, ajuste os campos." />
        </span>
        <ul>{frases.map((f, i) => <li key={i}>{f}</li>)}</ul>
      </div>

      <div className="coluna" style={{ gap: 8 }}>
        <span className="cons-subcampo-titulo">
          Comece por um formato pronto
          <Explica titulo="Formatos prontos" texto="Atalhos para os prêmios mais usados pelas indústrias. Um clique preenche tudo; depois é só trocar os valores." exemplo="Campanha simples de balcão: escolha 'A cada 15 un, R$ 10' e mude para os números do fornecedor." />
        </span>
        <div className="prem-rapidos">
          {RAPIDOS.map((r) => (
            <button key={r.id} type="button" className={`prem-rapido${r.ativo(pr) ? ' ativo' : ''}`} aria-pressed={r.ativo(pr)} onClick={() => aoMudar(r.aplicar(pr))}>
              <r.icone size={16} />
              <span><span className="t">{r.titulo}</span><span className="d">{r.texto}</span></span>
            </button>
          ))}
        </div>
      </div>

      <div className="coluna" style={{ gap: 8 }}>
        <span className="cons-subcampo-titulo">Ou escolha o tipo e ajuste os valores <Explica {...INFO_TIPO} /></span>
        <Segmentado valor={pr.tipo} aoMudar={(v) => aoMudar(v === 'ranking' ? { ...pr, tipo: v, ranking: comPosicoes(pr) } : { ...pr, tipo: v })}
          opcoes={[
            { valor: 'faixas', rotulo: 'Faixas de meta', icone: Award, dica: 'Prêmio conforme quanto da meta a pessoa fez.' },
            { valor: 'bloco', rotulo: 'A cada N vendas', icone: Boxes, dica: 'Valor a cada bloco vendido (ex.: R$ 10 a cada 15 un).' },
            { valor: 'ranking', rotulo: 'Ranking', icone: Trophy, dica: 'Prêmio por posição (1º, 2º, 3º...).' },
            { valor: 'rateio', rotulo: 'Rateio de verba', icone: Coins, dica: 'Valor fechado dividido entre quem bater a meta.' },
            { valor: 'nenhuma', rotulo: 'Sem prêmio', dica: 'Só acompanhamento.' },
          ]} />
      </div>

      {pr.tipo === 'faixas' && (
        <div className="coluna" style={{ gap: 10 }}>
          <div className="linha entre quebra">
            <span className="cons-ajuda">
              Quanto da meta a pessoa fez define a faixa. Vale só a maior faixa alcançada.
              <Explica titulo="Faixas de meta" texto="Cada linha é um degrau. 'A partir de' é o % da meta; o prêmio fixo é pago a quem chegar no degrau; o valor por unidade multiplica o que a pessoa vendeu."
                como={['Use um degrau só para "bateu, ganhou".', 'Use 2 ou 3 degraus para premiar mais quem vai além.', 'O valor por unidade é opcional: deixe 0 para prêmio só fixo.']}
                exemplo="Meta de 100 un. Faixa 100%: R$ 150. Faixa 120%: R$ 250. Quem vende 125 un ganha R$ 250 (não soma com a faixa de 100%)." />
            </span>
            <Menu gatilho={<Botao tamanho="p" variante="fantasma" icone={Sparkles}>Modelos de faixa</Botao>}
              itens={PRESETS.map((p) => ({ rotulo: p.rotulo, aoClicar: () => set('faixas', p.faixas()) }))} />
          </div>
          <table className="cons-tabela">
            <thead>
              <tr>
                <th>Nome da faixa</th>
                <th>A partir de (% da meta)</th>
                <th>Prêmio fixo</th>
                <th>Mais R$ por {porUnidade}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {pr.faixas.map((f, i) => (
                <tr key={i}>
                  <td><Entrada tamanho="p" value={f.rotulo || ''} placeholder={`Faixa ${i + 1}`} onChange={(e) => mudarFaixa(i, 'rotulo', e.target.value)} /></td>
                  <td style={{ width: 120 }}><EntradaNumero tamanho="p" valor={f.min} aoMudar={(v) => mudarFaixa(i, 'min', v ?? 0)} sufixo="%" /></td>
                  <td style={{ width: 140 }}><EntradaNumero tamanho="p" valor={f.fixo} aoMudar={(v) => mudarFaixa(i, 'fixo', v ?? 0)} sufixo="R$" /></td>
                  <td style={{ width: 170 }}><EntradaNumero tamanho="p" valor={f.variavel} aoMudar={(v) => mudarFaixa(i, 'variavel', v ?? 0)} sufixo="R$" /></td>
                  <td style={{ width: 34 }}><BotaoIcone icone={Trash2} tamanho="p" rotulo="Remover faixa" onClick={() => set('faixas', pr.faixas.filter((_, j) => j !== i))} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="linha quebra" style={{ gap: 10 }}>
            <Botao tamanho="p" icone={Plus} onClick={() => {
              const ult = pr.faixas[pr.faixas.length - 1];
              set('faixas', [...pr.faixas, { min: (ult?.min ?? 90) + 10, fixo: Math.round((ult?.fixo ?? 100) * 1.5), variavel: ult?.variavel ?? 0, rotulo: '' }]);
            }}>Faixa</Botao>
            <span className="cresce" />
            {pr.faixas.some((f) => f.variavel > 0) && (
              <>
                {seletorBase}
                <Segmentado tamanho="p" valor={pr.variavel_sobre} aoMudar={(v) => set('variavel_sobre', v)}
                  opcoes={[{ valor: 'total', rotulo: 'Sobre tudo que vender' }, { valor: 'excedente', rotulo: 'Só o que passar da meta' }]} />
              </>
            )}
          </div>
        </div>
      )}

      {pr.tipo === 'bloco' && (
        <div className="coluna" style={{ gap: 12 }}>
          <div className="prem-frase">
            <span>A cada</span>
            <EntradaNumero tamanho="p" valor={pr.bloco.tamanho} aoMudar={(v) => setBloco('tamanho', v && v > 0 ? v : 1)} sufixo={unidade} />
            <span>{pr.bloco.sobre === 'excedente' ? 'acima da meta, ' : ''}o {def.participantes?.nivel === 'equipe' ? 'time' : 'vendedor'} ganha</span>
            <EntradaNumero tamanho="p" valor={pr.bloco.valor} aoMudar={(v) => setBloco('valor', v ?? 0)} sufixo="R$" />
            {seletorBase && <span>contando</span>}
            {seletorBase}
            <Explica titulo="Prêmio a cada N vendas" texto="Conta quantos blocos completos a pessoa fechou e paga o valor de cada bloco. O que sobra de um bloco incompleto ainda não paga."
              como={['Informe o tamanho do bloco (ex.: 15 unidades) e quanto vale cada um.', 'Para pagar por unidade, use bloco de 1.', 'Não precisa de meta, a menos que você exija a meta para começar a ganhar.']}
              exemplo="A cada 15 un, R$ 10. Quem vende 47 un fecha 3 blocos (45 un) e ganha R$ 30. Faltam 13 un para o 4º bloco." />
          </div>
          <div className="cons-linha">
            <Campo rotulo="O que conta" info={{ texto: 'Escolha se todos os itens vendidos contam ou só o que passar da meta de cada um.', exemplo: 'Meta 60 un, vendeu 90. "Tudo": 90 un contam (6 blocos de 15). "Só o que passar": 30 un contam (2 blocos).' }}>
              <Segmentado tamanho="p" valor={pr.bloco.sobre} aoMudar={(v) => setBloco('sobre', v)}
                opcoes={[{ valor: 'total', rotulo: 'Tudo que vender' }, { valor: 'excedente', rotulo: 'Só o que passar da meta' }]} />
            </Campo>
            <Campo rotulo="Para começar a ganhar" info={{ texto: 'Uma exigência mínima antes de os blocos começarem a pagar. Depois de cumprida, todos os blocos contam, inclusive os anteriores.', exemplo: '"Vender um mínimo" de 60 un: quem vende 50 un não ganha nada; quem vende 61 un ganha 4 blocos.' }}>
              <Segmentado tamanho="p" valor={pr.bloco.exigencia}
                aoMudar={(v) => set('bloco', { ...pr.bloco, exigencia: v, minimo: v === 'meta' ? 100 : v === 'quantidade' ? Math.max(pr.bloco.tamanho * 2, 1) : 0 })}
                opcoes={[{ valor: 'nenhuma', rotulo: 'Sem exigência' }, { valor: 'quantidade', rotulo: 'Vender um mínimo' }, { valor: 'meta', rotulo: 'Atingir a meta' }]} />
            </Campo>
            {pr.bloco.exigencia !== 'nenhuma' && (
              <Campo rotulo={pr.bloco.exigencia === 'meta' ? 'Quanto da meta' : 'Mínimo para começar'}>
                <EntradaNumero valor={pr.bloco.minimo} aoMudar={(v) => setBloco('minimo', v ?? 0)} sufixo={pr.bloco.exigencia === 'meta' ? '%' : unidade} />
              </Campo>
            )}
            <Campo rotulo="Limite de blocos por pessoa" dica="Opcional. Para a premiação não passar de um valor por pessoa. Vazio = sem limite.">
              <EntradaNumero valor={pr.bloco.max_blocos} aoMudar={(v) => setBloco('max_blocos', v == null ? null : Math.max(0, Math.round(v)))} placeholder="sem limite"
                sufixo={pr.bloco.max_blocos != null ? `= ${fmtMoeda(pr.bloco.max_blocos * pr.bloco.valor)}` : undefined} />
            </Campo>
          </div>
          {semMeta && (pr.bloco.exigencia === 'meta' || pr.bloco.sobre === 'excedente') && (
            <Aviso tipo="aviso">O critério está "sem meta". Para exigir a meta ou contar só o excedente, defina uma meta na etapa de critérios.</Aviso>
          )}
          <BonusMeta pr={pr} setBonus={setBonus} semMeta={semMeta} texto="Soma com o que a pessoa ganhou nos blocos." />
        </div>
      )}

      {pr.tipo === 'ranking' && (
        <div className="coluna" style={{ gap: 12 }}>
          <div className="cons-linha">
            <Campo rotulo="Ordenar por" info={{ texto: 'Define quem fica na frente.', como: ['Pontuação: quem fez mais % da meta. Justo quando as metas são diferentes.', 'Realizado: quem vendeu mais, em números absolutos. Não precisa de meta.'], exemplo: 'Ana vendeu 80 de uma meta de 50 (160%) e Bruno 120 de 150 (80%). Por pontuação Ana fica em 1º; por realizado, Bruno.' }}>
              <Segmentado valor={pr.ranking.por} aoMudar={(v) => set('ranking', { ...pr.ranking, por: v })}
                opcoes={[{ valor: 'score', rotulo: 'Pontuação (% da meta)' }, { valor: 'realizado', rotulo: 'Quem vendeu mais' }]} />
            </Campo>
            {pr.ranking.por === 'realizado' && opCrit.length > 1 && (
              <Campo rotulo="Vendas de">
                <Seletor valor={pr.criterio_base} aoMudar={(v) => set('criterio_base', v)} opcoes={opCrit} />
              </Campo>
            )}
            <Campo rotulo="Quem concorre" info={{ texto: 'Quem pode aparecer nas posições premiadas.', como: ['Todos que venderam: qualquer um com venda entra na disputa.', 'Só quem bateu a meta: é preciso fazer 100% da meta para disputar o pódio.', 'Outro mínimo: escolha o % da meta exigido (ex.: 80%).'] }}>
              <Segmentado valor={pr.ranking.minimo <= 0 ? 'todos' : pr.ranking.minimo === 100 ? 'meta' : 'outro'}
                aoMudar={(v) => set('ranking', { ...pr.ranking, minimo: v === 'todos' ? 0 : v === 'meta' ? 100 : 80 })}
                opcoes={[{ valor: 'todos', rotulo: 'Todos que venderam' }, { valor: 'meta', rotulo: 'Só quem bateu a meta' }, { valor: 'outro', rotulo: 'Outro mínimo' }]} />
            </Campo>
            {pr.ranking.minimo > 0 && pr.ranking.minimo !== 100 && (
              <Campo rotulo="Mínimo da meta para concorrer">
                <EntradaNumero valor={pr.ranking.minimo} aoMudar={(v) => set('ranking', { ...pr.ranking, minimo: v ?? 0 })} sufixo="%" />
              </Campo>
            )}
          </div>
          {semMeta && (pr.ranking.minimo > 0 || pr.ranking.por === 'score') && (
            <Aviso tipo="aviso">O critério está "sem meta": ninguém tem pontuação. Ordene por "Quem vendeu mais" e deixe "Todos que venderam".</Aviso>
          )}
          <div className="coluna" style={{ gap: 4 }}>
            <span className="cons-subcampo-titulo">
              Prêmio por posição
              <Explica titulo="Prêmio por posição" texto="Cada linha cobre uma posição ou um grupo de posições. Para premiar do 4º ao 10º com o mesmo valor, use 'Da posição 4' e 'Até a posição 10'." exemplo="1º: R$ 500 · 2º: R$ 300 · 3º: R$ 200 · do 4º ao 10º: R$ 50 cada." />
            </span>
            <table className="cons-tabela">
              <thead><tr><th>Da posição</th><th>Até a posição</th><th>Prêmio (cada)</th><th /></tr></thead>
              <tbody>
                {pr.ranking.posicoes.map((p, i) => (
                  <tr key={i}>
                    <td style={{ width: 120 }}><EntradaNumero tamanho="p" valor={p.de} aoMudar={(v) => mudarPos(i, 'de', Math.max(1, Math.round(v || 1)))} sufixo="º" /></td>
                    <td style={{ width: 120 }}><EntradaNumero tamanho="p" valor={p.ate} aoMudar={(v) => mudarPos(i, 'ate', Math.max(p.de, Math.round(v || p.de)))} sufixo="º" /></td>
                    <td><EntradaNumero tamanho="p" valor={p.valor} aoMudar={(v) => mudarPos(i, 'valor', v ?? 0)} sufixo="R$" /></td>
                    <td style={{ width: 34 }}><BotaoIcone icone={Trash2} tamanho="p" rotulo="Remover" onClick={() => set('ranking', { ...pr.ranking, posicoes: pr.ranking.posicoes.filter((_, j) => j !== i) })} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="linha quebra">
              <Botao tamanho="p" icone={ListOrdered} onClick={() => {
                const ult = pr.ranking.posicoes[pr.ranking.posicoes.length - 1];
                const de = (ult?.ate ?? 0) + 1;
                set('ranking', { ...pr.ranking, posicoes: [...pr.ranking.posicoes, { de, ate: de, valor: Math.round((ult?.valor ?? 400) / 2) }] });
              }}>Posição</Botao>
              <span className="mudo pequeno" style={{ marginLeft: 8 }}>
                Total do pódio: {fmtMoeda(pr.ranking.posicoes.reduce((a, p) => a + p.valor * (p.ate - p.de + 1), 0))}
                {pr.bonus?.ativo && pr.bonus.valor > 0 ? `, mais ${fmtMoeda(pr.bonus.valor)} para cada pessoa que bater a meta` : ''}
              </span>
            </div>
          </div>
          <BonusMeta pr={pr} setBonus={setBonus} semMeta={semMeta} texto="Quem bater a meta já ganha, mesmo fora do pódio. Quem está no pódio recebe os dois." />
        </div>
      )}

      {pr.tipo === 'rateio' && (
        <div className="coluna" style={{ gap: 12 }}>
          <div className="cons-linha">
            <Campo rotulo="Verba total a dividir" info={{ texto: 'O valor fechado que o fornecedor liberou para a campanha. Ele é dividido entre quem cumprir a condição.', exemplo: 'R$ 5.000 para 10 vendedores que bateram a meta: R$ 500 para cada (em partes iguais).' }}>
              <EntradaNumero valor={pr.rateio.valor_total} aoMudar={(v) => set('rateio', { ...pr.rateio, valor_total: v ?? 0 })} sufixo="R$" />
            </Campo>
            <Campo rotulo="Quem entra na divisão" dica="% mínimo da meta para participar da divisão. 100% = só quem bateu a meta.">
              <EntradaNumero valor={pr.rateio.minimo} aoMudar={(v) => set('rateio', { ...pr.rateio, minimo: v ?? 0 })} sufixo="%" />
            </Campo>
            <Campo rotulo="Como dividir" info={{ texto: 'Como a verba é repartida entre quem entrou.', como: ['Proporcional ao que vendeu: quem vendeu mais leva uma parte maior.', 'Proporcional à pontuação: quem fez mais % da meta leva mais.', 'Partes iguais: todos recebem o mesmo valor.'] }}>
              <Seletor valor={pr.rateio.proporcional} aoMudar={(v) => set('rateio', { ...pr.rateio, proporcional: v })}
                opcoes={[{ valor: 'realizado', rotulo: 'Proporcional ao que vendeu' }, { valor: 'score', rotulo: 'Proporcional à pontuação' }, { valor: 'igual', rotulo: 'Em partes iguais' }]} />
            </Campo>
            {pr.rateio.proporcional === 'realizado' && opCrit.length > 1 && (
              <Campo rotulo="Vendas de">
                <Seletor valor={pr.criterio_base} aoMudar={(v) => set('criterio_base', v)} opcoes={opCrit} />
              </Campo>
            )}
          </div>
          <BonusMeta pr={pr} setBonus={setBonus} semMeta={semMeta} texto="Um valor fixo extra, além da parte da verba." />
        </div>
      )}

      {pr.tipo !== 'nenhuma' && (
        <>
          <div className="cons-subcampo">
            <div className="cons-subcampo-titulo">
              <Zap size={13} /> Aceleradores e redutores
              <Explica titulo="Aceleradores e redutores" texto="Multiplicam o prêmio conforme o resultado de um critério. Servem para dar um extra a quem vai bem em algo ou cortar o prêmio de quem descumpre uma regra."
                como={['Acelerador: se o critério atingir X%, o prêmio é multiplicado (ex.: × 1,2 = 20% a mais).', 'Redutor: se o critério não atingir X%, o prêmio é multiplicado por menos de 1 (ex.: × 0,5 = metade).']}
                exemplo="Prêmio de R$ 200. Devolução ficou acima do limite: redutor × 0,5, a pessoa recebe R$ 100." />
            </div>
            {pr.multiplicadores.length === 0 && <span className="cons-ajuda">Nenhum. São opcionais.</span>}
            {pr.multiplicadores.map((m, i) => (
              <div key={i} className="linha quebra" style={{ gap: 8 }}>
                <span className="pequeno">Se</span>
                <div style={{ width: 220 }}><Seletor tamanho="p" valor={m.criterio} aoMudar={(v) => mudarMult(i, 'criterio', v)} opcoes={opCrit} /></div>
                <span className="pequeno">atingir</span>
                <div style={{ width: 96 }}><EntradaNumero tamanho="p" valor={m.min} aoMudar={(v) => mudarMult(i, 'min', v ?? 100)} sufixo="%" /></div>
                <span className="pequeno">multiplica por</span>
                <div style={{ width: 80 }}><EntradaNumero tamanho="p" valor={m.fator} aoMudar={(v) => mudarMult(i, 'fator', v ?? 1)} /></div>
                <span className="pequeno">senão por</span>
                <div style={{ width: 80 }}><EntradaNumero tamanho="p" valor={m.senao} aoMudar={(v) => mudarMult(i, 'senao', v ?? 1)} /></div>
                <BotaoIcone icone={Trash2} tamanho="p" rotulo="Remover" onClick={() => set('multiplicadores', pr.multiplicadores.filter((_, j) => j !== i))} />
              </div>
            ))}
            <div className="linha" style={{ gap: 6 }}>
              <Botao tamanho="p" icone={Plus} onClick={() => set('multiplicadores', [...pr.multiplicadores, { criterio: def.criterios[def.criterios.length - 1].id, min: 100, fator: 1, senao: 0.5 }])}>Redutor</Botao>
              <Botao tamanho="p" icone={Plus} onClick={() => set('multiplicadores', [...pr.multiplicadores, { criterio: def.criterios[0].id, min: 100, fator: 1.2, senao: 1 }])}>Acelerador</Botao>
            </div>
          </div>

          <div className="cons-linha">
            <Campo rotulo="Teto por pessoa" info={{ texto: 'O máximo que uma pessoa pode receber na campanha, somando tudo. Vazio = sem teto.', exemplo: 'Teto de R$ 300: quem calcularia R$ 420 recebe R$ 300.' }}>
              <EntradaNumero valor={pr.teto_participante} aoMudar={(v) => set('teto_participante', v)} sufixo="R$" placeholder="sem teto" />
            </Campo>
            <Campo rotulo="Orçamento da campanha" info={{ texto: 'Quanto o fornecedor aprovou para a campanha inteira. O sistema avisa se a projeção de prêmios passar desse valor.', como: 'Use o valor do acordo com a indústria. Se a projeção estourar, ajuste valores, teto ou metas.' }}>
              <EntradaNumero valor={pr.orcamento} aoMudar={(v) => set('orcamento', v)} sufixo="R$" placeholder="sem orçamento" />
            </Campo>
          </div>
          <SaldoContaCorrente definicao={def} idCampanha={idCampanha} />
        </>
      )}

      {resumo && pr.tipo !== 'nenhuma' && (
        <div className="cons-subcampo">
          <div className="cons-subcampo-titulo">
            <Wallet size={13} /> Simulação com as vendas reais
            <Explica titulo="Simulação" texto="Aplica estas regras de prêmio às vendas que já aconteceram no período, e à projeção até o fim. Serve para conferir se o custo está dentro do combinado antes de salvar."
              como={['"Se fechasse hoje": quanto seria pago com o que já foi vendido.', '"Projetado no fim": quanto deve ser pago se o ritmo continuar.', '"Premiados": quantas pessoas devem receber algo.']} />
          </div>
          <div className="linha quebra" style={{ gap: 22 }}>
            <div className="cons-mini"><span className="r">Prêmio se fechasse hoje</span><span className="v">{fmtMoeda(resumo.premio_total)}</span></div>
            <div className="cons-mini"><span className="r">Prêmio projetado no fim</span><span className="v">{fmtMoeda(resumo.premio_proj_total)}</span></div>
            {premiados != null && <div className="cons-mini"><span className="r">Premiados (projeção)</span><span className="v">{fmtNumero(premiados)} de {fmtNumero(resumo.participantes)}</span></div>}
            {resumo.orcamento ? <div className="cons-mini"><span className="r">Uso do orçamento</span><span className="v">{fmtPerc(resumo.uso_orcamento_proj * 100)}</span></div> : null}
          </div>
          {resumo.orcamento ? <Progresso valor={(resumo.uso_orcamento_proj || 0) * 100} cor={resumo.uso_orcamento_proj > 1 ? 'critico' : resumo.uso_orcamento_proj > 0.9 ? 'aviso' : 'neutro'} /> : null}
          {resumo.orcamento && resumo.uso_orcamento_proj > 1 && (
            <Aviso tipo="aviso">A premiação projetada ({fmtMoeda(resumo.premio_proj_total)}) passa do orçamento. Ajuste valores, teto ou metas.</Aviso>
          )}
          {maiores.length > 0 && (
            <div className="coluna" style={{ gap: 4 }}>
              <span className="cons-ajuda">Maiores prêmios projetados e de onde vêm:</span>
              {maiores.map((p) => (
                <div key={p.chave} className="linha entre pequeno" style={{ gap: 10 }}>
                  <span className="cresce truncar">{p.nome}</span>
                  <span className="mudo truncar" style={{ maxWidth: '55%' }}>{(p.premio_partes_proj || []).map((x) => `${x.rotulo} (${fmtMoeda(x.valor)})`).join(' + ')}</span>
                  <span className="forte num" style={{ minWidth: 84, textAlign: 'right' }}>{fmtMoeda(p.premio_proj)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Prêmio fixo extra para quem atingir a meta (vale com ranking, rateio e blocos). */
function BonusMeta({ pr, setBonus, semMeta, texto }) {
  const b = pr.bonus || { ativo: false, min: 100, valor: 50 };
  return (
    <div className="cons-subcampo">
      <Alternador ligado={b.ativo} aoMudar={(v) => setBonus('ativo', v)} descricao={texto} rotulo={<span className="com-explica">Prêmio fixo para quem bater a meta<Explica titulo="Prêmio para quem bater a meta" texto="Garante um valor para todo mundo que atingir a meta, independente da posição ou dos blocos. Os valores se somam."
          exemplo="Ranking com 1º lugar de R$ 500 e prêmio de meta de R$ 50: o 1º colocado que bateu a meta recebe R$ 550; quem bateu a meta e ficou em 7º recebe R$ 50." /></span>} />
      {b.ativo && (
        <div className="prem-frase">
          <span>Quem atingir</span>
          <EntradaNumero tamanho="p" valor={b.min} aoMudar={(v) => setBonus('min', v ?? 100)} sufixo="%" />
          <span>da meta ganha</span>
          <EntradaNumero tamanho="p" valor={b.valor} aoMudar={(v) => setBonus('valor', v ?? 0)} sufixo="R$" />
        </div>
      )}
      {b.ativo && semMeta && <Aviso tipo="aviso">O critério está "sem meta", então ninguém atinge a meta. Defina uma meta na etapa de critérios.</Aviso>}
    </div>
  );
}
