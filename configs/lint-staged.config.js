export default {
  '*.{js,mjs,cjs,ts,tsx,jsx}': ['prettier --write', 'eslint --fix'],
  '*.{json,md,yml,yaml,css}': ['prettier --write'],
};
