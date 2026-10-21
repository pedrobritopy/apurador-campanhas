import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import express from 'express';
import { RAIZ, contarLinhas } from './db.js';

try {
  process.loadEnvFile(path.join(RAIZ, '.env'));
} catch {
  /* sem .env: IA e Receita ficam desabilitadas */
}

const DEV = process.argv.includes('--dev');
const PORTA = Number(process.env.PORT || 3210);

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '20mb' }));
app.use('/api/importar/arquivo', express.raw({ type: '*/*', limit: '512mb' }));

// Rotas: cada arquivo em server/rotas exporta `default (app) => void` e, opcionalmente, `iniciar()`.
const pastaRotas = path.join(RAIZ, 'server', 'rotas');
const modulos = [];
for (const arq of fs.readdirSync(pastaRotas).filter((f) => f.endsWith('.js')).sort()) {
  const mod = await import(pathToFileURL(path.join(pastaRotas, arq)).href);
  if (typeof mod.default === 'function') mod.default(app);
  modulos.push({ nome: arq, mod });
}

// Imagens do DW (fotos dos vendedores etc.), nomeadas como na coluna "imagem" das dimensões.
app.use('/imagens', express.static(path.join(RAIZ, 'dados', 'imagens'), { maxAge: '7d', fallthrough: false }));

app.use('/api', (req, res) => res.status(404).json({ erro: `Rota não encontrada: ${req.method} ${req.originalUrl}` }));

// Erros: mensagem amigável em JSON
app.use((err, req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(`[erro] ${req.method} ${req.originalUrl}:`, err);
  res.status(status).json({ erro: err.message || 'Erro inesperado', ...(err.erros ? { erros: err.erros } : {}), ...(err.detalhes ? { detalhes: err.detalhes } : {}) });
});

// Frontend: Vite em modo middleware (dev) ou arquivos estáticos (produção)
if (DEV) {
  const { createServer } = await import('vite');
  const vite = await createServer({ configFile: path.join(RAIZ, 'vite.config.js'), server: { middlewareMode: true, hmr: { port: PORTA + 10000 } }, appType: 'spa' });
  app.use(vite.middlewares);
} else {
  const dist = path.join(RAIZ, 'web', 'dist');
  if (!fs.existsSync(dist)) {
    console.error('Frontend não compilado. Rode "npm start" (compila e sobe) ou "npm run dev".');
  }
  app.use(express.static(dist, { maxAge: '1h', index: 'index.html' }));
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

// Inicialização: carga de dados na primeira execução, exemplos, agendador, módulos.
const { inicializar } = await import('./inicializacao.js');
// APURADOR_SEM_TAREFAS=1: instância só de leitura (medições/testes), sem agendador, bots e pipeline
const semTarefas = process.env.APURADOR_SEM_TAREFAS === '1';
if (!semTarefas) await inicializar();
for (const { nome, mod } of semTarefas ? [] : modulos) {
  if (typeof mod.iniciar === 'function') {
    try {
      await mod.iniciar();
    } catch (e) {
      console.error(`[inicializacao] ${nome}:`, e.message);
    }
  }
}

app.listen(PORTA, () => {
  console.log(`\n  Apurador de Campanhas rodando em http://localhost:${PORTA}  (${DEV ? 'desenvolvimento' : 'produção'})`);
  console.log(`  ${contarLinhas('fato_vendas').toLocaleString('pt-BR')} linhas de venda · ${contarLinhas('campanha')} campanhas\n`);
});
