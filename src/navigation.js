import { ChartManager } from './chartmanager.js';

export const Navigation = {
  routes: {
    '#home': () => {
      document.body.classList.remove('analyzer-active');
      document.body.classList.add('landing-active');

      document.getElementById('landing-page').style.display = 'block';
      document.getElementById('analyzer-page').style.display = 'none';
      document.body.classList.add('docs-body');

      const navBtn = document.querySelector('.nav-btn-primary');
      if (navBtn) {
        navBtn.href = '#analyzer';
        navBtn.innerHTML = '<i class="fas fa-chart-line"></i> Open Analyzer';
      }
    },

    '#analyzer': () => {
      document.body.classList.add('analyzer-active');
      document.body.classList.remove('landing-active');

      document.getElementById('landing-page').style.display = 'none';
      document.getElementById('analyzer-page').style.display = 'block';
      document.body.classList.remove('docs-body');

      const navBtn = document.querySelector('.nav-btn-primary');
      if (navBtn) {
        navBtn.href = '#home';
        navBtn.innerHTML = '<i class="fas fa-home"></i> Back to Home';
      }

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
    Navigation.handleRoute();
  },
};
