import purgecss from '@fullhuman/postcss-purgecss';
import postcssCsso from 'postcss-csso';
import postcssPresetEnv from 'postcss-preset-env';

export default {
  plugins: [

    postcssPresetEnv({ stage: 2 }),

    process.env.NODE_ENV === 'production'
      ? purgecss({
          content: ['./index.html', './src/**/*.{vue,js,ts,jsx,tsx}'],
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
