// @ts-check
import antfu from '@antfu/eslint-config'

export default antfu(
  {
    type: 'lib',
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-console': 'off',
      'style/brace-style': ['error', '1tbs', { allowSingleLine: true }],
    },
  },
)
