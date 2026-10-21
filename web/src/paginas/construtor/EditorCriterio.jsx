import { useState } from 'react';
import {
  ArrowDown, ArrowUp, ChevronDown, ChevronUp, Copy, DollarSign, Filter, LayoutGrid, Link2, MessageSquareText, MoreHorizontal, Package,
  Settings2, Sparkles, Trash2, UserCheck,
} from 'lucide-react';
import { Botao, BotaoIcone, Campo, Entrada, Explica, Menu, Progresso, Segmentado, Seletor, Selo } from '../../componentes/ui.jsx';
import { EntradaNumero } from './campos.jsx';
import { fmtData, fmtNumero, fmtPerc } from '../../lib/formato.js';
import EditorCombo from './EditorCombo.jsx';
import EditorFormula from './EditorFormula.jsx';
import AssistenteFormula from './AssistenteFormula.jsx';
import { SeletorFormulaSalva } from './BibliotecaFormulas.jsx';
import EditorMeta from './EditorMeta.jsx';
import SeletorMetrica from './SeletorMetrica.jsx';
import SeletorProdutos from './SeletorProdutos.jsx';
import { GUIA_METRICAS } from './guia.js';
import { SELETOR_VAZIO, fmtMetrica, fraseCriterio, infoMetrica, nivelPlural, nivelSingular, variaveisDoCriterio } from './util.js';

const COR_POR_INDICE = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s6)', 'var(--s7)', 'var(--s8)'];

// as medidas mais usadas, em linguagem comum; as outras ficam no seletor completo
const RAPIDAS = [
  { chave: 'quantidade', rotulo: 'Unidades vendidas', icone: Package },
  { chave: 'valor', rotulo: 'Faturamento (R$)', icone: DollarSign },
  { chave: 'positivacao', rotulo: 'Clientes que compraram', icone: UserCheck },
  { chave: 'mix', rotulo: 'Produtos diferentes', icone: LayoutGrid },
  { chave: 'combo', rotulo: 'Venda casada (kit)', icone: Link2 },
];

function Passo({ n, titulo, info, children, acoes }) {
  return (
    <div className="cons-passo">
      <div className="cons-passo-topo">
        <span className="cons-passo-num">{n}</span>
        <span className="cons-passo-titulo">{titulo}</span>
        {info && <Explica titulo={titulo} {...info} />}
        <span className="cresce" />
        {acoes}
      </div>
      <div className="cons-passo-corpo">{children}</div>
    </div>
  );
}

