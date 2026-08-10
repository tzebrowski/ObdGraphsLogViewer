/** @type {import('stylelint').Config} */
export default {
  extends: ['stylelint-config-standard'],
  rules: {
    'font-family-no-missing-generic-family-keyword': [
      true,
      {
        ignoreFontFamilies: ['/Font Awesome/'],
      },
    ],
    // Allows camelCase for IDs and Classes (e.g., chartContainer)
    'selector-id-pattern': null,
    'selector-class-pattern': null,

    // Allows camelCase for keyframes (e.g., slideUp)
    'keyframes-name-pattern': null,

    // Disable "no-duplicate-selectors" if you prefer keeping theme overrides separate
    'no-duplicate-selectors': null,

    // Allows multiple declarations on one line (common in small utility classes)
    'declaration-block-single-line-max-declarations': null,

    // Fixes the issue where dark-theme overrides were flagged
    'no-descending-specificity': null,

    // Standard cleanup
    'value-keyword-case': null,
    'comment-empty-line-before': null,
  },
};
