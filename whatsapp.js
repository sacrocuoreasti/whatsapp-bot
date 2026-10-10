const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  prepareWAMessageMedia,
  Browsers,
  proto,
  delay
} = require('@whiskeysockets/baileys');
const crypto = require('crypto');
const pino = require('pino');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { getConfig, updateConfig, addLog } = require('./config');

const AUTH_FOLDER = path.join(__dirname, 'baileys_auth_info');
const CONTACTS_FILE = path.join(__dirname, 'data', 'contacts.json');
const STATUSES_FILE = path.join(__dirname, 'data', 'statuses.json');

let sock = null;
let qrCodeDataUrl = null;
let qrRaw = null;
let connectionState = 'DISCONNECTED'; // 'DISCONNECTED' | 'SCAN_QR' | 'CONNECTING' | 'CONNECTED'
let connectedUser = null;
let hasSentRebootNotification = false;
let isStarting = false;

// Tracciamento contatti per la distribuzione dello stato
const knownContacts = new Set();
let publishedStatuses = [];

function loadStatuses() {
  try {
    if (fs.existsSync(STATUSES_FILE)) {
      publishedStatuses = JSON.parse(fs.readFileSync(STATUSES_FILE, 'utf8'));
      if (!Array.isArray(publishedStatuses)) publishedStatuses = [];
    }
  } catch (e) {
    publishedStatuses = [];
  }
}

function saveStatuses() {
  try {
    fs.writeFileSync(STATUSES_FILE, JSON.stringify(publishedStatuses, null, 2), 'utf8');
  } catch (e) {}
}

loadStatuses();

function loadKnownContacts() {
  try {
    knownContacts.clear();
    if (fs.existsSync(CONTACTS_FILE)) {
      const list = JSON.parse(fs.readFileSync(CONTACTS_FILE, 'utf8'));
      if (Array.isArray(list)) {
        list.forEach(j => {
          if (typeof j === 'string') {
            const num = j.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
            if (num && num.length >= 7 && !j.includes('@newsletter') && !j.includes('@g.us') && !j.includes('@lid')) {
              knownContacts.add(`${num}@s.whatsapp.net`);
            }
          }
        });
      }
    }
  } catch (e) {
    console.error('Errore caricamento contatti:', e);
  }
}

function saveKnownContacts() {
  try {
    const arr = Array.from(knownContacts);
    fs.writeFileSync(CONTACTS_FILE, JSON.stringify(arr, null, 2), 'utf8');
  } catch (e) {}
}

function registerContact(rawJid) {
  if (!rawJid || typeof rawJid !== 'string') return;
  const jid = rawJid.trim();
  if (jid.includes('@g.us') || jid.includes('@broadcast') || jid.includes('@newsletter') || jid.includes('@lid')) {
    return;
  }

  const num = jid.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
  if (!num || num.length < 7) return;

  const cleanJid = `${num}@s.whatsapp.net`;
  if (!knownContacts.has(cleanJid)) {
    knownContacts.add(cleanJid);
    saveKnownContacts();
  }
}

// Inizializza contatti noti
loadKnownContacts();

// Funzione di utilità per normalizzare i numeri telefonici in JID validi
function normalizeNumber(numero) {
  if (!numero) return '';
  const str = String(numero).trim().replace(/\s+/g, '').replace(/^\+/, '');
  const user = str.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
  if (!user || user.length < 5) return '';
  let cleanUser = user;
  if (cleanUser.startsWith('3') && cleanUser.length === 10) {
    cleanUser = '39' + cleanUser;
  }
  return `${cleanUser}@s.whatsapp.net`;
}

const recentMessages = new Map();

function storeRecentMessage(id, msg) {
  if (!id || !msg) return;
  recentMessages.set(id, msg);
  if (recentMessages.size > 500) {
    const firstKey = recentMessages.keys().next().value;
    recentMessages.delete(firstKey);
  }
}

async function getStatus() {
  return {
    state: connectionState,
    qrCode: qrCodeDataUrl,
    user: connectedUser,
    hasSentRebootNotification,
    contactsCount: knownContacts.size
  };
}

