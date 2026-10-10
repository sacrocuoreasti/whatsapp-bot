# WhatsApp Gateway & Baileys Bot – Sacro Cuore Asti

Gateway WhatsApp creato con **Node.js**, **Express** e **@whiskeysockets/baileys**, pronto per essere hostato su **Render** e integrato direttamente con **Google Apps Script** (`whatsapp-api.js`).

---

## 🌟 Funzionalità Incluse

1. **Homepage con Accesso Protetto**:
   - Accesso riservato con credenziali di amministrazione configurabili.
   - Pannello di controllo completo e reattivo in tempo reale.
2. **Collegamento & Scollegamento Rapido WhatsApp**:
   - Generazione dinamica del QR Code Baileys a schermo.
   - Disconnessione rapida ("Scollega WhatsApp") con azzeramento sessione per ricollegare all'istante un altro numero.
   - Monitoraggio dello stato in tempo reale (Non connesso, In attesa QR, Connesso).
3. **API per Google Apps Script (`whatsapp-api.js`)**:
   - Generazione e visualizzazione di `WHATSAPP_API_URL` e `WHATSAPP_API_TOKEN`.
   - Pulsanti per copia rapida e rigenerazione token.
   - Endpoint compatibile al 100% con `inviaWhatsApp(numero, testo)`:
     - `POST /send` (e `POST /api/send`)
     - Autenticazione: `Authorization: Bearer <WHATSAPP_API_TOKEN>`
     - Normalizzazione automatica dei numeri italiani (aggiunta automatica di `39` per numeri a 10 cifre che iniziano con `3`).
4. **Notifica di Avvenuto Riavvio**:
   - Ad ogni avvio/reboot del server, non appena la connessione WhatsApp viene stabilita, invia in automatico un messaggio di conferma al numero admin configurato.
5. **Storie Instagram &rarr; Stato WhatsApp (Meta Graph API Ufficiale)**:
   - Integrazione diretta con l'**App Meta for Business** tramite il tuo Token Graph API.
   - Rilevamento automatico dell'ID Account Instagram Business associato (`🔍 Rileva Account`).
   - Sincronizzazione automatica programmata che controlla le storie attive e le pubblica su WhatsApp solo se inedite.
   - Sincronizzazione automatica del feed/reel sul Canale WhatsApp associato.
   - Pulsante manuale per sincronizzare subito le storie e post attivi a schermo.
   - Webhook Meta opzionale per ricezione in tempo reale.
6. **Simulatore di Test Integrato**:
   - Permette di inviare messaggi di test direttamente dalla pagina web per verificare la funzionalità prima di lanciare Google Script.

---

## 🚀 Avvio in Locale

1. **Installa le dipendenze**:
   ```bash
   npm install
   ```
2. **Avvia il server**:
   ```bash
   npm start
   ```
3. **Apri il browser**:
   - Vai su: `http://localhost:3010`
   - Inserisci le tue credenziali admin configurate.
4. **Inquadra il QR Code**:
   - Apri WhatsApp sul telefono &rarr; Dispositivi collegati &rarr; Inquadra il QR code visualizzato a video.

---

## ☁️ Guida al Deploy su Render

1. Carica questa cartella su un repository **GitHub** (es. `whatsapp-bot`).
2. Accedi a [render.com](https://render.com) e crea un **New Web Service**.
3. Collega il tuo repository GitHub.
4. Imposta le seguenti opzioni:
   - **Environment:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start` (oppure `node server.js`)
   - **Plan:** Free oppure Starter (se vuoi aggiungere un Persistent Disk per mantenere la sessione WhatsApp tra un deploy e l'altro, seleziona Starter e monta `/opt/render/project/src/baileys_auth_info`).
5. Clicca su **Deploy Web Service**.
6. Una volta terminato, Render ti fornirà un URL pubblico (es. `https://tuo-servizio.onrender.com`).
7. Apri l'URL, esegui il login, scansiona il QR code e copia `WHATSAPP_API_URL` e `WHATSAPP_API_TOKEN` nel tuo Google Apps Script!

---

## 🔗 Collegamento con Google Apps Script (`whatsapp-api.js`)

Nel file `whatsapp-api.js`, la funzione `inviaWhatsApp` legge:
```javascript
const properties = PropertiesService.getScriptProperties();
const apiUrl = properties.getProperty('WHATSAPP_API_URL');
const apiToken = properties.getProperty('WHATSAPP_API_TOKEN');
```

Per impostarli istantaneamente:
1. Apri il tuo progetto in Google Apps Script.
2. Incolla ed esegui questa funzione con i valori che trovi nella dashboard:
   ```javascript
   function configuraWhatsApp() {
     PropertiesService.getScriptProperties().setProperties({
       'WHATSAPP_API_URL': 'https://tuo-servizio.onrender.com',
       'WHATSAPP_API_TOKEN': 'IL_TUO_TOKEN_DALLA_DASHBOARD'
     });
     Logger.log('Proprietà salvate con successo!');
   }
   ```
3. Fai clic su `Esegui` per `testInviaWhatsApp()`: il messaggio verrà recapitato immediatamente al numero destinatario configurato!