function Regras({ crit, vars, aoMudar }) {
  const temCli = vars.has('clientes');
  const temPed = vars.has('pedidos');
  const temSku = vars.has('skus');
  const temNovos = vars.has('clientes_novos') || vars.has('clientes_reativados');
  if (!temCli && !temPed && !temSku && !temNovos) return null;
  const rc = crit.regra_cliente;
  const setRc = (k, v) => aoMudar({ ...crit, regra_cliente: { ...rc, [k]: v ?? 0 } });
  return (
    <div className="cons-subcampo">
      <div className="cons-subcampo-titulo com-explica">
        <Filter size={13} /> Quando uma venda conta
        <Explica titulo="Quando uma venda conta" texto="Mínimos para evitar que uma compra pequena conte como cliente ou pedido. Deixe 0 para não exigir nada."
          como={['Preencha só o que o fornecedor exige.', 'O cliente precisa cumprir todos os mínimos preenchidos no período da campanha.']}
          exemplo="Mínimo de 12 unidades: um cliente que comprou 5 unidades não conta como positivado." />
      </div>
      {temCli && (
        <>
          <div className="cons-ajuda">Um cliente só conta (positivado) se comprar no período pelo menos:</div>
          <div className="cons-linha" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))' }}>
            <Campo rotulo="Unidades" dica="Soma de unidades dos produtos do critério que o cliente comprou."><EntradaNumero tamanho="p" valor={rc.min_qtd} aoMudar={(v) => setRc('min_qtd', v)} sufixo="un" /></Campo>
            <Campo rotulo="Valor" dica="Valor comprado pelo cliente nos produtos do critério."><EntradaNumero tamanho="p" valor={rc.min_valor} aoMudar={(v) => setRc('min_valor', v)} sufixo="R$" /></Campo>
            <Campo rotulo="Produtos diferentes" dica="Mix mínimo: quantos produtos (SKUs) diferentes do critério o cliente levou."><EntradaNumero tamanho="p" valor={rc.min_skus} aoMudar={(v) => setRc('min_skus', v)} /></Campo>
            <Campo rotulo="Marcas diferentes" dica="Quantas marcas diferentes do critério o cliente levou."><EntradaNumero tamanho="p" valor={rc.min_marcas} aoMudar={(v) => setRc('min_marcas', v)} /></Campo>
            <Campo rotulo="Pedidos" dica="Recorrência: quantos pedidos diferentes o cliente fez no período."><EntradaNumero tamanho="p" valor={rc.min_pedidos} aoMudar={(v) => setRc('min_pedidos', v)} /></Campo>
          </div>
        </>
      )}
      {temPed && (
        <div className="cons-linha" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
          <Campo rotulo="Pedido conta com no mínimo" dica="Pedidos menores do que isso não entram na contagem.">
            <EntradaNumero tamanho="p" valor={crit.regra_pedido.min_qtd} aoMudar={(v) => aoMudar({ ...crit, regra_pedido: { ...crit.regra_pedido, min_qtd: v ?? 0 } })} sufixo="un" />
          </Campo>
          <Campo rotulo="Ou valor mínimo do pedido" dica="Pedidos abaixo deste valor não entram na contagem.">
            <EntradaNumero tamanho="p" valor={crit.regra_pedido.min_valor} aoMudar={(v) => aoMudar({ ...crit, regra_pedido: { ...crit.regra_pedido, min_valor: v ?? 0 } })} sufixo="R$" />
          </Campo>
        </div>
      )}
      {temSku && (
        <div className="cons-linha" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
          <Campo rotulo="Produto conta se vendido para pelo menos" dica="O produto só entra no mix se chegou a este número de clientes.">
            <EntradaNumero tamanho="p" valor={crit.regra_sku.min_clientes} aoMudar={(v) => aoMudar({ ...crit, regra_sku: { ...crit.regra_sku, min_clientes: v ?? 0 } })} sufixo="clientes" />
          </Campo>
        </div>
      )}
      {temNovos && (
        <div className="cons-linha" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
          <Campo rotulo="Cliente novo ou reativado é quem está sem comprar há" dica="Janela de inatividade contada até o início da campanha.">
            <EntradaNumero tamanho="p" valor={crit.novos.dias} aoMudar={(v) => aoMudar({ ...crit, novos: { dias: Math.max(1, Math.round(v || 1)) } })} sufixo="dias" />
          </Campo>
        </div>
      )}
    </div>
  );
}