async function startWhatsApp() {
  if (isStarting) return;
  isStarting = true;

  try {
    if (!fs.existsSync(AUTH_FOLDER)) {
      fs.mkdirSync(AUTH_FOLDER, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);
    const { version } = await fetchLatestBaileysVersion().catch(() => ({
      version: [2, 3000, 1015901307],
      isLatest: true
    }));

    connectionState = 'CONNECTING';

    if (sock) {
      try {
        sock.ev.removeAllListeners();
      } catch (e) {}
      sock = null;
    }

    sock = makeWASocket({
      version,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,
      auth: state,
      browser: Browsers.ubuntu('Chrome'),
      qrTimeout: 60000,
      syncFullHistory: false,
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000,
      keepAliveIntervalMs: 25000,
      emitOwnEvents: true,
      markOnlineOnConnect: true,
      generateHighQualityLinkPreview: false,
      getMessage: async (key) => {
        if (key && key.id && recentMessages.has(key.id)) {
          return recentMessages.get(key.id);
        }
        return undefined;
      }
    });

    sock.ev.on('creds.update', saveCreds);

    // Raccoglie i contatti della rubrica per la lista di distribuzione degli stati
    sock.ev.on('contacts.upsert', (contacts) => {
      for (const c of contacts) {
        if (c.id) registerContact(c.id);
      }
    });

    sock.ev.on('contacts.update', (contacts) => {
      for (const c of contacts) {
        if (c.id) registerContact(c.id);
      }
    });

    sock.ev.on('chats.upsert', (chats) => {
      for (const ch of chats) {
        if (ch.id) registerContact(ch.id);
      }
    });

    sock.ev.on('messages.upsert', (m) => {
      for (const msg of m.messages || []) {
        if (msg.key?.id && msg.message) {
          storeRecentMessage(msg.key.id, msg.message);
        }
        if (msg.key?.remoteJid) registerContact(msg.key.remoteJid);

        // Rileva se il messaggio è inoltrato da un canale WhatsApp (Newsletter)
        const contextInfo = msg.message?.extendedTextMessage?.contextInfo ||
                            msg.message?.imageMessage?.contextInfo ||
                            msg.message?.videoMessage?.contextInfo ||
                            msg.message?.documentMessage?.contextInfo ||
                            msg.message?.contextInfo;

        const newsletterInfo = contextInfo?.forwardedNewsletterMessageInfo;
        if (newsletterInfo?.newsletterJid) {
          const jid = newsletterInfo.newsletterJid;
          const name = newsletterInfo.newsletterName || 'Canale WhatsApp';
          console.log(`🎉 RILEVATO JID CANALE DALL'INOLTRO: ${jid} (${name})`);
          const config = getConfig();
          updateConfig({
            channel: {
              ...config.channel,
              jid,
              name: name || config.channel?.name || 'Canale WhatsApp',
              enabled: true
            }
          });
          addLog('channel', `JID Canale WhatsApp rilevato automaticamente: ${jid} (${name})`);
        }

        // Se il messaggio proviene direttamente da un canale
        if (msg.key?.remoteJid?.endsWith('@newsletter')) {
          console.log(`🎉 RILEVATO JID CANALE DIRETTO: ${msg.key.remoteJid}`);
          const config = getConfig();
          updateConfig({
            channel: {
              ...config.channel,
              jid: msg.key.remoteJid,
              enabled: true
            }
          });
          addLog('channel', `JID Canale WhatsApp rilevato: ${msg.key.remoteJid}`);
        }

        // Traccia in tempo reale tutti gli stati pubblicati dall'account (da app, web o bot)
        if (msg.key?.remoteJid === 'status@broadcast' && msg.key?.fromMe && msg.key?.id) {
          const existing = publishedStatuses.find(s => s.id === msg.key.id);
          if (!existing) {
            console.log('📸 Rilevato stato WhatsApp pubblicato:', msg.key.id);
            publishedStatuses.unshift({
              id: msg.key.id,
              key: msg.key,
              timestamp: msg.messageTimestamp ? Number(msg.messageTimestamp) * 1000 : Date.now(),
              caption: msg.message?.imageMessage?.caption || msg.message?.videoMessage?.caption || msg.message?.conversation || msg.message?.extendedTextMessage?.text || 'Stato',
              type: msg.message?.imageMessage ? 'image' : msg.message?.videoMessage ? 'video' : 'text'
            });
            if (publishedStatuses.length > 50) publishedStatuses = publishedStatuses.slice(0, 50);
            saveStatuses();
          }
        }
      }
    });

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr, isNewLogin } = update;

      if (isNewLogin) {
        console.log('🎉 Dispositivo collegato con successo! Finalizzazione sessione...');
        addLog('success', 'Dispositivo accoppiato con successo! Finalizzazione sessione in corso...');
        connectionState = 'CONNECTING';
        qrCodeDataUrl = null;
        qrRaw = null;
      }

      if (qr) {
        qrRaw = qr;
        try {
          qrCodeDataUrl = await QRCode.toDataURL(qr, {
            errorCorrectionLevel: 'M',
            margin: 2,
            scale: 7
          });
          connectionState = 'SCAN_QR';
          console.log('📲 Nuovo QR Code WhatsApp generato pronto per la scansione.');
        } catch (qrErr) {
          console.error('Errore nella generazione del QR Code:', qrErr);
        }
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const errMessage = lastDisconnect?.error?.message || 'sconosciuto';
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        console.log(`⚠️ Connessione WhatsApp chiusa (codice: ${statusCode}, motivo: ${errMessage}). Riconnessione: ${shouldReconnect}`);

        addLog('warning', `Connessione WhatsApp chiusa: codice ${statusCode || 'sconosciuto'} (${errMessage})`);

        // Riconnessione post-accoppiamento (codice 515 = restartRequired)
        if (statusCode === DisconnectReason.restartRequired || statusCode === 515) {
          console.log('🔄 Accoppiamento completato con successo! Riavvio rapido per stabilire la sessione...');
          connectionState = 'CONNECTING';
          qrCodeDataUrl = null;
          qrRaw = null;
          isStarting = false;
          setTimeout(() => {
            startWhatsApp();
          }, 2000);
          return;
        }

        if (statusCode === DisconnectReason.loggedOut) {
          // Se eravamo autenticati pulisci credenziali, altrimenti ritenta senza cancellare subito
          if (state.creds?.account) {
            connectionState = 'DISCONNECTED';
            qrCodeDataUrl = null;
            qrRaw = null;
            connectedUser = null;
            console.log('Disconnesso da WhatsApp (Logged Out). Pulisco sessione...');
            await disconnectWhatsApp();
            return;
          } else {
            console.log('Tentativo di connessione rifiutato (401 non accoppiato). Riavvio pulito...');
            connectionState = 'CONNECTING';
            isStarting = false;
            setTimeout(() => {
              startWhatsApp();
            }, 2000);
            return;
          }
        }

        // Timeout normale QR (408) o riconnessione generica
        if (shouldReconnect) {
          isStarting = false;
          connectionState = 'CONNECTING';
          setTimeout(() => {
            startWhatsApp();
          }, 1500);
        } else {
          connectionState = 'DISCONNECTED';
          qrCodeDataUrl = null;
          qrRaw = null;
          connectedUser = null;
        }
      } else if (connection === 'open') {
        connectionState = 'CONNECTED';
        qrCodeDataUrl = null;
        qrRaw = null;

        const botUser = sock.user;
        const botNumber = botUser?.id ? botUser.id.split(':')[0] : 'Numero';
        connectedUser = {
          id: botUser?.id,
          name: botUser?.name || 'Bot Sacro Cuore',
          phone: botNumber
        };

        // Registra il proprio numero tra i contatti per la visibilità dello stato
        if (botNumber) {
          registerContact(botNumber + '@s.whatsapp.net');
        }

        console.log(`✅ WhatsApp connesso con successo! Account: +${botNumber}`);
        addLog('success', `WhatsApp connesso con successo (+${botNumber})`);

        // ============================================================
        // INVIO NOTIFICA RIAVVIO A 393487856692
        // ============================================================
        if (!hasSentRebootNotification) {
          const config = getConfig();
          const targetNotifyNumber = normalizeNumber(config.adminNotifyNumber || '393487856692');
          registerContact(targetNotifyNumber);

          try {
            const now = new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome' });
            const restartMsg =
              `🤖 *WhatsApp Bot Sacro Cuore*\n\n` +
              `✅ *Server riavviato e connesso con successo!*\n` +
              `🕒 Orario: ${now}\n` +
              `📡 Stato: Online e operativo.\n` +
              `🚀 Pronto per inviare messaggi Google Script e stato.`;

            await delay(2500);
            await sock.sendMessage(targetNotifyNumber, { text: restartMsg });

            hasSentRebootNotification = true;
            console.log(`📩 Messaggio di avvenuto riavvio inviato a ${targetNotifyNumber}`);
            addLog('info', `Messaggio di avvenuto riavvio inviato a ${config.adminNotifyNumber}`);
          } catch (notifErr) {
            console.error('Errore invio messaggio notifica riavvio:', notifErr);
            addLog('error', `Impossibile inviare notifica riavvio: ${notifErr.message}`);
          }
        }
      }
    });

  } catch (err) {
    console.error('Errore durante l\'avvio di Baileys:', err);
    connectionState = 'DISCONNECTED';
    addLog('error', `Errore avvio Baileys: ${err.message}`);
  } finally {
    isStarting = false;
  }
}

