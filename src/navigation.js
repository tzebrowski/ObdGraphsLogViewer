import { ChartManager } from './chartmanager.js';

window.navigateTo = (page) => {
  const landing = document.getElementById('landing-page');
  const analyzer = document.getElementById('analyzer-page');
  const body = document.body;

  if (page === 'analyzer') {
    landing.style.display = 'none';
    analyzer.style.display = 'flex';
    body.classList.remove('docs-body');
    body.classList.add('analyzer-active');
    ChartManager.render();
  } else {
    landing.style.display = 'block';
    analyzer.style.display = 'none';
    body.classList.add('docs-body');
    body.classList.remove('analyzer-active');
  }
  window.scrollTo(0, 0);
};