/** Peso, mínimo, teto, sentido e (meta sobre histórico) piso e período-base: recolhidos por padrão. */
function AjustesAvancados({ crit, info, sentidoPadrao, nivel, total, previa, indice, aoMudar }) {
  const [aberto, setAberto] = useState(false);
  const m = crit.meta;
  const set = (k, v) => aoMudar({ ...crit, [k]: v });
  const setMeta = (k, v) => aoMudar({ ...crit, meta: { ...m, [k]: v } });
  const usaHistorico = m.tipo === 'historico' || (m.tipo === 'distribuida' && m.distribuir_por === 'historico');
  const sufixo = info.formato === 'moeda' ? 'R$' : info.formato === 'perc' ? '%' : info.unidade || '';
  const pb = previa?.criterios?.[indice]?.periodo_base;

  const resumo = [
    info.sentido === 'menor' ? 'quanto menor, melhor' : 'quanto maior, melhor',
    total > 1 && `peso ${fmtNumero(crit.peso, crit.peso % 1 ? 1 : 0)}`,
    crit.gatilho > 0 ? `pontua a partir de ${fmtNumero(crit.gatilho)}%` : 'sem mínimo',
    crit.teto != null ? `conta até ${fmtNumero(crit.teto)}%` : 'sem limite',
    m.tipo === 'historico' && (m.piso > 0 ? `meta mínima ${fmtMetrica(m.piso, info)}` : 'sem meta mínima'),
    usaHistorico && (m.base_inicio && m.base_fim ? `base ${fmtData(m.base_inicio)} a ${fmtData(m.base_fim)}` : 'base: período anterior'),
  ].filter(Boolean);
  const mexidos = [info.sentido !== sentidoPadrao, total > 1 && crit.peso !== 1, crit.gatilho > 0, crit.teto != null, m.tipo === 'historico' && m.piso > 0, usaHistorico && m.base_inicio].filter(Boolean).length;

  return (
    <div className={`cons-avancado${aberto ? ' aberto' : ''}`}>
      <button type="button" className="cons-avancado-botao" onClick={() => setAberto((a) => !a)} aria-expanded={aberto}>
        <Settings2 size={14} />
        <span className="forte">Ajustes avançados</span>
        {mexidos > 0 && <span className="selo acento">{mexidos} ajuste{mexidos > 1 ? 's' : ''}</span>}
        {!aberto && <span className="mudo pequeno truncar cresce">{resumo.join(' · ')}</span>}
        {aberto && <span className="cresce" />}
        {aberto ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
      </button>
      {aberto && (
        <div className="cons-avancado-corpo">
          <div className="cons-ajuda">Na maioria das campanhas não precisa mexer aqui. Passe o mouse no "i" de cada campo para ver o que ele faz.</div>
          <div className="cons-linha" style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}>
            <Campo rotulo="O que é melhor" info={{
              texto: 'Diz se o bom resultado é o número alto ou o baixo.',
              como: ['Quase sempre "maior é melhor" (vender mais).', 'Use "menor é melhor" para desconto, devolução ou cancelamento.'],
              exemplo: 'Desconto médio com meta de 4%: quem fez 3% atingiu a meta; quem fez 5% não.',
            }}>
              <Segmentado tamanho="p" valor={info.sentido} aoMudar={(v) => set('sentido', v)}
                opcoes={[{ valor: 'maior', rotulo: 'Maior é melhor' }, { valor: 'menor', rotulo: 'Menor é melhor' }]} />
            </Campo>
          </div>
          <div className="cons-linha" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
            <Campo rotulo="Peso" info={{
              texto: 'Importância deste critério na pontuação, quando a campanha tem mais de um critério.',
              como: ['Peso 2 vale o dobro de um critério com peso 1.', 'Peso 0: o critério não entra na nota e só serve para acelerar ou reduzir o prêmio.'],
              exemplo: 'Unidades com peso 2 (90%) e positivação com peso 1 (120%): pontuação = (2×90 + 1×120) ÷ 3 = 100%.',
            }}>
              <EntradaNumero tamanho="p" valor={crit.peso} aoMudar={(v) => set('peso', v ?? 0)} />
            </Campo>
            <Campo rotulo="Só pontua a partir de" info={{
              texto: 'Atingimento mínimo (gatilho). Abaixo dele este critério vale zero, ou desclassifica quando a regra é "cumprir todos".',
              como: ['0% = sem mínimo.', 'Use 80% ou 100% quando o fornecedor só paga a partir de um patamar.'],
              exemplo: 'Mínimo de 80%: quem fez 75% da meta fica com 0 pontos neste critério.',
            }}>
              <EntradaNumero tamanho="p" valor={crit.gatilho} aoMudar={(v) => set('gatilho', v ?? 0)} sufixo="%" />
            </Campo>
            <Campo rotulo="Conta no máximo até" info={{
              texto: 'Teto do atingimento considerado na pontuação. Evita que um critério estourado compense os outros.',
              como: ['Vazio = sem limite.', 'Comum: 120% ou 150%.'],
              exemplo: 'Teto de 150%: quem fez 210% da meta pontua 150%.',
            }}>
              <EntradaNumero tamanho="p" valor={crit.teto} aoMudar={(v) => set('teto', v)} sufixo="%" placeholder="sem limite" />
            </Campo>
          </div>
          {m.tipo === 'historico' && (
            <div className="cons-linha" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
              <Campo rotulo="Meta mínima (piso)" info={{
                texto: `Garante uma meta para quem vendeu pouco ou nada no período anterior (sem isso, a meta dele seria zero).`,
                como: ['0 = sem piso.', `Use um valor pequeno e possível para um ${nivelSingular(nivel)} novo.`],
                exemplo: 'Piso de 20 un: quem vendeu 5 no mês passado fica com meta de 20, não de 6.',
              }}>
                <EntradaNumero tamanho="p" valor={m.piso} aoMudar={(v) => setMeta('piso', v ?? 0)} sufixo={sufixo} />
              </Campo>
            </div>
          )}
          {usaHistorico && (
            <div className="cons-linha" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
              <Campo rotulo="Período-base: início" info={{
                texto: 'O período usado como "antes" para calcular as metas sobre o histórico.',
                como: ['Em branco: o sistema usa o período anterior com a mesma duração (ex.: campanha de outubro usa setembro).', 'Preencha para comparar com outra época (ex.: o mesmo mês do ano passado).'],
              }}>
                <Entrada type="date" value={m.base_inicio || ''} onChange={(e) => setMeta('base_inicio', e.target.value || null)} />
              </Campo>
              <Campo rotulo="Período-base: fim" ajuda={!m.base_inicio && pb ? `Hoje: ${fmtData(pb.inicio)} a ${fmtData(pb.fim)} (automático).` : undefined}>
                <Entrada type="date" value={m.base_fim || ''} onChange={(e) => setMeta('base_fim', e.target.value || null)} />
              </Campo>
            </div>
          )}
          {total === 1 && <div className="cons-ajuda">Com um critério só, o peso não muda nada. Ele importa quando a campanha tem dois ou mais critérios ({nivelPlural(nivel)} pontuam pela média).</div>}
        </div>
      )}
    </div>
  );
}

