const axios = require('axios');
const { getConfig, updateConfig, addLog } = require('./config');
const { postWhatsAppStatus, sendToChannel } = require('./whatsapp');

let pollInterval = null;
const GRAPH_API_VERSION = 'v21.0';

// Rileva in automatico l'ID dell'account Instagram dal token (supporta sia Instagram Login che Meta Pages)
async function detectInstagramAccount(accessToken) {
  if (!accessToken) {
    throw new Error('Access Token non fornito.');
  }

  const errors = [];

  // 1. Priorità: Instagram Login (endpoint graph.instagram.com)
  try {
    const urlIg = `https://graph.instagram.com/v21.0/me?fields=id,user_id,username,account_type&access_token=${accessToken}`;
    const resIg = await axios.get(urlIg);
    if (resIg.data?.id || resIg.data?.user_id) {
      return {
        success: true,
        accountId: resIg.data.id || resIg.data.user_id,
        username: resIg.data.username || 'Utente Instagram',
        accountType: resIg.data.account_type || 'Instagram Login',
        source: 'Instagram Login (graph.instagram.com)'
      };
    }
  } catch (errIg) {
    errors.push(`graph.instagram.com: ${errIg.response?.data?.error?.message || errIg.message}`);
  }

  // 2. Prova tramite Meta Facebook Pages con account IG collegato
  try {
    const urlPages = `https://graph.facebook.com/${GRAPH_API_VERSION}/me/accounts?fields=name,instagram_business_account{id,username,name}&access_token=${accessToken}`;
    const resPages = await axios.get(urlPages);
    if (resPages.data?.data?.length > 0) {
      for (const page of resPages.data.data) {
        if (page.instagram_business_account) {
          const ig = page.instagram_business_account;
          return {
            success: true,
            accountId: ig.id,
            username: ig.username || ig.name,
            pageName: page.name,
            source: 'Meta Business Page'
          };
        }
      }
    }
  } catch (errPages) {
    errors.push(`graph.facebook.com/me/accounts: ${errPages.response?.data?.error?.message || errPages.message}`);
  }

  // 3. Prova tramite graph.facebook.com /me diretto
  try {
    const urlDirect = `https://graph.facebook.com/${GRAPH_API_VERSION}/me?fields=id,username,name&access_token=${accessToken}`;
    const resDirect = await axios.get(urlDirect);
    if (resDirect.data?.id) {
      return {
        success: true,
        accountId: resDirect.data.id,
        username: resDirect.data.username || resDirect.data.name,
        source: 'Meta Direct User'
      };
    }
  } catch (errDirect) {
    errors.push(`graph.facebook.com/me: ${errDirect.response?.data?.error?.message || errDirect.message}`);
  }

  throw new Error(`Impossibile rilevare account. Dettaglio: ${errors.join(' | ')}`);
}

// Recupera e sincronizza le storie attive da Instagram Login o Meta Graph API
async function syncStoriesFromMeta() {
  const config = getConfig();
  const igConfig = config.instagram || {};

  const token = igConfig.metaAccessToken;
  const accountId = igConfig.instagramAccountId || 'me';

  if (!token) {
    throw new Error('Access Token di Instagram/Meta non configurato.');
  }

  // Endpoints candidati in base alla tipologia di App Meta (Instagram Login vs Meta Business)
  const candidateUrls = [
    `https://graph.instagram.com/v21.0/me/stories?fields=id,media_type,media_url,timestamp,caption,permalink&access_token=${token}`,
    `https://graph.instagram.com/v21.0/${accountId}/stories?fields=id,media_type,media_url,timestamp,caption,permalink&access_token=${token}`,
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${accountId}/stories?fields=id,media_type,media_url,timestamp,caption,permalink&access_token=${token}`,
    `https://graph.facebook.com/${GRAPH_API_VERSION}/me/stories?fields=id,media_type,media_url,timestamp,caption,permalink&access_token=${token}`
  ];

  let stories = null;
  let lastError = null;

  for (const url of candidateUrls) {
    try {
      const res = await axios.get(url);
      if (res.data && Array.isArray(res.data.data)) {
        stories = res.data.data;
        break; // Trovato l'endpoint corretto che risponde
      }
    } catch (err) {
      lastError = err.response?.data?.error?.message || err.message;
    }
  }

  if (stories === null) {
    addLog('error', `Errore interrogazione storie Instagram: ${lastError}`);
    throw new Error(`Errore recupero storie: ${lastError || 'Nessun endpoint ha risposto con successo.'}`);
  }

  if (stories.length === 0) {
    return {
      success: true,
      totalActiveStories: 0,
      newPublished: 0,
      message: 'Nessuna storia attiva attualmente su Instagram (le storie durano 24 ore).'
    };
  }

  const publishedIds = new Set(igConfig.publishedStoryIds || []);
  let newPublishedCount = 0;

  for (const story of stories) {
    if (!publishedIds.has(story.id)) {
      try {
        let mediaUrl = story.media_url;
        let isVideo = story.media_type === 'VIDEO';

        // Se media_url manca (comune nei video o storie senza permessi diretti al file video), interroga il singolo item
        if (!mediaUrl) {
          try {
            const singleUrl = `https://graph.instagram.com/v21.0/${story.id}?fields=id,media_type,media_url,thumbnail_url,caption&access_token=${token}`;
            const singleRes = await axios.get(singleUrl);
            if (singleRes.data) {
              mediaUrl = singleRes.data.media_url || singleRes.data.thumbnail_url;
              if (!singleRes.data.media_url && singleRes.data.thumbnail_url) {
                isVideo = false; // Pubblica come immagine la copertina/fotogramma del video
              }
            }
          } catch (singleErr) {
            console.error(`Impossibile recuperare dettagli per storia ${story.id}:`, singleErr.message);
          }
        }

        if (!mediaUrl) {
          console.warn(`Nessun URL multimediale reperibile per storia ${story.id}.`);
          continue;
        }

        await postWhatsAppStatus({
          imageUrl: isVideo ? null : mediaUrl,
          videoUrl: isVideo ? mediaUrl : null,
          caption: story.caption || `Storia Instagram @${igConfig.username || ''}`
        });

        publishedIds.add(story.id);
        newPublishedCount++;

        addLog('instagram', `Storia Instagram (${story.id}) pubblicata come stato WhatsApp`, {
          storyId: story.id,
          mediaType: isVideo ? 'VIDEO' : 'IMAGE',
          caption: story.caption
        });
      } catch (publishErr) {
        console.error(`Errore pubblicazione stato per storia ${story.id}:`, publishErr.message);
      }
    }
  }

  // Salva gli ID pubblicati
  igConfig.publishedStoryIds = Array.from(publishedIds).slice(-50);
  updateConfig({ instagram: igConfig });

  return {
    success: true,
    totalActiveStories: stories.length,
    newPublished: newPublishedCount,
    message: `Trovate ${stories.length} storie attive. Nuove pubblicate su WhatsApp: ${newPublishedCount}`
  };
}

