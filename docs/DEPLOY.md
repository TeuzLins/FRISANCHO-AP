# Publicar na Square Cloud e configurar Cloudflare

**Etapa de banco atualizada em 09/10/2026:** o PostgreSQL será o da Square Cloud, com TLS autenticado e inventário antes de mudanças. Siga [BANCO_SQUARE_CLOUD.md](BANCO_SQUARE_CLOUD.md) para certificados, migrations e transferência; as instruções abaixo de domínio permanecem aplicáveis.

Documentação oficial consultada em **08/10/2026**:

- [Express na Square Cloud](https://docs.squarecloud.app/en/tutorials/api/express)
- [Arquivo squarecloud.app](https://docs.squarecloud.app/en/getting-started/config-file)
- [Hospedagem de sites e APIs](https://docs.squarecloud.app/en/services/sites)
- [Cloudflare Full (strict)](https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/full-strict/)

## Preparação

1. Contrate/verifique o plano. A documentação da Square Cloud exige **Standard ou superior para domínio próprio**. Sites/APIs usam no mínimo 512 MB; o arquivo inicial reserva 512 MB. Monitore uso de memória e ajuste conforme carga, especialmente nos hashes de senha.
2. Abra o PostgreSQL existente da Square Cloud e inventarie-o antes de alterar. Configure TLS com CA/identidade PKCS#12 privadas segundo o guia de banco. Não use `.local/postgres` na produção.
3. Configure a origem definitiva como `https://SEU_DOMINIO`, sem caminho e sem barra final.
4. Altere `SUBDOMAIN=SEU_SUBDOMINIO` em `squarecloud.app`, escolhendo um nome cuja disponibilidade deve ser conferida no painel. `MAIN=apps/api/dist/server.js` aponta para um arquivo compilado incluído no pacote. `VERSION=recommended` segue o runtime recomendado; confirme **Node.js 24** no painel.
5. Gere o pacote: `npm.cmd run package`. O build ocorre localmente; não há dependência de compilação TypeScript/Angular implícita no provedor.

## Variáveis no painel

```dotenv
DATABASE_URL=URL_POSTGRESQL_FORNECIDA_PELO_PROVEDOR
DATABASE_CA_PEM_BASE64=CONTEUDO_PRIVADO
DATABASE_IDENTITY_P12_BASE64=CONTEUDO_PRIVADO
DATABASE_IDENTITY_PASSWORD=SENHA_PRIVADA
DATABASE_CONNECTION_LIMIT=5
NODE_ENV=production
APP_ORIGIN=https://SEU_DOMINIO
PORT=80
TRUST_PROXY_HOPS=NUMERO_CONFIRMADO_DE_PROXIES_CONFIAVEIS
SESSION_DAYS=7
```

A Square Cloud define `PORT=80` para esse serviço; o servidor lê `PORT` e escuta em `0.0.0.0`. O fallback local é 3000. Não coloque `.env` nem credenciais no ZIP. `TRUST_PROXY_HOPS` deve representar a topologia real, confirmada com o provedor; não configure `true` para confiar indiscriminadamente em cabeçalhos encaminhados. O padrão 0 não confia em proxies, mas pode agregar usuários sob um mesmo IP para rate limiting. Se existirem caminhos com números diferentes de proxies, adapte a configuração para uma lista de IPs/sub-redes verificada antes de operar.

## Migração, upload e start

O ZIP contém uma raiz de produção independente com lockfile próprio. O `postinstall` gera o Prisma Client na plataforma Linux do provedor. O frontend e a API já estão compilados. Com as variáveis do banco configuradas, aplique as migrações por ambiente seguro com acesso ao PostgreSQL, antes de abrir a aplicação:

```text
npm ci --omit=dev
npm run db:inventory -- --output CAMINHO_PRIVADO_DO_INVENTARIO
npm run db:migrate:deploy -- --inventory CAMINHO_PRIVADO_DO_INVENTARIO --backup-reference IDENTIFICADOR_DO_SNAPSHOT
npm start
```

Esses comandos se aplicam ao diretório extraído do pacote de produção; na raiz de desenvolvimento, `npm ci` instala também ferramentas de build. Não aplique migrações automaticamente em cada requisição ou em múltiplas instâncias. Faça backup antes de novas migrações e revise o SQL versionado.

Envie `dist/frisancho-ap-squarecloud.zip` no painel como publicação web. O painel instala dependências e inicia o MAIN. Se ele usar `npm install` em vez de `npm ci`, confira os logs e a geração do cliente. Não foi feito upload desta aplicação nesta sessão.

Abra o endereço de subdomínio apresentado pelo painel e confira `/api/v1/health`: espere HTTP 200 e `database=connected`. Teste cadastro/login, salvar uma avaliação fictícia, abrir PDF e atualizar `/historico`. Antes de testar autenticação no subdomínio, ajuste temporariamente `APP_ORIGIN` para essa origem HTTPS; depois retorne ao domínio definitivo.

## Domínio e DNS

1. No painel Square Cloud, cadastre `SEU_DOMINIO` e confirme o suporte do plano contratado.
2. Copie **exatamente** os registros e as instruções de validação apresentados pelo painel. Os destinos ainda não foram obtidos; não há IP ou alvo CNAME inventado neste projeto.
3. Na Cloudflare, crie os registros correspondentes:

| Tipo | Nome | Conteúdo | Proxy |
| --- | --- | --- | --- |
| TIPO_DO_PAINEL | HOST_DO_PAINEL | ALVO_DO_PAINEL | MODO_EXIGIDO_PELO_PROVEDOR |
| TXT ou tipo indicado | HOST_DE_VALIDACAO | VALOR_DE_VALIDACAO | DNS only quando indicado |

4. Aguarde validação DNS e emissão de certificado pela Square Cloud. Verifique o certificado na origem antes de habilitar proxy.
5. Se houver proxy Cloudflare, confirme compatibilidade do provedor e configure **Full (strict)**: certificado de origem válido, vigente e correspondente ao domínio. Se os registros exigirem DNS only, respeite essa exigência.
6. Ative HTTPS no domínio definitivo e teste cookies Secure, login, logout e CSRF usando essa origem.

## Cache

O servidor marca todas as respostas `/api` como `no-store`, incluindo autenticação, exportação e PDF. Não crie regras de cache para `/api/*` ou relatórios privados. Assets com hash podem ter cache público imutável; `index.html` e fallback SPA devem ser revalidados. Se adicionar regras Cloudflare, limite-as aos assets estáticos com hash; respeite `Cache-Control`. Não use Cache Everything para o domínio.

## Arquivos do pacote

`MANIFEST.txt` dentro do ZIP registra cada arquivo. A allowlist inclui `apps/api/dist`, `apps/web/dist`, schema e migrações Prisma, `packages/anthropometry/dist` e seu package.json, `squarecloud.app`, `.env.example`, README e documentação. O script gera package.json/lockfile somente com dependências de runtime. Exclui `.env`, credenciais, `node_modules`, testes, relatórios de teste, dados locais e fontes desnecessárias à execução.
