const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
const crypto = require('crypto');
const { getConfig, updateConfig, regenerateToken, addLog } = require('./config');
const whatsapp = require('./whatsapp');
const instagram = require('./instagram');

const app = express();
const PORT = process.env.PORT || 3010;

// Filtra i log di rumore interni di libsignal (Bad MAC, MessageCounterError, ratchets)
const origConsoleError = console.error;
console.error = function(...args) {
  const str = args.map(a => (a && a.stack) ? a.stack : String(a)).join(' ');
  if (str.includes('Bad MAC') || str.includes('MessageCounterError') || str.includes('Key used already')) {
    return;
  }
  origConsoleError.apply(console, args);
};

// Token di sessione segreto in memoria per le sessioni utente
const SESSION_SECRET = crypto.randomBytes(32).toString('hex');
const activeSessions = new Set();

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Servizio file statici
app.use(express.static(path.join(__dirname, 'public')));

// Middleware per rilevare l'URL del server (supporta proxy Render HTTPS)
function getHostUrl(req) {
  const config = getConfig();
  if (config.serverUrl && config.serverUrl.trim() !== '') {
    return config.serverUrl.trim().replace(/\/+$/, '');
  }
  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.get('host') || `localhost:${PORT}`;
  return `${protocol}://${host}`;
}

// Middleware di autenticazione Web Dashboard
function requireWebAuth(req, res, next) {
  const sessionToken = req.cookies.admin_session;
  if (sessionToken && activeSessions.has(sessionToken)) {
    return next();
  }

  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.status(401).json({ error: 'Non autorizzato. Effettua il login.' });
  }
  return res.redirect('/login');
}

// Middleware di autenticazione API Token (per Google Apps Script e webhook)
function requireApiToken(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  const config = getConfig();

  if (!token || token !== config.apiToken) {
    addLog('warning', 'Tentativo di accesso API con token non valido', { ip: req.ip });
    return res.status(401).json({
      success: false,
      error: 'Token non valido o non autorizzato. Controlla WHATSAPP_API_TOKEN.'
    });
  }

  next();
}

// ============================================================
// ROTTE AUTENTICAZIONE WEB
// ============================================================

app.get('/login', (req, res) => {
  const sessionToken = req.cookies.admin_session;
  if (sessionToken && activeSessions.has(sessionToken)) {
    return res.redirect('/');
  }
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  const config = getConfig();

  if (email === config.adminEmail && password === config.adminPassword) {
    const token = crypto.randomBytes(32).toString('hex');
    activeSessions.add(token);

    res.cookie('admin_session', token, {
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 giorni
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production'
    });

    addLog('auth', `Accesso effettuato con successo (${email})`);
    return res.json({ success: true, message: 'Accesso eseguito con successo' });
  }

  addLog('warning', `Tentativo di accesso fallito per ${email}`);
  return res.status(401).json({
    success: false,
    error: 'Credenziali non corrette. Riprova con email e password valide.'
  });
});

app.post('/api/auth/logout', (req, res) => {
  const sessionToken = req.cookies.admin_session;
  if (sessionToken) {
    activeSessions.delete(sessionToken);
  }
  res.clearCookie('admin_session');
  res.json({ success: true, message: 'Disconnesso' });
});

// ============================================================
// DASHBOARD PROTETTA
// ============================================================