// Gestione Webhook generico
async function handleWebhookStory(payload) {
  const config = getConfig();

  if (config.instagram.webhookVerifyToken && payload.secret) {
    if (payload.secret !== config.instagram.webhookVerifyToken) {
      throw new Error('Secret Webhook non valido');
    }
  }

  const imageUrl = payload.imageUrl || payload.image_url || payload.url;
  const videoUrl = payload.videoUrl || payload.video_url;
  const caption = payload.caption || payload.text || '';

  if (!imageUrl && !videoUrl && !caption) {
    throw new Error('Nessun contenuto multimediale o testo trovato nel webhook');
  }

  const result = await postWhatsAppStatus({
    imageUrl,
    videoUrl,
    caption
  });

  addLog('instagram', 'Storia Instagram inoltrata a Stato WhatsApp tramite Webhook', {
    hasMedia: !!(imageUrl || videoUrl),
    caption
  });

  return result;
}

// Sincronizza Post, Caroselli e Reel da Instagram al Canale WhatsApp
async function syncFeedToChannel(options = {}) {
  const config = getConfig();
  const igConfig = config.instagram || {};
  const channelConfig = config.channel || {};

  if (!channelConfig.jid) {
    throw new Error('Nessun canale WhatsApp configurato. Inserisci il link o JID del canale nelle impostazioni.');
  }

  const token = igConfig.metaAccessToken;
  if (!token) {
    throw new Error('Access Token di Instagram/Meta non configurato.');
  }

  const accountId = igConfig.instagramAccountId || 'me';

  // Endpoints per recuperare i media del feed (post, caroselli, reels)
  const candidateUrls = [
    `https://graph.instagram.com/v21.0/me/media?fields=id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,children{media_type,media_url}&access_token=${token}`,
    `https://graph.instagram.com/v21.0/${accountId}/media?fields=id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,children{media_type,media_url}&access_token=${token}`,
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${accountId}/media?fields=id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,children{media_type,media_url}&access_token=${token}`
  ];

  let mediaItems = null;
  let lastError = null;

  for (const url of candidateUrls) {
    try {
      const res = await axios.get(url);
      if (res.data && Array.isArray(res.data.data)) {
        mediaItems = res.data.data;
        break;
      }
    } catch (err) {
      lastError = err.response?.data?.error?.message || err.message;
    }
  }

  if (mediaItems === null) {
    addLog('error', `Errore recupero media Instagram per canale: ${lastError}`);
    throw new Error(`Errore recupero media Instagram: ${lastError || 'Nessun endpoint ha risposto con successo.'}`);
  }

  if (mediaItems.length === 0) {
    return {
      success: true,
      totalMedia: 0,
      newPublished: 0,
      message: 'Nessun post o reel trovato su Instagram.'
    };
  }

  const publishedIds = new Set(channelConfig.publishedPostIds || []);
  let newPublishedCount = 0;

  // Determina quali post elaborare:
  // Se è la primissima volta (nessun ID salvato) e non è forzato syncAll,
  // inviamo l'ultimo post (il più recente) e marchiamo tutti gli altri 24 come già noti,
  // evitando di inondare il canale con dozzine di vecchi post storici!
  let itemsToProcess = [];

  if (publishedIds.size === 0 && !options.syncAll) {
    const latestItem = mediaItems[0];
    itemsToProcess = [latestItem];
    mediaItems.forEach(item => publishedIds.add(item.id));
    publishedIds.delete(latestItem.id);
  } else {
    // Elabora dal più vecchio al più recente così appaiono in ordine temporale nel canale
    itemsToProcess = mediaItems.filter(item => !publishedIds.has(item.id)).reverse();
  }

  for (const item of itemsToProcess) {
    try {
      const mediaType = item.media_type;
      const caption = item.caption || '';
      const permalink = item.permalink || '';

      if (mediaType === 'IMAGE') {
        // - post ig -> foto + descrizione nel canale
        let imageUrl = item.media_url;
        if (!imageUrl) {
          try {
            const singleUrl = `https://graph.instagram.com/v21.0/${item.id}?fields=media_url,caption&access_token=${token}`;
            const sRes = await axios.get(singleUrl);
            imageUrl = sRes?.data?.media_url;
          } catch (e) {}
        }

        await sendToChannel(channelConfig.jid, {
          type: 'post',
          imageUrl,
          caption,
          link: permalink
        });
        publishedIds.add(item.id);
        newPublishedCount++;
      } else if (mediaType === 'CAROUSEL_ALBUM') {
        // - carosello ig -> foto + descrizione nel canale
        let imageUrl = item.children?.data?.[0]?.media_url || item.media_url;
        if (!imageUrl) {
          try {
            const singleUrl = `https://graph.instagram.com/v21.0/${item.id}?fields=media_url,children{media_type,media_url},caption&access_token=${token}`;
            const sRes = await axios.get(singleUrl);
            imageUrl = sRes?.data?.children?.data?.[0]?.media_url || sRes?.data?.media_url;
          } catch (e) {}
        }

        await sendToChannel(channelConfig.jid, {
          type: 'carosello',
          imageUrl,
          caption,
          link: permalink
        });
        publishedIds.add(item.id);
        newPublishedCount++;
      } else if (mediaType === 'VIDEO') {
        // - reel ig -> descrizione + link ig
        await sendToChannel(channelConfig.jid, {
          type: 'reel',
          caption,
          link: permalink
        });
        publishedIds.add(item.id);
        newPublishedCount++;
      }

      addLog('channel_post', `Pubblicato ${mediaType} nel canale WhatsApp`, {
        mediaType,
        caption: caption ? caption.substring(0, 50) : '',
        permalink
      });
    } catch (publishErr) {
      console.error(`Errore pubblicazione elemento ${item.id} su canale:`, publishErr.message);
      addLog('error', `Errore pubblicazione ${item.id} su canale: ${publishErr.message}`);
    }
  }

  channelConfig.publishedPostIds = Array.from(publishedIds).slice(-200);
  updateConfig({ channel: channelConfig });

  return {
    success: true,
    totalFound: mediaItems.length,
    newPublished: newPublishedCount,
    message: newPublishedCount > 0 
      ? `Pubblicati ${newPublishedCount} nuovi contenuti nel Canale WhatsApp.`
      : `Nessun nuovo post o reel da pubblicare nel canale.`
  };
}

