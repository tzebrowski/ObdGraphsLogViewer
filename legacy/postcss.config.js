import purgecss from '@fullhuman/postcss-purgecss';
import postcssCsso from 'postcss-csso';
import postcssPresetEnv from 'postcss-preset-env';
import process from 'node:process';

export default {
  plugins: [
    postcssPresetEnv({ stage: 2 }),

    process.env.NODE_ENV === 'production'
      ? purgecss({
          content: ['./index.html', './src/**/*.{js,ts}'],
          defaultExtractor: (content) => content.match(/[\w-/:]+(?<!:)/g) || [],
          safelist: ['html', 'body'],
        })
      : null,

    process.env.NODE_ENV === 'production'
      ? postcssCsso({
          restructure: true,
          comments: false,
        })
      : null,
  ].filter(Boolean),
};