// Disconnessione rapida e pulizia credenziali
async function disconnectWhatsApp() {
  console.log('🔄 Disconnessione e rimozione credenziali WhatsApp...');
  try {
    if (sock) {
      try {
        await sock.logout();
      } catch (e) {}
      try {
        sock.end();
      } catch (e) {}
      sock = null;
    }
  } catch (e) {
    console.error('Errore logout socket:', e);
  }

  try {
    if (fs.existsSync(AUTH_FOLDER)) {
      fs.rmSync(AUTH_FOLDER, { recursive: true, force: true });
    }
  } catch (rmErr) {
    console.error('Errore rimozione cartella auth:', rmErr);
  }

  connectionState = 'DISCONNECTED';
  qrCodeDataUrl = null;
  qrRaw = null;
  connectedUser = null;
  hasSentRebootNotification = false;

  addLog('info', 'WhatsApp scollegato. Sessione azzerata.');

  setTimeout(() => {
    startWhatsApp();
  }, 1000);

  return { success: true, message: 'Disconnesso con successo. Nuovo QR in generazione...' };
}

// Invio messaggio WhatsApp compatibile con whatsapp-api.js di Google Script
async function sendMessage(numero, testo) {
  if (connectionState !== 'CONNECTED' || !sock) {
    throw new Error('WhatsApp non è attualmente connesso. Scansiona prima il codice QR.');
  }

  if (!numero) {
    throw new Error('Numero di telefono obbligatorio.');
  }

  if (!testo && testo !== '') {
    throw new Error('Testo del messaggio obbligatorio.');
  }

  const jid = normalizeNumber(numero);
  registerContact(jid);

  try {
    const result = await sock.sendMessage(jid, { text: String(testo) });
    if (result?.key?.id && result?.message) {
      storeRecentMessage(result.key.id, result.message);
    }
    addLog('send', `Messaggio inviato a ${numero}`, {
      jid,
      preview: String(testo).substring(0, 60),
      messageId: result?.key?.id
    });

    return {
      success: true,
      messageId: result?.key?.id,
      timestamp: Date.now(),
      to: numero,
      jid
    };
  } catch (sendErr) {
    addLog('error', `Errore invio messaggio a ${numero}: ${sendErr.message}`);
    throw sendErr;
  }
}

