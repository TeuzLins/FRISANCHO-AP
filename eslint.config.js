import js from '@eslint/js';
import ts from 'typescript-eslint';
export default ts.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/generated/**', '**/.angular/**', '.local/**', 'playwright-report/**', 'test-results/**'] },
  js.configs.recommended, ...ts.configs.recommended,
  { files: ['**/*.{ts,tsx,js,mjs}'], rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }] }, languageOptions: { globals: { process: 'readonly', console: 'readonly', Buffer: 'readonly', URL: 'readonly', fetch: 'readonly', document: 'readonly', window: 'readonly', navigator: 'readonly', getComputedStyle: 'readonly', setTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly', AbortController: 'readonly', RequestInit: 'readonly', HTMLInputElement: 'readonly', HTMLSelectElement: 'readonly', HTMLTextAreaElement: 'readonly' } } }
);
