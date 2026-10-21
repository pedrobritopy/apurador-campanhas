import { useState } from 'react';
import { CheckCircle2, Link2, Search, Users } from 'lucide-react';
import { useApi } from '../../lib/api.js';
import { fmtRelativo } from '../../lib/formato.js';
import { Botao, Carregando, Entrada, ErroCarga, Explica, Selo, Tabela, Vazio } from '../../componentes/ui.jsx';
import { EXPLICA } from '../../lib/explicacoes.jsx';
import { AvatarContato, RotuloCanal, SeloVinculo } from './comum.jsx';
import { ModalVinculo } from './PainelContato.jsx';

export default function Contatos({ aoAbrirConversa }) {
  const [busca, setBusca] = useState('');
  const { dados, erro, carregando, recarregar } = useApi(`/atendimento/contatos${busca.trim() ? `?q=${encodeURIComponent(busca.trim())}` : ''}`);
  const [editando, setEditando] = useState(null);
  if (erro) return <ErroCarga erro={erro} aoTentar={recarregar} />;
  return (
    <div className="coluna g12" style={{ maxWidth: 1180 }}>
      <div className="linha entre quebra">
        <div style={{ width: 340 }}><Entrada icone={Search} placeholder="Buscar nome, @usuário, telefone, e-mail…" value={busca} onChange={(e) => setBusca(e.target.value)} /></div>
        <span className="mudo pequeno linha g4">{dados ? `${dados.length} contato(s)` : ''}<Explica titulo="Contatos" {...EXPLICA.atendimentoContatos} tamanho={13} /></span>
      </div>
      {carregando && !dados ? <Carregando /> : (
        <div className="cartao">
          <Tabela
            linhas={dados || []}
            chaveLinha={(c) => c.id}
            vazio={<Vazio icone={Users} titulo="Nenhum contato ainda" texto="Contatos aparecem quando alguém escreve para o bot ou para o e-mail da central." />}
            ordenacaoInicial={{ chave: 'ultima', dir: 'desc' }}
            colunas={[
              { chave: 'nome', titulo: 'Contato', ordenavel: true, valor: (c) => c.vinculo?.nome || c.nome || '', render: (c) => (
                <div className="linha" style={{ gap: 10 }}>
                  <AvatarContato nome={c.vinculo?.nome || c.nome || c.identificador} canal={c.canal} tamanho="p" />
                  <div className="coluna" style={{ gap: 0, minWidth: 0 }}>
                    <strong className="truncar">{c.vinculo?.nome || c.nome || c.identificador}</strong>
                    <span className="mini mudo truncar">{[c.nome !== c.vinculo?.nome ? c.nome : null, c.username, c.email, c.telefone].filter(Boolean).join(' · ')}</span>
                  </div>
                </div>
              ) },
              { chave: 'canal', titulo: 'Canal', ordenavel: true, render: (c) => <RotuloCanal canal={c.canal} /> },
              { chave: 'vinculo', titulo: 'Quem é', ordenavel: true, valor: (c) => c.vinculo?.tipo || 'z', render: (c) => (
                <div className="linha g4">
                  <SeloVinculo tipo={c.vinculo?.tipo} />
                  {c.vinculo?.equipe && <span className="mini mudo">eq. {c.vinculo.equipe}</span>}
                  {c.verificado && <Selo cor="bom" icone={CheckCircle2} title="Identificação confirmada pelo telefone">confirmado</Selo>}
                </div>
              ) },
              { chave: 'conversas', titulo: 'Conversas', alinhar: 'direita', ordenavel: true },
              { chave: 'ultima', titulo: 'Última mensagem', ordenavel: true, valor: (c) => c.ultima_mensagem_em || '', render: (c) => <span className="mudo pequeno">{c.ultima_mensagem_em ? fmtRelativo(c.ultima_mensagem_em) : '-'}</span> },
              { chave: 'acoes', titulo: '', alinhar: 'direita', render: (c) => (
                <div className="linha g4" style={{ justifyContent: 'flex-end' }} onClick={(e) => e.stopPropagation()}>
                  <Botao tamanho="p" variante="sutil" icone={Link2} onClick={() => setEditando(c)}>Vincular</Botao>
                  {c.conversas > 0 && <Botao tamanho="p" variante="fantasma" onClick={() => aoAbrirConversa(c.id)}>Abrir</Botao>}
                </div>
              ) },
            ]}
          />
        </div>
      )}
      <ModalVinculo aberto={Boolean(editando)} aoFechar={() => setEditando(null)} contato={editando} aoSalvar={recarregar} />
    </div>
  );
}
