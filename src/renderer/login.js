class LoginApp {
  constructor() {
    this.emailInput = document.getElementById('license-email');
    this.loginButton = document.getElementById('login-button');
    this.messageEl = document.getElementById('login-message');
    this.isSubmitting = false;
    this.init();
  }

  init() {
    if (!this.emailInput || !this.loginButton) {
      return;
    }

    this.loginButton.addEventListener('click', () => this.handleSubmit());
    this.emailInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        this.handleSubmit();
      }
    });
  }

  showMessage(text, isError = true) {
    if (!this.messageEl) return;
    this.messageEl.textContent = text;
    this.messageEl.style.display = text ? 'block' : 'none';
    this.messageEl.style.color = isError ? 'var(--error-color)' : 'var(--success-color)';
  }

  setLoading(isLoading) {
    this.isSubmitting = isLoading;
    if (this.loginButton) {
      this.loginButton.disabled = isLoading;
      this.loginButton.textContent = isLoading ? 'Checking...' : 'Sign in';
    }
  }

  logRuntimeEvent(type, payload = {}) {
    try {
      const raw = localStorage.getItem('autoflow-runtime-events');
      let events = [];
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            events = parsed;
          }
        } catch (e) {}
      }

      const entry = {
        type,
        timestamp: new Date().toISOString(),
        ...payload
      };

      events.push(entry);
      if (events.length > 100) {
        events = events.slice(-100);
      }

      localStorage.setItem('autoflow-runtime-events', JSON.stringify(events));
    } catch (e) {}
  }

  validateEmail(email) {
    if (!email) return false;
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
  }

  async handleSubmit() {
    if (this.isSubmitting) return;

    const email = this.emailInput ? this.emailInput.value.trim() : '';
    if (!this.validateEmail(email)) {
      this.showMessage('Invalid email format');
      this.logRuntimeEvent('login-invalid-email', { email });
      return;
    }

    this.showMessage('');
    this.setLoading(true);

    try {
      if (!window.electronAPI || !window.electronAPI.validateLicense) {
        this.showMessage('License API is not available', true);
        this.logRuntimeEvent('login-error', { email, error: 'License API is not available' });
        return;
      }

      const result = await window.electronAPI.validateLicense({ email });
      if (!result || !result.success) {
        this.showMessage(result && result.error ? result.error : 'License validation failed');
        this.logRuntimeEvent('login-failed', { email, error: result && result.error ? result.error : 'License validation failed' });
        return;
      }

      this.showMessage('License is valid, opening the app...', false);
      this.logRuntimeEvent('login-success', { email });
      setTimeout(async () => {
        try {
          if (window.electronAPI && window.electronAPI.openMainApp) {
            const navResult = await window.electronAPI.openMainApp();
            if (!navResult || !navResult.success) {
              window.location.href = 'index.html';
            }
          } else {
            window.location.href = 'index.html';
          }
        } catch (e) {
          window.location.href = 'index.html';
        }
      }, 600);
    } catch (error) {
      this.showMessage('An error occurred: ' + (error.message || String(error)));
      this.logRuntimeEvent('login-error', { email, error: error.message || String(error) });
    } finally {
      this.setLoading(false);
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new LoginApp();
});