// Helper per calcolare la lista destinatari degli stati WhatsApp
function getStatusRecipients() {
  const config = getConfig();
  const recipients = new Set();

  for (const j of knownContacts) {
    if (typeof j === 'string') {
      const num = j.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
      if (num && num.length >= 7) {
        recipients.add(`${num}@s.whatsapp.net`);
      }
    }
  }

  if (sock?.user?.id) {
    const myNum = sock.user.id.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
    if (myNum) recipients.add(`${myNum}@s.whatsapp.net`);
  }

  if (config.adminNotifyNumber) {
    const adminJid = normalizeNumber(config.adminNotifyNumber);
    if (adminJid) recipients.add(adminJid);
  }

  return Array.from(recipients).filter(j => /^\d+@s\.whatsapp\.net$/.test(j));
}

// Pubblicazione come stato / storia WhatsApp (status@broadcast)
async function postWhatsAppStatus({ imageUrl, videoUrl, text, caption }) {
  if (connectionState !== 'CONNECTED' || !sock) {
    throw new Error('WhatsApp non è attualmente connesso.');
  }

  try {
    let payload = {};

    if (imageUrl) {
      let imgBuffer;
      if (Buffer.isBuffer(imageUrl)) {
        imgBuffer = imageUrl;
      } else {
        console.log(`📥 Scaricamento buffer immagine per lo stato da: ${imageUrl.substring(0, 70)}...`);
        const resp = await axios.get(imageUrl, {
          responseType: 'arraybuffer',
          timeout: 25000,
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        });
        imgBuffer = Buffer.from(resp.data);
      }
      payload = {
        image: imgBuffer,
        caption: caption || text || ''
      };
    } else if (videoUrl) {
      let vidBuffer;
      if (Buffer.isBuffer(videoUrl)) {
        vidBuffer = videoUrl;
      } else {
        console.log(`📥 Scaricamento buffer video per lo stato da: ${videoUrl.substring(0, 70)}...`);
        const resp = await axios.get(videoUrl, {
          responseType: 'arraybuffer',
          timeout: 45000,
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        });
        vidBuffer = Buffer.from(resp.data);
      }
      payload = {
        video: vidBuffer,
        caption: caption || text || ''
      };
    } else if (text) {
      payload = {
        text: text,
        backgroundColor: '#1E293B',
        font: 1
      };
    } else {
      throw new Error('È necessario specificare un\'immagine, video o testo per lo stato.');
    }

    // ============================================================
    // DESTINATARI DELLO STATO (statusJidList)
    // ============================================================
    const statusJidList = getStatusRecipients();
    console.log(`📢 Invio stato a status@broadcast per ${statusJidList.length} destinatari:`, statusJidList);

    const result = await sock.sendMessage('status@broadcast', payload, {
      statusJidList: statusJidList.length > 0 ? statusJidList : undefined,
      broadcast: true
    });

    if (result?.key?.id) {
      publishedStatuses.unshift({
        id: result.key.id,
        key: result.key,
        timestamp: Date.now(),
        caption: caption || text || 'Stato',
        type: imageUrl ? 'image' : videoUrl ? 'video' : 'text'
      });
      if (publishedStatuses.length > 50) {
        publishedStatuses = publishedStatuses.slice(0, 50);
      }
      saveStatuses();
    }

    addLog('status_publish', `Stato WhatsApp pubblicato (ID: ${result?.key?.id})`, {
      type: imageUrl ? 'image' : videoUrl ? 'video' : 'text',
      messageId: result?.key?.id,
      recipientsCount: statusJidList.length,
      caption: caption || text || ''
    });

    return {
      success: true,
      messageId: result?.key?.id,
      recipientsCount: statusJidList.length,
      status: 'published'
    };
  } catch (statusErr) {
    console.error('Errore pubblicazione stato WhatsApp:', statusErr);
    addLog('error', `Errore pubblicazione stato WhatsApp: ${statusErr.message}`);
    throw statusErr;
  }
}

