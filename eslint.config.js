import typescriptEslint from '@typescript-eslint/eslint-plugin';
import config from 'ultracite/eslint/core';

export default [
  ...config,
  {
    ignores: ['**/*.js', '**/*.cjs', '**/*.mjs', 'package.json', 'tsconfig.json'],
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: {
        project: false,
      },
    },
    rules: {
      ...typescriptEslint.configs['flat/disable-type-checked'].rules,
    },
  },
  {
    files: ['src/index.ts', 'src/*/index.ts'],
    rules: {
      'unicorn/no-barrel-files': 'off',
    },
  },
  {
    files: ['src/**/*.ts'],
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unsafe-function-type': 'off',
      'arrow-body-style': 'off',
      'unicorn/consistent-arrow-return-style': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    files: ['tests/**/*.ts'],
    rules: {
      'arrow-body-style': 'off',
      'unicorn/consistent-arrow-return-style': 'off',
    },
  },
];
