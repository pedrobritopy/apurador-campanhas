import { useMemo, useState } from 'react';
import { Inbox, MessageCircle, RefreshCw, Search } from 'lucide-react';
import { post, qs, useApi } from '../../lib/api.js';
import { fmtDataHora, fmtNumero, fmtRelativo } from '../../lib/formato.js';
import {
  Botao, Cartao, Carregando, Entrada, ErroCarga, Explica, Gaveta, Selo, Seletor, Tabela, Vazio, useToast,
} from '../../componentes/ui.jsx';
import { EXPLICA } from '../../lib/explicacoes.jsx';
import TextoMensagem, { InfosMensagem } from './TextoMensagem.jsx';
import { CANAIS, CANAL, STATUS_DISPARO, linkWhatsapp, opcoesCampanhas } from '../sistema/comum.js';

/** contato pode vir como texto (telefone/e-mail) ou objeto { telefone, email } */
const contatoTexto = (c) => (c && typeof c === 'object' ? c.telefone || c.email || '' : c || '');

function SeloDisparo({ status }) {
  const s = STATUS_DISPARO[status] || { rotulo: status || '-', cor: 'neutro' };
  return <Selo cor={s.cor} icone={s.icone}>{s.rotulo}</Selo>;
}

export default function Historico({ campanhaInicial }) {
  const toast = useToast();
  const [idCampanha, setIdCampanha] = useState(campanhaInicial ? String(campanhaInicial) : '');
  const { dados, erro, carregando, recarregar, setDados } = useApi(`/disparos${qs({ campanha: idCampanha, limite: 500 })}`);
  const { dados: campanhas } = useApi('/campanhas');
  const [canal, setCanal] = useState('');
  const [status, setStatus] = useState('');
  const [busca, setBusca] = useState('');
  const [aberto, setAberto] = useState(null);

  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return (dados || []).filter((d) =>
      (!canal || d.canal === canal)
      && (!status || d.status === status)
      && (!q || `${d.destinatario || ''} ${contatoTexto(d.contato)} ${d.assunto || ''} ${d.mensagem || ''} ${d.campanha || ''}`.toLowerCase().includes(q)));
  }, [dados, canal, status, busca]);

  const contagem = useMemo(() => {
    const c = { total: (dados || []).length };
    for (const d of dados || []) c[d.status] = (c[d.status] || 0) + 1;
    return c;
  }, [dados]);

  async function marcarEnviado(d) {
    const url = linkWhatsapp(d.contato?.telefone ?? contatoTexto(d.contato), d.mensagem);
    if (url) window.open(url, '_blank', 'noopener');
    try {
      await post(`/disparos/${d.id}/marcar`, { status: 'enviado' });
      setDados((l) => l.map((x) => (x.id === d.id ? { ...x, status: 'enviado' } : x)));
      setAberto((a) => (a && a.id === d.id ? { ...a, status: 'enviado' } : a));
    } catch (e) {
      toast.erro(e.message);
    }
  }

  const colunas = [
    { chave: 'criado_em', titulo: 'Quando', ordenavel: true, largura: 130, valor: (d) => d.criado_em, render: (d) => <span className="pequeno" title={fmtDataHora(d.criado_em)}>{fmtRelativo(d.criado_em)}</span> },
    { chave: 'destinatario', titulo: 'Destinatário', ordenavel: true, valor: (d) => d.destinatario || '', render: (d) => (
      <div style={{ minWidth: 0 }}>
        <div className="pequeno forte truncar" style={{ maxWidth: 220 }}>{d.destinatario || '-'}</div>
        <div className="mini mudo truncar" style={{ maxWidth: 220 }}>{contatoTexto(d.contato) || 'sem contato'}</div>
      </div>
    ) },
    { chave: 'campanha', titulo: 'Campanha', ordenavel: true, valor: (d) => d.campanha || '', render: (d) => <span className="pequeno truncar" style={{ display: 'block', maxWidth: 200 }}>{d.campanha || '-'}</span> },
    { chave: 'canal', titulo: 'Canal', ordenavel: true, render: (d) => {
      const c = CANAL[d.canal];
      return c ? <span className="linha g4 pequeno"><c.icone size={13} />{c.rotulo}</span> : d.canal;
    } },
    { chave: 'mensagem', titulo: 'Mensagem', render: (d) => <span className="pequeno sec truncar" style={{ display: 'block', maxWidth: 340 }}>{d.assunto || String(d.mensagem || '').replace(/[*_~]/g, '').slice(0, 120)}</span> },
    { chave: 'status', titulo: 'Situação', ordenavel: true, render: (d) => <SeloDisparo status={d.status} /> },
  ];

  if (erro && !dados) return <ErroCarga erro={erro} aoTentar={recarregar} />;

  return (
    <div className="coluna" style={{ gap: 14 }}>
      <div className="linha quebra" style={{ gap: 8 }}>
        <Seletor opcoes={opcoesCampanhas(campanhas || [], { incluirTodas: 'Todas as campanhas' })} valor={idCampanha} aoMudar={setIdCampanha} style={{ width: 280 }} />
        <Seletor opcoes={[{ valor: '', rotulo: 'Todos os canais' }, ...CANAIS.map((c) => ({ valor: c.valor, rotulo: c.rotulo }))]} valor={canal} aoMudar={setCanal} style={{ width: 170 }} />
        <Seletor opcoes={[{ valor: '', rotulo: 'Todas as situações' }, ...Object.entries(STATUS_DISPARO).map(([k, v]) => ({ valor: k, rotulo: v.rotulo }))]} valor={status} aoMudar={setStatus} style={{ width: 180 }} />
        <Entrada icone={Search} placeholder="Buscar pessoa, contato ou texto" value={busca} onChange={(e) => setBusca(e.target.value)} style={{ width: 260 }} />
        <div className="cresce" />
        <Botao variante="fantasma" icone={RefreshCw} carregando={carregando && Boolean(dados)} onClick={recarregar}>Atualizar</Botao>
      </div>

      <div className="hist-resumo">
        <Selo cor="contorno">{fmtNumero(contagem.total)} mensagens</Selo>
        <Explica titulo="Caixa de saída" {...EXPLICA.historico} tamanho={13} />
        {Object.entries(STATUS_DISPARO).map(([k, v]) => (contagem[k] ? <Selo key={k} cor={v.cor} icone={v.icone}>{fmtNumero(contagem[k])} {v.rotulo.toLowerCase()}{contagem[k] > 1 && k !== 'erro' ? 's' : ''}</Selo> : null))}
      </div>

      <Cartao semMargem>
        {!dados ? <Carregando /> : (
          <Tabela
            colunas={colunas}
            linhas={lista}
            chaveLinha={(d) => d.id}
            aoClicarLinha={setAberto}
            ordenacaoInicial={{ chave: 'criado_em', dir: 'desc' }}
            maxAltura="calc(100vh - 320px)"
            vazio={<Vazio icone={Inbox} titulo="Caixa de saída vazia" texto="As mensagens disparadas e agendadas aparecem aqui." />}
          />
        )}
      </Cartao>

      <Gaveta aberto={Boolean(aberto)} aoFechar={() => setAberto(null)} titulo={aberto?.destinatario || 'Mensagem'} subtitulo={aberto ? `${aberto.campanha || ''} · ${fmtDataHora(aberto.criado_em)}` : ''} largura={620}
        acoes={aberto?.canal === 'whatsapp' && aberto?.status !== 'enviado' && contatoTexto(aberto?.contato)
          ? <Botao variante="primario" tamanho="p" icone={MessageCircle} onClick={() => marcarEnviado(aberto)}>Abrir no WhatsApp</Botao> : null}>
        {aberto && (
          <div className="coluna" style={{ gap: 14 }}>
            <div className="linha quebra" style={{ gap: 8 }}>
              <SeloDisparo status={aberto.status} />
              {CANAL[aberto.canal] && <Selo icone={CANAL[aberto.canal].icone}>{CANAL[aberto.canal].rotulo}</Selo>}
              {contatoTexto(aberto.contato) && <Selo cor="contorno">{contatoTexto(aberto.contato)}</Selo>}
            </div>
            {aberto.erro && <div className="aviso-caixa erro">{aberto.erro}</div>}
            <InfosMensagem texto={aberto.mensagem} />
            {aberto.assunto && <div className="pequeno"><span className="mudo">Assunto:</span> <strong>{aberto.assunto}</strong></div>}
            <div className="whats-fundo">
              <div className="whats-bolha"><TextoMensagem texto={aberto.mensagem} /><span className="hora">{fmtDataHora(aberto.criado_em).slice(11)}</span></div>
            </div>
          </div>
        )}
      </Gaveta>
    </div>
  );
}
