# GMD Medical Platform

Applicazione desktop per la gestione di ambulatori ospedalieri, sviluppata con `Tauri + SvelteKit` e pensata per lavorare interamente in locale con `SQLite`.

Non richiede un backend HTTP separato: il frontend usa direttamente i plugin Tauri per accedere al database, aprire dialog nativi e salvare file.

## Panoramica

Il progetto oggi copre questi flussi principali:

- login locale con utente amministratore demo
- selezione dell'ambulatorio
- dashboard con strumenti rapidi e sezione statistiche
- gestione anagrafica pazienti
- modalita `Cerca Paziente` separata dalla gestione amministrativa
- archivio visite
- creazione di una nuova visita tramite pagina dedicata
- generazione del referto visita in formato `DOCX` da template

L'app e' offline-first: dati clinici, pazienti e visite restano sul dispositivo.

## Funzionalita principali

- Multi-ambulatorio con tema grafico per singolo ambulatorio
- Archivio pazienti con ricerca per nome, cognome e codice fiscale
- Ricerca paziente operativa con selezione rapida e azioni contestuali
- Archivio visite con modifica delle visite esistenti
- Nuova visita strutturata in blocchi clinici modulari
- Calcolo automatico di `BMI` e `BSA`
- Generazione del referto `DOCX` dal template `template_dislip.docx`
- Database locale `SQLite` con migrazioni automatiche sul file esistente

## Stack Tecnologico

- Desktop shell: `Tauri 2`
- Frontend: `SvelteKit`
- Linguaggio UI: `TypeScript`
- Database: `SQLite` tramite `@tauri-apps/plugin-sql`
- Password hashing: `bcryptjs`
- Generazione DOCX: `docxtemplater` + `pizzip`
- Dialog e filesystem nativi: plugin Tauri `dialog` e `fs`

## Struttura del Progetto

```text
gmd-platform/
├── src/
│   ├── lib/
│   │   ├── components/        # Componenti UI riusabili
│   │   ├── db/                # Layer database (connessione, schema, CRUD)
│   │   ├── reports/           # Generazione referti DOCX
│   │   ├── templates/         # Template documenti
│   │   ├── stores/            # Store Svelte (auth, toast, ambulatorio, sidebar)
│   │   └── utils/             # Utility applicative e serializzazione dati clinici
│   ├── routes/                # Pagine SvelteKit
│   └── app.css                # Stili globali
├── src-tauri/                 # Runtime Tauri e configurazione plugin
├── static/                    # Asset statici (loghi, icone ambulatori)
└── gmd.db                     # Database SQLite locale del progetto
```

## Routing Principale

- `src/routes/+page.svelte`
  - login
- `src/routes/ambulatori/+page.svelte`
  - selezione ambulatorio
- `src/routes/ambulatori/[id]/+page.svelte`
  - dashboard dell'ambulatorio
- `src/routes/ambulatori/[id]/pazienti/+page.svelte`
  - gestione anagrafica e cerca paziente
- `src/routes/ambulatori/[id]/visite/+page.svelte`
  - archivio visite
- `src/routes/ambulatori/[id]/visite/nuova/+page.svelte`
  - nuova visita
- `src/routes/ambulatori/[id]/impostazioni/+page.svelte`
  - impostazioni ambulatorio

## Moduli Clinici della Visita

La pagina di nuova visita non e' monolitica: usa blocchi dedicati in `src/lib/components/visit-blocks`.

Tra i blocchi principali:

- fattori di rischio cardiovascolare
- ipercolesterolemia familiare
- anamnesi cardiologica
- terapia ipolipemizzante
- terapia domiciliare
- valutazione odierna
- esami ematici
- valutazione rischio cardiovascolare
- ecocardiografia
- conclusioni e follow-up
- firme visita

Questo rende il form piu' estendibile e riduce la logica concentrata in un solo file.

## Database

Il database runtime e' `SQLite`.

La connessione e' centralizzata in:

- `src/lib/db/config.ts`
- `src/lib/db/client.ts`

L'inizializzazione dello schema parte da:

- `src/lib/db/schema.ts`

Le migrazioni e l'allineamento delle colonne legacy sono gestiti in:

- `src/lib/db/migrations.ts`

Le tabelle principali oggi sono:

- `users`
- `ambulatori`
- `pazienti`
- `visite`
- `fattori_rischio_cv`

Il file `gmd.db` viene aperto tramite `sqlite:gmd.db`. Se il database e' vuoto, l'app crea automaticamente:

- utente demo `admin`
- ambulatori demo
- pazienti demo

### Posizione del Database

In ambiente Tauri il database applicativo viene salvato nella cartella dati dell'app:

- macOS: `~/Library/Application Support/com.gmdmedical.platform/`
- Windows: `%APPDATA%/com.gmdmedical.platform/`

Nel repository puo' essere presente anche un `gmd.db` locale usato per sviluppo.

## Referto DOCX

La generazione del referto usa:

- template: `src/lib/templates/template_dislip.docx`
- logica di compilazione: `src/lib/reports/generateVisitaReferto.ts`

Flusso:

1. la visita viene salvata nel database
2. il template DOCX viene caricato
3. i placeholder vengono sostituiti con i dati della visita
4. viene aperto un dialog nativo "Salva con nome"
5. il file `.docx` viene scritto nel percorso scelto

## Ambulatori Demo Attuali

Gli ambulatori demo configurati di default sono:

- `Ambulatorio Cardiologico delle Dislipidemie`
- `Ortopedia`
- `Day Hospital Riabilitativa`

## Credenziali Demo

- Username: `admin`
- Password: `admin123`

## Prerequisiti

Per lavorare in sviluppo servono:

1. `Node.js` 18 o superiore
2. `Rust` stabile
3. prerequisiti Tauri del sistema operativo

Su macOS:

```bash
xcode-select --install
```

Per installare Rust:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

## Installazione

```bash
npm install
```

## Comandi Utili

Avvio frontend Vite:

```bash
npm run dev
```

Build frontend SvelteKit:

```bash
npm run build
```

Controllo TypeScript/Svelte:

```bash
npm run check
```

Avvio app desktop in sviluppo:

```bash
npm run tauri dev
```

Build desktop:

```bash
npm run tauri build
```

## Note di Sviluppo

- Il progetto usa SQL scritto a mano, non un ORM.
- Le query di dominio sono in `src/lib/db/*.ts`.
- I dati clinici complessi della visita vengono serializzati in campi `TEXT` JSON-like nel database.
- La UI usa store Svelte per autenticazione, stato ambulatorio, sidebar e toast.

## Sicurezza

- Password hashate con `bcrypt`
- Dati salvati in locale
- Nessuna API esterna necessaria per il funzionamento base
- Permessi Tauri espliciti per SQL, dialog e filesystem

## Debug Rapido

Se l'app non parte correttamente:

1. controlla che `npm install` sia stato eseguito
2. verifica che `Rust` e i prerequisiti Tauri siano installati
3. controlla la console DevTools e l'output del terminale Tauri
4. verifica che il file SQLite non sia corrotto o bloccato

## Documentazione Interna

Nel repository sono presenti anche questi file utili:

- `ARCHITETTURA_PROGRAMMA.md`
  - descrizione tecnica piu' dettagliata del progetto
- `REPLICA_PAGINA_STATISTICHE.md`
  - note sul layout e sulla replica della sezione statistiche

## Licenza

Proprieta di GMD Medical. Tutti i diritti riservati.

## IDE Consigliato

- `VS Code`
- estensione `Svelte for VS Code`
- estensione `Tauri`
- estensione `rust-analyzer`
