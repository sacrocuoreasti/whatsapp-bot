// Client Dashboard Application
let currentState = null;
let pollTimer = null;

// Gestione Toast Feedback
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerText = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 200);
  }, 2800);
}

// Aggiorna Interfaccia di Stato WhatsApp
function updateWhatsAppUI(status) {
  const badge = document.getElementById('wa-status-badge');
  const dot = badge.querySelector('.status-dot');
  const text = badge.querySelector('.status-text');

  const qrBox = document.getElementById('wa-qr-container');
  const connectedBox = document.getElementById('wa-connected-container');
  const qrImage = document.getElementById('qr-image');
  const qrLoading = document.getElementById('qr-loading-spinner');

  const userName = document.getElementById('wa-user-name');
  const userPhone = document.getElementById('wa-user-phone');
  const rebootStatus = document.getElementById('reboot-notified-status');

  badge.className = 'badge';

  if (status.state === 'CONNECTED') {
    badge.classList.add('badge-connected');
    text.textContent = 'Connesso';

    qrBox.style.display = 'none';
    connectedBox.style.display = 'flex';

    if (status.user) {
      userName.textContent = status.user.name || 'Bot Sacro Cuore';
      userPhone.textContent = status.user.phone ? `+${status.user.phone}` : '+39...';
    }

    if (status.hasSentRebootNotification) {
      rebootStatus.textContent = '✅ Notifica riavvio inviata all\'amministratore';
    } else {
      rebootStatus.textContent = '⏳ In attesa invio notifica riavvio...';
    }
  } else {
    // Non connesso: mostra area QR
    connectedBox.style.display = 'none';
    qrBox.style.display = 'flex';

    if (status.qrCode) {
      badge.classList.add('badge-waiting');
      text.textContent = 'Scansiona QR';
      if (qrImage.getAttribute('src') !== status.qrCode) {
        qrImage.src = status.qrCode;
      }
      qrImage.style.display = 'block';
      qrLoading.style.display = 'none';
    } else if (status.state === 'CONNECTING') {
      badge.classList.add('badge-waiting');
      text.textContent = 'Connessione in corso...';
      qrImage.style.display = 'none';
      qrLoading.style.display = 'flex';
      const label = qrLoading.querySelector('span');
      if (label) label.textContent = 'Connessione e autorizzazione in corso...';
    } else {
      badge.classList.add('badge-disconnected');
      text.textContent = 'Non Connesso';
      qrImage.style.display = 'none';
      qrLoading.style.display = 'flex';
      const label = qrLoading.querySelector('span');
      if (label) label.textContent = 'In attesa del codice QR...';
    }

    rebootStatus.textContent = '⏸ In attesa connessione per notifica riavvio';
  }
}

// Aggiorna Credenziali e Snippet Google Script
function updateApiDetails(status) {
  const urlInput = document.getElementById('api-url-input');
  const tokenInput = document.getElementById('api-token-input');
  const scriptCode = document.getElementById('script-code-block');
  const webhookInput = document.getElementById('ig-webhook-url');

  const fullUrl = status.serverUrl || window.location.origin;

  urlInput.value = fullUrl;
  if (status.apiToken) {
    tokenInput.value = status.apiToken;
  }
  webhookInput.value = `${fullUrl}/api/ig/story-webhook`;

  scriptCode.textContent = 
`// Incolla in Google Apps Script per configurare l'invio WhatsApp:
PropertiesService.getScriptProperties().setProperties({
  'WHATSAPP_API_URL': '${fullUrl}',
  'WHATSAPP_API_TOKEN': '${status.apiToken || '...'}'
});`;
}

// Recupera Stato WhatsApp dal Server
async function fetchStatus() {
  try {
    const res = await fetch('/api/whatsapp/status');
    if (res.status === 401) {
      window.location.href = '/login';
      return;
    }
    const data = await res.json();
    currentState = data;
    updateWhatsAppUI(data);
    updateApiDetails(data);
  } catch (err) {
    console.error('Errore durante fetch status:', err);
  }
}

