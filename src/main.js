const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const os = require('os');
const axios = require('axios');
const crypto = require('crypto');

const LICENSE_API_URL = 'https://script.google.com/macros/s/AKfycbwsC06dFa16fIwTXDHrNvXkr7xtNdLmcwLsqOn7ZAJpMkHa1-enNyKkQooc-YkgF5jy/exec';

class AutoFlowApp {
  constructor() {
    this.mainWindow = null;
    this.settingsPath = path.join(app.getPath('userData'), 'settings.json');
    this.licensePath = path.join(app.getPath('userData'), 'license.json');
    this.machineId = this.generateMachineId();
    this.setupEventHandlers();
  }

  setupEventHandlers() {
    app.whenReady().then(() => this.createWindow());
    
    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') {
        app.quit();
      }
    });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        this.createWindow();
      }
    });

    // IPC handlers
    ipcMain.handle('save-settings', this.saveSettings.bind(this));
    ipcMain.handle('load-settings', this.loadSettings.bind(this));
    ipcMain.handle('select-folder', this.selectFolder.bind(this));
    ipcMain.handle('select-files', this.selectFiles.bind(this));
    ipcMain.handle('scan-image-files', this.scanImageFiles.bind(this));
    ipcMain.handle('read-file-base64', this.readFileBase64.bind(this));
    ipcMain.handle('write-file', this.writeFile.bind(this));
    ipcMain.handle('open-file', this.openFile.bind(this));
    ipcMain.handle('path-join', this.pathJoin.bind(this));
    ipcMain.handle('path-basename', this.pathBasename.bind(this));
    ipcMain.handle('path-dirname', this.pathDirname.bind(this));
    ipcMain.handle('path-extname', this.pathExtname.bind(this));
    ipcMain.handle('validate-license', this.validateLicense.bind(this));
    ipcMain.handle('load-license', this.loadLicense.bind(this));
    ipcMain.handle('open-main-app', this.openMainApp.bind(this));
  }

  createWindow() {
    // Add these flags before creating the BrowserWindow
    app.commandLine.appendSwitch('--disable-gpu-sandbox');
    app.commandLine.appendSwitch('--disable-software-rasterizer');
    this.mainWindow = new BrowserWindow({
      width: 1400,
      height: 900,
      minWidth: 1200,
      minHeight: 700,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js')
      },
      icon: path.join(__dirname, '../assets/icon.png'),
      titleBarStyle: 'default',
      autoHideMenuBar: true,
      show: false
    });

    this.mainWindow.webContents.on('before-input-event', (event, input) => {
      if (input.key === 'F12' && !input.isAutoRepeat) {
        this.mainWindow.webContents.toggleDevTools();
        event.preventDefault();
      }
    });

    this.loadInitialPage();

    // Show window when ready to prevent visual flash
    this.mainWindow.once('ready-to-show', () => {
      this.mainWindow.show();
    });

    // Save settings before closing
    this.mainWindow.on('close', async () => {
      // Auto-save will be handled by renderer process
    });

    // Development tools
    if (process.argv.includes('--dev')) {
      this.mainWindow.webContents.openDevTools();
    }
  }

  async loadInitialPage() {
    if (!this.mainWindow) {
      return;
    }

    try {
      await this.mainWindow.loadFile(path.join(__dirname, 'renderer', 'login.html'));
    } catch (error) {
      console.error('Failed to load initial page:', error);
      await this.mainWindow.loadFile(path.join(__dirname, 'renderer', 'login.html'));
    }
  }

  async saveSettings(event, settings) {
    try {
      await fs.ensureDir(path.dirname(this.settingsPath));
      await fs.writeJson(this.settingsPath, settings, { spaces: 2 });
      return { success: true };
    } catch (error) {
      console.error('Failed to save settings:', error);
      return { success: false, error: error.message };
    }
  }

  async loadLicense() {
    try {
      if (await fs.pathExists(this.licensePath)) {
        const license = await fs.readJson(this.licensePath);
        return { success: true, license };
      }
      return { success: true, license: null };
    } catch (error) {
      console.error('Failed to load license:', error);
      return { success: false, error: error.message };
    }
  }

  async openMainApp() {
    try {
      if (!this.mainWindow) {
        return { success: false, error: 'Main window is not ready.' };
      }

      await this.mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
      return { success: true };
    } catch (error) {
      console.error('Failed to open main app:', error);
      return { success: false, error: error.message };
    }
  }

  async validateLicense(event, data) {
    try {
      const email = data && typeof data.email === 'string' ? data.email.trim() : '';
      if (!this.isValidEmail(email)) {
        return { success: false, error: 'Invalid email' };
      }
      if (!LICENSE_API_URL || LICENSE_API_URL.includes('PUT_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE')) {
        return { success: false, error: 'License server URL has not been configured in the application.' };
      }

      const machineId = this.machineId || 'unknown-machine';

      // Step 1: login / register this machine
      const loginResponse = await axios.post(
        LICENSE_API_URL,
        {
          email,
          machineId,
          action: 'login'
        },
        { timeout: 15000 }
      );

      let loginPayload = loginResponse.data;
      if (typeof loginPayload === 'string') {
        try {
          loginPayload = JSON.parse(loginPayload);
        } catch (e) {
          return { success: false, error: 'Invalid response from license server.' };
        }
      }

      if (!loginPayload || loginPayload.ok !== true) {
        const message = loginPayload && loginPayload.message ? loginPayload.message : 'License validation failed.';
        return { success: false, error: message };
      }

      const now = new Date();

      // Step 2: fetch full license info (all spreadsheet columns)
      let licenseDetails = null;
      try {
        const infoResponse = await axios.post(
          LICENSE_API_URL,
          {
            email,
            machineId,
            action: 'info'
          },
          { timeout: 15000 }
        );

        let infoPayload = infoResponse.data;
        if (typeof infoPayload === 'string') {
          try {
            infoPayload = JSON.parse(infoPayload);
          } catch (e) {
            infoPayload = null;
          }
        }

        if (infoPayload && infoPayload.ok === true && infoPayload.license && typeof infoPayload.license === 'object') {
          licenseDetails = infoPayload.license;
        }
      } catch (e) {
        console.error('Failed to load license info:', e);
      }

      const ld = licenseDetails || {};

      let expiryIso = '';
      if (ld.tanggalBerakhir) {
        const parsed = new Date(ld.tanggalBerakhir);
        if (!Number.isNaN(parsed.getTime())) {
          parsed.setHours(23, 59, 59, 999);
          expiryIso = parsed.toISOString();
        }
      }
      if (!expiryIso) {
        const fallback = new Date();
        fallback.setFullYear(fallback.getFullYear() + 1);
        expiryIso = fallback.toISOString();
      }

      const license = {
        email,
        tanggalJoin: ld.tanggalJoin || '',
        tanggalBerakhir: ld.tanggalBerakhir || '',
        mesinId1: ld.mesinId1 != null ? String(ld.mesinId1) : '',
        mesinId2: ld.mesinId2 != null ? String(ld.mesinId2) : '',
        mesinId3: ld.mesinId3 != null ? String(ld.mesinId3) : '',
        ultra: ld.ultra != null ? String(ld.ultra) : '',
        pass: ld.pass != null ? String(ld.pass) : '',
        ultraExpiredDate: ld.expiredDate || '',
        statusDeliveryUltra: ld.statusDeliveryUltra != null ? String(ld.statusDeliveryUltra) : '',
        machineId,
        maxMachines: 3,
        createdAt: now.toISOString(),
        expiry: expiryIso,
        serverMessage: loginPayload.message || '',
        serverCode: loginPayload.code || '',
        lastCheckedAt: now.toISOString()
      };

      await fs.ensureDir(path.dirname(this.licensePath));
      await fs.writeJson(this.licensePath, license, { spaces: 2 });

      return { success: true, license };
    } catch (error) {
      console.error('Failed to validate license:', error);
      return { success: false, error: error.message };
    }
  }

  async readLicense() {
    try {
      if (await fs.pathExists(this.licensePath)) {
        return await fs.readJson(this.licensePath);
      }
      return null;
    } catch (error) {
      console.error('Failed to read license:', error);
      return null;
    }
  }

  isLicenseValid(license) {
    if (!license || !license.email || !license.expiry) {
      return false;
    }
    const expiry = new Date(license.expiry);
    if (Number.isNaN(expiry.getTime())) {
      return false;
    }
    const now = new Date();
    return expiry >= now;
  }

  isValidEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
  }

  generateMachineId() {
    try {
      const host = os.hostname() || '';
      const platform = os.platform() || '';
      const arch = os.arch() || '';
      const base = [host, platform, arch].join('|');

      const hash = crypto.createHash('sha256').update(base).digest('hex');
      return hash || 'unknown-machine';
    } catch (error) {
      return 'unknown-machine';
    }
  }

  async loadSettings() {
    try {
      if (await fs.pathExists(this.settingsPath)) {
        const settings = await fs.readJson(this.settingsPath);
        return { success: true, settings };
      }
      return { success: true, settings: {} };
    } catch (error) {
      console.error('Failed to load settings:', error);
      return { success: false, error: error.message };
    }
  }

  async selectFolder() {
    const result = await dialog.showOpenDialog(this.mainWindow, {
      properties: ['openDirectory'],
      title: 'Select Output Folder'
    });

    return {
      canceled: result.canceled,
      filePath: result.canceled ? null : result.filePaths[0]
    };
  }

  async selectFiles(options = {}) {
    const dialogOptions = {
      properties: ['openFile'],
      title: options.title || 'Select Files',
      filters: options.filters || [
        { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    };

    if (options.multiple) {
      dialogOptions.properties.push('multiSelections');
    }

    const result = await dialog.showOpenDialog(this.mainWindow, dialogOptions);

    return {
      canceled: result.canceled,
      filePaths: result.canceled ? [] : result.filePaths
    };
  }

  async scanImageFiles(event, folderPath) {
    try {
      const files = await fs.readdir(folderPath);
      const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'];
      
      const imageFiles = files
        .filter(file => imageExtensions.includes(path.extname(file).toLowerCase()))
        .map(file => path.join(folderPath, file));
      
      return { success: true, files: imageFiles };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async readFileBase64(event, filePath) {
    try {
      const data = await fs.readFile(filePath);
      return { success: true, base64: data.toString('base64') };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async writeFile(event, filePath, data) {
    try {
      const dir = path.dirname(filePath);
      await fs.ensureDir(dir);
      
      // Handle both Buffer and Uint8Array data
      let buffer;
      if (data instanceof Uint8Array) {
        buffer = Buffer.from(data);
      } else if (Array.isArray(data)) {
        buffer = Buffer.from(data);
      } else {
        buffer = Buffer.from(data);
      }
      
      await fs.writeFile(filePath, buffer);
      return { success: true, filePath };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async pathJoin(event, ...args) {
    return path.join(...args);
  }

  async pathBasename(event, filePath) {
    return path.basename(filePath);
  }

  async pathDirname(event, filePath) {
    return path.dirname(filePath);
  }

  async pathExtname(event, filePath) {
    return path.extname(filePath);
  }

  async openFile(event, filePath) {
    try {
      const { shell } = require('electron');
      await shell.openPath(filePath);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

// Initialize the application
new AutoFlowApp();