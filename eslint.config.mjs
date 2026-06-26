import { defineConfig, globalIgnores } from 'eslint/config'
import tseslint from 'typescript-eslint'

export default defineConfig([
  ...tseslint.configs.recommended,
  globalIgnores(['.next/**', 'dist/**', 'generated/**', 'node_modules/**', 'packages/fe/dist/**', 'scripts/**']),
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        Buffer: 'readonly',
        process: 'readonly',
        globalThis: 'readonly',
        crypto: 'readonly',
        MutationObserver: 'readonly',
        WheelEvent: 'readonly',
        TouchEvent: 'readonly',
        EventTarget: 'readonly',
        Event: 'readonly',
        HTMLElement: 'readonly',
        Node: 'readonly',
        HTMLDivElement: 'readonly',
        HTMLButtonElement: 'readonly',
        FormData: 'readonly',
        WebDriver: 'readonly',
        Builder: 'readonly',
        By: 'readonly',
        until: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
])