// Elimina uno stato specifico
async function deleteStatus(statusId) {
  if (connectionState !== 'CONNECTED' || !sock) {
    throw new Error('WhatsApp non è attualmente connesso.');
  }

  let keyToDelete = null;
  const found = publishedStatuses.find(s => s.id === statusId);
  if (found && found.key) {
    keyToDelete = found.key;
  } else {
    keyToDelete = {
      remoteJid: 'status@broadcast',
      id: statusId,
      fromMe: true
    };
  }

  const statusJidList = getStatusRecipients();
  console.log(`🗑️ Eliminazione stato WhatsApp:`, keyToDelete, `per ${statusJidList.length} destinatari`);
  await sock.sendMessage('status@broadcast', { delete: keyToDelete }, {
    statusJidList: statusJidList.length > 0 ? statusJidList : undefined,
    broadcast: true
  });

  publishedStatuses = publishedStatuses.filter(s => s.id !== statusId);
  saveStatuses();

  addLog('status_delete', `Stato WhatsApp eliminato (${statusId})`);
  return { success: true, deletedId: statusId };
}

// Elimina tutti gli stati WhatsApp memorizzati
async function deleteAllStatuses() {
  if (connectionState !== 'CONNECTED' || !sock) {
    throw new Error('WhatsApp non è attualmente connesso.');
  }

  if (publishedStatuses.length === 0) {
    return {
      success: true,
      count: 0,
      message: 'Nessuno stato memorizzato nel bot da eliminare.'
    };
  }

  const statusJidList = getStatusRecipients();
  let deletedCount = 0;
  for (const item of [...publishedStatuses]) {
    try {
      const key = item.key || {
        remoteJid: 'status@broadcast',
        id: item.id,
        fromMe: true
      };
      await sock.sendMessage('status@broadcast', { delete: key }, {
        statusJidList: statusJidList.length > 0 ? statusJidList : undefined,
        broadcast: true
      });
      deletedCount++;
    } catch (err) {
      console.error(`Errore eliminazione stato ${item.id}:`, err.message);
    }
  }

  publishedStatuses = [];
  saveStatuses();

  addLog('status_delete', `Tutti gli stati registrati (${deletedCount}) sono stati eliminati`);
  return { success: true, count: deletedCount };
}