// Recupera Configurazione e Log
async function fetchConfigAndLogs() {
  try {
    const res = await fetch('/api/config');
    if (res.ok) {
      const config = await res.json();
      if (config.adminNotifyNumber) {
        document.getElementById('admin-notify-number').value = config.adminNotifyNumber;
      }

      // Popola campi Meta Instagram
      if (config.instagram) {
        const ig = config.instagram;
        if (ig.appId) {
          const appIdElem = document.getElementById('meta-app-id');
          if (appIdElem) appIdElem.value = ig.appId;
        }
        if (ig.metaAccessToken) {
          document.getElementById('meta-access-token').value = ig.metaAccessToken;
        }
        if (ig.instagramAccountId) {
          document.getElementById('meta-account-id').value = ig.instagramAccountId;
        }
        document.getElementById('meta-sync-enabled').checked = !!ig.enabled;

        const fullUrl = config.serverUrl || window.location.origin;
        const cbElem = document.getElementById('meta-webhook-callback-url');
        const vtElem = document.getElementById('meta-webhook-verify-token');
        if (cbElem) cbElem.textContent = `${fullUrl}/api/ig/meta-webhook`;
        if (vtElem) vtElem.textContent = ig.webhookVerifyToken || 'sacrocuore_ig_token';
      }

      // Popola impostazioni Canale WhatsApp
      if (config) {
        const mode = config.activeChannelMode || 'test';
        const radio = document.querySelector(`input[name="channelModeRadio"][value="${mode}"]`);
        if (radio) radio.checked = true;

        // Aggiorna stile visivo delle card
        ['test', 'official', 'both'].forEach(m => {
          const card = document.getElementById(`card-channel-${m}`);
          if (card) {
            if (m === mode) {
              card.style.border = '2px solid #3b82f6';
              card.style.background = 'rgba(59, 130, 246, 0.15)';
            } else {
              card.style.border = '1px solid rgba(148, 163, 184, 0.3)';
              card.style.background = 'rgba(15, 23, 42, 0.6)';
            }
          }
        });

        const syncElem = document.getElementById('channel-sync-enabled');
        if (syncElem && config.channel) syncElem.checked = (config.channel.enabled !== false);
      }

      renderLogs(config.logs || []);
    }
  } catch (err) {
    console.error('Errore fetch config:', err);
  }
}

