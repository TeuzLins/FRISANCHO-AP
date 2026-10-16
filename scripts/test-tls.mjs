import EmbeddedPostgres from 'embedded-postgres';
import { PrismaClient } from '@prisma/client';
import { prepareDatabase } from '@frisancho/database';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { spawnSync, fork } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { parseEnv } from 'node:util';
const openssl = process.platform === 'win32' && existsSync('C:/Program Files/Git/usr/bin/openssl.exe') ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl';
const directory = mkdtempSync(path.join(tmpdir(), 'frisancho-tls-test-')), certificatePassword = randomBytes(18).toString('hex');
const file = name => path.join(directory, name);
function ssl(args) { const result = spawnSync(openssl, args, { cwd: directory, env: { ...process.env, FRISANCHO_TLS_TEST_PASSWORD: certificatePassword }, encoding: 'utf8' }); if (result.status !== 0) throw new Error('Preparação dos certificados de teste falhou.'); }
ssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.pem', '-days', '2', '-subj', '/CN=Frisancho Test CA']);
for (const name of ['server', 'client', 'other-client']) {
  ssl(['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', name + '.key', '-out', name + '.csr', '-subj', '/CN=' + (name === 'client' ? 'frisancho_tls' : name === 'server' ? 'localhost' : 'wrong_identity')]);
  writeFileSync(file(name + '.ext'), name === 'server' ? 'subjectAltName=DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth\n' : 'extendedKeyUsage=clientAuth\n');
  ssl(['x509', '-req', '-in', name + '.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial', '-out', name + '.pem', '-days', '2', '-extfile', name + '.ext']);
  if (name !== 'server') ssl(['pkcs12', '-export', '-out', name + '.p12', '-inkey', name + '.key', '-in', name + '.pem', '-certfile', 'ca.pem', '-keypbe', 'PBE-SHA1-3DES', '-certpbe', 'PBE-SHA1-3DES', '-passout', 'env:FRISANCHO_TLS_TEST_PASSWORD']);
}
// OpenSSL receives only the generated test password via environment, never through logs.
ssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'wrong-ca.key', '-out', 'wrong-ca.pem', '-days', '2', '-subj', '/CN=Untrusted Test CA']);
chmodSync(file('server.key'), 0o600);
const freePort = () => new Promise(resolve => { const server = net.createServer(); server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); }); });
const port = await freePort();
const pg = new EmbeddedPostgres({ databaseDir: file('postgres'), user: 'frisancho_tls', password: randomBytes(18).toString('hex'), port, persistent: true, initdbFlags: ['--encoding=' + (process.platform === 'win32' ? 'WIN1252' : 'UTF8'), '--locale=C'], postgresFlags: ['-h', '127.0.0.1,127.0.0.2', '-c', 'ssl=on', '-c', 'ssl_cert_file=' + file('server.pem'), '-c', 'ssl_key_file=' + file('server.key'), '-c', 'ssl_ca_file=' + file('ca.pem')], onLog: () => {}, onError: () => {} });
await pg.initialise();
writeFileSync(file('postgres/pg_hba.conf'), 'hostssl all all 127.0.0.0/8 cert clientcert=verify-full\nhost all all 127.0.0.0/8 reject\n');
const baseEnv = { ...process.env, NODE_ENV: 'development', DATABASE_URL: `postgresql://frisancho_tls:unused@127.0.0.1:${port}/postgres?schema=tls_check`, DATABASE_CA_PEM_BASE64: readFileSync(file('ca.pem')).toString('base64'), DATABASE_IDENTITY_P12_BASE64: readFileSync(file('client.p12')).toString('base64'), DATABASE_IDENTITY_PASSWORD: certificatePassword };
let started = false, apiProcess; const report = [];
const packageDirectory = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
const productionPackage = packageDirectory !== process.cwd();
const httpPort = await freePort(), httpBase = 'http://localhost:' + httpPort, appOrigin = (productionPackage ? 'https' : 'http') + '://localhost:' + httpPort;
async function startAPI() {
  apiProcess = fork(path.join(packageDirectory, 'apps/api/dist/server.js'), [], { cwd: packageDirectory, env: { ...baseEnv, NODE_ENV: productionPackage ? 'production' : 'development', PORT: String(httpPort), APP_ORIGIN: appOrigin }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  apiProcess.stdout.on('data', () => {}); apiProcess.stderr.on('data', () => {});
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(httpBase + '/api/v1/ready')).ok) return; } catch { /* startup */ }
    if (apiProcess.exitCode !== null) throw new Error('API isolada encerrou durante a inicialização.');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('API isolada não ficou pronta.');
}
async function stopAPI() {
  if (!apiProcess || apiProcess.exitCode !== null) return;
  const child = apiProcess;
  const closed = new Promise((resolve, reject) => { child.once('exit', code => code === 0 ? resolve() : reject(new Error('Encerramento da API não foi gracioso.'))); });
  child.send('shutdown'); await closed; apiProcess = undefined;
}
async function runtimeCase(name, env, expected) {
  let prepared, client, passed = false;
  try { prepared = prepareDatabase(env); client = new PrismaClient({ datasourceUrl: prepared.url, log: [] }); await client.$queryRaw`SELECT 1`; passed = true; }
  catch { passed = false; }
  finally { if (client) await client.$disconnect(); prepared?.cleanup(); }
  if (passed !== expected) throw new Error('Resultado TLS inesperado: ' + name);
  report.push({ name, verified: true, connectionAccepted: passed });
}
try {
  await pg.start(); started = true;
  const adminConnection = prepareDatabase(baseEnv), admin = new PrismaClient({ datasourceUrl: adminConnection.url, log: [] });
  try { await admin.$executeRawUnsafe("CREATE DATABASE frisancho_tls_utf8 WITH ENCODING='UTF8' TEMPLATE=template0 LC_COLLATE='C' LC_CTYPE='C'"); }
  finally { await admin.$disconnect(); adminConnection.cleanup(); }
  baseEnv.DATABASE_URL = baseEnv.DATABASE_URL.replace('/postgres?', '/frisancho_tls_utf8?');
  const generatedEnv = file('prepared.env');
  const certificateTool = spawnSync(process.execPath, ['scripts/certificates.mjs', '--ca', file('ca.pem'), '--cert', file('client.pem'), '--key', file('client.key'), '--output', generatedEnv], { encoding: 'utf8' });
  if (certificateTool.status !== 0) throw new Error('Utilitário de certificados não concluiu.');
  await runtimeCase('certificate preparation produces usable matching identity', { ...baseEnv, ...parseEnv(readFileSync(generatedEnv, 'utf8')) }, true);
  const mismatchTool = spawnSync(process.execPath, ['scripts/certificates.mjs', '--ca', file('ca.pem'), '--cert', file('client.pem'), '--key', file('other-client.key'), '--output', file('invalid.env')], { encoding: 'utf8' });
  if (mismatchTool.status === 0 || existsSync(file('invalid.env'))) throw new Error('Utilitário aceitou certificado e chave não correspondentes.');
  report.push({ name: 'certificate preparation rejects mismatched private key', verified: true });
  await runtimeCase('runtime valid CA and identity', baseEnv, true);
  await runtimeCase('runtime untrusted CA rejected', { ...baseEnv, DATABASE_CA_PEM_BASE64: readFileSync(file('wrong-ca.pem')).toString('base64') }, false);
  await runtimeCase('runtime wrong client identity rejected', { ...baseEnv, DATABASE_IDENTITY_P12_BASE64: readFileSync(file('other-client.p12')).toString('base64') }, false);
  await runtimeCase('runtime hostname mismatch rejected', { ...baseEnv, DATABASE_URL: baseEnv.DATABASE_URL.replace('127.0.0.1:', '127.0.0.2:') }, false);
  await runtimeCase('runtime invalid identity password rejected', { ...baseEnv, DATABASE_IDENTITY_PASSWORD: 'incorrect-test-password' }, false);
  const privateEnv = file('test.env');
  const writeEnv = env => writeFileSync(privateEnv, Object.entries(env).filter(([key]) => /^(DATABASE_|NODE_ENV)/.test(key)).map(([key, value]) => key + '=' + JSON.stringify(value)).join('\n'), { mode: 0o600 });
  writeEnv(baseEnv);
  let cli = spawnSync(process.execPath, [path.join(packageDirectory, 'scripts/db.mjs'), 'migrate:deploy', '--env-file', privateEnv], { cwd: packageDirectory, encoding: 'utf8', timeout: 30000 });
  if (cli.status !== 0) throw new Error('CLI não concluiu migrations com TLS válido.');
  report.push({ name: 'CLI migrations with valid TLS', verified: true });
  for (const [name, env] of [['CA', { ...baseEnv, DATABASE_CA_PEM_BASE64: readFileSync(file('wrong-ca.pem')).toString('base64') }], ['hostname', { ...baseEnv, DATABASE_URL: baseEnv.DATABASE_URL.replace('127.0.0.1:', '127.0.0.2:') }], ['identity', { ...baseEnv, DATABASE_IDENTITY_P12_BASE64: readFileSync(file('other-client.p12')).toString('base64') }]]) {
    writeEnv(env); cli = spawnSync(process.execPath, [path.join(packageDirectory, 'scripts/db.mjs'), 'status', '--env-file', privateEnv], { cwd: packageDirectory, encoding: 'utf8', timeout: 20000 });
    if (cli.status === 0) throw new Error('CLI aceitou configuração TLS inválida.'); report.push({ name: 'CLI rejects invalid ' + name, verified: true });
  }
  await startAPI();
  const api = (route, options = {}) => fetch(httpBase + '/api/v1' + route, options);
  const auth = await api('/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: appOrigin }, body: JSON.stringify({ email: 'tls-restart@example.invalid', name: 'Fictício TLS', password: 'Senha-ficticia-tls-2026' }) });
  if (auth.status !== 201) throw new Error('Cadastro no processo isolado falhou.');
  if (productionPackage && !auth.headers.getSetCookie()[0].includes('Secure')) throw new Error('Cookie de produção não está Secure.');
  const session = await auth.json(), cookie = auth.headers.getSetCookie()[0].split(';')[0];
  const headers = { 'Content-Type': 'application/json', Origin: appOrigin, Cookie: cookie, 'X-CSRF-Token': session.csrfToken };
  const patientResponse = await api('/patients', { method: 'POST', headers, body: JSON.stringify({ identifier: 'TLS-RESTART', displayName: 'Paciente fictício TLS' }) });
  if (patientResponse.status !== 201) throw new Error('Persistência no processo isolado falhou.');
  const patient = await patientResponse.json();
  const assessmentResponse = await api('/assessments', { method: 'POST', headers: { ...headers, 'Idempotency-Key': '11111111-1111-4111-8111-111111111111' }, body: JSON.stringify({ patientId: patient.id, evaluationDate: '2026-10-09', inputs: { ageYears: 76, referenceSex: null, armCircumferenceCm: 30, tricepsSkinfoldMm: 16 } }) });
  if (assessmentResponse.status !== 201) throw new Error('Salvar avaliação no processo isolado falhou.');
  const assessment = await assessmentResponse.json();
  await stopAPI(); report.push({ name: 'API graceful shutdown', verified: true });
  await startAPI();
  const restored = await api('/assessments/' + assessment.id, { headers });
  if (!restored.ok || (await restored.json()).result.displayValue !== '24,97') throw new Error('Registros não persistiram após reiniciar o processo.');
  report.push({ name: 'API session and records survive process restart', verified: true });
  await pg.stop(); started = false;
  const beforeReady = Date.now(), degraded = await api('/ready');
  if (degraded.status !== 503 || Date.now() - beforeReady > 6000 || (await api('/live')).status !== 200) throw new Error('Liveness/readiness inválidas com banco indisponível.');
  if ((await api('/patients', { headers })).status !== 503) throw new Error('API simulou acesso a dados com banco indisponível.');
  report.push({ name: 'API readiness bounded to five seconds; liveness preserved; dependent route returns 503', verified: true });
  await stopAPI();
  await runtimeCase('runtime database unavailable rejected', baseEnv, false);
  writeFileSync(productionPackage ? '.local/package-tls-verificacao.json' : '.local/tls-verificacao.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} finally { if (apiProcess) { try { await stopAPI(); } catch { apiProcess.kill(); } } if (started) await pg.stop(); }
