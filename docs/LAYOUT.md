# Layout revisado — 09/10/2026

A aplicação real foi revisada mantendo Angular, Prisma, PostgreSQL, autenticação, API e cálculos. Não houve migração de banco ou alteração dos dados existentes.

## Diagnóstico dos estilos

A falha descrita no Prompt 03 não se reproduziu na versão encontrada nesta revisão. Antes das alterações, o Chromium recebeu CSS com HTTP 200 e MIME `text/css`; os estilos computados já mostravam sidebar fixa de 224 px, grid, bordas, campos de 46 px e navegação sem sublinhado. As capturas anteriores e os registros estão em `.local/layout-antes`.

A correção anterior permanece: `inlineCritical: false` em `apps/web/angular.json` impede que o Angular produza carregamento diferido por `onload` inline bloqueado pelo CSP. A proteção CSP foi mantida. O Express serve os arquivos estáticos antes do fallback da SPA; o HTML referencia uma folha de estilos normal.

Tailwind e `@tailwindcss/postcss` instalados: 4.3.3. O CSS global está registrado no builder Angular e o plugin PostCSS está em `apps/web/.postcssrc.json`. A detecção foi delimitada a `apps/web/src` com `source("./")`, evitando que arquivos de build e outros diretórios ampliem a geração. Os componentes compartilhados de apresentação estão nesse diretório; o pacote de antropometria não contém interface. As classes de estado são completas e as regras principais de apresentação são CSS explícito. Nenhuma dependência foi atualizada nesta revisão.

Integração conferida na documentação oficial: [Tailwind com Angular/PostCSS](https://tailwindcss.com/docs/installation/framework-guides/angular), [detecção e delimitação de fontes](https://tailwindcss.com/docs/detecting-classes-in-source-files) e [configuração de estilos Angular](https://angular.dev/reference/configs/workspace-config#styles-and-scripts-configuration).

## Alterações

- Shell, sidebar, topbar, cabeçalho de página, campo com unidade, painel de resultado e aviso de referência em componentes reutilizáveis.
- Sidebar de 224 px; conteúdo útil limitado a 1200 px, duas colunas aproximadamente 60/40 com gap de 24 px. Painéis empilhados abaixo de 1200 px; navegação recolhível abaixo de 1024 px; campos em uma coluna abaixo de 640 px.
- Inter local, cores solicitadas, cartões com padding de 24 px no desktop e 20 px no celular, inputs de 48 px com texto de 16 px e resultado de 40 px.
- Estado vazio curto; placeholders de exemplo; medidas complementares recolhíveis; fórmula expansível; comparação com CMB informada somente quando preenchida; motivos específicos de classificação indisponível.
- Menu móvel com foco inicial, contenção de Tab, Escape e retorno ao botão. Navegação oculta e conteúdo de fundo usam `inert`. Link de salto visualmente oculto e exibido ao receber foco.
- Validação perto dos campos, carregamento visível e proteção contra submissão duplicada. Alterar entradas invalida o resultado e exige recálculo, preservando o fluxo existente.

## Verificação renderizada

Chromium real via Playwright, em desenvolvimento (`localhost:4200`) e no build servido pelo Express (`localhost:3000`):

| Largura | Organização | Resultado | CSS e overflow |
| --- | --- | --- | --- |
| 360 px | Campos e painéis empilhados; menu recolhível | 24,97 cm | HTTP 200, MIME correto, sem overflow horizontal |
| 768 px | Campos em duas colunas, painéis empilhados; menu recolhível | 24,97 cm | HTTP 200, MIME correto, sem overflow horizontal |
| 1024 px | Sidebar fixa, campos em duas colunas, painéis empilhados | 24,97 cm | HTTP 200, MIME correto, sem overflow horizontal |
| 1440 px | Sidebar fixa, formulário e resultado lado a lado | 24,97 cm | HTTP 200, MIME correto, sem overflow horizontal |

Estilos computados confirmaram grid, gap, padding, borda, tamanho dos campos e estado ativo. Sem erros JavaScript ou de CSS/CSP nos registros de inspeção. As capturas desktop e celular foram abertas e conferidas visualmente. Foram corrigidos também o recorte do link de salto em capturas de página inteira e o espaçamento de rótulos no celular.

- Build de API, pacote compartilhado e Angular aprovado; TypeScript/templates e ESLint aprovados.
- Seis testes E2E aprovados: cálculo, validação, limpeza, exemplo, falha de rede, invalidação, cadastro/login, pacientes, persistência após recarregar, relatório/PDF, revisão, edição, exclusão e navegação nas quatro larguras. Os testes móveis verificam abertura por teclado, Escape, foco e link de salto.
- O build mantém aviso de bundle inicial: aproximadamente 785 kB brutos / 163 kB transferidos, acima do alvo de 750 kB e abaixo do limite de erro de 1 MB.
- Sem tabela numérica validada carregada: percentis e classificação continuam indisponíveis. Deploy externo não foi realizado.

Capturas finais: [desktop](screenshots/layout-desktop.png), [celular](screenshots/layout-mobile.png), [resultado desktop](screenshots/resultado-desktop.png) e [resultado celular](screenshots/resultado-mobile.png). Registros completos: `docs/layout-verificacao-producao.json` e `docs/layout-verificacao-desenvolvimento.json`.

## Executar a versão corrigida

No diretório do projeto, com `.env` e o banco local já configurados:

```powershell
# Em um terminal, se o banco ainda não estiver iniciado:
npm.cmd run local:db

# Em outro terminal:
npm.cmd run build
node --env-file=.env apps/api/dist/server.js
```

Abra **http://localhost:3000**. Se a API já estiver rodando nessa porta, não inicie uma segunda instância. A configuração inicial completa está no README.

Para repetir a inspeção do build servido:

```powershell
node scripts/check-layout.mjs http://localhost:3000 layout-final
npm.cmd run test:e2e
```
