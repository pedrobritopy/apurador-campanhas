import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Landmark, XCircle } from 'lucide-react';
import { get, post, qs } from '../../lib/api.js';
import { fmtMoeda } from '../../lib/formato.js';
import { Esqueleto, Explica, Selo, cx } from '../../componentes/ui.jsx';
import { EXPLICA, SITUACAO_CONTA } from './util.js';

/**
 * Saldo da conta corrente de um fabricante e se ele cobre um valor.
 * Uso direto: <SaldoContaCorrente fabricante="Haleon" valorNecessario={30000} />
 * Ou passando a definição da campanha (calcula fabricante e valor a reservar pelo servidor):
 * <SaldoContaCorrente definicao={def} idCampanha={id} />
 */
export default function SaldoContaCorrente({ fabricante, valorNecessario, definicao, idCampanha, compacto = false }) {
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState(null);
  const pedido = useRef(0);
  const chaveDef = definicao ? JSON.stringify([definicao.fabricante, definicao.fornecedor, definicao.varios_fornecedores, definicao.premiacao, definicao.inicio, definicao.fim, definicao.participantes, definicao.criterios?.map((c) => c.produtos)]) : null;

  useEffect(() => {
    const id = ++pedido.current;
    const t = setTimeout(async () => {
      try {
        let r;
        if (definicao && valorNecessario == null) {
          const s = await post('/conta-corrente/simular', { definicao, id_campanha: idCampanha || null });
          r = { ...s.cobertura, necessidade: s.necessidade, ja_reservado: s.ja_reservado, como: s.como };
        } else if (fabricante) {
          r = await get(`/conta-corrente/saldo${qs({ fabricante, valor: valorNecessario || 0 })}`);
        } else r = null;
        if (id === pedido.current) { setDados(r); setErro(null); }
      } catch (e) {
        if (id === pedido.current) setErro(e);
      }
    }, definicao ? 500 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fabricante, valorNecessario, chaveDef, idCampanha]);

  if (erro) return <div className="ccr-saldo mudo pequeno">Não foi possível consultar a conta corrente.</div>;
  if (!fabricante && !definicao) {
    return <div className="ccr-saldo mudo pequeno"><Landmark size={15} /> Escolha o fornecedor para ver a verba disponível.</div>;
  }
  if (!dados) return <div className="ccr-saldo"><Esqueleto altura={14} linhas={2} /></div>;

  const sit = SITUACAO_CONTA[dados.situacao] || SITUACAO_CONTA.ok;
  const necessario = dados.necessario || 0;
  const sobra = dados.capacidade - necessario;
  const Icone = !dados.existe || !dados.cobre ? XCircle : sobra < dados.limite ? AlertTriangle : CheckCircle2;
  const tom = !dados.existe || !dados.cobre ? 'critico' : sobra < dados.limite ? 'aviso' : 'bom';

  return (
    <div className={cx('ccr-saldo', compacto && 'compacto')}>
      <div className="linha entre quebra" style={{ gap: 8 }}>
        <span className="linha g4 forte">
          <Landmark size={15} className="mudo" />
          Conta corrente {dados.nome}
          <Explica titulo="Conta corrente" texto={EXPLICA.disponivel.texto} como={EXPLICA.reservado.como} exemplo={EXPLICA.limite.exemplo} tamanho={13} />
        </span>
        {dados.existe ? <Selo cor={sit.cor} icone={sit.icone}>{sit.rotulo}</Selo> : <Selo cor="critico" icone={XCircle}>Sem conta</Selo>}
      </div>
      <div className="ccr-saldo-numeros">
        <div><span className="r">Disponível</span><span className="v num">{fmtMoeda(dados.disponivel)}</span></div>
        {dados.limite > 0 && <div><span className="r">Limite</span><span className="v num">{fmtMoeda(dados.limite)}</span></div>}
        {necessario > 0 && <div><span className="r">{dados.ja_reservado ? 'A reservar a mais' : 'A reservar'}</span><span className="v num">{fmtMoeda(necessario)}</span></div>}
      </div>
      {dados.necessidade?.texto && <div className="mudo pequeno">{dados.necessidade.texto}</div>}
      {necessario > 0 && (
        <div className={cx('ccr-saldo-veredito', tom)}>
          <Icone size={15} />
          <span>
            {!dados.existe
              ? 'Este fornecedor não tem verba lançada. A campanha não poderá ser ativada sem exceção.'
              : !dados.cobre
                ? `Faltam ${fmtMoeda(dados.falta)}. A campanha não poderá ser ativada sem exceção autorizada.`
                : sobra < dados.limite
                  ? `Cabe, mas usando o limite: depois da reserva a conta fica em ${fmtMoeda(dados.disponivel - necessario)}.`
                  : `Cabe. Depois da reserva sobram ${fmtMoeda(dados.disponivel - necessario)}.`}
          </span>
        </div>
      )}
      {dados.id_conta && <a className="pequeno" href={`#/conta-corrente/${dados.id_conta}`}>Ver extrato da conta</a>}
    </div>
  );
}
