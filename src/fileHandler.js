import { DOM } from './config.js';
import { DataProcessor } from './core.js';
import { UI } from './ui.js';

export const FileHandler = {
    init: () => {
        const dropZone = DOM.get('dropZone');
        const fileInput = DOM.get('fileInput');

        if (!dropZone || !fileInput) return;

        dropZone.addEventListener('click', () => fileInput.click());

        fileInput.addEventListener('change', (e) => FileHandler.handleFiles(e.target.files));

        ['dragenter', 'dragover'].forEach(eventName => {
            dropZone.addEventListener(eventName, (e) => {
                e.preventDefault();
                dropZone.classList.add('drag-over');
            });
        });

        ['dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, (e) => {
                e.preventDefault();
                dropZone.classList.remove('drag-over');
            });
        });

        dropZone.addEventListener('drop', (e) => {
            const dt = e.dataTransfer;
            FileHandler.handleFiles(dt.files);
        });
    },

    handleFiles: (files) => {
        setTimeout(() => {
            UI.setLoading(true, `Parsing ${files.length} Files...`);
            try {
                const file = files[0];
                if (!file || file.type !== "application/json") {
                    alert("Please drop a valid JSON telemetry file.");
                    return;
                }

                const reader = new FileReader();
                reader.onload = (e) => {
                    const data = JSON.parse(e.target.result);
                    DataProcessor.process(data, file.name);
                    console.log("File loaded successfully:", file.name);

                };
                reader.readAsText(file);
            } catch (err) {
                console.error("Failed to parse JSON:", err);
                alert("Invalid JSON format.");
            }
            finally {
                UI.setLoading(false);
            }
        }, 50);
    }

};