app.get('/', requireWebAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Stato WhatsApp in tempo reale
app.get('/api/whatsapp/status', requireWebAuth, async (req, res) => {
  const status = await whatsapp.getStatus();
  const config = getConfig();
  const dynamicUrl = getHostUrl(req);

  res.json({
    ...status,
    apiToken: config.apiToken,
    serverUrl: dynamicUrl,
    adminNotifyNumber: config.adminNotifyNumber
  });
});

// Disconnetti WhatsApp rapidamente
app.post('/api/whatsapp/disconnect', requireWebAuth, async (req, res) => {
  try {
    const result = await whatsapp.disconnectWhatsApp();
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Riavvia socket WhatsApp
app.post('/api/whatsapp/reconnect', requireWebAuth, async (req, res) => {
  try {
    await whatsapp.startWhatsApp();
    res.json({ success: true, message: 'Riavvio connessione in corso...' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Richiedi codice di accoppiamento (Pairing Code) con numero telefonico
app.post('/api/whatsapp/pairing-code', requireWebAuth, async (req, res) => {
  const { phoneNumber } = req.body;
  try {
    const result = await whatsapp.requestPairingCode(phoneNumber);
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Invio messaggio di test da dashboard
app.post('/api/whatsapp/test-send', requireWebAuth, async (req, res) => {
  const { numero, testo } = req.body;
  try {
    const result = await whatsapp.sendMessage(numero, testo);
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Pubblica stato WhatsApp da dashboard
app.post('/api/whatsapp/post-status', requireWebAuth, async (req, res) => {
  const { imageUrl, videoUrl, text, caption } = req.body;
  try {
    const result = await whatsapp.postWhatsAppStatus({ imageUrl, videoUrl, text, caption });
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Ottieni elenco stati WhatsApp pubblicati
app.get('/api/whatsapp/statuses', requireWebAuth, (req, res) => {
  res.json({ statuses: whatsapp.getPublishedStatuses() });
});

// Elimina uno stato specifico
app.post('/api/whatsapp/delete-status', requireWebAuth, async (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ success: false, error: 'ID stato obbligatorio' });
  try {
    const result = await whatsapp.deleteStatus(id);
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Elimina TUTTI gli stati WhatsApp pubblicati
app.post('/api/whatsapp/delete-all-statuses', requireWebAuth, async (req, res) => {
  try {
    const result = await whatsapp.deleteAllStatuses();
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Rigenera API Token
app.post('/api/config/regenerate-token', requireWebAuth, (req, res) => {
  const newToken = regenerateToken();
  addLog('config', 'WHATSAPP_API_TOKEN rigenerato');
  res.json({ success: true, apiToken: newToken });
});

// Salva impostazioni generali
app.post('/api/config/update', requireWebAuth, (req, res) => {
  const { adminNotifyNumber, serverUrl } = req.body;
  const updates = {};
  if (adminNotifyNumber !== undefined) updates.adminNotifyNumber = adminNotifyNumber;
  if (serverUrl !== undefined) updates.serverUrl = serverUrl;

  const newConfig = updateConfig(updates);
  addLog('config', 'Impostazioni aggiornate');
  res.json({ success: true, config: newConfig });
});

// Ottieni configurazione & log
app.get('/api/config', requireWebAuth, (req, res) => {
  const config = getConfig();
  res.json({
    ...config,
    serverUrl: getHostUrl(req)
  });
});

// Rileva account Instagram dal token Meta
app.post('/api/instagram/detect-account', requireWebAuth, async (req, res) => {
  const { accessToken } = req.body;
  try {
    const result = await instagram.detectInstagramAccount(accessToken);
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Sincronizza subito storie da Meta Graph API
app.post('/api/instagram/sync-now', requireWebAuth, async (req, res) => {
  try {
    const result = await instagram.syncStoriesFromMeta();
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Aggiorna impostazioni Instagram
app.post('/api/instagram/update', requireWebAuth, (req, res) => {
  const updated = instagram.updateInstagramSettings(req.body);
  addLog('config', 'Impostazioni Instagram aggiornate');
  res.json({ success: true, instagram: updated });
});

// ============================================================
// CANALE WHATSAPP (Newsletter)
// ============================================================

// Risolvi link o JID canale WhatsApp
app.post('/api/channel/resolve', requireWebAuth, async (req, res) => {
  const { channelLink } = req.body;
  try {
    const result = await whatsapp.resolveChannel(channelLink);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Elenco canali gestiti dall'account WhatsApp collegato
app.get('/api/channel/my-channels', requireWebAuth, async (req, res) => {
  try {
    const channels = await whatsapp.getMyNewsletters();
    res.json({ success: true, channels });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Salva impostazioni canale WhatsApp
app.post('/api/channel/update', requireWebAuth, (req, res) => {
  const { link, jid, name, enabled } = req.body;
  const config = getConfig();
  const currentChannel = config.channel || {};

  const updatedChannel = {
    ...currentChannel,
    ...(link !== undefined && { link }),
    ...(jid !== undefined && { jid }),
    ...(name !== undefined && { name }),
    ...(enabled !== undefined && { enabled })
  };

  updateConfig({ channel: updatedChannel });
  instagram.startInstagramPolling();
  addLog('config', 'Impostazioni Canale WhatsApp aggiornate', { jid: updatedChannel.jid, name: updatedChannel.name });
  res.json({ success: true, channel: updatedChannel });
});

// Sincronizza subito i contenuti Instagram (Post, Caroselli, Reel) nel canale
app.post('/api/channel/sync-now', requireWebAuth, async (req, res) => {
  try {
    const { syncAll } = req.body;
    const result = await instagram.syncFeedToChannel({ syncAll: !!syncAll });
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Invia un messaggio di test nel canale
app.post('/api/channel/test-send', requireWebAuth, async (req, res) => {
  const config = getConfig();
  const channelJid = req.body.jid || config.channel?.jid;
  if (!channelJid) {
    return res.status(400).json({ success: false, error: 'Nessun JID canale specificato o salvato.' });
  }

  try {
    const imageUrl = req.body.imageUrl || (req.body.withImage ? 'https://picsum.photos/800/800' : null);
    const result = await whatsapp.sendToChannel(channelJid, {
      type: 'test',
      imageUrl,
      caption: imageUrl
        ? `🔔 Messaggio di Test con FOTO dal Bot WhatsApp Sacro Cuore!\n\nSe vedi questa foto, la sincronizzazione immagini è perfettamente funzionante!`
        : `🔔 Messaggio di Test dal Bot WhatsApp Sacro Cuore!\n\nIl collegamento con il canale è attivo e pronto a sincronizzare Post, Caroselli e Reel da Instagram.`
    });
    res.json({ success: true, result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Resetta cronologia post pubblicati nel canale
app.post('/api/channel/clear-history', requireWebAuth, (req, res) => {
  const config = getConfig();
  const currentChannel = config.channel || {};
  currentChannel.publishedPostIds = [];
  updateConfig({ channel: currentChannel });
  addLog('config', 'Cronologia post del canale azzerata');
  res.json({ success: true, message: 'Cronologia pubblicazioni canale azzerata con successo.' });
});

// Reset completo del canale (JID, link, nome e cronologia)
app.post('/api/channel/reset', requireWebAuth, (req, res) => {
  const resetChannel = {
    jid: '',
    name: '',
    link: '',
    enabled: false,
    publishedPostIds: []
  };
  updateConfig({ channel: resetChannel });
  addLog('config', 'Canale WhatsApp resettato completamente');
  res.json({ success: true, message: 'Canale WhatsApp resettato con successo. Puoi collegare un nuovo canale.' });
});

// ============================================================
// API PER GOOGLE APPS SCRIPT (whatsapp-api.js)
// POST /send e alias POST /api/send
// ============================================================

async function handleSendMessage(req, res) {
  const { numero, testo } = req.body;

  if (!numero) {
    return res.status(400).json({
      success: false,
      error: 'Parametro "numero" mancante'
    });
  }

  if (testo === undefined || testo === null) {
    return res.status(400).json({
      success: false,
      error: 'Parametro "testo" mancante'
    });
  }

  try {
    const result = await whatsapp.sendMessage(numero, testo);
    return res.status(200).json({
      success: true,
      message: 'Messaggio inviato con successo',
      messageId: result.messageId,
      to: result.to,
      timestamp: result.timestamp
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
}

app.post('/send', requireApiToken, handleSendMessage);
app.post('/api/send', requireApiToken, handleSendMessage);

// ============================================================
// WEBHOOK PER STORIE INSTAGRAM
// ============================================================

// Webhook generico (Zapier, Make, script)
app.post('/api/ig/story-webhook', async (req, res) => {
  try {
    const result = await instagram.handleWebhookStory(req.body);
    res.json({ success: true, result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Meta Graph API Webhook Handshake (hub.challenge)
app.get('/api/ig/meta-webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  const config = getConfig();

  const verifyToken = config.instagram?.webhookVerifyToken || 'sacrocuore_ig_token';

  if (mode === 'subscribe' && token === verifyToken) {
    console.log('✅ Webhook Meta verificato con successo!');
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// Meta Graph API Webhook Event Receiver
app.post('/api/ig/meta-webhook', async (req, res) => {
  try {
    console.log('📩 Ricevuto evento Webhook Meta:', JSON.stringify(req.body).substring(0, 100));
    // Quando Meta invia un evento per Instagram, avvia una sincronizzazione storie
    await instagram.syncStoriesFromMeta().catch(() => {});
    res.status(200).send('EVENT_RECEIVED');
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// Health check per Render / monitor
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// Avvia server e WhatsApp bot
app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🚀 Server Sacro Cuore WhatsApp attivo sulla porta ${PORT}`);
  console.log(`🌍 URL Web: http://localhost:${PORT}`);
  console.log(`🔐 Accesso: admin@sacrocuoreasti.com | admin123`);
  console.log(`====================================================`);

  // Avvia connessione WhatsApp
  whatsapp.startWhatsApp();

  // Avvia eventuale polling Instagram
  instagram.startInstagramPolling();
});

// Prevenzione crash per timeout di rete o promise non gestite
process.on('unhandledRejection', (reason, promise) => {
  const msg = reason?.message || String(reason);
  if (!msg.includes('Timed Out') && !msg.includes('rate-overlimit')) {
    console.warn('⚠️ Unhandled Rejection intercettata:', msg);
  }
});

process.on('uncaughtException', (err) => {
  console.error('⚠️ Uncaught Exception intercettata:', err?.message || err);
});