export default function EditorCriterio({
  crit, indice, total, catalogo, nivel, previa, premiacao, fabricante, grupos = [], foraDoFornecedor, aoUsarFornecedor, aoMudar, aoRemover, aoDuplicar, aoMover,
}) {
  const [recolhido, setRecolhido] = useState(false);
  const [todasMetricas, setTodasMetricas] = useState(false);
  const info = infoMetrica(crit, catalogo);
  const vars = variaveisDoCriterio(crit, catalogo);
  const res = previa?.criterios?.[indice];
  const cor = COR_POR_INDICE[indice % COR_POR_INDICE.length];
  const set = (k, v) => aoMudar({ ...crit, [k]: v });
  const guia = GUIA_METRICAS[crit.metrica];
  const rapida = RAPIDAS.some((r) => r.chave === crit.metrica);
  const verSeletor = todasMetricas || !rapida;
  const frase = fraseCriterio(crit, catalogo, nivel, grupos, premiacao);

  const mudarMetrica = (k) => {
    const m = catalogo?.metricas?.[k] || {};
    const nomeAnterior = catalogo?.metricas?.[crit.metrica]?.nome;
    const novo = {
      ...crit,
      metrica: k,
      nome: !crit.nome || crit.nome === nomeAnterior ? m.nome || '' : crit.nome,
      sentido: m.sentido === 'menor' ? 'menor' : 'maior',
      formato: k === 'personalizada' ? crit.formato || 'decimal' : undefined,
      totalizar: k === 'personalizada' ? crit.totalizar : undefined,
    };
    if (k === 'combo' && !crit.combo.itens.length) {
      const base = () => (fabricante ? { ...SELETOR_VAZIO(), fabricantes: [fabricante] } : SELETOR_VAZIO());
      novo.combo = { ...crit.combo, itens: [{ nome: 'Item 1', minimo: 1, produtos: base() }, { nome: 'Item 2', minimo: 1, produtos: base() }] };
    }
    aoMudar(novo);
  };

  // rodapé: números da prévia em frases
  const t = res?.total;
  const temMeta = t?.meta != null && t.meta > 0;

  return (
    <div className={`cons-crit${recolhido ? ' cons-recolhido' : ''}`} style={{ '--cor-crit': cor }}>
      <div className="cons-crit-topo">
        <span className="cons-crit-id" title="Código do critério (usado nas fórmulas e nos relatórios)">{crit.id}</span>
        <input className="cons-crit-nome" value={crit.nome} placeholder={`Nome do critério (ex.: ${info.nome})`} onChange={(e) => set('nome', e.target.value)} aria-label="Nome do critério" />
        {recolhido && res && <Selo cor={t.atingimento >= 100 ? 'bom' : 'neutro'}>{fmtPerc(t.atingimento)}</Selo>}
        <BotaoIcone icone={ArrowUp} rotulo="Mover para cima" tamanho="p" disabled={indice === 0} onClick={() => aoMover(-1)} />
        <BotaoIcone icone={ArrowDown} rotulo="Mover para baixo" tamanho="p" disabled={indice === total - 1} onClick={() => aoMover(1)} />
        <Menu
          gatilho={<BotaoIcone icone={MoreHorizontal} rotulo="Mais ações" tamanho="p" />}
          itens={[
            { rotulo: 'Duplicar critério', icone: Copy, aoClicar: aoDuplicar },
            total > 1 && { rotulo: 'Remover critério', icone: Trash2, perigo: true, aoClicar: aoRemover },
          ]}
        />
        <BotaoIcone icone={recolhido ? ChevronDown : ChevronUp} rotulo={recolhido ? 'Expandir' : 'Recolher'} tamanho="p" onClick={() => setRecolhido((r) => !r)} />
      </div>

      <div className="cons-crit-frase" aria-live="polite">
        <MessageSquareText size={15} />
        <span>{frase}</span>
      </div>

      <div className="cons-crit-corpo">
        <Passo n={1} titulo="O que medir" info={{
          texto: 'O número que vai ser contado para cada participante.',
          como: ['Escolha um dos botões (as medidas mais usadas).', 'Precisa de outra coisa (margem, share, ticket, devolução...)? Clique em "Outras medidas".', 'Nada serve? Escolha "Fórmula personalizada" e descreva o que quer: o assistente monta a fórmula.'],
          exemplo: 'Campanha de positivação: "Clientes que compraram". Campanha de volume: "Unidades vendidas".',
        }}>
          <div className="cons-rapidas">
            {RAPIDAS.map((r) => (
              <button key={r.chave} type="button" className={`cons-rapida${crit.metrica === r.chave ? ' sel' : ''}`} onClick={() => { mudarMetrica(r.chave); setTodasMetricas(false); }}>
                <r.icone size={15} /> {r.rotulo}
              </button>
            ))}
            <button type="button" className={`cons-rapida${!rapida ? ' sel' : ''}${todasMetricas ? ' aberta' : ''}`} onClick={() => setTodasMetricas((a) => !a)}>
              <Sparkles size={15} /> {rapida ? `Outras medidas (${Object.keys(catalogo?.metricas || {}).length - RAPIDAS.length})` : info.nome}
            </button>
          </div>
          {verSeletor && <SeletorMetrica valor={crit.metrica} aoMudar={(k) => { mudarMetrica(k); setTodasMetricas(false); }} catalogo={catalogo} />}
          {guia && (
            <div className="cons-guia">
              <span><b>{info.nome}:</b> {info.descricao || guia[0]}</span>
              <Explica titulo={info.nome} texto={info.descricao} como={guia[0]} exemplo={guia[1]} />
            </div>
          )}
        </Passo>

        {crit.metrica === 'personalizada' && (
          <div className="cons-subcampo">
            <div className="linha entre" style={{ gap: 8 }}>
              <div className="cons-subcampo-titulo com-explica">
                Fórmula
                <Explica titulo="Fórmula personalizada" texto="Uma conta com as variáveis do sistema (qtd, valor, clientes, margem...). Vale para qualquer regra que não existe pronta."
                  como={['Escreva o que você quer no assistente e clique para gerar.', 'Ou escolha uma fórmula salva.', 'Ou digite direto: as variáveis aparecem enquanto você escreve.']}
                  exemplo={'valor{canal: "App Mobile"} / valor * 100 mede o % do faturamento que veio pelo app.'} />
              </div>
              <SeletorFormulaSalva aoEscolher={(f) => aoMudar({
                ...crit,
                expressao: f.expressao,
                formato: f.formato,
                totalizar: f.totalizar,
                sentido: f.sentido,
                nome: !crit.nome || crit.nome === 'Fórmula personalizada' ? f.nome : crit.nome,
              })} />
            </div>
            <AssistenteFormula compacto expressaoAtual={crit.expressao} aoAplicar={(r) => aoMudar({
              ...crit,
              expressao: r.expressao,
              ...(r.desfazer ? {} : { formato: r.formato || crit.formato, totalizar: r.totalizar || crit.totalizar, sentido: r.sentido || crit.sentido, nome: !crit.nome || crit.nome === 'Fórmula personalizada' ? r.nome || crit.nome : crit.nome }),
            })} />
            <EditorFormula valor={crit.expressao} aoMudar={(v) => set('expressao', v)} catalogo={catalogo} />
            <div className="cons-linha">
              <Campo rotulo="Formato do resultado" dica="Como o número aparece nos relatórios: inteiro, decimal, em reais ou em porcentagem.">
                <Seletor valor={crit.formato || 'decimal'} aoMudar={(v) => set('formato', v)}
                  opcoes={[{ valor: 'numero', rotulo: 'Número inteiro' }, { valor: 'decimal', rotulo: 'Decimal' }, { valor: 'moeda', rotulo: 'Moeda (R$)' }, { valor: 'perc', rotulo: 'Percentual (%)' }]} />
              </Campo>
              <Campo rotulo="Como somar a campanha" dica="Soma: o total da campanha é a soma de todos (unidades, R$). Média: para razões e percentuais, que não se somam.">
                <Seletor valor={crit.totalizar || (crit.expressao.includes('/') ? 'media' : 'soma')} aoMudar={(v) => set('totalizar', v)}
                  opcoes={[{ valor: 'soma', rotulo: 'Soma (volumes)' }, { valor: 'media', rotulo: 'Média (razões e %)' }]} />
              </Campo>
            </div>
          </div>
        )}

        <Passo n={2} titulo={crit.metrica === 'combo' ? 'Itens do kit' : 'Quais produtos contam'}
          info={crit.metrica === 'combo' ? {
            texto: 'Os itens que precisam ser vendidos juntos e a quantidade mínima de cada um.',
            como: ['Dê um nome a cada item e escolha os produtos dele (normalmente uma marca).', 'Diga se os itens precisam estar no mesmo pedido ou só no mesmo cliente durante o período.'],
            exemplo: 'Kit ressaca: Item 1 Engov (2 un) + Item 2 Epocler (1 un) no mesmo pedido.',
          } : {
            texto: 'Só as vendas destes produtos entram na conta do critério.',
            como: ['Os filtros se combinam: fabricante E marca E subcategoria.', 'Deixe tudo vazio para contar todos os produtos.', '"Avulsos e exceções" inclui ou tira produtos específicos.'],
            exemplo: 'Fabricante Haleon + marca Sensodyne = só os cremes Sensodyne.',
          }}>
          {crit.metrica === 'combo' ? (
            <EditorCombo combo={crit.combo} aoMudar={(v) => set('combo', v)} fabricante={fabricante} />
          ) : (
            <>
              <SeletorProdutos valor={crit.produtos} aoMudar={(v) => set('produtos', v)} fabricante={fabricante} />
              {foraDoFornecedor && fabricante && (
                <div className="cons-sugestao-meta">
                  <Sparkles size={14} style={{ color: 'var(--acento)' }} />
                  <span>Este critério conta produtos de fora da {fabricante}. A campanha é da {fabricante}?</span>
                  <span className="cresce" />
                  <Botao tamanho="p" variante="sutil" onClick={aoUsarFornecedor}>Usar só {fabricante}</Botao>
                </div>
              )}
            </>
          )}
        </Passo>

        {(vars.has('qtd_ref') || vars.has('valor_ref')) && (
          <div className="cons-subcampo">
            <div className="cons-subcampo-titulo com-explica">
              Comparar com quais produtos
              <Explica titulo="Base da participação (share)" texto="A participação é: vendas dos produtos do critério ÷ vendas destes produtos de referência."
                como="Vazio = a mesma subcategoria dos produtos do critério." exemplo="Sensodyne dentro de Higiene Bucal: Sensodyne vendeu R$ 16 mil de R$ 100 mil = 16% de share." />
            </div>
            <div className="cons-ajuda">Vazio = a mesma subcategoria dos produtos do critério (ex.: Sensodyne dentro de Higiene Bucal).</div>
            <SeletorProdutos valor={crit.produtos_ref} aoMudar={(v) => set('produtos_ref', v)} rotuloTodos="Mesma subcategoria (padrão)" compacto />
          </div>
        )}

        <Regras crit={crit} vars={vars} aoMudar={aoMudar} />

        <Passo n={3} titulo="Qual é a meta" info={{
          texto: `O quanto cada ${nivelSingular(nivel)} precisa alcançar. A pontuação é o realizado dividido pela meta (atingimento).`,
          como: ['Escolha um dos jeitos de definir a meta.', 'Preencha o número pedido.', 'Confira o resumo das metas e, se quiser, ajuste a de alguém em "Ver e ajustar".'],
          exemplo: 'Meta de 100 un e vendeu 90: atingimento de 90%.',
        }}>
          <EditorMeta crit={crit} indice={indice} catalogo={catalogo} nivel={nivel} previa={previa} aoMudar={(meta) => set('meta', meta)} />
        </Passo>

        <AjustesAvancados crit={crit} info={info} sentidoPadrao={catalogo?.metricas?.[crit.metrica]?.sentido || 'maior'} nivel={nivel} total={total} previa={previa} indice={indice} aoMudar={aoMudar} />
      </div>

      {res && (
        <div className="cons-crit-rodape">
          <div className="coluna cresce" style={{ gap: 6, minWidth: 0 }}>
            <div className="pequeno com-explica" style={{ display: 'block' }}>
              {temMeta ? (
                <>
                  Até agora: <b>{fmtMetrica(t.realizado, info)}</b> de uma meta de <b>{fmtMetrica(t.meta, info)}</b> ({fmtPerc(t.atingimento)}).
                  {t.projecao != null && <> No ritmo atual deve fechar em <b>{fmtMetrica(t.projecao, info)}</b> ({fmtPerc(t.atingimento_proj)}).</>}
                </>
              ) : (
                <>
                  Até agora: <b>{fmtMetrica(t.realizado, info)}</b>.
                  {t.projecao != null && <> No ritmo atual deve fechar em <b>{fmtMetrica(t.projecao, info)}</b>.</>}
                </>
              )}
              {t.base != null && <> No período anterior: {fmtMetrica(t.base, info)}.</>}
              {' '}
              <Explica titulo="Números deste critério" texto={`Soma ${info.totalizar === 'media' ? '(média) ' : ''}de todos os ${nivelPlural(nivel)} com as regras atuais, usando as vendas reais até a data de referência.`}
                como={['Barra cheia: quanto da meta já foi feito.', 'Tracinho na barra: onde a projeção indica que vai fechar.', 'Projeção: ritmo atual somado ao comportamento do período anterior.']} />
            </div>
            {temMeta && <Progresso valor={t.atingimento} projecao={t.atingimento_proj} espessura="p" />}
          </div>
          <span className="mini mudo" title="Produtos que entram neste critério">{fmtNumero(res.n_produtos)} produtos</span>
        </div>
      )}
    </div>
  );
}
