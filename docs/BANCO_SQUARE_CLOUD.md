# PostgreSQL da Square Cloud — operação e transferência

Implementação em 09/10/2026: Angular preservado, Prisma CLI/Client **6.19.0**, engine nativo e PostgreSQL real. A produção escolhida é Square Cloud. O banco remoto informado contém dados de origem desconhecida; ele **não foi acessado ou alterado nesta sessão**. A configuração disponível é somente local.

## 1. Preparar o acesso privado

A [Square Cloud](https://docs.squarecloud.app/en/services/databases) exige plano Standard ou superior e conexões autenticadas por certificados. Em **Bancos de Dados / Databases**, abra a instância existente e obtenha a URL, porta e certificados em seu painel. A porta PostgreSQL é independente da porta HTTP. Não substitua o host por um domínio Cloudflare e não use proxy HTTP para o banco.

O runtime e o CLI usam a mesma preparação. Conforme a [documentação do Prisma 6](https://www.prisma.io/docs/orm/v6/overview/databases/postgresql), o código acrescenta `sslmode=require`, `sslaccept=strict`, CA, identidade PKCS#12 e senha à URL efetiva. Não utiliza adapter, modo inseguro ou serviço alternativo. Se o certificado não validar o host fornecido, a conexão falha; solicite ao provedor certificado/endpoint compatíveis.

Prepare o certificado cliente e sua chave correspondentes. Se o painel fornecer PEM combinado, separe a chave e o certificado no ambiente privado; identifique também a cadeia CA correta, sem supor que qualquer certificado baixado é a CA. O utilitário abaixo verifica validade e correspondência de chave/certificado e gera a identidade usando OpenSSL:

```powershell
npm.cmd run db:certificates -- --ca .local/certificados/ca.pem --cert .local/certificados/cliente.pem --key .local/certificados/cliente.key --output .local/certificates.env
```

Requer OpenSSL; no Windows detecta a instalação do Git em `C:/Program Files/Git`. Para outro caminho, configure `OPENSSL_BIN`. Nenhuma senha vai para argumentos ou logs. A senha da identidade é gerada aleatoriamente, ou obtida de `DATABASE_IDENTITY_PASSWORD` no ambiente privado.

O arquivo produzido contém somente as três variáveis de certificados. Copie seus valores **pelo ambiente privado** para o painel da aplicação e para o job de migrations. Base64 é transporte, não criptografia. Não compartilhe esse arquivo ou screenshots de seu conteúdo. Os certificados são materializados em diretório temporário com modo 0700/0600 no Linux e ACL exclusiva do usuário no Windows; arquivos usam caminhos absolutos e são removidos ao encerrar normalmente.

Crie `.local/squarecloud.env` para os comandos administrativos, combinando os valores privados com:

```dotenv
DATABASE_URL=postgresql://USUARIO:SENHA@HOST_DO_PAINEL:PORTA_DO_PAINEL/BANCO_DO_PAINEL?schema=SCHEMA_CONFIRMADO
NODE_ENV=production
DATABASE_CONNECTION_LIMIT=5
DATABASE_CA_PEM_BASE64=CONTEUDO_PRIVADO
DATABASE_IDENTITY_P12_BASE64=CONTEUDO_PRIVADO
DATABASE_IDENTITY_PASSWORD=SENHA_PRIVADA_DA_IDENTIDADE
```

Use a URL base do painel com credenciais corretamente codificadas, **sem parâmetros SSL**: o preparador os controla e rejeita configurações concorrentes. Apenas desenvolvimento em loopback pode conectar sem TLS. O pool tem limite inicial de cinco conexões por processo, connect/pool timeout de cinco segundos e socket timeout de dez segundos. Ajuste o limite segundo os recursos contratados, somando aplicações e jobs.

## 2. Inventariar antes de alterar

```powershell
npm.cmd run db:check -- --env-file .local/squarecloud.env
npm.cmd run db:inventory -- --env-file .local/squarecloud.env --output .local/squarecloud-inventory.json
```

O inventário usa transação somente de leitura: versões, schemas, tabelas, colunas, constraints, permissões e migrations. Não lê registros clínicos nem registra URL/credenciais. O relatório deve permanecer privado. Ele identifica o destino por hash e precisa corresponder a um inventário fresco fornecido ao deploy/importação; mudanças no schema exigem repetir o inventário.

- **Tabelas de outra aplicação:** preserve-as. Escolha `schema=frisancho_ap`, repita o inventário e confirme que esse schema está vazio. O deploy pode criar o schema exclusivo se o usuário tiver permissão.
- **FRISANCHO AP com migrations conhecidas:** o comando confere checksums e assinatura física das tabelas. Histórico incompleto, migration desconhecida ou drift bloqueiam a operação.
- **Tabelas sem histórico:** deploy é bloqueado. Apenas quando o inventário comprovar estrutura exatamente equivalente à migration inicial, o baseline controlado abaixo pode registrar o histórico. Estruturas diferentes exigem diagnóstico e uma proposta específica de compatibilização; não serão recriadas automaticamente.

```powershell
# Somente após snapshot e comprovação estrutural; nunca como tentativa genérica:
npm.cmd run db:baseline -- --env-file .local/squarecloud.env --inventory .local/squarecloud-inventory.json --migration 202610080001_initial --backup-reference IDENTIFICADOR_DO_SNAPSHOT
```

O baseline exige ausência de migrations e assinatura equivalente da estrutura clínica, excluindo a tabela administrativa do Prisma. Ele não copia tabelas nem dados. Os nomes das constraints e diferenças entre versões podem causar bloqueio conservador; analise o inventário em vez de contornar a verificação. Depois de um baseline, gere novo inventário.

## 3. Backup e migrations

Antes de alterações em um banco remoto com dados, crie um snapshot no painel e anote seu identificador. Os comandos exigem essa referência, mas não conseguem confirmar por conta própria se o snapshot foi criado: a operação do painel ainda precisa ser verificada pelo responsável. Confira retenção, disponibilidade e possibilidade de restauração isolada no plano; não se presume recuperação pontual.

Para o banco local, o backup da aplicação inclui usuários, hashes, sessões e tabelas clínicas e é **confidencial**:

```powershell
npm.cmd run db:backup -- --output .local/backup-local.json
npm.cmd run db:generate
npm.cmd run db:migrate:deploy
npm.cmd run db:status
```

Esse backup JSON é da aplicação e do histórico de migrations, não um dump completo de outras aplicações, extensões ou grants do PostgreSQL. Para recuperação integral da instância, use também o mecanismo do provedor ou `pg_dump` em ambiente administrativo adequado.

O ensaio de restauração aceita somente destino **local, vazio e separado**, com schema `frisancho_restore_<16 caracteres hexadecimais>`. Prepare `.local/restore.env` com a URL local desse schema e `NODE_ENV=development`:

```powershell
npm.cmd run db:restore -- --env-file .local/restore.env --input .local/backup-local.json
```

Ele recria somente migrations reconhecidas, restaura em transação e compara o conteúdo das tabelas. Nunca restaura sobre produção. Na publicação:

```powershell
npm.cmd run db:migrate:deploy -- --env-file .local/squarecloud.env --inventory .local/squarecloud-inventory.json --backup-reference IDENTIFICADOR_DO_SNAPSHOT
npm.cmd run db:status -- --env-file .local/squarecloud.env
```

`db:migrate` é alias de `db:migrate:deploy`. `db:migrate:dev -- --name NOME` usa o CLI local e permite somente banco local de desenvolvimento, com shadow database adequada. Não execute reset, force-reset, truncate ou alteração de migrations aplicadas. Nunca aplique migrations em cada start/réplica. Gere novo inventário após qualquer alteração.

## 4. Transferir os registros locais

Congele gravações na origem durante o corte e registre o snapshot do destino. Migre a origem local para a versão atual antes de transferir. A importação lê um snapshot consistente; não inclui sessões locais. Usuários mantêm seus hashes de senha e entram novamente na produção.

```powershell
# Inventário atualizado depois das migrations:
npm.cmd run db:inventory -- --env-file .local/squarecloud.env --output .local/squarecloud-inventory.json

# Primeira execução: somente simulação.
npm.cmd run db:import -- --source-env .env --target-env .local/squarecloud.env --inventory .local/squarecloud-inventory.json --output .local/import-dry-run.json

# Aplicar somente após conferir a simulação e o snapshot:
npm.cmd run db:import -- --source-env .env --target-env .local/squarecloud.env --inventory .local/squarecloud-inventory.json --apply --backup-reference IDENTIFICADOR_DO_SNAPSHOT --output .local/import-applied.json
```

Origem e destino devem ser distintos. A simulação não grava nada. A aplicação usa uma transação Serializable; preserva IDs, timestamps, hashes, vínculos, referências, avaliações, auditoria e idempotência. Registros idênticos são reconhecidos. Qualquer diferença por ID, email normalizado, código por proprietário, versão de referência ou chave de idempotência aborta a operação inteira. Não mescla ou sobrescreve registros remotos.

Conflitos produzem relatório privado com entidade, ID e motivo, sem imprimir dados clínicos. Resolva as diferenças explicitamente e repita a simulação. Após aplicar, cada registro importado é comparado com o snapshot dentro da mesma transação. A ferramenta limita a origem a 100 mil registros por entidade e trabalha em memória; acima disso, exige uma estratégia de transferência diferente. Não apague a origem e não troque sua `.env` ativa para produção durante o ensaio.

## 5. Modelo e comportamento

- Patient usa arquivamento; avaliações exigem paciente e pertencem ao mesmo proprietário por FK composta. Arquivar preserva histórico. Novas avaliações não aceitam pacientes arquivados; editar uma avaliação mantendo seu paciente arquivado é permitido.
- Nascimento/data da avaliação são PostgreSQL DATE; DTOs retornam `YYYY-MM-DD`. Timestamps técnicos são TIMESTAMPTZ(3), com instantes antigos interpretados na convenção UTC já usada pelo Prisma.
- Medidas/resultados permanecem JSONB com números IEEE-754 do motor JavaScript. Não há conversão Decimal ou arredondamento adicional. O servidor valida, deriva idade quando aplicável e recalcula; o banco reforça positividade, idade e vínculos.
- Assessment armazena snapshot do paciente e resultado com metadados da referência. Relatórios usam esses snapshots. Para registros anteriores, o snapshot do paciente foi preenchido com o cadastro disponível na migration: nomes antigos que nunca foram armazenados não podem ser recuperados retroativamente.
- ReferenceDataset tem chave/versão única. Somente metadados bibliográficos reais são usados; não há seed de pacientes, administrador ou percentis inventados.
- IdempotencyRecord tem usuário/operação/chave, hash canônico, resposta original e validade de sete dias. Retries de criação/edição retornam a resposta original; outro payload retorna 409. Ao excluir a avaliação, respostas clínicas e revisões são apagadas; uma tentativa da mesma chave retorna 410 até expirar. Depois de expirar, a chave pode ser reutilizada. `db:cleanup` remove os registros expirados; agende essa manutenção no ambiente administrativo.
- Logout revoga a sessão; sessões revogadas/expiradas e usuários desativados são recusados. Reautenticação preserva as medidas; avaliações iniciadas em outra conta não são salvas silenciosamente.

## 6. Publicar e verificar

Configure no painel as variáveis privadas do banco e também `NODE_ENV=production`, `APP_ORIGIN=https://DOMINIO_CONFIRMADO`, `PORT=80`, `SESSION_DAYS` e os hops de proxy confirmados. Gere `npm.cmd run package`. O ZIP inclui aplicação compilada, módulos administrativos, schema, migrations e lockfile de produção; exclui certificados, banco, backups e `.env`.

O `postinstall` gera o Prisma Client na plataforma do provedor; isso não aplica migrations. Aplique-as por job administrativo único antes de iniciar a nova aplicação. Faça o corte de dados sem gravações concorrentes e confirme readiness antes de abrir o domínio definitivo.

Verifique cadastro/login, paciente, CB 30/DCT 16 → **24,97 cm**, salvamento, refresh do histórico e PDF. Reinicie a aplicação e confira usuário/sessão/registros. `/api/v1/live` confirma processo vivo; `/api/v1/ready` e `/health` retornam 503 se o banco não estiver pronto, com prazo máximo de cinco segundos. Rotas dependentes não simulam sucesso. O cálculo rápido continua sem persistência.

Logs mostram somente categorias TLS, AUTHENTICATION, TIMEOUT_OR_UNAVAILABLE, MIGRATION ou DATABASE. Erros internos/URLs do CLI não são encaminhados ao console. Para falhas, confira privadamente endpoint/porta, certificados e hostname, permissões, limites e inventário; não desative validação TLS.

Restaurar snapshot não é rollback sem perda: gravações posteriores ao snapshot podem desaparecer. Prefira migrations compatíveis e correção posterior; teste recuperação isoladamente antes de decidir o corte.

## 7. Evidências e pendências

Verificado localmente: build, TypeScript/templates, lint, 64 testes unitários/integração em PostgreSQL isolado, seis E2E e 15 cenários TLS/processo. Runtime e CLI recusaram CA, identidade e hostname inválidos. Foram testados reinício real da API, persistência de sessão/registros, encerramento gracioso, indisponibilidade e readiness limitada. Backup local foi restaurado e comparado em schema isolado antes da migration local. CSS e cálculo conferidos em quatro larguras. O fluxo de navegador também confirmou reautenticação sem perder medidas, retry após resposta perdida sem duplicar avaliação e arquivamento com histórico preservado.

O ZIP foi extraído e instalado separadamente com `npm ci --omit=dev`, gerando o Prisma Client pelo postinstall. O pacote foi executado com `NODE_ENV=production`, certificados de teste e cookies Secure; cadastro, persistência e reinício passaram em PostgreSQL TLS isolado. Essa conferência ocorreu no Windows e não substitui a publicação e validação no ambiente Linux da Square Cloud.

Pendências externas concretas: inventariar o banco Square Cloud, confirmar origem de seus dados/permissões/plano, configurar certificados privados, criar e verificar snapshot, executar migrations/baseline se aplicável, simular e aplicar a transferência, publicar e testar reinício e recuperação no provedor. Nenhuma dessas operações é declarada concluída. Evidências sanitizadas em `docs/banco-verificacao.json`.
