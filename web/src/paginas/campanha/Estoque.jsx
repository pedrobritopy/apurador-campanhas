import { AlertTriangle, CheckCircle2, Package, XCircle } from 'lucide-react';
import { useApi } from '../../lib/api.js';
import { fmtData, fmtDecimal, fmtNumero } from '../../lib/formato.js';
import { Aviso, Carregando, ErroCarga, Explica, Selo, Tabela, Vazio } from '../../componentes/ui.jsx';
import { EXPLICA } from '../../lib/explicacoes.jsx';
import { FotoProduto } from '../../componentes/Imagens.jsx';

const RISCO = {
  abaixo_minimo: { rotulo: 'Abaixo do mínimo', cor: 'critico', icone: XCircle },
  ruptura: { rotulo: 'Pode faltar', cor: 'aviso', icone: AlertTriangle },
  ok: { rotulo: 'Coberto', cor: 'bom', icone: CheckCircle2 },
};

/** Estoque dos produtos da campanha: cobertura em dias vs dias restantes. */
export default function Estoque({ idCampanha }) {
  const { dados, erro, carregando, recarregar } = useApi(`/campanhas/${idCampanha}/estoque`);
  if (erro && !dados) return <ErroCarga erro={erro} aoTentar={recarregar} />;
  if (carregando && !dados) return <Carregando texto="Lendo estoque…" />;
  const itens = Array.isArray(dados) ? dados : [];
  if (!itens.length) return <div className="cartao"><Vazio icone={Package} titulo="Sem dados de estoque" texto="Importe a tabela fato_estoque para acompanhar a cobertura dos produtos da campanha." /></div>;
  const emRisco = itens.filter((i) => i.risco !== 'ok');
  const restantes = itens[0]?.dias_campanha_restantes ?? 0;

  const colunas = [
    {
      chave: 'nome', titulo: 'Produto', ordenavel: true, dirInicial: 'asc', valor: (p) => p.nome,
      render: (p) => (
        <div className="linha" style={{ gap: 10, minWidth: 0 }}>
          <FotoProduto id={p.id} nome={p.nome} tamanho={36} />
          <div style={{ minWidth: 0 }}>
            <div className="truncar" style={{ maxWidth: 360 }}>{p.nome}</div>
            <div className="mudo pequeno">{p.marca}</div>
          </div>
        </div>
      ),
    },
    { chave: 'estoque', titulo: 'Estoque', alinhar: 'direita', ordenavel: true, valor: (p) => p.estoque, render: (p) => <span className="num">{fmtNumero(p.estoque)}</span> },
    { chave: 'estoque_minimo', titulo: 'Mínimo', alinhar: 'direita', ordenavel: true, valor: (p) => p.estoque_minimo, render: (p) => <span className="num sec">{fmtNumero(p.estoque_minimo)}</span> },
    { chave: 'media_dia', titulo: 'Venda/dia (30d)', alinhar: 'direita', ordenavel: true, valor: (p) => p.media_dia, render: (p) => <span className="num">{fmtDecimal(p.media_dia, 1)}</span> },
    {
      chave: 'cobertura_dias', titulo: 'Cobertura', alinhar: 'direita', ordenavel: true, dirInicial: 'asc', valor: (p) => p.cobertura_dias,
      render: (p) => <span className="num forte">{p.cobertura_dias == null ? '-' : `${fmtDecimal(p.cobertura_dias, 1)} d`}</span>,
    },
    {
      chave: 'risco', titulo: 'Situação', ordenavel: true, valor: (p) => ({ abaixo_minimo: 0, ruptura: 1, ok: 2 })[p.risco],
      render: (p) => {
        const r = RISCO[p.risco] || RISCO.ok;
        return <Selo cor={r.cor} icone={r.icone}>{r.rotulo}</Selo>;
      },
    },
  ];

  return (
    <div className="coluna" style={{ gap: 14 }}>
      {emRisco.length > 0 ? (
        <Aviso tipo="aviso" titulo={`${fmtNumero(emRisco.length)} ${emRisco.length === 1 ? 'produto pode' : 'produtos podem'} faltar antes do fim da campanha`}>
          Cobertura menor que os {fmtNumero(restantes)} dias restantes, no ritmo de venda dos últimos 30 dias. Acione compras antes que a meta fique inalcançável por falta de produto.
        </Aviso>
      ) : (
        <Aviso tipo="ok" titulo="Estoque cobre o restante da campanha">Todos os produtos têm cobertura maior que os dias restantes.</Aviso>
      )}
      <div className="cartao">
        <Tabela colunas={colunas} linhas={itens} chaveLinha={(p) => p.id} densa maxAltura="62vh" ordenacaoInicial={{ chave: 'cobertura_dias', dir: 'asc' }} />
      </div>
      <div className="mudo pequeno linha g4">Posição de estoque em {fmtData(itens[0]?.data)}. Cobertura = estoque ÷ venda média por dia.<Explica titulo="Como ler o estoque" {...EXPLICA.estoque} tamanho={13} /></div>
    </div>
  );
}
