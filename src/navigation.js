import { ChartManager } from './chartmanager.js';

export const Navigation = {
  routes: {
    '#home': () => {
      document.getElementById('landing-page').style.display = 'block';
      document.getElementById('analyzer-page').style.display = 'none';
      document.body.classList.add('docs-body');
    },
    '#analyzer': () => {
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
