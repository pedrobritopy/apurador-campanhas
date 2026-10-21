import { BadgeCheck, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useApi } from '../../lib/api.js';
import { fmtDataHora, fmtNumero } from '../../lib/formato.js';
import { Aviso, Cartao, Carregando, ErroCarga, Selo, Tabela } from '../../componentes/ui.jsx';
import { EXPLICA_INSIGHTS } from './comum.jsx';

const fmtLado = (v) => (v == null ? 'n/d' : fmtNumero(v, Math.abs(v) < 1000 && v % 1 ? 2 : 0));

export default function AbaQualidade() {
  const { dados, erro, carregando, recarregar } = useApi('/qualidade-dados');
  if (erro) return <ErroCarga erro={erro} aoTentar={recarregar} />;
  if (carregando && !dados) return <Carregando />;
  const lista = dados || [];
  const divergentes = lista.filter((v) => !v.ok);
  return (
    <div className="coluna" style={{ gap: 16 }}>
      {divergentes.length ? (
        <Aviso tipo="erro" titulo={`${divergentes.length} verificação(ões) com divergência`}>
          Os números afetados foram retirados da base de conhecimento da IA até a próxima importação de dados.
        </Aviso>
      ) : lista.length ? (
        <Aviso tipo="ok" titulo="Dados conferidos">Todas as {lista.length} verificações passaram. A IA só recebe números conferidos.</Aviso>
      ) : null}
      <Cartao titulo="Verificações automáticas" info={EXPLICA_INSIGHTS.qualidade} subtitulo={lista[0] ? `Última execução: ${fmtDataHora(lista[0].criado_em)}` : 'Rodam a cada importação e a cada atualização da base'} semMargem
        acoes={divergentes.length ? <ShieldAlert size={16} style={{ color: 'var(--critico)' }} /> : <ShieldCheck size={16} style={{ color: 'var(--bom)' }} />}>
        <Tabela
          linhas={lista}
          chaveLinha={(l) => l.regra}
          colunas={[
            { chave: 'ok', titulo: 'Situação', largura: 130, render: (l) => (l.ok ? <Selo cor="bom" icone={BadgeCheck}>Conferido</Selo> : <Selo cor="critico" icone={ShieldAlert}>Divergente</Selo>) },
            { chave: 'descricao', titulo: 'Regra', render: (l) => <div><div className="forte">{l.descricao}</div><div className="mini mudo mono">{l.regra}</div></div> },
            { chave: 'valor_a', titulo: 'Caminho A', alinhar: 'direita', render: (l) => <span className="num">{fmtLado(l.valor_a)}</span> },
            { chave: 'valor_b', titulo: 'Caminho B', alinhar: 'direita', render: (l) => <span className="num">{fmtLado(l.valor_b)}</span> },
            { chave: 'divergencias', titulo: 'Divergências', alinhar: 'direita', render: (l) => <span className="num forte" style={{ color: l.divergencias ? 'var(--critico-texto)' : undefined }}>{fmtNumero(l.divergencias || 0)}</span> },
            { chave: 'detalhe', titulo: 'Detalhe', render: (l) => <span className="pequeno sec">{l.detalhe}</span> },
          ]}
        />
      </Cartao>
    </div>
  );
}
