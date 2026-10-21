import { Camera, Eye, Lock } from 'lucide-react';
import { useApi } from '../../lib/api.js';
import { definirQuery } from '../../lib/rotas.js';
import { fmtData, fmtDataHora } from '../../lib/formato.js';
import { Botao, Carregando, ErroCarga, Explica, Selo, Tabela, Vazio } from '../../componentes/ui.jsx';
import { EXPLICA } from '../../lib/explicacoes.jsx';

/** Fotografias (apurações congeladas) da campanha. */
export default function Fotografias({ idCampanha, aoFotografar, atual }) {
  const { dados, erro, carregando, recarregar } = useApi(`/campanhas/${idCampanha}/fotografias`);
  if (erro && !dados) return <ErroCarga erro={erro} aoTentar={recarregar} />;
  if (carregando && !dados) return <Carregando />;
  const itens = Array.isArray(dados) ? dados : [];
  if (!itens.length) {
    return (
      <div className="cartao">
        <Vazio icone={Camera} titulo="Nenhuma fotografia ainda"
          texto="Uma fotografia congela a apuração como está agora. Serve para registrar a posição de uma reunião, de um fechamento parcial ou do pagamento do prêmio."
          acao={<Botao variante="primario" icone={Camera} onClick={aoFotografar}>Fotografar agora</Botao>} />
      </div>
    );
  }
  const colunas = [
    {
      chave: 'tipo', titulo: 'Tipo', valor: (f) => f.tipo,
      render: (f) => (f.tipo === 'fechamento' ? <Selo cor="bom" icone={Lock}>Fechamento</Selo> : <Selo icone={Camera}>Manual</Selo>),
    },
    { chave: 'data_referencia', titulo: 'Dados até', ordenavel: true, valor: (f) => f.data_referencia, render: (f) => <span className="num">{fmtData(f.data_referencia)}</span> },
    { chave: 'criado_em', titulo: 'Criada em', ordenavel: true, valor: (f) => f.criado_em, render: (f) => <span className="num sec">{fmtDataHora(f.criado_em)}</span> },
    { chave: 'observacao', titulo: 'Observação', render: (f) => <span className="sec">{f.observacao || '-'}</span> },
    {
      chave: 'abrir', titulo: '', alinhar: 'direita',
      render: (f) => (
        <Botao tamanho="p" variante={String(atual) === String(f.id) ? 'sutil' : 'padrao'} icone={Eye} onClick={(e) => { e.stopPropagation(); definirQuery({ fotografia: f.id, aba: null }); }}>
          {String(atual) === String(f.id) ? 'Exibindo' : 'Ver'}
        </Botao>
      ),
    },
  ];
  return (
    <div className="coluna" style={{ gap: 12 }}>
      <div className="linha entre">
        <span className="mudo pequeno linha g4">{itens.length} {itens.length === 1 ? 'fotografia' : 'fotografias'}<Explica titulo="Fotografias" {...EXPLICA.fotografias} tamanho={13} /></span>
        <Botao tamanho="p" icone={Camera} onClick={aoFotografar}>Fotografar agora</Botao>
      </div>
      <div className="cartao">
        <Tabela colunas={colunas} linhas={itens} chaveLinha={(f) => f.id} ordenacaoInicial={{ chave: 'criado_em', dir: 'desc' }} />
      </div>
    </div>
  );
}
