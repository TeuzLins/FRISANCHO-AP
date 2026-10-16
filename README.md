<div align="center">

[![Angular](https://img.shields.io/badge/Angular-21-DD0031?style=flat-square&logo=angular&logoColor=white)](https://angular.dev)
[![Node.js](https://img.shields.io/badge/Node.js-24-339933?style=flat-square&logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://typescriptlang.org)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791?style=flat-square&logo=postgresql&logoColor=white)](https://postgresql.org)
[![Prisma](https://img.shields.io/badge/Prisma-6-2D3748?style=flat-square&logo=prisma&logoColor=white)](https://prisma.io)

![FRISANCHO AP — banner](docs/banner.png)

**Avaliação antropométrica · Cálculo da CMB · Histórico de pacientes**

</div>

---

![Interface — Nova Avaliação](docs/screenshot.png)

---

## Sobre o projeto

**FRISANCHO AP** é uma aplicação web em português brasileiro para cálculo da Circunferência Muscular do Braço (CMB), cadastro de pacientes e acompanhamento longitudinal de avaliações antropométricas.

O cálculo rápido está disponível sem conta e sem persistência de dados. O cadastro desbloqueia histórico, emissão de PDF A4 e exportação. O sistema **não gera diagnóstico nem prescrição**; a interpretação clínica é de responsabilidade do profissional.

**Referência:** Frisancho AR, 1981 — [resumo do periódico](https://ajcn.nutrition.org/article/S0002-9165%2823%2943220-0/abstract) · [PubMed](https://pubmed.ncbi.nlm.nih.gov/6975564/) · DOI: 10.1093/ajcn/34.11.2540. Sem tabela numérica validada/licenciada; percentil e classificação permanecem `null`.

## Funcionalidades

- **Cálculo instantâneo** de CMB (`CB − π × DCT_mm / 10`) sem arredondamentos intermediários; rejeita combinações com CMB ≤ 0
- **Cálculo sem conta** — rápido, sem armazenamento automático
- **Cadastro de pacientes** com nascimento e derivação automática de idade na data da avaliação
- **Histórico** com filtro, consulta, edição com recálculo, exclusão com confirmação e emissão de PDF A4
- **PDF no servidor** gerado com PDFKit e fonte Inter incorporada (SIL OFL); impressão HTML disponível no navegador
- **Interpretação contextual** — exibe motivos separados para idade fora da cobertura, sexo ausente e tabela indisponível
- **Exportação de dados** e exclusão de conta com senha e confirmação
- Aceita vírgula e ponto como separador decimal

## Stack tecnológica

| Camada | Tecnologia | Versão |
| --- | --- | --- |
| Frontend | Angular — standalone, rotas lazy, Reactive Forms | 21 |
| Estilização | Tailwind CSS | 4 |
| Ícones | Lucide Angular | 1.0 |
| Validação | Zod | — |
| Backend | Node.js + Express | 24 / 5 |
| ORM | Prisma | 6 |
| Banco de dados | PostgreSQL | — |
| Autenticação | Argon2id + sessões em cookie revogáveis | — |
| PDF | PDFKit + Inter (SIL OFL) | — |
| Dev DB local | embedded-postgres (127.0.0.1:54329) | — |
| Linguagem | TypeScript | 5.9 |
| Cálculo compartilhado | `@frisancho/anthropometry` (pacote puro) | — |

## Arquitetura

```
frisancho-ap/
├── apps/
│   ├── web/          # Angular 21 — frontend compilado
│   └── api/          # Express 5 — API REST + servidor de arquivos estáticos
├── packages/
│   └── anthropometry/ # Funções puras: cálculo, normalização, idade, metadados
└── docs/             # OpenAPI, guias de deploy e operação
```

Em produção, o Express serve o Angular e a API no mesmo domínio (`/api/v1/*` → handlers; demais rotas → `index.html`). Rotas desconhecidas de `/api` retornam JSON. O pacote `@frisancho/anthropometry` é compartilhado e requer recompilação manual ao alterar.

## Início rápido — Windows

**Requisitos:** Node.js 24 e npm. Use `npm.cmd` e `npx.cmd` no PowerShell se scripts `.ps1` estiverem bloqueados.

```powershell
# 1. Instalar dependências
npm.cmd ci

# 2. Configurar ambiente local e gerar o cliente Prisma
npm.cmd run local:setup
npm.cmd run db:generate

# 3. Compilar
npm.cmd run build

# 4. Em um terminal separado — iniciar o PostgreSQL local
npm.cmd run local:db
# Escuta em 127.0.0.1:54329 · persiste em .local/postgres · senha em .env (ignorado pelo Git)

# 5. Aplicar migrações e iniciar
npm.cmd run db:migrate
node --env-file=.env apps/api/dist/server.js
```

Acesse **http://localhost:3000** (use exatamente este endereço para cadastro e login). `GET /api/v1/health` confirma a conexão com o banco.

> Para usar PostgreSQL próprio ou Docker, copie `.env.example` → `.env`, ajuste `DATABASE_URL` e aplique as migrações.

## Desenvolvimento com atualização automática

Com o banco em execução, altere `.env` para `APP_ORIGIN=http://localhost:4200` e rode:

```powershell
# Recompilar o pacote compartilhado sempre que alterá-lo
npm.cmd run build -w @frisancho/anthropometry

# Iniciar API (porta 3000) e dev server Angular (porta 4200) em paralelo
npm.cmd run dev
```

Acesse **http://localhost:4200**. O dev server Angular encaminha `/api` ao Express na porta 3000.

## Testes e validação

```powershell
# Verificação de tipos e linting
npm.cmd run typecheck
npm.cmd run lint

# Testes de integração (requer banco local ativo)
# Cria schema temporário isolado, aplica migrações, executa e remove
npm.cmd test

# Testes unitários sem banco
npm.cmd run test:unit

# Testes E2E com Playwright (cria e remove dados fictícios ao finalizar)
npx.cmd playwright install chromium
npm.cmd run test:e2e

# Auditoria de dependências
npm.cmd audit
```

> Não execute `npm test` contra um banco de produção.

## Publicação

```powershell
npm.cmd run package
# Saída: dist/frisancho-ap-squarecloud.zip
```

O ZIP contém JavaScript compilado, Angular compilado, migrações, dependências de produção e lockfile próprio. **Não contém** `.env`, banco local ou `node_modules`.

| Guia | Conteúdo |
| --- | --- |
| [DEPLOY.md](docs/DEPLOY.md) | Publicação na Square Cloud e Cloudflare |
| [BANCO_SQUARE_CLOUD.md](docs/BANCO_SQUARE_CLOUD.md) | PostgreSQL Square Cloud: certificados, inventário e migrações |
| [OPERACAO.md](docs/OPERACAO.md) | Segurança, backup, retenção e restauração |
| [VERIFICACAO.md](docs/VERIFICACAO.md) | Resultados e limitações das verificações |
| [LAYOUT.md](docs/LAYOUT.md) | Revisão do layout e capturas finais |
| [openapi.json](docs/openapi.json) | Documentação completa da API |

> Pendências do responsável: domínio definitivo, plano Square Cloud, PostgreSQL de produção, variáveis de ambiente e política de retenção.

## Referências

- [Frisancho 1981 — resumo do periódico](https://ajcn.nutrition.org/article/S0002-9165%2823%2943220-0/abstract)
- [PubMed 6975564](https://pubmed.ncbi.nlm.nih.gov/6975564/) · DOI: 10.1093/ajcn/34.11.2540
- [OpenAPI completo](docs/openapi.json) — também em `/api/v1/openapi.json`

## Aviso legal

Este sistema é uma ferramenta de apoio ao registro e cálculo. **Não gera diagnóstico, prescrição nem substituição de avaliação clínica.** A interpretação dos resultados é de responsabilidade exclusiva do profissional de saúde habilitado. Nenhuma tabela numérica de terceiros foi reproduzida ou licenciada neste repositório.