function getPublishedStatuses() {
  return [...publishedStatuses];
}

// Helper per interrogazioni socket con timeout
async function safeQuery(query, timeoutMs = 4000) {
  if (!sock) throw new Error('WhatsApp non connesso');
  return Promise.race([
    sock.query(query),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout query')), timeoutMs))
  ]);
}

// Ottieni i canali di cui l'account connesso è amministratore o iscritto
async function getMyNewsletters() {
  if (connectionState !== 'CONNECTED' || !sock) return [];
  const results = [];
  try {
    const query = {
      tag: 'iq',
      attrs: {
        to: 's.whatsapp.net',
        xmlns: 'newsletter',
        type: 'get',
        id: sock.generateMessageTag()
      },
      content: [
        {
          tag: 'newsletter',
          attrs: { type: 'admin' }
        }
      ]
    };
    const res = await safeQuery(query, 3000);
    if (res?.content && Array.isArray(res.content)) {
      for (const node of res.content) {
        if (node.tag === 'newsletter' || node.tag === 'channel') {
          const jid = (node.attrs?.id || node.attrs?.jid || '').endsWith('@newsletter') 
            ? (node.attrs?.id || node.attrs?.jid) 
            : (node.attrs?.id || node.attrs?.jid ? `${node.attrs?.id || node.attrs?.jid}@newsletter` : null);
          let name = 'Canale';
          if (node.content && Array.isArray(node.content)) {
            for (const sub of node.content) {
              if (sub.tag === 'metadata' && Array.isArray(sub.content)) {
                for (const m of sub.content) {
                  if (m.tag === 'name' && m.content) name = m.content.toString();
                }
              }
            }
          }
          if (jid) results.push({ jid, name });
        }
      }
    }
  } catch (err) {
    // Timeout o non supportato
  }
  return results;
}

