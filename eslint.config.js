import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['dist/**'] },
  {
    files: ['**/*.js'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: js.configs.recommended.rules,
  },
];
