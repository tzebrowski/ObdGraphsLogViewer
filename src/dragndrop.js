import { DOM } from './config.js';
import { DataProcessor } from './dataprocesssor.js';
import { UI } from './ui.js';

export const DragnDrop = {
  init: () => {
    const dropZone = DOM.get('dropZone');
    const fileInput = DOM.get('fileInputDropZone');

    if (!dropZone || !fileInput) return;

    dropZone.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', (e) =>
      DragnDrop.handleFiles(e.target.files)
    );

    ['dragenter', 'dragover'].forEach((eventName) => {
      dropZone.addEventListener(eventName, (e) => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
      });
    });

    ['dragleave', 'drop'].forEach((eventName) => {
      dropZone.addEventListener(eventName, (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
      });
    });

    dropZone.addEventListener('drop', (e) => {
      const dt = e.dataTransfer;
      DragnDrop.handleFiles(dt.files);
    });
  },

  toggleDropZone: () => {
    const dropZone = DOM.get('dropZone');

    if (!dropZone) return;

    const isHidden = dropZone.style.display === 'none';

    if (isHidden) {
      dropZone.style.display = 'flex';
    } else {
      dropZone.style.display = 'none';
    }
  },

  handleFiles: (files) => {
    setTimeout(() => {
      UI.setLoading(true, `Parsing ${files.length} Files...`);
      try {
        const file = files[0];
        if (!file || file.type !== 'application/json') {
          alert('Please drop a valid JSON telemetry file.');
          return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
          const data = JSON.parse(e.target.result);
          DataProcessor.process(data, file.name);
          console.log('File loaded successfully:', file.name);
        };
        reader.readAsText(file);
      } catch (err) {
        console.error('Failed to parse JSON:', err);
        alert('Invalid JSON format.');
      } finally {
        UI.setLoading(false);
      }
    }, 50);
  },
};
