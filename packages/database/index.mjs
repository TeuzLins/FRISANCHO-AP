import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createSecureContext } from 'node:tls';
import { X509Certificate, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

function restrictedDirectory(directory) {
  chmodSync(directory, 0o700);
  if (process.platform === 'win32') {
    const identity = execFileSync('whoami', ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true });
    const sid = /S-1-[\d-]+/.exec(identity)?.[0];
    if (!sid) throw new Error('TLS: não foi possível restringir permissões dos certificados.');
    execFileSync('icacls', [directory, '/inheritance:r', '/grant:r', '*' + sid + ':(OI)(CI)F'], { stdio: 'pipe', windowsHide: true });
  }
}
function removeDirectory(directory) {
  const root = path.resolve(tmpdir()), target = path.resolve(directory);
  if (path.dirname(target) !== root || !path.basename(target).startsWith('frisancho-tls-')) throw new Error('TLS: caminho temporário inesperado.');
  rmSync(target, { recursive: true, force: true });
}
export function restrictPrivateFile(file) {
  chmodSync(file, 0o600);
  if (process.platform === 'win32') {
    const sid = /S-1-[\d-]+/.exec(execFileSync('whoami', ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true }))?.[0];
    if (!sid) throw new Error('Permissões do arquivo privado não puderam ser verificadas.');
    execFileSync('icacls', [file, '/inheritance:r', '/grant:r', '*' + sid + ':F'], { stdio: 'pipe', windowsHide: true });
  }
}

export function canonicalJSON(value) {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return '[' + value.map(canonicalJSON).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => JSON.stringify(k) + ':' + canonicalJSON(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
export const payloadHash = value => createHash('sha256').update(canonicalJSON(value)).digest('hex');
export function databaseErrorCategory(error) {
  const code = error?.code || ''; const text = String(error?.message || '').toLowerCase();
  if (/tls|ssl|certificate|pkcs|pfx/.test(text) || code === 'P1011') return 'TLS';
  if (code === 'P1000' || /authentication|password/.test(text)) return 'AUTHENTICATION';
  if (['P1001', 'P1002', 'P1008', 'P2024'].includes(code) || /timeout|timed out|unreachable/.test(text)) return 'TIMEOUT_OR_UNAVAILABLE';
  if (/^P30/.test(code)) return 'MIGRATION';
  return 'DATABASE';
}
export function prepareDatabase(env = process.env) {
  let url; try { url = new URL(env.DATABASE_URL); } catch { throw new Error('DATABASE_URL inválida.'); }
  if (!['postgresql:', 'postgres:'].includes(url.protocol) || !url.hostname || url.pathname.length < 2) throw new Error('DATABASE_URL inválida.');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  const production = env.NODE_ENV === 'production';
  const tlsConfigured = !!(env.DATABASE_CA_PEM_BASE64 || env.DATABASE_IDENTITY_P12_BASE64);
  // A non-local connection never silently falls back to unencrypted PostgreSQL.
  const tlsRequired = production || !local || tlsConfigured;
  let directory;
  try {
    if (tlsRequired) {
      if (!env.DATABASE_CA_PEM_BASE64 || !env.DATABASE_IDENTITY_P12_BASE64 || !env.DATABASE_IDENTITY_PASSWORD) throw new Error('TLS: configure CA, identidade PKCS#12 e senha em ambiente privado.');
      for (const key of ['sslmode', 'sslaccept', 'sslcert', 'sslrootcert', 'sslidentity', 'sslpassword', 'host']) {
        if (url.searchParams.has(key)) throw new Error('TLS: remova parâmetros SSL da URL base; a configuração privada é centralizada.');
      }
      const decode = value => { if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) throw new Error('TLS: conteúdo base64 inválido.'); return Buffer.from(value, 'base64'); };
      const ca = decode(env.DATABASE_CA_PEM_BASE64), identity = decode(env.DATABASE_IDENTITY_P12_BASE64);
      const certificate = new X509Certificate(ca);
      if (Date.now() < Date.parse(certificate.validFrom) || Date.now() > Date.parse(certificate.validTo)) throw new Error('TLS: CA fora da validade.');
      createSecureContext({ ca, pfx: identity, passphrase: env.DATABASE_IDENTITY_PASSWORD, minVersion: 'TLSv1.2' });
      directory = mkdtempSync(path.join(tmpdir(), 'frisancho-tls-')); restrictedDirectory(directory);
      const caFile = path.join(directory, 'ca.pem'), identityFile = path.join(directory, 'identity.p12');
      writeFileSync(caFile, ca, { mode: 0o600 }); writeFileSync(identityFile, identity, { mode: 0o600 });
      url.searchParams.set('sslmode', 'require'); url.searchParams.set('sslaccept', 'strict');
      url.searchParams.set('sslcert', caFile); url.searchParams.set('sslidentity', identityFile); url.searchParams.set('sslpassword', env.DATABASE_IDENTITY_PASSWORD);
    } else if (url.searchParams.get('sslaccept') === 'accept_invalid_certs') throw new Error('TLS: certificados inválidos não são permitidos.');
    const limit = Number(env.DATABASE_CONNECTION_LIMIT || 5);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('DATABASE_CONNECTION_LIMIT deve ser de 1 a 100.');
    url.searchParams.set('connection_limit', String(limit));
    url.searchParams.set('connect_timeout', '5'); url.searchParams.set('pool_timeout', '5'); url.searchParams.set('socket_timeout', '10');
    let cleaned = false;
    return { url: url.toString(), local, cleanup() { if (!cleaned && directory) { removeDirectory(directory); cleaned = true; } } };
  } catch (error) { if (directory) removeDirectory(directory); throw new Error(databaseErrorCategory(error) === 'TLS' ? 'TLS: configuração de certificados inválida ou incompleta.' : error.message); }
}
