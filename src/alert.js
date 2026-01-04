export const Alert = {
  showAlert(message, title = 'Notification', type = 'error') {
    const modal = document.getElementById('customAlert');
    const titleEl = document.getElementById('alertTitle');
    const msgEl = document.getElementById('alertMessage');
    const content = modal?.querySelector('.modal-content');

    if (!modal || !titleEl || !msgEl) return;

    titleEl.innerText = title;
    msgEl.innerText = message;

    content.className = `modal-content alert-modal ${type}`;
    modal.style.display = 'flex';
  },

  hideAlert() {
    const modal = document.getElementById('customAlert');
    if (modal) modal.style.display = 'none';
  },
};
