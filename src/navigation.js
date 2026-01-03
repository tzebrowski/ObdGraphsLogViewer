import { ChartManager } from './chartmanager.js';

export const Navigation = {
  routes: {
    '#home': () => {
      document.body.classList.remove('analyzer-active');
      document.body.classList.add('landing-active');

      document.getElementById('landing-page').style.display = 'block';
      document.getElementById('analyzer-page').style.display = 'none';
      document.body.classList.add('docs-body');
    },
    '#analyzer': () => {
      document.body.classList.add('analyzer-active');
      document.body.classList.remove('landing-active');

      document.getElementById('landing-page').style.display = 'none';
      document.getElementById('analyzer-page').style.display = 'block';
      document.body.classList.remove('docs-body');
      ChartManager.render();
    },
  },

  handleRoute: () => {
    console.log('Current Hash:', window.location.hash);
    const hash = window.location.hash || '#home';
    const routeAction = Navigation.routes[hash];

    if (routeAction) {
      routeAction();
    } else {
      Navigation.routes['#home']();
    }
  },

  init() {
    window.addEventListener('hashchange', Navigation.handleRoute);
  },
};
