const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

// Assicura che la cartella data esista
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function generateToken() {
  return 'sc_' + crypto.randomBytes(24).toString('hex');
}

const PRESET_CHANNELS = {
  test: {
    id: 'test',
    name: 'test bot (Canale Test)',
    link: 'https://whatsapp.com/channel/0029Vb9EnnlKmCPKtLzdkb2i',
    jid: '120363432155030916@newsletter'
  },
  official: {
    id: 'official',
    name: 'Sacro Cuore Asti (Canale Ufficiale)',
    link: 'https://whatsapp.com/channel/0029VbC4hP4GZNCor76Om40q',
    jid: '120363423706225795@newsletter'
  }
};

const DEFAULT_CONFIG = {
  adminEmail: 'admin@sacrocuoreasti.com',
  adminPassword: 'admin123',
  apiToken: generateToken(),
  adminNotifyNumber: '393487856692',
  serverUrl: '', // Se vuoto, viene dedotto automaticamente dalla richiesta
  activeChannelMode: 'test', // 'test', 'official', 'both'
  channels: { ...PRESET_CHANNELS },
  instagram: {
    enabled: false,
    appId: '',
    metaAccessToken: '',
    instagramAccountId: '',
    username: 'sacrocuoreasti',
    checkIntervalMinutes: 5,
    publishedStoryIds: [],
    webhookVerifyToken: crypto.randomBytes(16).toString('hex')
  },
  channel: {
    enabled: true,
    link: PRESET_CHANNELS.test.link,
    jid: PRESET_CHANNELS.test.jid,
    name: PRESET_CHANNELS.test.name,
    publishedPostIds: []
  },
  logs: []
};

let currentConfig = { ...DEFAULT_CONFIG };

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      currentConfig = {
        ...DEFAULT_CONFIG,
        ...data,
        channels: {
          test: { ...PRESET_CHANNELS.test, ...(data.channels?.test || {}) },
          official: { ...PRESET_CHANNELS.official, ...(data.channels?.official || {}) }
        }
      };

      if (!currentConfig.activeChannelMode) {
        currentConfig.activeChannelMode = 'test';
      }

      const activePreset = currentConfig.channels[currentConfig.activeChannelMode === 'official' ? 'official' : 'test'] || currentConfig.channels.test;
      if (!currentConfig.channel || !currentConfig.channel.jid) {
        currentConfig.channel = {
          enabled: true,
          ...activePreset,
          publishedPostIds: currentConfig.channel?.publishedPostIds || []
        };
      }

      if (!currentConfig.apiToken) {
        currentConfig.apiToken = generateToken();
        saveConfig();
      }
    } else {
      saveConfig();
    }
  } catch (err) {
    console.error('Errore nel caricamento del file config:', err);
  }
  return currentConfig;
}

function saveConfig() {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(currentConfig, null, 2), 'utf8');
  } catch (err) {
    console.error('Errore nel salvataggio della configurazione:', err);
  }
}

function getConfig() {
  return currentConfig;
}

function updateConfig(updates) {
  currentConfig = { ...currentConfig, ...updates };
  saveConfig();
  return currentConfig;
}

function regenerateToken() {
  currentConfig.apiToken = generateToken();
  saveConfig();
  return currentConfig.apiToken;
}

function addLog(type, message, details = null) {
  const logItem = {
    id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
    type,
    message,
    details,
    timestamp: new Date().toISOString()
  };
  currentConfig.logs = currentConfig.logs || [];
  currentConfig.logs.unshift(logItem);
  if (currentConfig.logs.length > 100) {
    currentConfig.logs = currentConfig.logs.slice(0, 100);
  }
  saveConfig();
  return logItem;
}

// Inizializza
loadConfig();

module.exports = {
  getConfig,
  updateConfig,
  regenerateToken,
  addLog,
  DATA_DIR
};
