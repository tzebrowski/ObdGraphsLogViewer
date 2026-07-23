import { describe, test, expect } from '@jest/globals';
import { Alert } from '../src/alert.js';

describe('Alert Module Tests', () => {
  beforeEach(() => {
    // 1. Setup the exact DOM structure required by alert.js
    document.body.innerHTML = `
      <div id="customAlert" style="display: none;">
        <div class="modal-content">
          <h2 id="alertTitle"></h2>
          <p id="alertMessage"></p>
        </div>
      </div>
    `;
  });

  test('showAlert() populates the DOM and displays the modal', () => {
    // 2. Execute with custom title and type
    Alert.showAlert('Engine Overheating!', 'Critical Error', 'warning');

    const modal = document.getElementById('customAlert');
    const title = document.getElementById('alertTitle');
    const message = document.getElementById('alertMessage');
    const content = modal.querySelector('.modal-content');

    // 3. Verify content and visibility
    expect(title.innerText).toBe('Critical Error');
    expect(message.innerText).toBe('Engine Overheating!');
    expect(modal.style.display).toBe('flex');
    expect(content.className).toContain('warning');
  });

  test('hideAlert() sets display to none', () => {
    const modal = document.getElementById('customAlert');
    modal.style.display = 'flex'; // Set to visible first

    Alert.hideAlert();

    expect(modal.style.display).toBe('none');
  });
});