// Risolve il link o codice di un canale WhatsApp in JID
async function resolveChannel(input) {
  if (connectionState !== 'CONNECTED' || !sock) {
    throw new Error('WhatsApp non è attualmente connesso.');
  }

  let str = String(input || '').trim();
  if (!str) throw new Error('Inserisci un link o un codice canale');

  if (str.endsWith('@newsletter')) {
    return { jid: str, name: 'Canale WhatsApp' };
  }

  const match = str.match(/whatsapp\.com\/channel\/([a-zA-Z0-9_-]+)/i);
  const inviteCode = match ? match[1] : str.replace(/[^a-zA-Z0-9_-]/g, '');

  if (!inviteCode) throw new Error('Codice canale non riconosciuto dal link.');

  // Prova interrogazione IQ protocollo newsletter con le due varianti di schema WhatsApp
  const queries = [
    {
      tag: 'iq',
      attrs: { to: 's.whatsapp.net', xmlns: 'newsletter', type: 'get', id: sock.generateMessageTag() },
      content: [{ tag: 'newsletter', attrs: { type: 'invite', key: inviteCode } }]
    },
    {
      tag: 'iq',
      attrs: { to: 's.whatsapp.net', xmlns: 'newsletter', type: 'get', id: sock.generateMessageTag() },
      content: [{ tag: 'metadata', attrs: {}, content: [{ tag: 'invite', attrs: { key: inviteCode } }] }]
    }
  ];

  for (const q of queries) {
    try {
      const res = await safeQuery(q, 3500);
      let jid = null;
      let name = 'Canale WhatsApp';

      function findJidAndName(node) {
        if (!node) return;
        if (node.attrs?.id || node.attrs?.jid) {
          const raw = node.attrs?.id || node.attrs?.jid;
          if (raw.includes('@newsletter') || /^\d{10,}$/.test(raw)) {
            jid = raw.endsWith('@newsletter') ? raw : `${raw}@newsletter`;
          }
        }
        if (node.tag === 'name' && node.content) {
          name = node.content.toString();
        }
        if (Array.isArray(node.content)) {
          for (const c of node.content) findJidAndName(c);
        }
      }

      findJidAndName(res);

      if (jid) {
        return { jid, name, inviteCode };
      }
    } catch (iqErr) {
      // Ignora e passa oltre
    }
  }

  // Fallback: cerca nel web se possibile
  try {
    const pageRes = await axios.get(`https://whatsapp.com/channel/${inviteCode}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
      timeout: 10000
    });
    const html = pageRes.data;
    const titleMatch = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i);
    const channelName = titleMatch ? titleMatch[1] : 'Canale WhatsApp';

    const jidMatch = html.match(/(120363\d{10,18}@newsletter)/i);
    if (jidMatch) {
      return { jid: jidMatch[1], name: channelName, inviteCode };
    }

    return {
      name: channelName,
      inviteCode,
      needJid: true,
      message: `Trovato canale "${channelName}". Inserisci il JID (es. 120363...@newsletter) per completare il collegamento.`
    };
  } catch (webErr) {}

  throw new Error(`Impossibile risolvere automaticamente l'invito. Inserisci direttamente il JID del canale (es. 120363...@newsletter).`);
}

// Invia contenuto al Canale WhatsApp (Post, Carosello o Reel)
async function sendToChannel(channelJid, { type, imageUrl, caption, link }) {
  if (connectionState !== 'CONNECTED' || !sock) {
    throw new Error('WhatsApp non è attualmente connesso.');
  }

  let jid = String(channelJid || '').trim();
  if (!jid) {
    throw new Error('Nessun canale WhatsApp configurato.');
  }

  // Se è stato inserito un link o invite code invece del JID
  if (jid.includes('whatsapp.com/channel/') || (!jid.includes('@') && jid.length >= 15 && isNaN(jid))) {
    const resolved = await resolveChannel(jid).catch(() => null);
    if (resolved?.jid) jid = resolved.jid;
  }

  if (/^\d{10,25}$/.test(jid)) {
    jid = `${jid}@newsletter`;
  }

  if (!jid.endsWith('@newsletter')) {
    throw new Error(`Il JID "${jid}" non è valido. I canali WhatsApp hanno un identificativo numerico che termina con "@newsletter" (es. 120363...@newsletter).`);
  }

  console.log(`📢 Invio a Canale WhatsApp (${jid}) tipo: ${type}`);
  let result = null;

  try {
    if (type === 'reel') {
      // REEL IG -> descrizione + link ig
      const textMsg = `${caption ? caption + '\n\n' : ''}🎬 Guarda il Reel su Instagram:\n${link || ''}`.trim();
      result = await sock.sendMessage(jid, { text: textMsg });
    } else if (imageUrl) {
      // POST O CAROSELLO -> foto + descrizione nel canale
      console.log(`📥 Scaricamento foto per canale WhatsApp: ${imageUrl.substring(0, 80)}...`);
      const resp = await axios.get(imageUrl, {
        responseType: 'arraybuffer',
        timeout: 25000,
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      const imgBuffer = Buffer.from(resp.data);
      console.log(`📸 Foto scaricata con successo (${imgBuffer.length} bytes). Invio a canale ${jid}...`);
      result = await sock.sendMessage(jid, {
        image: imgBuffer,
        caption: caption || ''
      });
      console.log(`✅ Foto inviata a canale con successo. Message ID:`, result?.key?.id);
    } else {
      result = await sock.sendMessage(jid, {
        text: `${caption || ''}\n\n${link || ''}`.trim()
      });
    }

    const msgId = result?.key?.id || 'CH_' + Date.now();

    addLog('channel_post', `Pubblicato ${type} nel canale WhatsApp`, {
      channelJid: jid,
      type,
      caption: caption ? caption.substring(0, 50) : '',
      messageId: msgId
    });

    return {
      success: true,
      messageId: msgId,
      type,
      channelJid: jid
    };
  } catch (err) {
    console.error(`Errore invio a canale WhatsApp (${jid}):`, err);
    addLog('error', `Errore pubblicazione canale WhatsApp (${jid}): ${err.message}`);
    throw err;
  }
}

// Richiedi codice di accoppiamento (Pairing Code a 8 cifre) con numero di telefono
async function requestPairingCode(phoneNumber) {
  if (connectionState === 'CONNECTED') {
    throw new Error('WhatsApp è già connesso.');
  }

  if (!sock) {
    throw new Error('Servizio WhatsApp non pronto. Attendi qualche secondo e riprova.');
  }

  let clean = String(phoneNumber || '').replace(/[^0-9]/g, '');
  // Se è un numero italiano di 10 cifre senza prefisso (es. 3792429531 o 348...), aggiunge il 39
  if (clean.startsWith('3') && clean.length === 10) {
    clean = '39' + clean;
  }
  if (!clean || clean.length < 9) {
    throw new Error('Numero non valido. Inserisci il numero con prefisso (es. 393792429531 o 3792429531)');
  }

  console.log(`📲 Richiesta codice di accoppiamento WhatsApp per: ${clean}`);
  try {
    const rawCode = await sock.requestPairingCode(clean);
    const formattedCode = rawCode ? (rawCode.match(/.{1,4}/g)?.join('-') || rawCode) : rawCode;
    console.log(`✅ Codice di accoppiamento generato: ${formattedCode}`);
    addLog('info', `Pairing Code generato per ${clean}: ${formattedCode}`);
    return {
      success: true,
      code: formattedCode,
      phoneNumber: clean
    };
  } catch (err) {
    console.error(`Errore richiesta pairing code per ${clean}:`, err);
    throw new Error(`Impossibile generare codice per ${clean}: ${err.message}`);
  }
}

module.exports = {
  startWhatsApp,
  disconnectWhatsApp,
  getStatus,
  sendMessage,
  requestPairingCode,
  postWhatsAppStatus,
  deleteStatus,
  deleteAllStatuses,
  getPublishedStatuses,
  resolveChannel,
  getMyNewsletters,
  sendToChannel,
  normalizeNumber
};
