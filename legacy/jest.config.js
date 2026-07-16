export default {
  testEnvironment: 'jsdom',
  transform: {
    '^.+\\.jsx?$': 'babel-jest',
  },
  transformIgnorePatterns: [
    // If you have ESM-only dependencies, include them here
    '/node_modules/(?!your-esm-dep-name)/',
  ],
};
