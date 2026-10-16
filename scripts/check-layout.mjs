import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
const baseURL = process.argv[2] || 'http://localhost:3000';
const label = process.argv[3] || 'layout-final';
if (!/^http:\/\/localhost:(3000|4200)$/.test(baseURL) || !/^[a-z0-9-]+$/.test(label)) throw new Error('Use apenas o ambiente local e um nome simples.');
mkdirSync(`.local/${label}`, { recursive: true });
const browser = await chromium.launch(); const report = [];
try {
  for (const width of [360, 768, 1024, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } }); const cssResponses = []; const browserErrors = [];
    page.on('response', response => { if (/\.css(?:\?|$)/.test(response.url())) cssResponses.push({ url: response.url(), status: response.status(), mime: response.headers()['content-type'] }); });
    page.on('pageerror', error => browserErrors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' && /style|css|content security/i.test(message.text())) browserErrors.push(message.text()); });
    await page.goto(baseURL); await page.getByRole('heading', { name: 'Nova avaliação', exact: true }).waitFor(); await page.evaluate(() => document.fonts.ready);
    const metrics = await page.evaluate(() => {
      const el = selector => document.querySelector(selector); const style = selector => getComputedStyle(el(selector)); const rect = selector => { const r = el(selector).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
      return { sidebar: { width: style('.sidebar').width, position: style('.sidebar').position, activeBackground: style('.sidebar nav a.active').backgroundColor, linkDecoration: style('.sidebar nav a.active').textDecorationLine }, grid: { display: style('.evaluation-grid').display, columns: style('.evaluation-grid').gridTemplateColumns, gap: style('.evaluation-grid').gap }, form: { padding: style('.evaluation-form').padding, border: style('.evaluation-form').borderTopWidth, rect: rect('.evaluation-form') }, result: rect('.result-column'), input: { height: style('#cb').height, fontSize: style('#cb').fontSize }, mainPadding: style('.main-content').padding, skipLinkY: rect('.skip-link').y, horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth };
    });
    await page.screenshot({ path: `.local/${label}/avaliacao-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Carregar exemplo' }).click(); await page.getByRole('button', { name: 'Calcular avaliação', exact: true }).click(); await page.locator('.result-value strong').waitFor();
    const result = await page.locator('.result-value strong').textContent();
    await page.screenshot({ path: `.local/${label}/resultado-${width}.png`, fullPage: true });
    report.push({ width, cssResponses, browserErrors, metrics, result }); await page.close();
  }
} finally { await browser.close(); }
writeFileSync(`.local/${label}/verificacao.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (report.some(r => r.metrics.horizontalOverflow || r.metrics.grid.display !== 'grid' || r.metrics.sidebar.position !== 'fixed' || r.result !== '24,97' || r.cssResponses.some(css => css.status !== 200 || !css.mime?.includes('text/css')) || r.browserErrors.length)) process.exitCode = 1;
