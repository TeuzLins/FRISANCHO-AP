import { cpSync, mkdirSync, readFileSync, writeFileSync, createWriteStream, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import archiver from 'archiver';
const root = process.cwd();
const stage = path.resolve('.local', `package-${Date.now()}`);
mkdirSync(stage, { recursive: true });
const rootPackage = JSON.parse(readFileSync('package.json', 'utf8'));
const apiPackage = JSON.parse(readFileSync('apps/api/package.json', 'utf8'));
const files = ['apps/api/dist', 'apps/web/dist', 'apps/api/prisma', 'packages/anthropometry/dist', 'packages/anthropometry/package.json', 'squarecloud.app', '.env.example', 'README.md', 'docs/DEPLOY.md', 'docs/OPERACAO.md', 'docs/VERIFICACAO.md', 'docs/LAYOUT.md', 'docs/screenshots', 'docs/layout-verificacao-producao.json', 'docs/layout-verificacao-desenvolvimento.json', 'docs/openapi.json', 'packages/database', 'scripts/db.mjs', 'scripts/certificates.mjs', 'docs/BANCO_SQUARE_CLOUD.md', 'docs/banco-verificacao.json'];
for (const file of files) { const target = path.join(stage, file); mkdirSync(path.dirname(target), { recursive: true }); cpSync(path.join(root, file), target, { recursive: true }); }
const pkg = { name: 'frisancho-ap-production', version: rootPackage.version, private: true, type: 'module', engines: { node: '>=24 <25' },
  scripts: { start: 'node apps/api/dist/server.js', postinstall: 'prisma generate --schema apps/api/prisma/schema.prisma', 'db:generate': 'node scripts/db.mjs generate', 'db:migrate': 'npm run db:migrate:deploy', 'db:migrate:deploy': 'node scripts/db.mjs migrate:deploy', 'db:status': 'node scripts/db.mjs status', 'db:check': 'node scripts/db.mjs check', 'db:inventory': 'node scripts/db.mjs inventory', 'db:import': 'node scripts/db.mjs import', 'db:backup': 'node scripts/db.mjs backup', 'db:restore': 'node scripts/db.mjs restore', 'db:cleanup': 'node scripts/db.mjs cleanup', 'db:baseline': 'node scripts/db.mjs baseline', 'db:certificates': 'node scripts/certificates.mjs' },
  dependencies: { ...apiPackage.dependencies, ...rootPackage.dependencies, '@frisancho/anthropometry': 'file:packages/anthropometry', '@frisancho/database': 'file:packages/database' }, overrides: rootPackage.overrides };
// Pin deployment dependencies to the versions that passed the application checks.
const sourceLock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
for (const name of Object.keys(pkg.dependencies)) { if (name.startsWith('@frisancho/')) continue; const locked = sourceLock.packages[`node_modules/${name}`]?.version; if (locked) pkg.dependencies[name] = locked; }
writeFileSync(path.join(stage, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
if (!process.env.npm_execpath) throw new Error('Execute pelo comando npm run package para gerar o lockfile de produção.');
const lock = spawnSync(process.execPath, [process.env.npm_execpath, 'install', '--package-lock-only', '--ignore-scripts', '--omit=dev'], { cwd: stage, stdio: 'inherit' });
if (lock.status !== 0) throw new Error('Não foi possível gerar o lockfile de produção.');
function inventory(dir, prefix = '') { return readdirSync(dir, { withFileTypes: true }).flatMap(e => { const file = prefix ? `${prefix}/${e.name}` : e.name; return e.isDirectory() ? inventory(path.join(dir, e.name), file) : [file]; }); }
const manifest = inventory(stage).sort();
if (manifest.some(file => file.split('/').some(segment => segment === 'node_modules' || /\.(pem|p12|pfx|key|crt|dump)$/i.test(segment) || segment === '.env' || segment.startsWith('.env.') && segment !== '.env.example'))) throw new Error('Arquivo proibido no pacote.');
writeFileSync(path.join(stage, 'MANIFEST.txt'), manifest.join('\n') + '\n');
mkdirSync('dist', { recursive: true });
const output = createWriteStream('dist/frisancho-ap-squarecloud.zip');
const archive = archiver('zip', { zlib: { level: 9 } });
const complete = new Promise((resolve, reject) => { output.on('close', resolve); output.on('error', reject); archive.on('error', reject); });
archive.pipe(output); archive.directory(stage, false); await archive.finalize(); await complete;
console.log(`Pacote gerado: dist/frisancho-ap-squarecloud.zip (${archive.pointer()} bytes). Build incluído; .env e node_modules excluídos.`);
