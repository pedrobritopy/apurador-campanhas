import { AlertTriangle, CheckCircle2, Clock, Loader2, Play, RotateCcw, Workflow } from 'lucide-react';
import { post, useApi } from '../../lib/api.js';
import { fmtDataHora, fmtNumero, fmtRelativo } from '../../lib/formato.js';
import { Botao, Cartao, Carregando, Selo, useToast } from '../../componentes/ui.jsx';

const NOMES = {
  base: 'Base e filtros',
  apuracao: 'Apuração das campanhas',
  insights: 'Alertas da Central de insights',
  planos: 'Planos de ataque',
  conhecimento: 'Base de conhecimento da IA',
  detalhes: 'Boletins, detalhes e Excel',
  'mapa-malhas': 'Mapa: limites de cidades e bairros',
  'mapa-posicoes': 'Mapa: posição de farmácias e clientes',
  'mapa-resumo': 'Mapa: números por cidade e UF',
  'mapa-bairros': 'Mapa: números por bairro',
  'mapa-territorios': 'Mapa: territórios e desenhos',
};

const SITUACAO = {
  ok: { rotulo: 'Em dia', cor: 'bom', icone: CheckCircle2 },
  rodando: { rotulo: 'Processando', cor: 'acento', icone: Loader2 },
  pendente: { rotulo: 'Na fila', cor: 'neutro', icone: Clock },
  aguardando: { rotulo: 'Aguardando', cor: 'aviso', icone: Clock },
  erro: { rotulo: 'Erro', cor: 'critico', icone: AlertTriangle },
};

const GATILHO = {
  importacao: 'importação', dia: 'virada do dia', campanha: 'campanha alterada', plano: 'plano registrado',
  conta_corrente: 'conta corrente', config: 'configuração', receita: 'Receita Federal', territorio: 'território',
};

const fmtDuracao = (ms) => (ms == null ? '-' : ms < 1000 ? `${fmtNumero(ms)} ms` : ms < 60000 ? `${fmtNumero(ms / 1000, 1)} s` : `${fmtNumero(ms / 60000, 1)} min`);

const INFO = {
  titulo: 'Pipeline de dados',
  texto: 'Tudo que é pesado (apurar campanhas, montar boletins, planos, alertas, mapa) é calculado aqui, em segundo plano, e guardado pronto. Quando você abre uma tela, ela só lê o resultado, por isso abre na hora, mesmo depois de reiniciar o sistema.',
  como: [
    'Roda sozinha quando chegam dados novos, quando uma campanha é criada ou alterada, quando um plano ou lançamento da conta corrente é registrado, quando você desenha um território e na virada do dia.',
    'Cada etapa só refaz o que mudou. "Em dia" quer dizer que nada mudou desde a última vez.',
    'Enquanto processa, aparece "Atualizando dados..." no topo e as telas continuam mostrando o último resultado; quando termina, elas se atualizam sozinhas.',
    '"Processar agora" confere tudo; "Refazer tudo" recalcula mesmo o que está em dia (use se algo parecer errado).',
  ],
  exemplo: 'Você importa as vendas de ontem: a apuração das 10 campanhas é refeita em uns 3 s, depois alertas, planos e boletins. O Painel abre em menos de 0,2 s.',
};

export default function CartaoPipeline() {
  const toast = useToast();
  const { dados, recarregar } = useApi('/pipeline', { intervalo: 3000 });

  const executar = async (forcar) => {
    try {
      await post('/pipeline/executar', { forcar });
      toast.ok(forcar ? 'Recalculando tudo em segundo plano.' : 'Conferindo e processando o que mudou.');
      recarregar();
    } catch (e) {
      toast.erro(e.message);
    }
  };

  const ultima = dados?.ultima_execucao;
  return (
    <Cartao
      titulo="Pipeline de dados"
      subtitulo={dados?.rodando ? `Processando: ${NOMES[dados.etapa_atual] || dados.etapa_atual || 'preparando'}` : ultima?.fim ? `Última execução ${fmtRelativo(ultima.fim)} (${fmtDuracao(ultima.duracao_ms)})` : 'Prepara os números em segundo plano'}
      info={INFO}
      acoes={(
        <>
          <Botao tamanho="p" variante="fantasma" icone={RotateCcw} onClick={() => executar(true)} disabled={dados?.rodando}>Refazer tudo</Botao>
          <Botao tamanho="p" icone={Play} onClick={() => executar(false)} carregando={dados?.rodando}>Processar agora</Botao>
        </>
      )}
      semMargem
    >
      {!dados ? <Carregando altura={160} /> : (
        <div className="pipe-lista">
          {dados.etapas.map((e) => {
            const s = SITUACAO[e.status] || SITUACAO.pendente;
            return (
              <div key={e.nome} className="pipe-etapa">
                <span className={`pipe-ic ${s.cor}`}><Workflow size={15} /></span>
                <div style={{ minWidth: 0 }}>
                  <div className="linha" style={{ gap: 8 }}>
                    <span className="forte pequeno">{NOMES[e.nome] || e.nome}</span>
                    <Selo cor={s.cor} icone={s.icone}>{s.rotulo}</Selo>
                  </div>
                  <div className="mini mudo">{e.descricao}</div>
                  {e.erro && <div className="mini" style={{ color: 'var(--critico-texto)', marginTop: 2 }}>{e.erro}</div>}
                  {e.gatilhos?.length > 0 && <div className="mini mudo" style={{ marginTop: 2 }}>Roda com: {e.gatilhos.map((g) => GATILHO[g] || g).join(', ')}{e.depende?.length ? ` · depois de ${e.depende.map((d) => NOMES[d] || d).join(', ')}` : ''}</div>}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="num pequeno">{fmtDuracao(e.duracao_ms)}</div>
                  <div className="mini mudo" title={e.fim ? fmtDataHora(e.fim) : ''}>{e.status === 'rodando' ? 'em andamento' : e.fim ? fmtRelativo(e.fim) : 'ainda não rodou'}</div>
                  {e.linhas != null && <div className="mini mudo">{fmtNumero(e.linhas)} itens</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Cartao>
  );
}
