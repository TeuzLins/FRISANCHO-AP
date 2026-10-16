import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { X509Certificate, createPrivateKey, randomBytes } from 'node:crypto';
import { spawnSync, execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
const args = process.argv.slice(2), value = key => args[args.indexOf(key) + 1];
let directory;
try {
  for (const key of ['--ca', '--cert', '--key']) if (!args.includes(key)) throw new Error('Informe --ca, --cert e --key com caminhos privados.');
  const ca = readFileSync(value('--ca')), cert = readFileSync(value('--cert')), key = readFileSync(value('--key'));
  const client = new X509Certificate(cert); new X509Certificate(ca);
  if (!client.checkPrivateKey(createPrivateKey(key))) throw new Error('Certificado e chave não correspondem.');
  if (Date.now() < Date.parse(client.validFrom) || Date.now() > Date.parse(client.validTo)) throw new Error('Certificado de cliente fora da validade.');
  directory = mkdtempSync(path.join(tmpdir(), 'frisancho-cert-'));
  const output = path.resolve(args.includes('--output') ? value('--output') : '.local/certificates.env');
  const password = process.env.DATABASE_IDENTITY_PASSWORD || randomBytes(32).toString('hex');
  const openssl = process.env.OPENSSL_BIN || (process.platform === 'win32' ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl');
  const p12 = path.join(directory, 'client.p12');
  const result = spawnSync(openssl, ['pkcs12', '-export', '-out', p12, '-inkey', path.resolve(value('--key')), '-in', path.resolve(value('--cert')), '-certfile', path.resolve(value('--ca')), '-keypbe', 'PBE-SHA1-3DES', '-certpbe', 'PBE-SHA1-3DES', '-passout', 'env:FRISANCHO_CERT_PASSWORD'], { env: { ...process.env, FRISANCHO_CERT_PASSWORD: password }, stdio: 'pipe', windowsHide: true });
  if (result.status !== 0) throw new Error('OpenSSL não concluiu a exportação PKCS#12.');
  mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
  writeFileSync(output, 'DATABASE_CA_PEM_BASE64=' + ca.toString('base64') + '\nDATABASE_IDENTITY_P12_BASE64=' + readFileSync(p12).toString('base64') + '\nDATABASE_IDENTITY_PASSWORD=' + password + '\n', { mode: 0o600 });
  if (process.platform === 'win32') {
    const sid = /S-1-[\d-]+/.exec(execFileSync('whoami', ['/user','/fo','csv','/nh'], { encoding: 'utf8', windowsHide: true }))?.[0];
    if (!sid) throw new Error('Não foi possível restringir o arquivo privado.');
    execFileSync('icacls', [output, '/inheritance:r', '/grant:r', '*' + sid + ':F'], { stdio: 'pipe', windowsHide: true });
  }
  console.log('Identidade PKCS#12 preparada; variáveis gravadas em arquivo privado. Nenhum segredo exibido.');
} catch { console.error('Preparação não concluída. Confira caminhos, validade, correspondência de certificado/chave e instalação do OpenSSL.'); process.exitCode = 1; }
finally {
  if (directory) { const target = path.resolve(directory); if (path.dirname(target) === path.resolve(tmpdir()) && path.basename(target).startsWith('frisancho-cert-')) rmSync(target, { recursive: true, force: true }); else { console.error('Limpeza temporária bloqueada por caminho inesperado.'); process.exitCode = 1; } }
}