// Renderizza Stream Log
function renderLogs(logs) {
  const container = document.getElementById('log-container');
  if (!logs || logs.length === 0) {
    container.innerHTML = '<div class="log-empty">Nessuna attività recente registrata.</div>';
    return;
  }

  container.innerHTML = logs.map(l => {
    const timeStr = new Date(l.timestamp).toLocaleTimeString('it-IT');
    const badgeClass = `log-badge-${l.type || 'info'}`;
    return `
      <div class="log-item">
        <span class="log-time">${timeStr}</span>
        <span class="log-badge ${badgeClass}">${l.type || 'INFO'}</span>
        <span class="log-msg">${escapeHtml(l.message)}</span>
      </div>
    `;
  }).join('');
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>"']/g, function(m) {
    return {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    }[m];
  });
}

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {

  // Inizia polling stato
  fetchStatus();
  fetchConfigAndLogs();
  fetchStatusesList();
  pollTimer = setInterval(fetchStatus, 2000);

  // Copia negli Appunti
  document.querySelectorAll('.btn-copy').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-target');
      const input = document.getElementById(targetId);
      if (input) {
        navigator.clipboard.writeText(input.value).then(() => {
          showToast('Copiato negli appunti!', 'success');
        });
      }
    });
  });

  // Copia Codice Google Script
  document.getElementById('btn-copy-script').addEventListener('click', () => {
    const code = document.getElementById('script-code-block').textContent;
    navigator.clipboard.writeText(code).then(() => {
      showToast('Snippet Google Script copiato!', 'success');
    });
  });

  // Mostra / Nascondi Token
  const tokenInput = document.getElementById('api-token-input');
  document.getElementById('btn-toggle-token').addEventListener('click', () => {
    if (tokenInput.type === 'password') {
      tokenInput.type = 'text';
    } else {
      tokenInput.type = 'password';
    }
  });

  // Scollega WhatsApp
  document.getElementById('btn-disconnect').addEventListener('click', async () => {
    if (!confirm('Vuoi davvero scollegare WhatsApp? La sessione verrà chiusa e dovrai scansionare nuovamente il codice QR.')) {
      return;
    }

    const btn = document.getElementById('btn-disconnect');
    btn.disabled = true;
    showToast('Scollegamento in corso...', 'info');

    try {
      const res = await fetch('/api/whatsapp/disconnect', { method: 'POST' });
      const data = await res.json();
      showToast(data.message || 'WhatsApp scollegato con successo', 'success');
      setTimeout(fetchStatus, 1000);
    } catch (err) {
      showToast('Errore durante la disconnessione', 'error');
    } finally {
      btn.disabled = false;
    }
  });

  // Ricarica QR / Riavvia socket
  const handleReconnect = async () => {
    showToast('Riavvio socket Baileys...', 'info');
    try {
      await fetch('/api/whatsapp/reconnect', { method: 'POST' });
      setTimeout(fetchStatus, 1500);
    } catch (err) {
      showToast('Errore durante il riavvio', 'error');
    }
  };

  document.getElementById('btn-refresh-qr').addEventListener('click', handleReconnect);
  document.getElementById('btn-reconnect').addEventListener('click', handleReconnect);

  // Richiesta Codice di Accoppiamento Telefonico (Pairing Code)
  const btnPairing = document.getElementById('btn-request-pairing-code');
  if (btnPairing) {
    btnPairing.addEventListener('click', async () => {
      const phoneInput = document.getElementById('pairing-phone-input');
      let phone = phoneInput.value.trim().replace(/[^0-9]/g, '');
      const codeDisplay = document.getElementById('pairing-code-display');
      const codeValue = document.getElementById('pairing-code-value');

      if (!phone) {
        showToast('Inserisci il tuo numero di telefono', 'warning');
        return;
      }

      // Auto-prefisso 39 per numeri italiani di 10 cifre
      if (phone.startsWith('3') && phone.length === 10) {
        phone = '39' + phone;
        phoneInput.value = phone;
      }

      btnPairing.disabled = true;
      btnPairing.textContent = 'Generazione...';
      showToast(`Richiesta codice per +${phone}...`, 'info');

      try {
        const res = await fetch('/api/whatsapp/pairing-code', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phoneNumber: phone })
        });
        const data = await res.json();

        if (res.ok && data.success && data.code) {
          codeValue.textContent = data.code;
          codeDisplay.style.display = 'block';
          showToast(`Codice per +${data.phoneNumber} pronto! Inseriscilo su WhatsApp.`, 'success');
        } else {
          showToast(data.error || 'Impossibile generare il codice', 'error');
        }
      } catch (err) {
        showToast('Errore di comunicazione col server', 'error');
      } finally {
        btnPairing.disabled = false;
        btnPairing.textContent = 'Richiedi Codice';
      }
    });
  }

  // Rigenera API Token
  document.getElementById('btn-regenerate-token').addEventListener('click', async () => {
    if (!confirm('Se rigeneri il token, dovrai aggiornare la proprietà WHATSAPP_API_TOKEN in Google Apps Script. Continuare?')) {
      return;
    }

    try {
      const res = await fetch('/api/config/regenerate-token', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showToast('Nuovo token API generato con successo!', 'success');
        fetchStatus();
      }
    } catch (err) {
      showToast('Errore rigenerazione token', 'error');
    }
  });

  // Test invio messaggio da form
  const testForm = document.getElementById('test-send-form');
  testForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('btn-send-test');
    const btnText = btn.querySelector('.btn-text');
    const spinner = btn.querySelector('.spinner');
    const resultBox = document.getElementById('test-result');

    const numero = document.getElementById('test-number').value.trim();
    const testo = document.getElementById('test-message').value.trim();

    btn.disabled = true;
    btnText.style.display = 'none';
    spinner.style.display = 'inline-block';
    resultBox.style.display = 'none';

    try {
      const res = await fetch('/api/whatsapp/test-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ numero, testo })
      });

      const data = await res.json();

      if (res.ok && data.success) {
        resultBox.className = 'test-result-box success';
        resultBox.innerHTML = `✅ <strong>Inviato con successo!</strong><br>Destinatario: ${data.to} (ID: ${data.messageId || 'ok'})`;
        showToast('Messaggio inviato con successo!', 'success');
      } else {
        resultBox.className = 'test-result-box error';
        resultBox.innerHTML = `❌ <strong>Errore invio:</strong> ${data.error || 'Invio fallito'}`;
        showToast('Errore nell\'invio del messaggio', 'error');
      }
      resultBox.style.display = 'block';
    } catch (err) {
      resultBox.className = 'test-result-box error';
      resultBox.textContent = 'Errore di connessione col server.';
      resultBox.style.display = 'block';
    } finally {
      btn.disabled = false;
      btnText.style.display = 'inline-block';
      spinner.style.display = 'none';
      fetchConfigAndLogs();
    }
  });

  // Salva numero per notifica di riavvio
  document.getElementById('reboot-config-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const adminNotifyNumber = document.getElementById('admin-notify-number').value.trim();

    try {
      const res = await fetch('/api/config/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminNotifyNumber })
      });
      if (res.ok) {
        showToast('Numero per notifica riavvio salvato!', 'success');
      }
    } catch (err) {
      showToast('Errore salvataggio numero', 'error');
    }
  });

  // Pubblica Stato WhatsApp da Dashboard
  const statusForm = document.getElementById('post-status-form');
  statusForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('btn-publish-status');
    const btnText = btn.querySelector('.btn-text');
    const spinner = btn.querySelector('.spinner');

    const imageUrl = document.getElementById('status-image-url').value.trim();
    const caption = document.getElementById('status-caption').value.trim();

    if (!imageUrl && !caption) {
      showToast('Inserisci un URL immagine o una didascalia.', 'error');
      return;
    }

    btn.disabled = true;
    btnText.style.display = 'none';
    spinner.style.display = 'inline-block';

    try {
      const res = await fetch('/api/whatsapp/post-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: imageUrl || undefined, caption })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        showToast('Stato WhatsApp pubblicato con successo!', 'success');
        statusForm.reset();
      } else {
        showToast(data.error || 'Errore nella pubblicazione dello stato', 'error');
      }
    } catch (err) {
      showToast('Errore durante la pubblicazione dello stato', 'error');
    } finally {
      btn.disabled = false;
      btnText.style.display = 'inline-block';
      spinner.style.display = 'none';
      fetchConfigAndLogs();
    }
  });

  // Mostra / Nascondi Token Meta
  const metaTokenInput = document.getElementById('meta-access-token');
  document.getElementById('btn-toggle-meta-token').addEventListener('click', () => {
    if (metaTokenInput.type === 'password') {
      metaTokenInput.type = 'text';
    } else {
      metaTokenInput.type = 'password';
    }
  });

  // Rileva in automatico Account Instagram dal token Meta
  document.getElementById('btn-detect-ig-account').addEventListener('click', async () => {
    const accessToken = metaTokenInput.value.trim();
    if (!accessToken) {
      showToast('Inserisci prima il Meta Access Token.', 'error');
      return;
    }

    const btn = document.getElementById('btn-detect-ig-account');
    btn.disabled = true;
    showToast('Interrogazione Meta Graph API in corso...', 'info');

    try {
      const res = await fetch('/api/instagram/detect-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        document.getElementById('meta-account-id').value = data.accountId;
        const hint = document.getElementById('detected-account-hint');
        hint.innerHTML = `✅ Trovato: <strong>@${escapeHtml(data.username || '')}</strong> (Pagina: ${escapeHtml(data.pageName || 'Collegata')})`;
        showToast(`Account trovato: @${data.username || data.accountId}`, 'success');
      } else {
        showToast(data.error || 'Impossibile rilevare l\'account Instagram.', 'error');
      }
    } catch (err) {
      showToast('Errore di connessione durante la verifica token.', 'error');
    } finally {
      btn.disabled = false;
    }
  });

  // Salva Impostazioni Meta Graph API
  document.getElementById('meta-api-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const appId = document.getElementById('meta-app-id')?.value.trim() || '';
    const metaAccessToken = metaTokenInput.value.trim();
    const instagramAccountId = document.getElementById('meta-account-id').value.trim();
    const enabled = document.getElementById('meta-sync-enabled').checked;

    try {
      const res = await fetch('/api/instagram/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId, metaAccessToken, instagramAccountId, enabled })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        showToast('Impostazioni Meta salvate con successo!', 'success');
        fetchConfigAndLogs();
      } else {
        showToast('Errore nel salvataggio delle impostazioni Meta.', 'error');
      }
    } catch (err) {
      showToast('Errore di comunicazione col server.', 'error');
    }
  });

  // Sincronizza Storie Adesso
  document.getElementById('btn-sync-stories-now').addEventListener('click', async () => {
    const btn = document.getElementById('btn-sync-stories-now');
    const btnText = btn.querySelector('.btn-text');
    const spinner = btn.querySelector('.spinner');
    const resultBox = document.getElementById('meta-sync-result');

    btn.disabled = true;
    btnText.style.display = 'none';
    spinner.style.display = 'inline-block';
    resultBox.style.display = 'none';

    try {
      const res = await fetch('/api/instagram/sync-now', { method: 'POST' });
      const data = await res.json();

      if (res.ok && data.success) {
        resultBox.className = 'test-result-box success';
        resultBox.innerHTML = `✅ <strong>Sincronizzazione completata!</strong><br>${data.message}`;
        showToast('Sincronizzazione storie completata!', 'success');
      } else {
        resultBox.className = 'test-result-box error';
        resultBox.innerHTML = `❌ <strong>Errore sincronizzazione:</strong> ${data.error || 'Operazione fallita'}`;
        showToast(data.error || 'Errore sincronizzazione', 'error');
      }
      resultBox.style.display = 'block';
    } catch (err) {
      resultBox.className = 'test-result-box error';
      resultBox.textContent = 'Errore di connessione col server.';
      resultBox.style.display = 'block';
    } finally {
      btn.disabled = false;
      btnText.style.display = 'inline-block';
      spinner.style.display = 'none';
      fetchConfigAndLogs();
      fetchStatusesList();
    }
  });

  // Recupera elenco stati pubblicati
  async function fetchStatusesList() {
    try {
      const res = await fetch('/api/whatsapp/statuses');
      if (res.ok) {
        const data = await res.json();
        const container = document.getElementById('statuses-list-container');
        if (!data.statuses || data.statuses.length === 0) {
          container.innerHTML = '<div class="log-empty">Nessuno stato registrato di recente.</div>';
          return;
        }
        container.innerHTML = data.statuses.map(s => {
          const timeStr = new Date(s.timestamp).toLocaleTimeString('it-IT');
          return `
            <div class="log-item" style="justify-content: space-between; align-items: center;">
              <div>
                <span class="log-time">${timeStr}</span>
                <span class="log-badge log-badge-info">${s.type}</span>
                <span class="log-msg">${escapeHtml(s.caption || s.id)}</span>
                <code style="font-size: 0.7rem; color: #9ca3af;">(${s.id})</code>
              </div>
              <button class="btn btn-outline-danger btn-xs btn-del-stat" data-id="${s.id}">Elimina</button>
            </div>
          `;
        }).join('');

        container.querySelectorAll('.btn-del-stat').forEach(b => {
          b.addEventListener('click', async () => {
            const id = b.getAttribute('data-id');
            if (confirm(`Vuoi davvero eliminare questo stato (${id}) da WhatsApp?`)) {
              await deleteStatusById(id);
            }
          });
        });
      }
    } catch (e) {
      console.error('Errore fetch stati:', e);
    }
  }

  async function deleteStatusById(id) {
    showToast('Eliminazione stato in corso...', 'info');
    try {
      const res = await fetch('/api/whatsapp/delete-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast('Stato eliminato con successo da WhatsApp!', 'success');
        fetchStatusesList();
        fetchConfigAndLogs();
      } else {
        showToast(data.error || 'Errore eliminazione stato', 'error');
      }
    } catch (e) {
      showToast('Errore di comunicazione col server', 'error');
    }
  }

  // Elimina tutti gli stati
  document.getElementById('btn-delete-all-statuses').addEventListener('click', async () => {
    if (!confirm('Vuoi davvero eliminare TUTTI gli stati attivi pubblicati su WhatsApp?')) {
      return;
    }
    const btn = document.getElementById('btn-delete-all-statuses');
    btn.disabled = true;
    showToast('Invio richiesta eliminazione a WhatsApp...', 'info');

    try {
      const res = await fetch('/api/whatsapp/delete-all-statuses', { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast(`Eliminati con successo ${data.count} stati da WhatsApp!`, 'success');
        fetchStatusesList();
        fetchConfigAndLogs();
      } else {
        showToast(data.error || 'Errore durante l\'eliminazione', 'error');
      }
    } catch (e) {
      showToast('Errore di connessione', 'error');
    } finally {
      btn.disabled = false;
    }
  });

  // Elimina singolo stato da input
  document.getElementById('btn-delete-single-status').addEventListener('click', async () => {
    const input = document.getElementById('delete-single-status-id');
    const id = input.value.trim();
    if (!id) {
      showToast('Inserisci l\'ID del messaggio da eliminare.', 'error');
      return;
    }
    await deleteStatusById(id);
    input.value = '';
  });

  document.getElementById('btn-refresh-statuses-list').addEventListener('click', fetchStatusesList);

  // ==========================================
  // CANALE WHATSAPP EVENT LISTENERS
  // =======================  // Cambio visivo immediato al clic sui radio canali
  document.querySelectorAll('input[name="channelModeRadio"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      const mode = e.target.value;
      ['test', 'official', 'both'].forEach(m => {
        const card = document.getElementById(`card-channel-${m}`);
        if (card) {
          if (m === mode) {
            card.style.border = '2px solid #3b82f6';
            card.style.background = 'rgba(59, 130, 246, 0.15)';
          } else {
            card.style.border = '1px solid rgba(148, 163, 184, 0.3)';
            card.style.background = 'rgba(15, 23, 42, 0.6)';
          }
        }
      });
    });
  });

  // Salva Destinazione Canale
  document.getElementById('btn-save-channel-mode').addEventListener('click', async () => {
    const selectedRadio = document.querySelector('input[name="channelModeRadio"]:checked');
    const activeChannelMode = selectedRadio ? selectedRadio.value : 'test';
    const enabled = document.getElementById('channel-sync-enabled').checked;

    const btn = document.getElementById('btn-save-channel-mode');
    btn.disabled = true;
    showToast('Salvataggio destinazione canale...', 'info');

    try {
      const res = await fetch('/api/channel/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activeChannelMode, enabled })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast(`Destinazione impostata su: ${activeChannelMode.toUpperCase()}!`, 'success');
        fetchConfigAndLogs();
      } else {
        showToast(data.error || 'Errore salvataggio destinazione.', 'error');
      }
    } catch (err) {
      showToast('Errore di connessione col server.', 'error');
    } finally {
      btn.disabled = false;
    }
  });

  // Helper per invio test canale
  async function runChannelTest(btn, channelType, withImage = false) {
    btn.disabled = true;
    const label = channelType === 'official' ? 'Ufficiale' : 'Test';
    showToast(`Invio ${withImage ? 'foto' : 'messaggio'} al Canale ${label}...`, 'info');

    try {
      const res = await fetch('/api/channel/test-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelType, withImage })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast(`✅ ${withImage ? 'Foto' : 'Messaggio'} inviato con successo al canale ${label}!`, 'success');
        fetchConfigAndLogs();
      } else {
        showToast(data.error || `Errore invio a canale ${label}.`, 'error');
      }
    } catch (err) {
      showToast('Errore di comunicazione col server.', 'error');
    } finally {
      btn.disabled = false;
    }
  }

  // Pulsanti Test Canale Test
  document.getElementById('btn-test-channel-test').addEventListener('click', (e) => {
    runChannelTest(e.currentTarget, 'test', false);
  });
  document.getElementById('btn-test-photo-channel-test').addEventListener('click', (e) => {
    runChannelTest(e.currentTarget, 'test', true);
  });

  // Pulsanti Test Canale Ufficiale
  document.getElementById('btn-test-channel-official').addEventListener('click', (e) => {
    runChannelTest(e.currentTarget, 'official', false);
  });
  document.getElementById('btn-test-photo-channel-official').addEventListener('click', (e) => {
    runChannelTest(e.currentTarget, 'official', true);
  });

  // Sincronizza Canale Adesso
  document.getElementById('btn-sync-channel-now').addEventListener('click', async () => {
    const btn = document.getElementById('btn-sync-channel-now');
    const btnText = btn.querySelector('.btn-text');
    const spinner = btn.querySelector('.spinner');
    const resultBox = document.getElementById('channel-result-box');

    btn.disabled = true;
    btnText.style.display = 'none';
    spinner.style.display = 'inline-block';
    resultBox.style.display = 'none';

    try {
      const res = await fetch('/api/channel/sync-now', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const data = await res.json();

      if (res.ok && data.success) {
        resultBox.className = 'test-result-box success';
        resultBox.innerHTML = `✅ <strong>Sincronizzazione Canale Completata!</strong><br>${data.message}`;
        showToast('Canale WhatsApp sincronizzato!', 'success');
      } else {
        resultBox.className = 'test-result-box error';
        resultBox.innerHTML = `❌ <strong>Errore:</strong> ${data.error || 'Operazione fallita'}`;
        showToast(data.error || 'Errore sincronizzazione canale', 'error');
      }
      resultBox.style.display = 'block';
    } catch (err) {
      resultBox.className = 'test-result-box error';
      resultBox.textContent = 'Errore di connessione col server.';
      resultBox.style.display = 'block';
    } finally {
      btn.disabled = false;
      btnText.style.display = 'inline-block';
      spinner.style.display = 'none';
    }
  });

  // Azzera Cronologia Post Canale
  document.getElementById('btn-clear-channel-history').addEventListener('click', async () => {
    if (!confirm('Vuoi azzerare la cronologia dei post pubblicati nel canale? La prossima sincronizzazione rileverà nuovamente i post da pubblicare.')) {
      return;
    }
    try {
      const res = await fetch('/api/channel/clear-history', { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast('Cronologia post del canale azzerata!', 'success');
        fetchConfigAndLogs();
      } else {
        showToast(data.error || 'Errore azzeramento cronologia.', 'error');
      }
    } catch (err) {
      showToast('Errore di comunicazione col server.', 'error');
    }
  });

  // Reset Completo Canale
  const btnResetChannel = document.getElementById('btn-reset-channel');
  if (btnResetChannel) {
    btnResetChannel.addEventListener('click', async () => {
      if (!confirm('Vuoi resettare completamente il Canale WhatsApp? Verranno rimossi JID, link, nome e tutta la cronologia post memorizzata.')) {
        return;
      }
      try {
        const res = await fetch('/api/channel/reset', { method: 'POST' });
        const data = await res.json();
        if (res.ok && data.success) {
          showToast('Canale resettato con successo!', 'success');
          document.getElementById('channel-link').value = '';
          document.getElementById('channel-jid').value = '';
          document.getElementById('channel-name').value = '';
          fetchConfigAndLogs();
        } else {
          showToast(data.error || 'Errore reset canale.', 'error');
        }
      } catch (err) {
        showToast('Errore di comunicazione col server.', 'error');
      }
    });
  }

  // Tabs
  document.querySelectorAll('.tab-btn').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      const target = document.getElementById(tab.getAttribute('data-tab'));
      if (target) target.classList.add('active');
    });
  });

  // Aggiorna Log manuale
  document.getElementById('btn-refresh-logs').addEventListener('click', fetchConfigAndLogs);

  // Logout
  document.getElementById('btn-logout').addEventListener('click', async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      window.location.href = '/login';
    } catch (err) {
      window.location.href = '/login';
    }
  });

});
