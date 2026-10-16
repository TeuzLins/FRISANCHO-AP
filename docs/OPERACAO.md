# Operação e dados

## Segurança implementada

- Senhas Argon2id (64 MiB, 3 iterações, paralelismo 1); cookies HttpOnly, SameSite=Lax, Secure e prefixo `__Host-` em produção.
- Banco armazena apenas SHA-256 do token de sessão. Logout revoga a sessão. Sessões expiram em `SESSION_DAYS`, de 1 a 30, padrão 7.
- Origem exigida em cadastro/login e operações privadas; mutações autenticadas também exigem token CSRF da sessão. `GET /auth/me` retorna esse token para o cliente autenticado.
- A propriedade de pacientes/avaliações é validada no servidor, incluindo PDF, auditoria e exportação. Identificadores de outro usuário não revelam a existência de registros.
- Payload de até 32 KiB, validação Zod no servidor, Helmet, rate limiting de login/cadastro (20/15 min) e cálculo público (150/15 min).
- A fonte Inter é servida localmente no Angular e incorporada ao PDF; não há requisição a CDN de fontes durante o uso.
- Resultados salvos são recalculados no servidor; userId, resultado ou classificação enviados pelo cliente são rejeitados. A idade é calculada no dia da avaliação quando existe nascimento.
- Idempotency-Key UUID em criação de avaliação permite retry sem duplicar. PATCH usa revisão otimista para evitar sobrescrever edição concorrente. Cliente preserva campos em falha de rede.
- Respostas API usam `Cache-Control: no-store`. Não são registrados corpos de requisição, cookies, SQL, senhas ou dados clínicos. Logs de falha contêm apenas nome da classe do erro.

Defina segredos no ambiente. Use PostgreSQL com TLS na produção. Confirme a topologia de proxy e o runtime do provedor. O sistema não afirma conformidade legal completa.

## Histórico e exclusão

Avaliações guardam entradas, resultados, limitações, metadados da referência, versão do motor e revisão. Atualizar referência não altera os snapshots salvos; uma edição explícita recalcula usando a versão atual e guarda o snapshot anterior no AuditEvent.

Excluir uma avaliação remove seus snapshots de revisão e mantém somente um evento sem dados clínicos informando a exclusão. Excluir paciente exige excluir primeiro suas avaliações e remove snapshots de edição do cadastro. Excluir conta com senha e `EXCLUIR` remove todos os registros vinculados no banco ativo. A exclusão em backups obedece à política de retenção definida pelo responsável; não é instantânea.

Em Configurações há exportação JSON de pacientes, avaliações e auditoria. Relatórios PDF são individuais. A API de exportação nunca inclui senha, hash de senha ou tokens de sessão.

## Backup e restauração PostgreSQL

Use as ferramentas da mesma versão principal do PostgreSQL (ou versão compatível indicada pelo provedor). Armazene backups criptografados fora do host da aplicação. Evite argumentos com senha em histórico; configure `PGHOST`, `PGPORT`, `PGUSER`, `PGDATABASE`, TLS e a senha por mecanismo seguro do provedor ou arquivo `.pgpass` com permissões apropriadas.

```text
pg_dump --format=custom --file=frisancho-backup.dump
pg_restore --dbname=BANCO_NOVO_DE_RESTAURACAO --no-owner --no-acl frisancho-backup.dump
```

Restaure em banco novo isolado, verifique contagens, integridade de pacientes/avaliações e tabela `_prisma_migrations`, e teste com usuários de teste antes de trocar `DATABASE_URL`. Nunca sobrescreva produção para testar um backup. Faça backup antes de migrações e estabeleça ponto de retorno conforme a mudança de schema. Mantenha o arquivo protegido, pois contém dados privados e hashes de senha.

Proposta operacional a confirmar pelo responsável: backup diário criptografado, retenção de 30 dias e teste mensal de restauração. RPO/RTO dependem do serviço contratado e devem ser medidos. Esse agendamento **não foi instalado**.

## Retenção

O MVP não elimina avaliações automaticamente: elas ficam até exclusão explícita da avaliação, paciente ou conta. Configure e documente uma política adequada à operação antes da produção. Auditoria de versões contém dados privados e deve seguir a mesma política. Backups precisam expirar também após exclusões no banco ativo.

Sessões expiradas já são rejeitadas pelo servidor. Para remover linhas antigas, pode-se agendar `node scripts/cleanup-sessions.mjs` na raiz do projeto com as variáveis de ambiente do banco; esse script é administrativo e não é necessário ao start do pacote. Nenhum agendamento foi criado.
