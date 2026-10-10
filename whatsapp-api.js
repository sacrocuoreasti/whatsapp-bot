function inviaWhatsApp(numero, testo) {

    const properties = PropertiesService.getScriptProperties();

    const apiUrl = properties.getProperty('WHATSAPP_API_URL');
    const apiToken = properties.getProperty('WHATSAPP_API_TOKEN');

    if (!apiUrl) {
        throw new Error('Manca la proprietà WHATSAPP_API_URL');
    }

    if (!apiToken) {
        throw new Error('Manca la proprietà WHATSAPP_API_TOKEN');
    }

    // ============================================================
    // NORMALIZZAZIONE NUMERO
    // ============================================================

    numero = String(numero)
        .trim()
        .replace(/\s+/g, '')
        .replace(/^\+/, '');

    // Se è un numero italiano in formato nazionale:
    // 3358484035 → 393358484035
    if (numero.startsWith('3') && numero.length === 10) {
        numero = '39' + numero;
    }

    console.log('Numero WhatsApp normalizzato:', numero);

    // ============================================================
    // PREPARAZIONE RICHIESTA
    // ============================================================

    const payload = {
        numero: numero,
        testo: String(testo)
    };

    const options = {
        method: 'post',
        contentType: 'application/json',

        headers: {
            Authorization: 'Bearer ' + apiToken
        },

        payload: JSON.stringify(payload),

        muteHttpExceptions: true
    };

    // ============================================================
    // INVIO ALL'API
    // ============================================================

    const response = UrlFetchApp.fetch(
        apiUrl + '/send',
        options
    );

    const statusCode = response.getResponseCode();
    const responseText = response.getContentText();

    console.log('WhatsApp HTTP status:', statusCode);
    console.log('WhatsApp response:', responseText);

    // ============================================================
    // CONTROLLO ERRORE
    // ============================================================

    if (statusCode < 200 || statusCode >= 300) {

        throw new Error(
            'Errore API WhatsApp (' +
            statusCode +
            '): ' +
            responseText
        );
    }

    // ============================================================
    // RISULTATO
    // ============================================================

    return JSON.parse(responseText);
}


function testInviaWhatsApp() {

    inviaWhatsApp(
        '393487856692',
        '🚀 Messaggio inviato da Google Apps Script!'
    );

}


// ============================================================
// CONFIGURAZIONE
// ============================================================

const WHATSAPP_FOGLIO = 'SCRIPT';

// Colonne (numerazione Google Sheets: A=1, B=2, ecc.)
const COL_GENITORE = 4;       // D
const COL_TELEFONO = 5;       // E
const COL_RAGAZZO = 8;        // H

const COL_LUOGO_NASCITA = 10; // J
const COL_DATA_NASCITA = 11;  // K
const COL_INDIRIZZO = 12;     // L
const COL_ALLERGIE = 13;      // M
const COL_TERAPIE = 14;       // N

const COL_BATTESIMO = 22;     // V
const COL_FREQUENZA = 23;     // W

const COLORE_MANCANTE = '#FCBC05';


// ============================================================
// FUNZIONE PRINCIPALE
// Legge tutte le righe e invia i WhatsApp
// ============================================================

function controllaDatiEInviaWhatsApp() {

    Logger.log('==============================================');
    Logger.log('INIZIO controllaDatiEInviaWhatsApp');
    Logger.log('==============================================');

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(WHATSAPP_FOGLIO);

    if (!sheet) {
        throw new Error(
            'Foglio "' + WHATSAPP_FOGLIO + '" non trovato.'
        );
    }

    const ultimaRiga = sheet.getLastRow();

    Logger.log('Ultima riga: ' + ultimaRiga);

    if (ultimaRiga < 2) {
        Logger.log('Nessun record da controllare.');
        return;
    }

    // Leggiamo tutto in una volta
    const valori = sheet
        .getRange(1, 1, ultimaRiga, 23)
        .getDisplayValues();

    // Per V e W ci servono i colori effettivamente restituiti dal foglio
    const colori = sheet
        .getRange(1, 1, ultimaRiga, 23)
        .getBackgrounds();


    // ==========================================================
    // CICLO RIGHE
    // ==========================================================

    for (let riga = 2; riga <= ultimaRiga; riga++) {

        Logger.log('');
        Logger.log('----------------------------------------------');
        Logger.log('Controllo riga: ' + riga);
        Logger.log('----------------------------------------------');

        const dati = valori[riga - 1];
        const sfondi = colori[riga - 1];

        controllaERiga(
            sheet,
            riga,
            dati,
            sfondi,
            true
        );
    }

    Logger.log('');
    Logger.log('==============================================');
    Logger.log('FINE controllaDatiEInviaWhatsApp');
    Logger.log('==============================================');
}


