# Verificações — 08/10/2026

Etapa de banco em 09/10/2026: migration local aplicada após backup/restauração isolada; 64 testes PostgreSQL/unitários e seis E2E aprovados, além de 15 cenários TLS/processo. O banco da Square Cloud ainda não foi acessado. [Evidências e pendências](BANCO_SQUARE_CLOUD.md).

Revisão adicional em 09/10/2026: layout reconstruído, build/TypeScript/ESLint e seis E2E novamente aprovados. CSS, estilos computados e screenshots conferidos em desenvolvimento e produção nas quatro larguras. Detalhes e evidências em [LAYOUT.md](LAYOUT.md). Os resultados abaixo documentam a validação anterior da aplicação completa.

Ambiente: Windows, Node.js 24.19.0, PostgreSQL real local na porta 54329; Prisma Client 6.19.0. Banco UTF-8, migração inicial aplicada. Angular 21 substitui React conforme pedido.

## Verificado

- Build de API, pacote compartilhado e Angular de produção.
- Checagem TypeScript e templates Angular; ESLint.
- 37 testes unitários: fórmula, unidades, precisão, diferença informada, decimal com vírgula, valores inválidos, fronteiras dos metadados etários, motivos simultâneos, IMC numérico e idade histórica.
- 17 testes de integração com PostgreSQL/Prisma em schema isolado: autenticação, propriedade entre usuários, CSRF/origem, validação, datas históricas, idempotência, filtros, revisão concorrente, auditoria, PDF, cache, exportação, exclusão e logout.
- 6 testes E2E Chromium: cálculo e falha de rede; fluxo completo autenticado; navegação e layout em 360/768/1024/1440 px.
- Revisão visual das capturas das telas e do relatório A4. A revisão visual identificou o carregamento diferido do CSS do Angular bloqueado pelo CSP; a otimização inlineCritical foi desativada para carregar o CSS por link normal, preservando a proteção contra scripts inline.
- Auditoria npm sem vulnerabilidades após atualização do Vitest e correções transitivas da CLI Prisma.
- Pacote de publicação com build e sem segredos; lockfile de produção independente.
- Pacote extraído em diretório separado no Windows, instalado com `npm ci --omit=dev`, Prisma Client gerado pelo postinstall e iniciado em `NODE_ENV=production`. Health confirmou PostgreSQL conectado, cálculo retornou 24,97 cm e index Angular foi servido. Isso não substitui um teste do provedor Linux.

## Limitações e pendências

- Não há tabela clínica validada/licenciada carregada; classificação e percentil são null. As fronteiras testadas são da cobertura bibliográfica; não se declara validação de uma tabela numérica inexistente.
- Não foi testado deploy real, DNS, certificado, plano contratado, PostgreSQL de produção, carga sustentada ou restauração de backup do provedor.
- O Angular informa aviso de bundle inicial em torno de 781 kB brutos (cerca de 163 kB transferidos), acima do alvo de aviso de 750 kB e abaixo do limite de erro de 1 MB. O build conclui; telas secundárias são carregadas sob demanda.
- A comparação usa registros reais da página atual de um paciente e identifica esse recorte. Não faz interpretação automática de tendências.
- PDFKit não depende de Chromium para o PDF do servidor. Os campos textuais são limitados para reduzir risco de cortes; os relatórios representativos precisam ser novamente verificados se forem alterados layout ou limites de texto.
- A aplicação local está disponível em http://localhost:3000. O navegador integrado e o controle nativo não estavam disponíveis; a abertura de navegador por comando foi bloqueada pela revisão automática. Não se afirma que uma aba visível foi aberta no computador do usuário.
