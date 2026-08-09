/* eslint-env node */
module.exports = {
  root: true,
  env: { browser: true, es2022: true, node: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
  ],
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  plugins: ['@typescript-eslint', 'react-refresh'],
  ignorePatterns: ['dist', 'dev-dist', 'node_modules', 'coverage', '*.cjs'],
  rules: {
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    '@typescript-eslint/no-explicit-any': 'warn',
    'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
  },
  overrides: [
    {
      files: ['scripts/**/*.ts'],
      rules: { 'no-console': 'off' },
    },
    {
      files: ['tests/**/*.ts', 'tests/**/*.tsx'],
      rules: { '@typescript-eslint/no-explicit-any': 'off' },
    },
  ],
};