// ============================================================
// FUNZIONE DI CONTROLLO DI UNA SINGOLA RIGA
// ============================================================


function controllaERiga(
    sheet,
    riga,
    dati,
    sfondi,
    invia
) {

    const genitore = String(dati[COL_GENITORE - 1]).trim();
    const telefono = String(dati[COL_TELEFONO - 1]).trim();
    const ragazzo = String(dati[COL_RAGAZZO - 1]).trim();

    Logger.log('Genitore: ' + genitore);
    Logger.log('Telefono: ' + telefono);
    Logger.log('Ragazzo: ' + ragazzo);

    // ==========================================================
    // CONTROLLIAMO I CAMPI TESTUALI VUOTI
    // ==========================================================

    const mancanti = [];

    if (!String(dati[COL_LUOGO_NASCITA - 1]).trim()) {
        mancanti.push(
            'luogo di nascita'
        );
    }

    if (!String(dati[COL_DATA_NASCITA - 1]).trim()) {
        mancanti.push(
            'data di nascita'
        );
    }

    if (!String(dati[COL_INDIRIZZO - 1]).trim()) {
        mancanti.push(
            'indirizzo di residenza'
        );
    }

    if (!String(dati[COL_ALLERGIE - 1]).trim()) {
        mancanti.push(
            'allergie o intolleranze'
        );
    }

    if (!String(dati[COL_TERAPIE - 1]).trim()) {
        mancanti.push(
            'terapie o medicinali in corso di assunzione'
        );
    }

    // ==========================================================
    // CERTIFICATO DI BATTESIMO - COLONNA V
    // Controlliamo direttamente il testo
    // ==========================================================

    const statoBattesimo =
        String(dati[COL_BATTESIMO - 1]).trim().toUpperCase();

    if (statoBattesimo === 'IN ATTESA') {

        mancanti.push(
            'certificato di battesimo'
        );

        Logger.log(
            '⚠️ V' + riga + ' = IN ATTESA → certificato di battesimo mancante'
        );
    }

    // ==========================================================
    // CERTIFICATO DI FREQUENZA - COLONNA W
    // Controlliamo direttamente il testo
    // ==========================================================

    const statoFrequenza =
        String(dati[COL_FREQUENZA - 1]).trim().toUpperCase();

    if (statoFrequenza === 'IN ATTESA') {

        mancanti.push(
            'certificato di frequenza'
        );

        Logger.log(
            '⚠️ W' + riga + ' = IN ATTESA → certificato di frequenza mancante'
        );
    }

    // ==========================================================
    // NIENTE DA SEGNALARE
    // ==========================================================

    if (mancanti.length === 0) {

        Logger.log(
            '✅ Riga ' + riga + ': nessun dato mancante.'
        );

        return {
            riga: riga,
            daSegnalare: false,
            mancanti: []
        };
    }

    // ==========================================================
    // CREAZIONE MESSAGGIO
    // ==========================================================

    let messaggio =
        'Ciao ' + (genitore || 'genitore') + ',\n\n';

    messaggio +=
        'per completare l’iscrizione di ' +
        (ragazzo || 'tuo figlio') +
        ' ci manca';

    if (mancanti.length === 1) {

        messaggio +=
            ' il seguente dato/documento:\n\n';

    } else {

        messaggio +=
            'no i seguenti dati/documenti:\n\n';
    }

    // Elenco puntato

    mancanti.forEach(function (elemento) {

        messaggio +=
            '• ' + elemento + '\n';

    });

    messaggio +=
        '\nGrazie!';

    // ==========================================================
    // LOG
    // ==========================================================

    Logger.log(
        '⚠️ Riga ' + riga +
        ' - dati mancanti: ' +
        mancanti.join(', ')
    );

    Logger.log(
        'Messaggio che verrebbe inviato:\n' +
        messaggio
    );

    // ==========================================================
    // NUMERO MANCANTE
    // ==========================================================

    if (!telefono) {

        Logger.log(
            '⏭️ Riga ' + riga +
            ': numero di telefono assente → NON INVIO.'
        );

        return {
            riga: riga,
            daSegnalare: true,
            inviato: false,
            motivo: 'Numero di telefono assente',
            mancanti: mancanti
        };
    }

    // ==========================================================
    // INVIO WHATSAPP
    // ==========================================================

    if (invia) {

        Logger.log(
            '📱 Invio WhatsApp a: ' + telefono
        );

        try {

            const risultato =
                inviaWhatsApp(
                    telefono,
                    messaggio
                );

            Logger.log(
                '✅ WhatsApp inviato correttamente.'
            );

            return {
                riga: riga,
                daSegnalare: true,
                inviato: true,
                telefono: telefono,
                mancanti: mancanti,
                risultato: risultato
            };

        } catch (errore) {

            Logger.log(
                '❌ ERRORE invio WhatsApp: ' +
                errore.message
            );

            return {
                riga: riga,
                daSegnalare: true,
                inviato: false,
                errore: errore.message,
                mancanti: mancanti
            };
        }
    }

    // ==========================================================
    // MODALITÀ TEST
    // ==========================================================

    Logger.log(
        '🧪 MODALITÀ TEST → nessun messaggio inviato.'
    );

    return {
        riga: riga,
        daSegnalare: true,
        inviato: false,
        test: true,
        mancanti: mancanti
    };
}


