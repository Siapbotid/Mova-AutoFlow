class AutoFlowApp {
  constructor() {

    this.generationType = 'text-to-video';

    this.isProcessing = false;
    this.isPaused = false;

    this.currentBatch = 0;
    this.totalBatches = 0;
    this.logs = [];
    this.activityLogs = [];
    this.videoAPI = null;
    this.remainingCredits = null;

    this.userStopRequested = false;

    this.concurrentProcessing = 0;
    this.maxConcurrency = 3;
    this.currentPage = 'overview';
    
    // Initialize processing arrays
    this.processQueue = [];
    this.completedItems = [];
    this.processingState = 'idle';
    this.imageFiles = [];
    this.selectedImages = [];

    // Batch processing properties
    this.allItems = []; // Store all items to be processed
    this.currentBatchItems = []; // Currently displayed batch
    this.currentBatchIndex = 0;
    
    this.init();
  }

  async init() {
    this.setupEventListeners();
    await this.loadSettings();
    this.loadAutoSavedState(); // Load the auto-saved current state
    this.updateUI();
    this.startAutoSave();
    this.initializeAPI();
    this.consumeRuntimeEvents();
  }

  switchGenerationType(type) {
    if (type !== 'text-to-video' && type !== 'image-to-video') {
      type = 'text-to-video';
    }

    this.generationType = type;

    const tabs = document.querySelectorAll('.tab-btn');
    tabs.forEach(btn => {
      if (btn.dataset.type === type) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    const textControls = document.getElementById('text-to-video-controls');
    const imageControls = document.getElementById('image-to-video-controls');

    if (textControls && imageControls) {
      if (type === 'text-to-video') {
        textControls.style.display = 'block';
        imageControls.style.display = 'none';
      } else {
        textControls.style.display = 'none';
        imageControls.style.display = 'block';
      }
    }

    this.validateForm();
  }

  validateForm() {
    const startBtn = document.getElementById('start-btn');
    if (!startBtn) return;

    const bearerTokenEl = document.getElementById('bearer-token');
    const outputFolderEl = document.getElementById('output-folder-path');
    const inputFolderEl = document.getElementById('input-folder-path');
    const promptsEl = document.getElementById('prompt-list');

    const bearerToken = bearerTokenEl ? bearerTokenEl.value.trim() : '';
    const outputFolder = outputFolderEl ? outputFolderEl.value.trim() : '';
    const inputFolder = inputFolderEl ? inputFolderEl.value.trim() : '';
    const promptsText = promptsEl ? promptsEl.value.trim() : '';

    let hasWork = false;
    if (this.generationType === 'text-to-video') {
      hasWork = promptsText.length > 0;
    } else if (this.generationType === 'image-to-video') {
      hasWork = !!inputFolder;
    }

    const isValid = !!bearerToken && !!outputFolder && hasWork;
    startBtn.disabled = !isValid;
  }

  updatePromptCount() {
    const promptListTextarea = document.getElementById('prompt-list');
    const promptCountLabel = document.getElementById('prompt-count');
    if (!promptListTextarea || !promptCountLabel) return;

    const text = promptListTextarea.value || '';
    const lines = text
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);

    const count = lines.length;
    const suffix = count === 1 ? 'prompt' : 'prompts';
    promptCountLabel.textContent = `${count} ${suffix}`;
  }

  initializeAPI() {
    const bearerToken = document.getElementById('bearer-token').value || this.settings.defaultBearerToken;
    if (bearerToken) {
      this.videoAPI = new VideoAPI(bearerToken);
    }
  }

  async testBearerToken() {
    const tokenInput = document.getElementById('bearer-token');
    const button = document.getElementById('test-token');
    const token = tokenInput ? tokenInput.value.trim() : '';

    if (!token) {
      this.showError('Please enter a Bearer Token first');
      return;
    }

    if (!this.videoAPI) {
      this.videoAPI = new VideoAPI(token);
    } else {
      this.videoAPI.updateBearerToken(token);
    }

    try {
      if (button) {
        button.disabled = true;
        button.textContent = 'Testing...';
      }

      this.log('Testing bearer token...', 'info');
      const result = await this.videoAPI.testToken();

      if (result && result.success) {
        const statusText = result.status ? ` (HTTP ${result.status})` : '';
        this.showSuccess(`Bearer token is valid${statusText}`);
      } else {
        const message = result && result.error ? result.error : 'Bearer token test failed';
        this.showError(message);
      }
    } catch (error) {
      this.showError('Bearer token test error: ' + (error.message || String(error)));
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = 'Test Token';
      }
    }
  }

  getGeminiApiKey() {
    if (!this.settings) return '';
    const key = this.settings.geminiApiKey || '';
    return typeof key === 'string' ? key.trim() : '';
  }

  async analyzePromptWithGemini(prompt, context = '') {
    const apiKey = this.getGeminiApiKey();
    if (!apiKey) {
      return null;
    }

    try {
      const analysisPrompt = [
        'You are an assistant that reviews video generation prompts for Google Veo 3.',
        'Return a short, 1-2 sentence analysis in English describing potential issues,',
        'safety concerns, or suggestions to improve the prompt.',
        context ? `Context: ${context}` : '',
        '',
        `Prompt: ${prompt}`
      ].join(' ');

      const body = {
        contents: [
          {
            parts: [
              { text: analysisPrompt }
            ]
          }
        ]
      };

      const response = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' +
          encodeURIComponent(apiKey),
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body)
        }
      );

      if (!response.ok) {
        throw new Error(`Gemini HTTP ${response.status}`);
      }

      const data = await response.json();
      const parts =
        data.candidates &&
        data.candidates[0] &&
        data.candidates[0].content &&
        Array.isArray(data.candidates[0].content.parts)
          ? data.candidates[0].content.parts
          : [];
      const text = parts
        .map(p => (p && typeof p.text === 'string' ? p.text : ''))
        .join(' ') || '';

      if (text) {
        this.log(`Gemini analysis for prompt: ${text}`, 'info');
      } else {
        this.log('Gemini analysis returned no text', 'warning');
      }

      return text;
    } catch (error) {
      this.log(`Gemini analysis error: ${error.message || error}`, 'error');
      return null;
    }
  }

  async analyzeImageWithGemini(imagePath) {
    const apiKey = this.getGeminiApiKey();
    if (!apiKey || !imagePath) {
      return null;
    }

    try {
      if (!window.electronAPI || !window.electronAPI.readFileBase64) {
        this.log('readFileBase64 API is not available for image analysis', 'warning');
        return null;
      }

      const fileResult = await window.electronAPI.readFileBase64(imagePath);
      if (!fileResult || !fileResult.success || !fileResult.base64) {
        const message = fileResult && fileResult.error ? fileResult.error : 'Unknown error';
        this.log(`Failed to read image for Gemini analysis: ${message}`, 'error');
        return null;
      }

      const lowerPath = imagePath.toLowerCase();
      let mimeType = 'image/jpeg';
      if (lowerPath.endsWith('.png')) mimeType = 'image/png';
      else if (lowerPath.endsWith('.webp')) mimeType = 'image/webp';
      else if (lowerPath.endsWith('.gif')) mimeType = 'image/gif';

      const body = {
        contents: [
          {
            parts: [
              {
                inlineData: {
                  mimeType,
                  data: fileResult.base64
                }
              },
              {
                text: 'Generate a concise, high-quality English video generation prompt for Google Veo 3 based on this image. Use 1-2 sentences, describing the scene, style, and camera movement.'
              }
            ]
          }
        ]
      };

      const response = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' +
          encodeURIComponent(apiKey),
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body)
        }
      );

      if (!response.ok) {
        throw new Error(`Gemini HTTP ${response.status}`);
      }

      const data = await response.json();
      const parts =
        data.candidates &&
        data.candidates[0] &&
        data.candidates[0].content &&
        Array.isArray(data.candidates[0].content.parts)
          ? data.candidates[0].content.parts
          : [];
      const text = parts
        .map(p => (p && typeof p.text === 'string' ? p.text : ''))
        .join(' ') || '';

      if (text) {
        this.log(`Gemini image prompt for ${imagePath}: ${text}`, 'info');
      } else {
        this.log(`Gemini image analysis returned no text for ${imagePath}`, 'warning');
      }

      return text;
    } catch (error) {
      this.log(`Gemini image analysis error for ${imagePath}: ${error.message || error}`, 'error');
      return null;
    }
  }

  openLicenseModal() {
    const modal = document.getElementById('license-modal');
    const contentEl = document.getElementById('license-modal-content');
    const statusEl = document.getElementById('license-modal-status');
    if (!modal || !contentEl) {
      return;
    }

    modal.classList.add('show');

    if (!window.electronAPI || !window.electronAPI.loadLicense) {
      contentEl.innerHTML = '<p class="license-error-text">License API is not available.</p>';
      if (statusEl) statusEl.textContent = '';
      return;
    }

    if (statusEl) {
      statusEl.textContent = 'Loading license information...';
    }

    window.electronAPI.loadLicense()
      .then((result) => {
        if (!result || !result.success) {
          const message = result && result.error ? result.error : 'Failed to load license data.';
          contentEl.innerHTML = '<p class="license-error-text">' + message + '</p>';
          if (statusEl) statusEl.textContent = '';
          return;
        }

        const license = result.license;
        if (!license) {
          contentEl.innerHTML = '<p class="license-error-text">License not found. Please sign in again.</p>';
          if (statusEl) statusEl.textContent = '';
          return;
        }

        const email = license.email || '-';
        const tanggalJoin = license.tanggalJoin || '-';
        const tanggalBerakhir = license.tanggalBerakhir || '-';
        const mesinId1 = license.mesinId1 || '-';
        const mesinId2 = license.mesinId2 || '-';
        const mesinId3 = license.mesinId3 || '-';

        const rows = [
          '<div class="license-detail-row"><span class="license-detail-label">Email</span><span class="license-detail-value">' + email + '</span></div>',
          '<div class="license-detail-row"><span class="license-detail-label">Join Date</span><span class="license-detail-value">' + tanggalJoin + '</span></div>',
          '<div class="license-detail-row"><span class="license-detail-label">License Expired Date</span><span class="license-detail-value">' + tanggalBerakhir + '</span></div>',
          '<div class="license-detail-row"><span class="license-detail-label">Machine ID 1</span><span class="license-detail-value">' + mesinId1 + '</span></div>',
          '<div class="license-detail-row"><span class="license-detail-label">Machine ID 2</span><span class="license-detail-value">' + mesinId2 + '</span></div>',
          '<div class="license-detail-row"><span class="license-detail-label">Machine ID 3</span><span class="license-detail-value">' + mesinId3 + '</span></div>'
        ];

        contentEl.innerHTML = rows.join('');
        if (statusEl) statusEl.textContent = '';
      })
      .catch((error) => {
        const message = error && error.message ? error.message : String(error);
        contentEl.innerHTML = '<p class="license-error-text">An error occurred: ' + message + '</p>';
        if (statusEl) statusEl.textContent = '';
      });
  }

  closeLicenseModal() {
    const modal = document.getElementById('license-modal');
    if (!modal) {
      return;
    }
    modal.classList.remove('show');
  }

  logout() {
    try {
      window.location.href = 'login.html';
    } catch (error) {
      this.showError('Failed to log out: ' + (error.message || String(error)));
    }
  }

  navigateToPage(page) {
    const pageIdMap = {
      overview: 'overview-page',
      settings: 'settings-page',
      logs: 'logs-page',
      about: 'about-page'
    };

    const targetPageId = pageIdMap[page] || page;
    this.currentPage = page;

    // Log page navigation as part of runtime logs
    try {
      this.log(`Navigating to page: ${page}`, 'info');
    } catch (e) {
      // ignore logging errors so navigation is never blocked
    }

    try {
      localStorage.setItem('autoflow-current-page', page);
    } catch (e) {
      // ignore storage errors
    }

    const pages = document.querySelectorAll('.page');

    pages.forEach(pageElement => {
      if (pageElement.id === targetPageId) {
        pageElement.classList.add('active');
      } else {
        pageElement.classList.remove('active');
      }
    });

    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(navItem => {
      if (navItem.dataset.page === page) {
        navItem.classList.add('active');
      } else {
        navItem.classList.remove('active');
      }
    });

    if (page === 'logs') {
      this.loadLogs();
    } else if (page === 'about') {
      this.loadAboutInfo();
    } else if (page === 'overview') {
      this.updateInlineLogs();
    }
  }

  setupEventListeners() {
    const sidebar = document.querySelector('.sidebar');
    const sidebarToggle = document.getElementById('sidebar-toggle');
    const licenseButton = document.getElementById('license-button');
    const logoutNav = document.getElementById('logout-nav');
    const licenseModal = document.getElementById('license-modal');
    const licenseModalClose = document.getElementById('license-modal-close');
    const licenseModalCloseFooter = document.getElementById('license-modal-close-footer');

    if (sidebar && sidebarToggle) {
      const iconSpan = sidebarToggle.querySelector('.sidebar-toggle-icon');

      const applySidebarState = (collapsed) => {
        if (collapsed) {
          sidebar.classList.add('collapsed');
        } else {
          sidebar.classList.remove('collapsed');
        }
        if (iconSpan) {
          iconSpan.textContent = collapsed ? '\u00BB' : '\u00AB';
        }
      };

      let initialCollapsed = false;
      try {
        initialCollapsed = localStorage.getItem('autoflow-sidebar-collapsed') === 'true';
      } catch (e) {
        initialCollapsed = false;
      }

      applySidebarState(initialCollapsed);

      sidebarToggle.addEventListener('click', () => {
        const nextCollapsed = !sidebar.classList.contains('collapsed');
        applySidebarState(nextCollapsed);
        try {
          localStorage.setItem('autoflow-sidebar-collapsed', nextCollapsed ? 'true' : 'false');
        } catch (e) {
          // ignore storage errors
        }
      });
    }

    if (licenseButton) {
      licenseButton.addEventListener('click', () => this.openLicenseModal());
    }

    if (logoutNav) {
      logoutNav.addEventListener('click', () => this.logout());
    }

    if (licenseModalClose) {
      licenseModalClose.addEventListener('click', () => this.closeLicenseModal());
    }

    if (licenseModalCloseFooter) {
      licenseModalCloseFooter.addEventListener('click', () => this.closeLicenseModal());
    }

    if (licenseModal) {
      licenseModal.addEventListener('click', (e) => {
        if (e.target === licenseModal) {
          this.closeLicenseModal();
        }
      });
    }

    // Navigation
    document.querySelectorAll('.nav-item[data-page]').forEach(item => {
      item.addEventListener('click', (e) => {
        const page = e.currentTarget.dataset.page;
        this.navigateToPage(page);
      });
    });

    // Generation type tabs
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const type = e.currentTarget.dataset.type;
        this.switchGenerationType(type);
      });
    });

    // Processing controls
    const startBtn = document.getElementById('start-btn');
    if (startBtn) {
      startBtn.addEventListener('click', () => {
        console.log('Start button clicked'); // Debug log
        this.startProcessing();
      });
    }

    const stopBtn = document.getElementById('stop-btn');
    if (stopBtn) {
      stopBtn.addEventListener('click', () => this.stopProcessing());
    }

    // Log controls
    const clearLogsBtn = document.getElementById('clear-logs');
    if (clearLogsBtn) {
      clearLogsBtn.addEventListener('click', () => this.clearLogs());
    }

    const copyLogsBtn = document.getElementById('copy-logs');
    if (copyLogsBtn) {
      copyLogsBtn.addEventListener('click', () => this.copyLogs());
    }

    const inlineCopyLogsBtn = document.getElementById('inline-copy-logs');
    if (inlineCopyLogsBtn) {
      inlineCopyLogsBtn.addEventListener('click', () => this.copyLogs());
    }

    const exportLogsBtn = document.getElementById('export-logs');
    if (exportLogsBtn) {
      exportLogsBtn.addEventListener('click', () => this.exportLogs());
    }

    const exportResultsBtn = document.getElementById('export-results');
    if (exportResultsBtn) {
      exportResultsBtn.addEventListener('click', () => this.exportResults());
    }

    const skipAllBtn = document.getElementById('clear-completed');
    if (skipAllBtn) {
      skipAllBtn.addEventListener('click', () => this.skipAllActive());
    }

    // Settings controls
    const saveConfigBtn = document.getElementById('save-config');
    if (saveConfigBtn) {
      saveConfigBtn.addEventListener('click', () => this.saveOverviewConfiguration());
    }

    const saveSettingsBtn = document.getElementById('save-settings');
    if (saveSettingsBtn) {
      saveSettingsBtn.addEventListener('click', () => this.saveSettings());
    }

    const resetSettingsBtn = document.getElementById('reset-settings');
    if (resetSettingsBtn) {
      resetSettingsBtn.addEventListener('click', () => this.resetSettings());
    }

    // Form inputs
    const bearerTokenInput = document.getElementById('bearer-token');
    if (bearerTokenInput) {
      bearerTokenInput.addEventListener('input', () => {
        this.validateForm();
        this.initializeAPI();
      });
    }

    const testTokenBtn = document.getElementById('test-token');
    if (testTokenBtn) {
      testTokenBtn.addEventListener('click', () => this.testBearerToken());
    }

    const modelSelect = document.getElementById('model-select');
    if (modelSelect) {
      modelSelect.addEventListener('change', () => this.validateForm());
    }
    
    const concurrentCount = document.getElementById('concurrent-count');
    if (concurrentCount) {
      concurrentCount.addEventListener('input', () => this.validateForm());
    }

    const promptsInput = document.getElementById('prompt-list');
    if (promptsInput) {
      promptsInput.addEventListener('input', () => {
        this.updatePromptCount();
        this.validateForm();
      });
    }

    const savePromptsBtn = document.getElementById('save-prompts');
    if (savePromptsBtn) {
      savePromptsBtn.addEventListener('click', () => this.savePrompts());
    }

    const importPromptsBtn = document.getElementById('import-prompts');
    if (importPromptsBtn) {
      importPromptsBtn.addEventListener('click', () => this.importPrompts());
    }

    const clearPromptsBtn = document.getElementById('clear-prompts');
    if (clearPromptsBtn) {
      clearPromptsBtn.addEventListener('click', () => this.clearPrompts());
    }

    const browseOutputBtn = document.getElementById('browse-output');
    if (browseOutputBtn) {
      browseOutputBtn.addEventListener('click', () => this.selectOutputFolder());
    }

    const browseInputBtn = document.getElementById('browse-input');
    if (browseInputBtn) {
      browseInputBtn.addEventListener('click', () => this.selectInputFolder());
    }

    const inputFolderInput = document.getElementById('input-folder-path');
    if (inputFolderInput) {
      inputFolderInput.addEventListener('click', () => this.selectInputFolder());
    }

    const outputFolderInput = document.getElementById('output-folder-path');
    if (outputFolderInput) {
      outputFolderInput.addEventListener('click', () => this.selectOutputFolder());
    }

    const configCollapseToggle = document.getElementById('config-collapse-toggle');
    const configCardBody = document.getElementById('config-card-body');
    if (configCollapseToggle && configCardBody) {
      const labelSpan = configCollapseToggle.querySelector('.collapse-toggle-label');
      const iconSpan = configCollapseToggle.querySelector('.collapse-toggle-icon');

      const applyConfigCollapsed = (collapsed) => {
        configCardBody.style.display = collapsed ? 'none' : '';
        if (labelSpan) {
          labelSpan.textContent = collapsed ? 'Expand' : 'Collapse';
        }
        if (iconSpan) {
          iconSpan.textContent = collapsed ? '▼' : '▲';
        }
        configCollapseToggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      };

      let initialCollapsed = false;
      try {
        initialCollapsed = localStorage.getItem('autoflow-config-collapsed') === 'true';
      } catch (e) {
        initialCollapsed = false;
      }

      applyConfigCollapsed(initialCollapsed);

      configCollapseToggle.addEventListener('click', () => {
        const isCollapsed = configCardBody.style.display === 'none';
        const nextCollapsed = !isCollapsed;
        applyConfigCollapsed(nextCollapsed);
        try {
          localStorage.setItem('autoflow-config-collapsed', nextCollapsed ? 'true' : 'false');
        } catch (e) {
          // ignore storage errors
        }
      });
    }

    const controlCollapseToggle = document.getElementById('control-collapse-toggle');
    const controlCardBody = document.getElementById('control-card-body');
    if (controlCollapseToggle && controlCardBody) {
      const labelSpan = controlCollapseToggle.querySelector('.collapse-toggle-label');
      const iconSpan = controlCollapseToggle.querySelector('.collapse-toggle-icon');

      const applyControlCollapsed = (collapsed) => {
        controlCardBody.style.display = collapsed ? 'none' : '';
        if (labelSpan) {
          labelSpan.textContent = collapsed ? 'Expand' : 'Collapse';
        }
        if (iconSpan) {
          iconSpan.textContent = collapsed ? '▼' : '▲';
        }
        controlCollapseToggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      };

      let initialCollapsed = false;
      try {
        initialCollapsed = localStorage.getItem('autoflow-control-collapsed') === 'true';
      } catch (e) {
        initialCollapsed = false;
      }

      applyControlCollapsed(initialCollapsed);

      controlCollapseToggle.addEventListener('click', () => {
        const isCollapsed = controlCardBody.style.display === 'none';
        const nextCollapsed = !isCollapsed;
        applyControlCollapsed(nextCollapsed);
        try {
          localStorage.setItem('autoflow-control-collapsed', nextCollapsed ? 'true' : 'false');
        } catch (e) {
          // ignore storage errors
        }
      });
    }
  }

  async startProcessing() {
    try {
      if (this.isProcessing && !this.isPaused && this.processQueue && this.processQueue.length > 0) {
        this.showInfo('Processing is already running');
        return;
      }

      // Reset stop flag for a new run
      this.userStopRequested = false;

      const bearerTokenEl = document.getElementById('bearer-token');
      const outputFolderEl = document.getElementById('output-folder-path');
      const promptsEl = document.getElementById('prompt-list');
      const inputFolderEl = document.getElementById('input-folder-path');

      await this.initializeAPI();

      const items = [];

      if (this.generationType === 'text-to-video') {
        const text = promptsEl ? promptsEl.value : '';
        const lines = text
          .split('\n')
          .map(line => line.trim())
          .filter(line => line.length > 0);

        if (lines.length === 0) {
          this.showError('Please enter at least one prompt');
          return;
        }

        const baseId = Date.now();
        lines.forEach((line, index) => {
          items.push({
            id: `txt-${baseId}-${index}`,
            type: 'text-to-video',
            prompt: line,
            status: 'pending',
            progress: 0
          });
        });
      } else {
        const folderPath = inputFolderEl ? inputFolderEl.value.trim() : '';
        if (!folderPath) {
          this.showError('Please select an input folder for Image-to-Video');
          return;
        }

        if (!this.imageFiles || this.imageFiles.length === 0) {
          await this.scanInputFolder(folderPath);
        }

        if (!this.imageFiles || this.imageFiles.length === 0) {
          this.showError('No images found in input folder');
          return;
        }

        const baseId = Date.now();

        this.imageFiles.forEach((imagePath, index) => {
          items.push({
            id: `img-${baseId}-${index}`,
            type: 'image-to-video',
            imagePath,
            prompt: '',
            status: 'pending',
            progress: 0
          });
        });
      }

      if (items.length === 0) {
        this.showError('No items to process');
        return;
      }

      this.processQueue = items.slice();
      this.allItems = items.slice();
      this.currentBatchItems = items.slice();
      this.currentBatchIndex = 0;
      this.totalBatches = 1;
      this.completedItems = [];
      this.concurrentProcessing = 0;

      this.processingState = 'processing';
      this.isProcessing = true;
      this.isPaused = false;

      this.updateProcessedItemsList();
      this.updateStatistics();
      this.updateProcessingControls();
      this.updateBatchInfo();

      const kindText = this.generationType === 'text-to-video' ? 'prompt(s)' : 'image(s)';
      this.log(`Starting processing of ${items.length} ${kindText}`, 'info', { activity: true });

      this.updateMaxConcurrencyFromUI();
      this.fillConcurrencySlots();
    } catch (error) {
      this.showError('Failed to start processing: ' + (error.message || String(error)));
    }
  }

  stopProcessing() {
    if (!this.isProcessing && this.processingState !== 'processing') {
      return;
    }

    // Mark that user explicitly requested a hard stop
    this.userStopRequested = true;
    this.processingState = 'idle';
    this.isProcessing = false;
    this.isPaused = false;
    this.concurrentProcessing = 0;
    this.updateProcessingControls();
    this.updateProcessedItemsList();
    this.updateStatistics();
    this.validateForm();
    this.log('Processing stopped by user', 'info', { activity: true });
  }

  async scanInputFolder(folderPath) {
    try {
      if (!folderPath) {
        return;
      }
      this.log(`Scanning input folder: ${folderPath}`, 'info', { activity: true });

      if (!window.electronAPI || !window.electronAPI.scanImageFiles) {
        this.showError('Image scan API is not available');
        this.imageFiles = [];
        return;
      }

      const result = await window.electronAPI.scanImageFiles(folderPath);
      if (!result || !result.success) {
        const message = result && result.error ? result.error : 'Unknown error';
        this.showError('Failed to scan input folder: ' + message);
        this.imageFiles = [];
      } else {
        this.imageFiles = Array.isArray(result.files) ? result.files : [];
        const count = this.imageFiles.length;
        const folderInfo = document.getElementById('folder-info');
        const imageCountLabel = document.getElementById('image-count');
        if (folderInfo) folderInfo.style.display = count > 0 ? 'block' : 'none';
        if (imageCountLabel) imageCountLabel.textContent = `${count} images found`;
        this.log(`Found ${count} image(s) in input folder`, 'info', { activity: true });
      }
    } catch (error) {
      this.imageFiles = [];
      this.showError('Failed to scan input folder: ' + (error.message || String(error)));
    }
  }

  async selectInputFolder() {
    try {
      if (!window.electronAPI || !window.electronAPI.selectFolder) {
        this.showError('Folder selection API is not available');
        return;
      }

      const result = await window.electronAPI.selectFolder();
      if (!result || result.canceled || !result.filePath) {
        return;
      }

      const inputFolderEl = document.getElementById('input-folder-path');
      if (inputFolderEl) {
        inputFolderEl.value = result.filePath;
      }

      await this.scanInputFolder(result.filePath);
      this.validateForm();
      this.autoSaveCurrentState();
    } catch (error) {
      this.showError('Failed to select input folder: ' + (error.message || String(error)));
    }
  }

  async selectOutputFolder() {
    try {
      if (!window.electronAPI || !window.electronAPI.selectFolder) {
        this.showError('Folder selection API is not available');
        return;
      }

      const result = await window.electronAPI.selectFolder();
      if (!result || result.canceled || !result.filePath) {
        return;
      }

      const outputFolderEl = document.getElementById('output-folder-path');
      if (outputFolderEl) {
        outputFolderEl.value = result.filePath;
      }

      this.validateForm();
      this.autoSaveCurrentState();
    } catch (error) {
      this.showError('Failed to select output folder: ' + (error.message || String(error)));
    }
  }

  async selectImages() {
    try {
      if (!window.electronAPI || !window.electronAPI.selectFiles) {
        this.showError('Image selection API is not available');
        return;
      }

      const result = await window.electronAPI.selectFiles({
        multiple: true,
        filters: [
          { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'] }
        ]
      });

      if (!result || result.canceled || !result.filePaths || result.filePaths.length === 0) {
        return;
      }

      this.selectedImages = result.filePaths;
      this.imageFiles = result.filePaths.slice();

      const folderInfo = document.getElementById('folder-info');
      const imageCountLabel = document.getElementById('image-count');
      if (folderInfo) folderInfo.style.display = 'block';
      if (imageCountLabel) imageCountLabel.textContent = `${this.imageFiles.length} images selected`;

      this.updateImagePreview();
      this.validateForm();
      this.log(`Selected ${this.imageFiles.length} image(s)`, 'info', { activity: true });
    } catch (error) {
      this.showError('Failed to select images: ' + (error.message || String(error)));
    }
  }

  updateImagePreview() {
    const folderInfo = document.getElementById('folder-info');
    const imageCountLabel = document.getElementById('image-count');
    if (!folderInfo || !imageCountLabel) return;

    const selectedCount = this.selectedImages ? this.selectedImages.length : 0;
    const fileCount = this.imageFiles ? this.imageFiles.length : 0;
    const count = selectedCount || fileCount;

    folderInfo.style.display = count > 0 ? 'block' : 'none';
    if (count === 0) {
      imageCountLabel.textContent = '0 images found';
    } else if (selectedCount) {
      imageCountLabel.textContent = `${selectedCount} images selected`;
    } else {
      imageCountLabel.textContent = `${fileCount} images found`;
    }
  }

  clearPrompts() {
    const promptsEl = document.getElementById('prompt-list');
    if (promptsEl) {
      promptsEl.value = '';
    }
    this.updatePromptCount();
    this.validateForm();
    this.log('Prompts cleared', 'info', { activity: true });
  }

  savePrompts() {
    try {
      // Force-save current UI state (including current prompts) to localStorage
      this.autoSaveCurrentState();
      this.showSuccess('Prompts saved');
      this.log('Prompts saved manually', 'success', { activity: true });
    } catch (error) {
      this.showError('Failed to save prompts: ' + (error.message || String(error)));
    }
  }

  async importPrompts() {
    try {
      if (!window.electronAPI || !window.electronAPI.selectFiles || !window.electronAPI.readFileBase64) {
        this.showError('Import prompts is not available in this environment');
        return;
      }

      const result = await window.electronAPI.selectFiles({
        multiple: false,
        filters: [
          { name: 'Text Files', extensions: ['txt'] }
        ]
      });

      if (!result || result.canceled || !result.filePaths || result.filePaths.length === 0) {
        return;
      }

      const filePath = result.filePaths[0];
      const fileResult = await window.electronAPI.readFileBase64(filePath);
      if (!fileResult || !fileResult.success || !fileResult.base64) {
        const message = fileResult && fileResult.error ? fileResult.error : 'Unknown error';
        this.showError('Failed to import prompts: ' + message);
        return;
      }

      const base64 = fileResult.base64;
      let text = '';
      try {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        const decoder = new TextDecoder('utf-8');
        text = decoder.decode(bytes);
      } catch (e) {
        try {
          text = atob(base64);
        } catch (e2) {
          this.showError('Failed to decode imported prompts: ' + (e2.message || String(e2)));
          return;
        }
      }

      const promptsEl = document.getElementById('prompt-list');
      if (!promptsEl) {
        this.showError('Prompt input is not available');
        return;
      }

      promptsEl.value = text;
      this.updatePromptCount();
      this.validateForm();
      this.autoSaveCurrentState();
      this.showSuccess('Prompts imported');
      this.log(`Prompts imported from file: ${filePath}`, 'success', { activity: true });
    } catch (error) {
      this.showError('Failed to import prompts: ' + (error.message || String(error)));
    }
  }

  removePromptFromTextarea(prompt) {
    const autoDeleteEl = document.getElementById('auto-delete-prompts');
    if (autoDeleteEl && !autoDeleteEl.checked) {
      return;
    }

    const promptsEl = document.getElementById('prompt-list');
    if (!promptsEl) {
      return;
    }

    const target = (prompt || '').trim();
    if (!target) {
      return;
    }

    const lines = (promptsEl.value || '').split('\n');
    let removed = false;
    const newLines = [];

    for (const line of lines) {
      if (!removed && line.trim() === target) {
        removed = true;
        continue;
      }
      newLines.push(line);
    }

    if (removed) {
      promptsEl.value = newLines.join('\n');
      this.updatePromptCount();
      this.autoSaveCurrentState();
    }
  }

  clearImages() {
    this.imageFiles = [];
    this.selectedImages = [];

    const inputFolderEl = document.getElementById('input-folder-path');
    if (inputFolderEl) {
      inputFolderEl.value = '';
    }

    const folderInfo = document.getElementById('folder-info');
    const imageCountLabel = document.getElementById('image-count');
    if (folderInfo) folderInfo.style.display = 'none';
    if (imageCountLabel) imageCountLabel.textContent = '0 images found';

    this.validateForm();
    this.log('Image input cleared', 'info', { activity: true });
  }

  fillConcurrencySlots() {
    if (!this.isProcessing || this.processingState !== 'processing' || this.isPaused) {
      return;
    }

    const max = this.maxConcurrency || 1;
    while (this.concurrentProcessing < max) {
      const nextItem = this.processQueue.find(item => item.status === 'pending');
      if (!nextItem) break;

      this.concurrentProcessing++;
      this.processItem(nextItem);
    }
  }

  updateBatchInfo() {
    const infoEl = document.getElementById('batch-info');
    if (!infoEl) return;

    const currentBatchNumber = (this.currentBatchIndex || 0) + 1;
    const totalBatches = this.totalBatches || 1;
    const itemCount = this.currentBatchItems ? this.currentBatchItems.length : 0;

    infoEl.textContent = `Batch ${currentBatchNumber} of ${totalBatches} • ${itemCount} item(s)`;
  }

  manageItemQueues(item, oldStatus, newStatus) {
    if (!item || !item.id) return;

    const allIndex = this.allItems.findIndex(i => i.id === item.id);
    if (allIndex === -1) {
      this.allItems.push(item);
    } else {
      this.allItems[allIndex] = item;
    }

    const queueIndex = this.processQueue.findIndex(i => i.id === item.id);
    const completedIndex = this.completedItems.findIndex(i => i.id === item.id);

    // Treat skipped as a final status similar to failed/timeout
    if (newStatus === 'completed' || newStatus === 'failed' || newStatus === 'timeout' || newStatus === 'skipped') {
      if (queueIndex !== -1) {
        this.processQueue.splice(queueIndex, 1);
      }
      if (completedIndex === -1) {
        this.completedItems.push(item);
      } else {
        this.completedItems[completedIndex] = item;
      }
    } else {
      if (completedIndex !== -1) {
        this.completedItems.splice(completedIndex, 1);
      }
      if (queueIndex === -1) {
        this.processQueue.push(item);
      } else {
        this.processQueue[queueIndex] = item;
      }
    }

    const batchIndex = this.currentBatchItems.findIndex(i => i.id === item.id);
    if (batchIndex === -1) {
      this.currentBatchItems.push(item);
    } else {
      this.currentBatchItems[batchIndex] = item;
    }
  }

  logStatusChange(item, oldStatus, newStatus) {
    if (!item || oldStatus === newStatus) return;
    const name = item.prompt || item.imagePath || item.id || 'item';
    const level = newStatus === 'failed' || newStatus === 'timeout' || newStatus === 'skipped' ? 'error' : 'info';
    this.log(`Status changed: ${name} (${oldStatus} -> ${newStatus})`, level, { activity: true });
  }

  async processItem(item) {
    // If user has requested a hard stop, do not start or continue this item
    if (this.userStopRequested || !this.isProcessing || this.processingState === 'idle') {
      return;
    }
    try {
      // Update status to processing
      item.status = 'processing';

      item.progress = 5;

      item.startTime = new Date();
      this.updateProcessedItemsList();
      this.updateStatistics();

      const startedAtText = item.startTime
        ? new Date(item.startTime).toLocaleTimeString()
        : new Date().toLocaleTimeString();
      this.log(`Start ${item.type}: ${item.prompt || item.imagePath} at ${startedAtText}`, 'info', { activity: true });

      let result;
      const aspectRatio = document.getElementById('aspect-ratio').value || 'LANDSCAPE 16:9';
      const modelSelectEl = document.getElementById('model-select');
      const modelVariant = modelSelectEl && modelSelectEl.value
        ? modelSelectEl.value
        : 'veo-3-fast';

      if (item.type === 'text-to-video' && this.getGeminiApiKey()) {
        this.analyzePromptWithGemini(item.prompt, 'text-to-video');
      }

      if (item.type === 'text-to-video') {
        result = await this.videoAPI.generateTextToVideo(
          item.prompt,
          aspectRatio,
          null,
          modelVariant
        );
      } else {
        // Image-to-Video: ensure we have a descriptive prompt for both
        // the API request and the Processing Status display.
        if (!item.prompt) {
          try {
            const analysis = await this.analyzeImageWithGemini(item.imagePath);
            if (analysis && typeof analysis === 'string') {
              item.prompt = analysis.trim();
            }
          } catch (e) {
            // analyzeImageWithGemini already logs detailed errors
          }

          // Fallback prompt if Gemini is not configured or returns nothing
          if (!item.prompt) {
            item.prompt = 'Best camera movement based on picture';
          }

          // Update UI so Processing Status immediately shows the prompt
          this.updateProcessedItemsList();
        }

        if (!item.mediaId) {
          const uploadResult = await this.videoAPI.uploadUserImage(
            item.imagePath,
            aspectRatio
          );

          if (!uploadResult.success || !uploadResult.mediaId) {
            throw new Error(uploadResult.error || 'Image upload failed');
          }

          item.mediaId = uploadResult.mediaId;
        }
        result = await this.videoAPI.generateImageToVideo(
          item.mediaId,
          item.prompt,
          aspectRatio,
          null,
          modelVariant
        );
      }

      if (result.success) {
        if (typeof result.remainingCredits === 'number') {
          this.remainingCredits = result.remainingCredits;
          this.updateCreditsDisplay();
        }
        item.operationName = result.operationName;
        item.sceneId = result.sceneId;
        item.status = 'generating';
        item.progress = 25;
        this.updateProcessedItemsList();
        this.updateStatistics();

        await this.pollForCompletion(item);
      } else {
        throw new Error(result.error || 'Generation failed');
      }

    } catch (error) {
      // Implement retry logic based on JSON workflow
      await this.handleProcessingError(item, error);
    } finally {
      this.concurrentProcessing--;
      item.endTime = new Date();
      this.updateProcessedItemsList();
      if (this.processingState === 'processing' && this.isProcessing && !this.isPaused) {
        this.fillConcurrencySlots();
      }
    }
  }

  async handleProcessingError(item, error) {
    const errorMessage = error.message || error.toString();
    
    // If user requested a global stop, do not perform any retries
    if (this.userStopRequested || !this.isProcessing || this.processingState === 'idle') {
      this.log(`Processing was stopped; aborting retries for ${item.prompt || item.imagePath}`, 'info', { activity: true });
      return;
    }

    // If user has skipped this item, stop any further retries
    if (item.status === 'skipped') {
      this.log(`Stopping retries for skipped item: ${item.prompt || item.imagePath}`, 'info', { activity: true });
      return;
    }

    // Initialize retry count if not exists (used only for logging/visibility)
    if (!item.retryCount) {
      item.retryCount = 0;
    }
    item.retryCount++;

    // Try to extract HTTP status code from the error (if present)
    let statusCode = typeof error.status === 'number' ? error.status : null;
    if (!statusCode) {
      const match = errorMessage.match(/status:\s*(\d{3})/);
      if (match) {
        statusCode = parseInt(match[1], 10);
      }
    }

    // Check if it's a 429 rate limit error (like in JSON workflow)
    if (errorMessage.includes('429') || statusCode === 429) {
      this.log(`Rate limit detected for ${item.prompt || item.imagePath} (attempt ${item.retryCount}), waiting 10 seconds...`, 'warning', { activity: true });

      // Wait 10 seconds for rate limit (like "Antri boss lagi Overload" in workflow)
      await new Promise(resolve => setTimeout(resolve, 10000));

      // Before retrying, stop if user has requested a global stop
      if (this.userStopRequested || !this.isProcessing || this.processingState === 'idle') {
        this.log(`Stop requested during rate-limit wait, aborting retries for ${item.prompt || item.imagePath}`, 'info', { activity: true });
        return;
      }

      // Before retrying, stop if user has skipped the item
      if (item.status === 'skipped') {
        this.log(`Skip requested during rate-limit wait, stopping retries for ${item.prompt || item.imagePath}`, 'info', { activity: true });
        return;
      }

      // Retry the same item indefinitely until success or skipped
      this.log(`Retrying after rate limit: ${item.prompt || item.imagePath} (attempt ${item.retryCount})`, 'info', { activity: true });

      return await this.processItem(item);

    } else if (
      errorMessage.includes('Authorization') ||
      errorMessage.includes('401') ||
      errorMessage.includes('403') ||
      statusCode === 401 ||
      statusCode === 403
    ) {
      // Authorization/permission error - stop processing and notify user
      this.processingState = 'idle';
      this.isProcessing = false;
      this.isPaused = false;
      this.concurrentProcessing = 0;
      this.updateProcessingControls();

      // Show notification to user
      this.showError('Bearer token is invalid or expired. Please update your bearer token in settings and try again.');
      this.log(`Processing stopped due to authentication error: ${errorMessage}`, 'error', { activity: true });

      // Mark current item as failed due to auth issue
      item.status = 'failed';
      item.error = 'Invalid/Expired Bearer Token';
      this.moveItemToCompleted(item);

      // Stop all processing
      return;

    } else {
      // All other errors (network, 5xx, 4xx non-auth, etc.) => keep retrying indefinitely
      this.log(`Request failed for ${item.prompt || item.imagePath} (attempt ${item.retryCount}), retrying in 5 seconds... Error: ${errorMessage}`, 'warning', { activity: true });

      // Wait 5 seconds before retrying
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Before retrying, stop if user has requested a global stop
      if (this.userStopRequested || !this.isProcessing || this.processingState === 'idle') {
        this.log(`Stop requested during retry wait, aborting retries for ${item.prompt || item.imagePath}`, 'info', { activity: true });
        return;
      }

      // Before retrying, stop if user has skipped the item
      if (item.status === 'skipped') {
        this.log(`Skip requested during retry wait, stopping retries for ${item.prompt || item.imagePath}`, 'info', { activity: true });
        return;
      }

      // Retry the same item indefinitely until success or skipped
      this.log(`Retrying: ${item.prompt || item.imagePath} (attempt ${item.retryCount})`, 'info', { activity: true });

      return await this.processItem(item);
    }
  }

  async pollForCompletion(item, maxAttempts = 60, interval = 10000) {
    let attempts = 0;

    while (this.processingState === 'processing' || this.processingState === 'paused') {
      try {
        // Advance per-item progress slowly while we are polling.
        // Start from 25% (after initial request sent) and grow with attempts,
        // but never reach 100% until we actually finish.
        const baseProgress = 25;
        const maxDuringPolling = 90;
        const pollingProgress = Math.min(
          maxDuringPolling,
          baseProgress + attempts * 2
        );
        item.progress = pollingProgress;
        this.updateProcessedItemsList();

        // Check status (like "Cek Proses" in workflow)
        const statusResult = await this.videoAPI.checkProcessingStatus(item.operationName, item.sceneId);

        if (statusResult.success) {
          const status = statusResult.status;

          if (status === 'MEDIA_GENERATION_STATUS_COMPLETED' && statusResult.videoUrl) {
            // Success - download video (like "Get Video" in workflow)
            item.status = 'downloading';
            item.progress = 95;
            this.updateProcessedItemsList();

            // Determine output folder from UI
            const outputFolderEl = document.getElementById('output-folder-path');
            const outputFolder = outputFolderEl ? outputFolderEl.value.trim() : '';

            if (!outputFolder) {
              // Without an output folder we can't save the file; mark as failed
              const msg = 'No output folder configured; cannot download video';
              this.log(msg, 'error', { activity: true });
              item.status = 'failed';
              item.error = msg;
              this.moveItemToCompleted(item);
              return;
            }

            // Generate filename and full path using Electron's path helper when available
            const filename = this.generateFilename(item);
            let outputPath = '';
            try {
              if (window.electronAPI && window.electronAPI.path && window.electronAPI.path.join) {
                outputPath = await window.electronAPI.path.join(outputFolder, filename);
              } else {
                // Fallback join
                outputPath = `${outputFolder.replace(/[\\/]+$/, '')}/${filename}`;
              }
            } catch (pathError) {
              const msg = `Failed to build output path: ${pathError.message || pathError}`;
              this.log(msg, 'error', { activity: true });
              item.status = 'failed';
              item.error = msg;
              this.moveItemToCompleted(item);
              return;
            }

            const downloadResult = await this.videoAPI.downloadVideo(statusResult.videoUrl, outputPath);

            if (downloadResult.success) {
              item.status = 'completed';
              item.progress = 100;
              // Store local file path and original URL
              item.filePath = downloadResult.filePath || outputPath;
              item.videoUrl = statusResult.videoUrl;
              item.filename = filename;
              this.moveItemToCompleted(item);

              let durationSeconds = null;
              if (item.startTime) {
                const startedAtMs = item.startTime instanceof Date
                  ? item.startTime.getTime()
                  : Number(item.startTime);
                if (!Number.isNaN(startedAtMs)) {
                  durationSeconds = Math.round((Date.now() - startedAtMs) / 1000);
                }
              }
              const durationText = durationSeconds !== null ? ` in ${durationSeconds}s` : '';
              this.log(`Completed ${item.type}: ${item.prompt || item.imagePath}${durationText}`, 'success', { activity: true });
              return;
            } else {
              // Limit download retries so we don't poll forever at 95%
              const maxDownloadRetries = 5;
              item.downloadRetryCount = (item.downloadRetryCount || 0) + 1;
              const errMsg = downloadResult.error || 'Download failed';

              this.log(
                `Download failed for ${item.prompt || item.imagePath} (attempt ${item.downloadRetryCount}): ${errMsg}`,
                'warning',
                { activity: true }
              );

              if (item.downloadRetryCount >= maxDownloadRetries) {
                item.status = 'failed';
                item.error = `Download failed after ${maxDownloadRetries} attempts: ${errMsg}`;
                this.moveItemToCompleted(item);
                return;
              }
              // Otherwise, fall through; the outer while loop will wait 'interval' and poll again
            }
          } else if (status === 'MEDIA_GENERATION_STATUS_FAILED') {
            // Failed status - restart the entire process like n8n (never give up)
            this.log(`Generation failed on server for ${item.prompt || item.imagePath}, restarting from beginning...`, 'warning', { activity: true });

            // Reset item status
            item.status = 'queued';
            item.operationName = null;
            item.sceneId = null;

            // Wait a bit before restarting
            await new Promise(resolve => setTimeout(resolve, 5000));

            // Restart the entire process
            return await this.processItem(item);
          } else {
            // Still processing - wait and check again (like "Tunggu Lagi Generate Video")
            this.log(`Still generating: ${item.prompt || item.imagePath} (polling attempt ${attempts + 1})`, 'info', { activity: true });
          }
        } else {
          throw new Error(statusResult.error || 'Status check failed');
        }
      } catch (error) {
        // Handle polling errors with retry logic
        if (error.message.includes('429')) {
          this.log(`Rate limit during polling, waiting 10 seconds...`, 'warning', { activity: true });

          await new Promise(resolve => setTimeout(resolve, 10000));
          continue; // Don't increment attempts for rate limits
        } else if (error.message.includes('401') || error.message.includes('403') || error.message.includes('Authorization')) {
          // Auth errors (401/403) during polling - stop processing and notify user
          this.processingState = 'idle';
          this.isProcessing = false;
          this.isPaused = false;
          this.concurrentProcessing = 0;
          this.updateProcessingControls();

          this.showError('Bearer token is invalid or expired during polling. Please update your bearer token in settings and try again.');
          this.log(`Polling stopped due to authentication error: ${error.message}`, 'error', { activity: true });

          // Mark current item as failed due to auth issue
          item.status = 'failed';
          item.error = 'Invalid/Expired Bearer Token';
          this.moveItemToCompleted(item);
          return;
        } else {
          this.log(`Polling error: ${error.message}, continuing to poll...`, 'warning', { activity: true });

          // Continue polling even on other errors - never give up like n8n
        }
      }

      attempts++;
      await new Promise(resolve => setTimeout(resolve, interval));
    }

    // Only exit if processing was stopped by user, never timeout
    this.log(`Polling stopped for: ${item.prompt || item.imagePath} (user stopped processing)`, 'info', { activity: true });
  }

  generateFilename(item) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const type = item.type === 'text-to-video' ? 'txt' : 'img';
    const extension = '.mp4';

    let slug = '';
    if (item && item.prompt && typeof item.prompt === 'string') {
      slug = item.prompt.toLowerCase();
      slug = slug.replace(/[^a-z0-9\s-]/g, ' ');
      slug = slug.trim().replace(/\s+/g, '-').replace(/-+/g, '-');
      slug = slug.slice(0, 60);
    } else if (item && item.imagePath && typeof item.imagePath === 'string') {
      const baseName = item.imagePath.split(/[/\\]/).pop() || '';
      slug = baseName.toLowerCase().replace(/\.[^.]+$/, '');
      slug = slug.replace(/[^a-z0-9\s-]/g, ' ');
      slug = slug.trim().replace(/\s+/g, '-').replace(/-+/g, '-');
      slug = slug.slice(0, 60);
    }

    if (slug) {
      return `${type}_${timestamp}_${slug}_${item.id}${extension}`;
    }

    return `${type}_${timestamp}_${item.id}${extension}`;
  }

  // Add new method to properly move items between queues
  moveItemToCompleted(item) {
    // Remove from processQueue if it exists there
    const queueIndex = this.processQueue.findIndex(queueItem => queueItem.id === item.id);
    if (queueIndex !== -1) {
      this.processQueue.splice(queueIndex, 1);
    }
    
    // Update item status in currentBatchItems
    const batchIndex = this.currentBatchItems.findIndex(batchItem => batchItem.id === item.id);
    if (batchIndex !== -1) {
      this.currentBatchItems[batchIndex] = item;
    }
    
    // Update item status in allItems
    const allItemsIndex = this.allItems.findIndex(allItem => allItem.id === item.id);
    if (allItemsIndex !== -1) {
      this.allItems[allItemsIndex] = item;
    }
    
    // Add to completedItems if not already there
    const completedIndex = this.completedItems.findIndex(completedItem => completedItem.id === item.id);
    if (completedIndex === -1) {
      this.completedItems.push(item);
    }
    
    // Refresh UI statistics and lists after moving item
    this.updateProcessedItemsList();
    this.updateStatistics();
    
    // Log status changes
    this.logStatusChange(item, 'processing', 'completed');

    if (item.type === 'text-to-video') {
      this.removePromptFromTextarea(item.prompt);
    }

    // When there are no more items pending or running, mark processing as idle
    if (this.processQueue.length === 0 && this.concurrentProcessing === 0) {
      this.processingState = 'idle';
      this.isProcessing = false;
      this.isPaused = false;
      this.updateProcessingControls();
      this.validateForm();
    }
  }

  async skipAllActive() {
    try {
      const activeStatuses = new Set(['pending', 'processing', 'generating', 'downloading']);

      const candidates = [
        ...(this.processQueue || []),
        ...(this.currentBatchItems || [])
      ];

      const itemsToSkip = [];
      const seenIds = new Set();

      for (const item of candidates) {
        if (!item || !item.id) continue;
        if (!activeStatuses.has(item.status)) continue;
        if (seenIds.has(item.id)) continue;
        seenIds.add(item.id);
        itemsToSkip.push(item);
      }

      if (itemsToSkip.length === 0) {
        this.showInfo('No active items to skip');
        return;
      }

      for (const item of itemsToSkip) {
        await this.skipItem(item.id);
      }

      this.processingState = 'idle';
      this.isProcessing = false;
      this.isPaused = false;
      this.concurrentProcessing = 0;
      this.updateProcessingControls();

      this.updateProcessedItemsList();
      this.updateStatistics();

      this.log(`Skip All applied to ${itemsToSkip.length} item(s)`, 'warning', { activity: true });
    } catch (error) {
      this.showError('Failed to skip all items: ' + (error.message || String(error)));
    }
  }

  clearCompletedItems() {
    if (!this.currentBatchItems) {
      this.currentBatchItems = [];
    }
    if (!this.completedItems) {
      this.completedItems = [];
    }
    if (!this.allItems) {
      this.allItems = [];
    }

    const isFinished = (item) =>
      item.status === 'completed' || item.status === 'failed' || item.status === 'timeout' || item.status === 'skipped';

    this.currentBatchItems = this.currentBatchItems.filter(item => !isFinished(item));
    this.completedItems = this.completedItems.filter(item => !isFinished(item));
    this.allItems = this.allItems.filter(item => !isFinished(item));

    this.updateProcessedItemsList();
    this.updateStatistics();
  }

  exportResults() {
    const finishedItems = (this.completedItems || []).slice();

    if (!finishedItems.length) {
      this.showInfo('No results to export');
      return;
    }

    const headers = [
      'id',
      'type',
      'status',
      'prompt',
      'imagePath',
      'filePath',
      'videoUrl',
      'filename',
      'error',
      'startTime',
      'endTime',
      'durationSeconds'
    ];

    const escapeCsv = (value) => {
      if (value === null || value === undefined) return '';
      const str = String(value).replace(/"/g, '""');
      if (/[",\n]/.test(str)) {
        return `"${str}"`;
      }
      return str;
    };

    const rows = finishedItems.map(item => {
      const startIso = item.startTime
        ? new Date(item.startTime).toISOString()
        : '';
      const endIso = item.endTime
        ? new Date(item.endTime).toISOString()
        : '';

      let durationSeconds = '';
      if (item.startTime && item.endTime) {
        const startedAtMs = item.startTime instanceof Date
          ? item.startTime.getTime()
          : Number(item.startTime);
        if (!Number.isNaN(startedAtMs)) {
          durationSeconds = Math.round((item.endTime - startedAtMs) / 1000);
        }
      }

      const row = [
        item.id || '',
        item.type || '',
        item.status || '',
        item.prompt || '',
        item.imagePath || '',
        item.filePath || '',
        item.videoUrl || '',
        item.filename || '',
        item.error || '',
        startIso,
        endIso,
        durationSeconds
      ];

      return row.map(escapeCsv).join(',');
    });

    const csvContent = [headers.join(','), ...rows].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    a.href = url;
    a.download = `autoflow-results-${timestamp}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    this.showSuccess('Results exported successfully');
  }

  updateProcessedItemsList() {
    const container = document.getElementById('processed-items');
    if (!container) return;

    const batchItems = this.currentBatchItems || [];

    // Only show active items so completed ones don't keep growing the list
    const displayItems = batchItems.filter(item =>
      item.status === 'processing' ||
      item.status === 'generating' ||
      item.status === 'downloading'
    );

    if (displayItems.length === 0) {
      container.innerHTML = '<div class="no-items">No active items</div>';
      this.updateBatchInfo();
      return;
    }

    // Sort active items by status and start time (newest first)
    displayItems.sort((a, b) => {
      const statusPriority = {
        processing: 1,
        generating: 1,
        downloading: 1
      };

      const aPriority = statusPriority[a.status] || 2;
      const bPriority = statusPriority[b.status] || 2;

      if (aPriority !== bPriority) {
        return aPriority - bPriority;
      }

      const aTime = a.startTime ? new Date(a.startTime).getTime() : 0;
      const bTime = b.startTime ? new Date(b.startTime).getTime() : 0;
      return bTime - aTime;
    });

    const maxToShow = this.maxConcurrency && this.maxConcurrency > 0
      ? this.maxConcurrency
      : 20;

    const limitedItems = displayItems.slice(0, maxToShow);

    container.innerHTML = limitedItems.map(item => this.renderProcessedItem(item)).join('');

    // Update batch info
    this.updateBatchInfo();
  }

  // Enhanced processed items list with thumbnails and better formatting
  renderProcessedItem(item) {
    const duration = item.endTime && item.startTime
      ? Math.round((item.endTime - item.startTime) / 1000)
      : null;
    const statusClass = this.getStatusClass(item.status);
    const statusText = this.getStatusText(item.status);
    const typeLabel = this.getTypeLabel(item.type);
    const displayName = this.getItemDisplayName(item);
    const timeString = item.startTime ? new Date(item.startTime).toLocaleTimeString() : '';

    // Thumbnail HTML
    const thumbnailHTML = this.getThumbnailHTML(item);

    // Progress bar HTML
    let progressHTML = '';
    if (item.progress && (item.status === 'generating' || item.status === 'processing' || item.status === 'downloading')) {
      const clampedProgress = Math.min(100, Math.max(0, item.progress));
      progressHTML = `
        <div class="item-progress">
          <div class="progress-bar">
            <div class="progress-fill" style="width: ${clampedProgress}%"></div>
          </div>
          <div class="item-progress-text">${clampedProgress}%</div>
        </div>
      `;
    }

    // Action buttons
    let actionsHTML = '';

    // Skip button for active items so user can stop infinite retries
    if (item.status === 'processing' || item.status === 'generating' || item.status === 'downloading') {
      actionsHTML += `<button class="btn btn-sm btn-secondary" onclick="app.skipItem('${item.id}')">Skip</button>`;
    }

    // Keep Open button for completed items
    if (item.status === 'completed' && item.filePath) {
      const escapedPath = item.filePath.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      actionsHTML += `${actionsHTML ? ' ' : ''}<button class="btn btn-sm btn-open" onclick="app.openFile('${escapedPath}')">Open</button>`;
    }

    return `
      <div class="feed-item ${statusClass}" data-item-id="${item.id}">
        ${thumbnailHTML}
        <div class="item-info">
          <div class="item-header">
            <div class="item-name" title="${item.prompt || item.imagePath || displayName}">${displayName}</div>
            ${actionsHTML ? `<div class="item-actions">${actionsHTML}</div>` : ''}
          </div>
          <div class="item-details">
            <span class="item-type ${item.type}">${typeLabel}</span>
            <span class="item-status ${item.status}">${statusText}</span>
            ${duration ? `<span class="item-duration">${this.formatDuration(duration)}</span>` : ''}
            ${timeString ? `<span class="item-time">${timeString}</span>` : ''}
          </div>
          ${progressHTML}
          ${item.error ? `<div class="item-error">${item.error}</div>` : ''}
        </div>
        <div class="item-status-indicator"></div>
      </div>
    `;
  }

  // Generate thumbnail HTML based on item status and type
  getThumbnailHTML(item) {
    if (item.status === 'completed' && item.filePath) {
      // Show actual video thumbnail for completed items
      // Use a canvas-based approach or generate a proper thumbnail
      return `
        <div class="item-thumbnail">
          <video 
            src="file://${item.filePath}" 
            muted 
            preload="metadata" 
            onloadedmetadata="this.currentTime = 1"
            oncanplay="this.style.opacity = '1'"
            style="opacity: 0; transition: opacity 0.3s ease;">
            Your browser does not support the video tag.
          </video>
          <div class="video-overlay">
            <span class="play-icon">▶</span>
          </div>
        </div>
      `;
    } else if (item.type === 'image-to-video' && item.imagePath) {
      // Show source image for image-to-video items
      return `
        <div class="item-thumbnail">
          <img src="file://${item.imagePath}" alt="Source image" />
        </div>
      `;
    } else {
      // Show placeholder for queued/processing items
      return `
        <div class="item-thumbnail">
          <div class="placeholder-icon"></div>
        </div>
      `;
    }
  }

  // Format duration to show minutes and seconds
  formatDuration(seconds) {
    if (!seconds || seconds < 0) return '';
    
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    
    if (minutes > 0) {
      return `${minutes}m ${remainingSeconds}s`;
    } else {
      return `${remainingSeconds}s`;
    }
  }

  // Get type label for display
  getTypeLabel(type) {
    const typeMap = {
      'text-to-video': 'Text-to-Video',
      'image-to-video': 'Image-to-Video'
    };
    return typeMap[type] || 'Unknown';
  }

  // Updated status text mapping
  getStatusText(status) {
    const statusMap = {
      'pending': 'Processing',  // Changed from 'Queued' to 'Processing'
      'processing': 'Processing',
      'generating': 'Processing',
      'downloading': 'Processing',
      'completed': 'Completed',
      'failed': 'Failed',
      'timeout': 'Failed',
      'skipped': 'Skipped'
    };
    return statusMap[status] || status;
  }

  // Keep the original prompt text for display name
  getItemDisplayName(item) {
    // Always return the original prompt text, never replace with filename
    if (item.prompt) {
      return item.prompt;
    }
    if (item.imagePath) {
      return `Image: ${item.imagePath.split(/[/\\]/).pop()}`;
    }
    return item.id || 'Unknown Item';
  }

  // Enhanced status management with proper status text
  updateItemStatus(item, status, progress = null, error = null) {
    const oldStatus = item.status;
    item.status = status;
    
    if (progress !== null) {
      item.progress = Math.min(100, Math.max(0, progress));
    }
    
    if (error) {
      item.error = error;
    }
    
    // Set timestamps
    if (status === 'processing' && oldStatus === 'pending') {
      item.startTime = Date.now();
    } else if (status === 'completed' || status === 'failed' || status === 'timeout' || status === 'skipped') {
      item.endTime = new Date();
    }
    
    // Move items between queues as needed
    this.manageItemQueues(item, oldStatus, status);
    
    // Update UI
    this.updateProcessedItemsList();
    this.updateStatistics();
    
    // Log status changes
    this.logStatusChange(item, oldStatus, status);
  }

  // Enhanced status class mapping
  getStatusClass(status) {
    const statusMap = {
      'pending': 'pending',
      'processing': 'processing',
      'generating': 'processing',
      'downloading': 'processing',
      'completed': 'success',
      'failed': 'error',
      'timeout': 'error',
      'skipped': 'error'
    };
    return statusMap[status] || 'pending';
  }

  updateStatistics() {
    const totalElement = document.getElementById('total-count');
    const processingElement = document.getElementById('processing-count');
    const completedElement = document.getElementById('completed-count');
    const failedElement = document.getElementById('failed-count');
    const queuedElement = document.getElementById('queued-count');

    if (!this.processQueue) this.processQueue = [];
    if (!this.completedItems) this.completedItems = [];

    // Calculate statistics properly
    const queuedItems = this.processQueue.filter(item => 
      item.status === 'pending' || item.status === 'queued'
    );
    const processingItems = this.processQueue.filter(item => 
      item.status === 'processing' || item.status === 'generating' || item.status === 'downloading'
    );
    const completedItems = this.completedItems.filter(item => item.status === 'completed');
    const failedItems = this.completedItems.filter(item => 
      item.status === 'failed' || item.status === 'timeout' || item.status === 'skipped'
    );

    const total = this.processQueue.length + this.completedItems.length;
    const rawProcessing = processingItems.length;
    const completed = completedItems.length;
    const failed = failedItems.length;
    const queued = queuedItems.length;

    const maxConcurrency = this.maxConcurrency && this.maxConcurrency > 0
      ? this.maxConcurrency
      : rawProcessing;

    const processing = Math.min(rawProcessing, maxConcurrency);

    // Update UI elements with animation
    this.animateStatUpdate(totalElement, total);
    this.animateStatUpdate(processingElement, processing);
    this.animateStatUpdate(completedElement, completed);
    this.animateStatUpdate(failedElement, failed);
    this.animateStatUpdate(queuedElement, queued);

    // Update the top Processing Status progress bar based on done items
    this.updateOverallProgress(total, completed, failed);

    // Update small processing status message when there are failed items
    this.updateProcessingStatusMessage(failed);
  }

  animateStatUpdate(element, newValue) {
    if (!element) return;
    
    const currentValue = parseInt(element.textContent) || 0;
    if (currentValue !== newValue) {
      element.textContent = newValue;
      element.style.transform = 'scale(1.1)';
      setTimeout(() => {
        element.style.transform = 'scale(1)';
      }, 200);
    }
  }

  // Update the main Processing Status progress bar (top card)
  // based on how many items are finished (completed + failed)
  // out of the total items in the current run.
  updateOverallProgress(total, completed, failed) {
    const bar = document.getElementById('progress-bar');
    const text = document.getElementById('progress-text');
    if (!bar || !text) return;

    if (!total || total <= 0) {
      bar.style.width = '0%';
      text.textContent = '0%';
      return;
    }

    const done = (completed || 0) + (failed || 0);
    const percent = Math.max(0, Math.min(100, Math.round((done / total) * 100)));

    bar.style.width = `${percent}%`;
    text.textContent = `${percent}%`;
  }

  updateProcessingStatusMessage(failed) {
    const messageEl = document.getElementById('processing-status-message');
    if (!messageEl) return;

    if (!failed || failed <= 0) {
      messageEl.textContent = '';
      messageEl.style.display = 'none';
      return;
    }

    const label = failed === 1 ? 'item has failed' : 'items have failed';
    messageEl.textContent = `${failed} ${label}. Check Logs or the list below for details.`;
    messageEl.style.display = '';
  }

  async loadSettings() {
    try {
      const result = await window.electronAPI.loadSettings();
      const settings = result && result.success ? (result.settings || {}) : {};
      this.settings = settings;
      this.applySettings();
    } catch (error) {
      console.error('Failed to load settings:', error);
      this.settings = {};
    }
  }

  applySettings() {
    const settings = this.settings || {};

    const bearerTokenEl = document.getElementById('bearer-token');
    const outputFolderEl = document.getElementById('output-folder-path');
    const modelSelectMain = document.getElementById('model-select');
    const concurrentMain = document.getElementById('concurrent-count');

    const settingsModelEl = document.getElementById('settings-model');
    const settingsConcurrentEl = document.getElementById('settings-concurrent');
    const geminiKeyEl = document.getElementById('settings-gemini-key');
    const autoSaveEl = document.getElementById('auto-save-settings');
    const enableLoggingEl = document.getElementById('enable-logging');

    if (settings.defaultBearerToken && bearerTokenEl) {
      bearerTokenEl.value = settings.defaultBearerToken;
    }

    if (settings.defaultOutputFolder && outputFolderEl) {
      outputFolderEl.value = settings.defaultOutputFolder;
    }

    const videoModel = settings.defaultVideoModel || 'veo-3-fast';
    if (modelSelectMain) modelSelectMain.value = videoModel;
    if (settingsModelEl) settingsModelEl.value = videoModel;

    let concurrencyValue = settings.defaultConcurrency || '2';
    let parsedConcurrency = parseInt(concurrencyValue, 10);
    if (Number.isNaN(parsedConcurrency) || parsedConcurrency < 1) {
      parsedConcurrency = 1;
    } else if (parsedConcurrency > 10) {
      parsedConcurrency = 10;
    }
    concurrencyValue = String(parsedConcurrency);
    if (concurrentMain) concurrentMain.value = concurrencyValue;
    if (settingsConcurrentEl) settingsConcurrentEl.value = concurrencyValue;
    this.maxConcurrency = parsedConcurrency;

    if (geminiKeyEl) {
      geminiKeyEl.value = settings.geminiApiKey || '';
    }

    if (autoSaveEl) {
      autoSaveEl.checked = settings.autoSave !== false;
    }

    if (enableLoggingEl) {
      enableLoggingEl.checked = settings.enableLogging !== false;
    }

    this.validateForm();
  }

  updateMaxConcurrencyFromUI() {
    const concurrentEl = document.getElementById('concurrent-count');
    if (!concurrentEl) {
      return;
    }

    let value = parseInt(concurrentEl.value, 10);
    if (Number.isNaN(value) || value <= 0) {
      value = 1;
    } else if (value > 10) {
      value = 10;
    }

    concurrentEl.value = String(value);
    this.maxConcurrency = value;
  }

  saveOverviewConfiguration() {
    const concurrentMain = document.getElementById('concurrent-count');
    const settingsConcurrentEl = document.getElementById('settings-concurrent');
    const modelSelectMain = document.getElementById('model-select');
    const settingsModelEl = document.getElementById('settings-model');

    if (concurrentMain) {
      let value = parseInt(concurrentMain.value, 10);
      if (Number.isNaN(value) || value < 1) {
        value = 1;
      } else if (value > 10) {
        value = 10;
      }
      const valueStr = String(value);
      concurrentMain.value = valueStr;
      if (settingsConcurrentEl) {
        settingsConcurrentEl.value = valueStr;
      }
      this.maxConcurrency = value;
    }

    if (modelSelectMain && settingsModelEl) {
      settingsModelEl.value = modelSelectMain.value;
    }

    this.saveSettings();
  }

  async saveSettings() {
    try {
      const bearerTokenEl = document.getElementById('bearer-token');
      const outputFolderEl = document.getElementById('output-folder-path');
      const settingsModelEl = document.getElementById('settings-model');
      const settingsConcurrentEl = document.getElementById('settings-concurrent');
      const geminiKeyEl = document.getElementById('settings-gemini-key');
      const autoSaveEl = document.getElementById('auto-save-settings');
      const enableLoggingEl = document.getElementById('enable-logging');

      const newSettings = {
        defaultBearerToken: bearerTokenEl ? bearerTokenEl.value.trim() : '',
        defaultOutputFolder: outputFolderEl ? outputFolderEl.value.trim() : '',
        defaultVideoModel: settingsModelEl && settingsModelEl.value
          ? settingsModelEl.value
          : 'veo-3-fast',
        defaultConcurrency: settingsConcurrentEl && settingsConcurrentEl.value
          ? settingsConcurrentEl.value
          : '2',
        geminiApiKey: geminiKeyEl ? geminiKeyEl.value.trim() : '',
        autoSave: autoSaveEl ? autoSaveEl.checked : true,
        enableLogging: enableLoggingEl ? enableLoggingEl.checked : true
      };

      const result = await window.electronAPI.saveSettings(newSettings);
      if (!result || !result.success) {
        const message = result && result.error ? result.error : 'Failed to save settings';
        this.showError(message);
        return;
      }

      this.settings = newSettings;
      this.applySettings();
      this.showSuccess('Settings saved');
    } catch (error) {
      this.showError('Failed to save settings: ' + (error.message || String(error)));
    }
  }

  loadAutoSavedState() {
    try {
      let savedState = null;
      try {
        const raw = localStorage.getItem('autoflow-state');
        if (raw) {
          savedState = JSON.parse(raw);
        }
      } catch (e) {
        console.error('Failed to parse auto-saved state:', e);
      }

      if (savedState) {
        const bearerTokenEl = document.getElementById('bearer-token');
        const outputFolderEl = document.getElementById('output-folder-path');
        const inputFolderEl = document.getElementById('input-folder-path');
        const modelSelectEl = document.getElementById('model-select');
        const concurrentEl = document.getElementById('concurrent-count');
        const promptsEl = document.getElementById('prompt-list');

        if (bearerTokenEl && typeof savedState.bearerToken === 'string') {
          bearerTokenEl.value = savedState.bearerToken;
        }
        if (outputFolderEl && typeof savedState.outputFolder === 'string') {
          outputFolderEl.value = savedState.outputFolder;
        }
        if (inputFolderEl && typeof savedState.inputFolder === 'string') {
          inputFolderEl.value = savedState.inputFolder;
        }
        if (modelSelectEl && typeof savedState.videoModel === 'string') {
          modelSelectEl.value = savedState.videoModel;
        }
        if (concurrentEl && typeof savedState.concurrentProcessing === 'string') {
          concurrentEl.value = savedState.concurrentProcessing;
        }
        if (promptsEl && typeof savedState.prompts === 'string') {
          promptsEl.value = savedState.prompts;
        }

        if (savedState.generationType) {
          this.switchGenerationType(savedState.generationType);
        }
      }

      let pageFromStorage = null;
      try {
        pageFromStorage = localStorage.getItem('autoflow-current-page');
      } catch (e) {
        pageFromStorage = null;
      }

      const targetPage = (savedState && savedState.currentPage) || pageFromStorage || 'overview';
      if (targetPage) {
        this.navigateToPage(targetPage);
      }
    } catch (error) {
      console.error('Failed to load auto-saved UI state:', error);
    }
  }

  startAutoSave() {
    setInterval(() => {
      if (!this.settings || this.settings.autoSave !== false) {
        this.autoSaveCurrentState();
      }
    }, 30000); // Auto-save every 30 seconds
  }

  autoSaveCurrentState() {
    // Add null checks to prevent errors and use correct element IDs
    const bearerTokenEl = document.getElementById('bearer-token');
    const outputFolderEl = document.getElementById('output-folder-path');
    const inputFolderEl = document.getElementById('input-folder-path');
    const videoModelEl = document.getElementById('model-select'); // Main page model selector
    const concurrentEl = document.getElementById('concurrent-count'); // Main page concurrent input
    const promptsEl = document.getElementById('prompt-list');
    
    const currentState = {
      bearerToken: bearerTokenEl ? bearerTokenEl.value : '',
      outputFolder: outputFolderEl ? outputFolderEl.value : '',
      inputFolder: inputFolderEl ? inputFolderEl.value : '',
      videoModel: videoModelEl ? videoModelEl.value : 'veo-3-fast',
      concurrentProcessing: concurrentEl ? concurrentEl.value : '2',
      prompts: promptsEl ? promptsEl.value : '',
      generationType: this.generationType,
      currentPage: this.currentPage
    };

    try {
      localStorage.setItem('autoflow-state', JSON.stringify(currentState));
    } catch (e) {
      console.error('Failed to auto-save state:', e);
    }
  }

  log(message, level = 'info', options) {
    const logEntry = {
      message,
      level,
      timestamp: new Date().toISOString()
    };
    
    this.logs.push(logEntry);
    
    // Keep only last 1000 logs for the runtime log list
    if (this.logs.length > 1000) {
      this.logs = this.logs.slice(-1000);
    }
    
    // Always log to console for debugging
    const consoleMessage = `[${new Date(logEntry.timestamp).toLocaleTimeString()}] ${level.toUpperCase()}: ${message}`;
    
    switch (level) {
      case 'error':
        console.error(consoleMessage);
        break;
      case 'warning':
        console.warn(consoleMessage);
        break;
      case 'success':
        console.log(`✅ ${consoleMessage}`);
        break;
      default:
        console.log(consoleMessage);
    }

    const opts = options || {};
    if (opts.activity) {
      this.addActivityLog(logEntry);
      this.updateInlineLogs();
    }

    // Update logs page if currently visible
    if (this.currentPage === 'logs') {
      this.loadLogs();
    }
  }

  addActivityLog(logEntry) {
    if (!this.activityLogs) {
      this.activityLogs = [];
    }

    this.activityLogs.push(logEntry);

    // Batasi jumlah log aktivitas agar tidak menumpuk terlalu banyak di memori
    if (this.activityLogs.length > 200) {
      this.activityLogs = this.activityLogs.slice(-200);
    }
  }

  updateInlineLogs() {
    const container = document.getElementById('inline-log-container');
    if (!container) return;

    const source = this.activityLogs || [];

    if (!source.length) {
      container.innerHTML = '<div class="inline-log-empty">No recent activity</div>';
      return;
    }

    const recent = source.slice(-20);
    const html = recent.map(log => {
      const time = new Date(log.timestamp).toLocaleTimeString();
      const safeMessage = (log.message || '').toString().replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return `<div class="inline-log-entry ${log.level}"><span class="inline-log-timestamp">[${time}]</span>${safeMessage}</div>`;
    }).join('');

    container.innerHTML = html;
    container.scrollTop = container.scrollHeight;
  }

  loadLogs() {
    const logViewer = document.getElementById('log-viewer');
    if (!logViewer) return;
    
    if (this.logs.length === 0) {
      logViewer.innerHTML = '<div class="no-logs">No logs available</div>';
      return;
    }

    const logContent = this.logs.map(log => {
      const time = new Date(log.timestamp).toLocaleTimeString();
      return `<div class="log-entry ${log.level}">[${time}] ${log.level.toUpperCase()}: ${log.message}</div>`;
    }).join('');

    logViewer.innerHTML = logContent;
    
    // Auto-scroll to bottom
    logViewer.scrollTop = logViewer.scrollHeight;
  }

  clearLogs() {
    this.logs = [];
    this.loadLogs();
    this.showSuccess('Logs cleared');
  }

  copyLogs() {
    if (this.logs.length === 0) {
      this.showInfo('No logs to copy');
      return;
    }

    const logText = this.logs.map(log => {
      const time = new Date(log.timestamp).toLocaleTimeString();
      return `[${time}] ${log.level.toUpperCase()}: ${log.message}`;
    }).join('\n');

    // Use the Clipboard API to copy logs
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(logText).then(() => {
        this.showSuccess('Logs copied to clipboard');
      }).catch(err => {
        console.error('Failed to copy logs to clipboard:', err);
        this.fallbackCopyLogs(logText);
      });
    } else {
      this.fallbackCopyLogs(logText);
    }
  }

  fallbackCopyLogs(logText) {
    // Fallback method for older browsers
    const textArea = document.createElement('textarea');
    textArea.value = logText;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    textArea.style.top = '-999999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    
    try {
      const successful = document.execCommand('copy');
      if (successful) {
        this.showSuccess('Logs copied to clipboard');
      } else {
        this.showError('Failed to copy logs to clipboard');
      }
    } catch (err) {
      console.error('Fallback copy failed:', err);
      this.showError('Failed to copy logs to clipboard');
    } finally {
      document.body.removeChild(textArea);
    }
  }

  exportLogs() {
    if (this.logs.length === 0) {
      this.showInfo('No logs to export');
      return;
    }

    const logText = this.logs.map(log => {
      const timestamp = new Date(log.timestamp).toISOString();
      return `[${timestamp}] ${log.level.toUpperCase()}: ${log.message}`;
    }).join('\n');

    // Create and download the log file
    const blob = new Blob([logText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `autoflow-logs-${new Date().toISOString().split('T')[0]}.log`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    this.showSuccess('Logs exported successfully');
  }

  loadAboutInfo() {
    const versionElement = document.getElementById('app-version');
    if (versionElement) {
      versionElement.textContent = '1.0.0';
    }
  }

  updateProcessingControls() {
    const startBtn = document.getElementById('start-btn');
    const pauseBtn = document.getElementById('pause-btn');
    const resumeBtn = document.getElementById('resume-btn');
    const stopBtn = document.getElementById('stop-btn');
    const statusText = document.getElementById('status-text');
    const statusDot = document.getElementById('status-dot');

    const state = this.processingState || 'idle';

    if (statusDot) {
      statusDot.classList.remove('processing', 'error');
    }

    if (state === 'processing') {
      if (startBtn) startBtn.disabled = true;
      if (pauseBtn) pauseBtn.disabled = false;
      if (resumeBtn) {
        resumeBtn.disabled = true;
        resumeBtn.style.display = 'none';
      }
      if (stopBtn) stopBtn.disabled = false;
      if (statusText) statusText.textContent = 'Processing';
      if (statusDot) statusDot.classList.add('processing');
    } else if (state === 'paused') {
      if (startBtn) startBtn.disabled = true;
      if (pauseBtn) pauseBtn.disabled = true;
      if (resumeBtn) {
        resumeBtn.disabled = false;
        resumeBtn.style.display = '';
      }
      if (stopBtn) stopBtn.disabled = false;
      if (statusText) statusText.textContent = 'Paused';
      if (statusDot) statusDot.classList.add('processing');
    } else {
      // idle or any other state
      // Start button enable/disable tetap di-handle oleh validateForm
      if (pauseBtn) pauseBtn.disabled = true;
      if (resumeBtn) {
        resumeBtn.disabled = true;
        resumeBtn.style.display = 'none';
      }
      if (stopBtn) stopBtn.disabled = true;
      if (statusText) statusText.textContent = 'Ready';
      // statusDot tetap default (success) tanpa class tambahan
    }
  }

  updateCreditsDisplay() {
    const creditsElement = document.getElementById('credits-remaining');
    if (!creditsElement) return;

    if (typeof this.remainingCredits === 'number') {
      try {
        const formatted = this.remainingCredits.toLocaleString('en-US');
        creditsElement.textContent = `Credits: ${formatted}`;
      } catch (e) {
        creditsElement.textContent = `Credits: ${this.remainingCredits}`;
      }
    } else {
      creditsElement.textContent = 'Credits: -';
    }
  }

  updateUI() {
    this.validateForm();
    this.updatePromptCount();
    this.updateProcessingControls();
    this.updateCreditsDisplay();
  }

  showSuccess(message) {
    this.log(message, 'success');
    this.showNotification(message, 'success');
  }

  showError(message) {
    this.log(message, 'error');
    this.showNotification(message, 'error');
  }

  showInfo(message) {
    this.log(message, 'info');
    this.showNotification(message, 'info');
  }

  showNotification(message, type = 'info') {
    // Always log to console with detailed information
    const timestamp = new Date().toISOString();
    const consoleMessage = `[${timestamp}] ${type.toUpperCase()}: ${message}`;
    
    // Visual toast notification in the UI
    try {
      let notificationEl = document.getElementById('app-notification');
      if (!notificationEl) {
        notificationEl = document.createElement('div');
        notificationEl.id = 'app-notification';
        notificationEl.className = 'notification';
        document.body.appendChild(notificationEl);
      }

      notificationEl.textContent = message;
      notificationEl.className = `notification ${type}`;

      // Restart animation by forcing reflow before adding the class
      void notificationEl.offsetWidth;
      notificationEl.classList.add('show');

      if (notificationEl._hideTimeout) {
        clearTimeout(notificationEl._hideTimeout);
      }
      notificationEl._hideTimeout = setTimeout(() => {
        notificationEl.classList.remove('show');
      }, 3000);
    } catch (e) {
      console.error('Failed to show toast notification:', e);
    }

    // Show alert only for errors
    if (type === 'error') {
      const lower = String(message || '').toLowerCase();
      const isBearerAuthError = lower.includes('bearer token is invalid or expired');
      if (!isBearerAuthError) {
        alert(message);
      }
    }
  }

  // Helper method to open completed files
  async openFile(filePath) {
    try {
      // This would need to be implemented in the main process
      await window.electronAPI.openFile(filePath);
    } catch (error) {
      this.log(`Failed to open file: ${error.message}`, 'error');
      this.showError('Failed to open file');
    }
  }

  // Helper method to retry failed items
  async retryItem(itemId) {
    const item = [...this.processQueue, ...this.completedItems].find(i => i.id === itemId);
    if (!item) return;

    // Reset item status
    item.status = 'pending';
    item.error = null;
    item.progress = 0;
    item.startTime = null;
    item.endTime = null;

    // Move back to process queue if it was completed
    if (this.completedItems.includes(item)) {
      this.completedItems = this.completedItems.filter(i => i.id !== itemId);
      this.processQueue.push(item);
    }

    this.updateProcessedItemsList();
    this.updateStatistics();
    this.log(`Retrying item: ${item.prompt || item.imagePath}`, 'info');
  }

  // Helper method to skip items and stop infinite retries
  async skipItem(itemId) {
    const item = [...this.processQueue, ...this.completedItems].find(i => i.id === itemId);
    if (!item) return;

    // Mark as skipped and ensure it is treated as a finished item
    item.status = 'skipped';
    if (!item.error) {
      item.error = 'Skipped by user';
    }
    item.endTime = new Date();

    // Move into completed buckets and refresh UI/statistics
    this.moveItemToCompleted(item);

    this.log(`Item skipped by user: ${item.prompt || item.imagePath}`, 'warning', { activity: true });
  }
}

// Initialize the app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  window.app = new AutoFlowApp();
});