# FRISANCHO AP

Aplicação em português brasileiro para calcular a Circunferência Muscular do Braço (CMB), salvar avaliações e acompanhar pacientes. **Angular + Prisma + PostgreSQL**, conforme solicitado. O cálculo rápido funciona sem conta e sem salvar dados automaticamente.

## Arquitetura

- `apps/web`: Angular 21, componentes standalone, rotas carregadas sob demanda, Reactive Forms, Zod, Tailwind CSS 4 e Lucide. Substitui React/Vite/React Hook Form do documento original por solicitação do usuário.
- `apps/api`: Node.js 24, Express 5, Prisma 6, PostgreSQL, Argon2id e sessões revogáveis em cookie.
- `packages/anthropometry`: funções puras de cálculo, normalização, idade e metadados compartilhados.
- Em produção o Express serve o Angular e a API no mesmo domínio. Rotas desconhecidas de `/api` retornam JSON; as rotas da aplicação permitem atualização da página.
- PDF A4 gerado no servidor com PDFKit, Inter incorporada (licença SIL Open Font License) e sem dependência de Chromium. A mesma fonte é servida localmente no frontend. Há também impressão HTML no navegador.

Angular 21 foi escolhido por compatibilidade com TypeScript 5.9, Node.js 24 e Lucide Angular 1.0. Prisma 6 mantém o cliente e as migrações neste projeto. O lockfile registra as versões efetivamente instaladas. Overrides de `effect` e `deepmerge-ts` corrigem avisos transitivos da CLI Prisma; geração e migrações foram verificadas com eles.

## Executar localmente — Windows

Requisitos: Node.js 24 e npm. No PowerShell use `npm.cmd` e `npx.cmd` se a execução de scripts `.ps1` estiver bloqueada. Não é necessário alterar a política do Windows.

```powershell
npm.cmd ci
npm.cmd run local:setup
npm.cmd run db:generate
npm.cmd run build
```

Em um terminal separado, inicie o PostgreSQL de desenvolvimento:

```powershell
npm.cmd run local:db
```

O script usa PostgreSQL real, disponível pelo pacote `embedded-postgres`, escuta apenas em `127.0.0.1:54329` e persiste em `.local/postgres`. É uma facilidade de desenvolvimento; a publicação usa um serviço PostgreSQL persistente externo. A senha local é aleatória, fica em `.env` ignorado pelo Git e não é exibida.

Depois:

```powershell
npm.cmd run db:migrate
node --env-file=.env apps/api/dist/server.js
```

Abra **http://localhost:3000**. `GET /api/v1/health` informa a conexão com o banco. A configuração local usa `APP_ORIGIN=http://localhost:3000`; use exatamente esse endereço para cadastro e login.

Também é possível usar PostgreSQL próprio ou Docker: copie `.env.example` para `.env`, ajuste `DATABASE_URL` e aplique as migrações. No Docker, use armazenamento persistente e configure credenciais em ambiente, sem incluí-las na imagem.

## Desenvolvimento com atualização automática

Com o banco iniciado, altere `.env` para `APP_ORIGIN=http://localhost:4200`, rode `npm.cmd run build -w @frisancho/anthropometry` e `npm.cmd run dev`. Acesse http://localhost:4200; o dev server Angular encaminha `/api` ao Express na porta 3000. Alterações no pacote compartilhado exigem recompilar esse pacote.

## Uso

1. Preencha idade, CB em cm e DCT em mm; vírgula e ponto decimal são aceitos. Campos começam vazios.
2. Clique em **Calcular avaliação**. O resultado anterior é invalidado quando qualquer entrada da avaliação muda.
3. **Carregar exemplo** insere um caso fictício de 76 anos, CB 30 cm, DCT 16 mm e CMB anterior 25 cm. O exemplo nunca é salvo automaticamente.
4. Crie uma conta, cadastre um paciente e selecione-o antes de salvar. Com nascimento, a idade é derivada na data da avaliação.
5. No histórico, filtre, consulte, emita PDF, imprima, edite com recálculo ou exclua com confirmação.
6. Configurações permite exportar dados e excluir conta com senha e confirmação.

## Cálculo e referência

`CMB = CB − Math.PI × (DCT_mm / 10)`. CB 30 e DCT 16 produzem `24.97345175425633 cm`, exibidos como **24,97 cm**. Nenhum resultado intermediário é arredondado. Combinações com CMB não positiva são rejeitadas. Peso e altura não são estimados; quando medidos, ambos permitem somente IMC numérico.

Frisancho 1981 abrange 1 a 74 anos, com categorias por idade e sexo. Há apenas metadados bibliográficos, **sem tabela numérica validada/licenciada**. Percentil e classificação permanecem `null`. Aos 76 anos, os motivos de idade fora da cobertura, sexo ausente e tabela indisponível são mostrados separadamente. A indisponibilidade de interpretação não impede o cálculo. O sistema não gera diagnóstico nem prescrição.

Fonte original: [Frisancho 1981 — resumo do periódico](https://ajcn.nutrition.org/article/S0002-9165%2823%2943220-0/abstract), [registro PubMed](https://pubmed.ncbi.nlm.nih.gov/6975564/). DOI: 10.1093/ajcn/34.11.2540. Não foram extraídas tabelas de terceiros.

## Validação e publicação

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
npx.cmd playwright install chromium
npm.cmd run test:e2e
npm.cmd audit
npm.cmd run package
```

`npm test` cria um schema temporário isolado no PostgreSQL local, aplica as migrações, executa os testes e remove exclusivamente esse schema. Não execute testes contra um banco de produção. `npm run test:unit` não exige banco. E2E cria contas e pacientes fictícios e remove os dados de teste ao finalizar.

O pacote de publicação é `dist/frisancho-ap-squarecloud.zip`, com JavaScript compilado, Angular compilado, migrações, dependências de produção e lockfile próprio. Não contém `.env`, banco local ou `node_modules`.

- [Publicação na Square Cloud e Cloudflare](docs/DEPLOY.md)
- [PostgreSQL Square Cloud: certificados, inventário, migrations e transferência](docs/BANCO_SQUARE_CLOUD.md)
- [Segurança, backup, retenção e restauração](docs/OPERACAO.md)
- [Resultados e limitações das verificações](docs/VERIFICACAO.md)
- [Revisão do layout, diagnóstico de CSS e capturas finais](docs/LAYOUT.md)
- [OpenAPI completo](docs/openapi.json), também em `/api/v1/openapi.json`

Ainda dependem do responsável: domínio definitivo, disponibilidade do subdomínio, plano Square Cloud, PostgreSQL de produção, variáveis de ambiente, topologia de proxy, política de retenção/backup e eventual fonte tabulada autorizada. Nenhuma publicação externa foi realizada.