// ============================================================
// NORMALIZZA COLORE
// ============================================================

function normalizzaColore(colore) {

    if (!colore) {
        return '';
    }

    return String(colore)
        .trim()
        .toUpperCase();

}


// ============================================================
// TEST COMPLETO
// NON INVIA WHATSAPP
// ============================================================

function testControllaDatiWhatsApp() {

    Logger.log('==============================================');
    Logger.log('🧪 TEST - NESSUN WHATSAPP VERRÀ INVIATO');
    Logger.log('==============================================');

    const ss = SpreadsheetApp.getActiveSpreadsheet();

    const sheet =
        ss.getSheetByName(WHATSAPP_FOGLIO);

    if (!sheet) {
        throw new Error(
            'Foglio "' + WHATSAPP_FOGLIO + '" non trovato.'
        );
    }

    const ultimaRiga =
        sheet.getLastRow();

    const valori =
        sheet
            .getRange(1, 1, ultimaRiga, 23)
            .getDisplayValues();

    const colori =
        sheet
            .getRange(1, 1, ultimaRiga, 23)
            .getBackgrounds();


    for (let riga = 2; riga <= ultimaRiga; riga++) {

        controllaERiga(
            sheet,
            riga,
            valori[riga - 1],
            colori[riga - 1],
            false
        );
    }

    Logger.log('==============================================');
    Logger.log('🧪 FINE TEST');
    Logger.log('==============================================');
}


// ============================================================
// TEST DI UNA SOLA RIGA
// NON INVIA WHATSAPP
// ============================================================

function testRigaWhatsApp() {

    const RIGA = 33; // <<< CAMBIA QUI

    Logger.log(
        '=============================================='
    );

    Logger.log(
        '🧪 TEST RIGA ' + RIGA +
        ' - NESSUN INVIO'
    );

    Logger.log(
        '=============================================='
    );


    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const sheet =
        ss.getSheetByName(WHATSAPP_FOGLIO);

    if (!sheet) {
        throw new Error(
            'Foglio "' + WHATSAPP_FOGLIO + '" non trovato.'
        );
    }


    const dati =
        sheet
            .getRange(RIGA, 1, 1, 23)
            .getDisplayValues()[0];

    const sfondi =
        sheet
            .getRange(RIGA, 1, 1, 23)
            .getBackgrounds()[0];


    controllaERiga(
        sheet,
        RIGA,
        dati,
        sfondi,
        false
    );

}


// ============================================================
// INVIA UNA SOLA RIGA
// MODIFICA RIGA QUI SOTTO
// ============================================================

function inviaWhatsAppRiga() {

    const RIGA = 33; // <<< CAMBIA QUI


    Logger.log(
        '=============================================='
    );

    Logger.log(
        '📱 INVIO WHATSAPP RIGA ' + RIGA
    );

    Logger.log(
        '=============================================='
    );


    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const sheet =
        ss.getSheetByName(WHATSAPP_FOGLIO);

    if (!sheet) {
        throw new Error(
            'Foglio "' + WHATSAPP_FOGLIO + '" non trovato.'
        );
    }


    const dati =
        sheet
            .getRange(RIGA, 1, 1, 23)
            .getDisplayValues()[0];

    const sfondi =
        sheet
            .getRange(RIGA, 1, 1, 23)
            .getBackgrounds()[0];


    return controllaERiga(
        sheet,
        RIGA,
        dati,
        sfondi,
        true
    );

}