// Avvia polling automatico
function startInstagramPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }

  const config = getConfig();
  const igConfig = config.instagram || {};
  const channelConfig = config.channel || {};

  const isIgActive = igConfig.enabled && igConfig.metaAccessToken;
  const isChannelActive = channelConfig.enabled && channelConfig.jid && igConfig.metaAccessToken;

  if (isIgActive || isChannelActive) {
    const minutes = Math.max(2, igConfig.checkIntervalMinutes || 5);
    console.log(`📸 Sincronizzazione automatica attiva ogni ${minutes} minuti (Storie: ${isIgActive ? 'SI' : 'NO'}, Canale: ${isChannelActive ? 'SI' : 'NO'}).`);

    pollInterval = setInterval(async () => {
      try {
        if (isIgActive) {
          await syncStoriesFromMeta().catch(err => console.error('Errore polling storie Instagram:', err.message));
        }
        if (isChannelActive) {
          await syncFeedToChannel().catch(err => console.error('Errore polling canale WhatsApp:', err.message));
        }
      } catch (err) {
        console.error('Errore durante il ciclo di polling:', err.message);
      }
    }, minutes * 60 * 1000);
  }
}

// Aggiorna impostazioni Instagram
function updateInstagramSettings(newSettings) {
  const config = getConfig();
  const updated = {
    ...config.instagram,
    ...newSettings
  };
  updateConfig({ instagram: updated });
  startInstagramPolling();
  return updated;
}

module.exports = {
  detectInstagramAccount,
  syncStoriesFromMeta,
  syncFeedToChannel,
  handleWebhookStory,
  startInstagramPolling,
  updateInstagramSettings
};
