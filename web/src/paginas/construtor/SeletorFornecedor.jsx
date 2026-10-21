import { useMemo } from 'react';
import { Building2 } from 'lucide-react';
import MultiSelecao from '../../componentes/MultiSelecao.jsx';
import { Alternador, Campo } from '../../componentes/ui.jsx';
import { fmtNumero } from '../../lib/formato.js';
import { VARIOS_FORNECEDORES } from './util.js';
import { LogoFabricante, LogoMarca } from '../../componentes/Imagens.jsx';

const INFO = {
  texto: 'O fabricante dono da campanha, puxado do cadastro de produtos. Ele define quais produtos os critérios usam por padrão e aparece nos boletins, no regulamento e nos relatórios.',
  como: [
    'Digite parte do nome e escolha na lista (ex.: "hyp" acha Hypera Pharma).',
    'Os critérios passam a contar só os produtos desse fabricante. Depois você pode refinar por marca.',
    'Se a campanha vale para produtos de vários fabricantes (meta geral, uma categoria inteira), ligue "Vários fornecedores".',
  ],
  exemplo: 'Campanha Sensodyne: escolha Haleon e, no critério, refine para a marca Sensodyne.',
};

/** Fornecedor da campanha: um fabricante da base (obrigatório) ou, de forma explícita, vários fornecedores. */
export default function SeletorFornecedor({ def, dim, aoEscolher }) {
  const fabs = dim?.fabricantes || [];
  const atual = fabs.find((f) => f.nome === def.fabricante);
  const opcoes = useMemo(
    () => fabs.map((f) => ({ valor: f.nome, rotulo: f.nome, icone: <LogoFabricante nome={f.nome} tamanho={20} />, detalhe: `${fmtNumero(f.produtos)} produtos · ${f.marcas.slice(0, 3).join(', ')}${f.marcas.length > 3 ? '…' : ''}` })),
    [fabs],
  );
  const pendente = !def.fabricante && !def.varios_fornecedores;

  return (
    <div className="cons-fornecedor">
      <Campo rotulo="Fornecedor da campanha" info={INFO}>
        {def.varios_fornecedores ? (
          <div className="cons-fornecedor-card">
            <span className="cons-fornecedor-icone"><Building2 size={16} /></span>
            <div className="coluna" style={{ gap: 2 }}>
              <span className="forte">Vários fornecedores</span>
              <span className="pequeno mudo">Cada critério escolhe os próprios produtos, de qualquer fabricante.</span>
            </div>
          </div>
        ) : (
          <MultiSelecao unico opcoes={opcoes} valores={def.fabricante ? [def.fabricante] : []} aoMudar={(v) => aoEscolher(v[0] || null)}
            placeholder={`Busque entre os ${fabs.length} fabricantes cadastrados (ex.: Haleon, Hypera, EMS)`} />
        )}
        {pendente && <span className="campo-erro">Obrigatório: escolha o fabricante ou ligue "Vários fornecedores".</span>}
      </Campo>
      {atual && (
        <div className="cons-fornecedor-marcas">
          <LogoFabricante nome={atual.nome} tamanho={36} />
          <span className="mudo pequeno">{fmtNumero(atual.produtos)} produtos em {atual.marcas.length} marca{atual.marcas.length > 1 ? 's' : ''}:</span>
          {atual.marcas.map((m) => <span key={m} className="selo linha g4" style={{ paddingLeft: 3 }}><LogoMarca nome={m} tamanho={16} />{m}</span>)}
        </div>
      )}
      <Alternador ligado={def.varios_fornecedores} rotulo="Vários fornecedores"
        descricao="Ligue quando a campanha não é de um fabricante só, como a meta geral do mês ou uma categoria com várias indústrias."
        aoMudar={(on) => aoEscolher(on ? VARIOS_FORNECEDORES : null)} />
    </div>
  );
}
