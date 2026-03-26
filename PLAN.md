# Ristrutturazione Dati PostgreSQL per GMD Medical Platform

## 1) Sintesi Esecutiva (decisione presa)
- **Strada consigliata:** `PostgreSQL remoto + backend API` (cloud), mantenendo **client Tauri/SvelteKit**.
- **Motivo:** nel repo attuale il frontend accede direttamente a SQLite (`src/lib/db/*`); per multiutente concorrente, audit e sicurezza sanitaria servono controllo centralizzato di accessi, transazioni, audit trail e policy.
- **Scelte operative assunte:** online required, last-write-wins, migrazione incrementale, nessun big-bang.
- **Principio chiave:** preservare UX e flussi esistenti, sostituendo gradualmente il data layer con un service/repository layer e API.

---

## A) Analisi stato attuale del repository

### Architettura e accesso dati oggi
- App desktop `Tauri + SvelteKit`, SPA senza backend HTTP separato.
- Inizializzazione DB lato client in `src/lib/db/schema.ts` e migrazioni runtime in `src/lib/db/migrations.ts`.
- Accesso SQL diretto in moduli `src/lib/db/*.ts`, invocati direttamente da route/componenti (`src/routes/...`, `src/lib/components/...`).
- Config DB vincolata a `sqlite:*` in `src/lib/db/config.ts`.
- Possibilità di cambiare cartella DB da UI (`impostazioni`), quindi possibile uso di file condiviso di rete.

### Tabelle e relazioni attuali (reali)
- `users` (credenziali e ruolo applicativo).
- `ambulatori` (anagrafica + branding + durata visite).
- `ambulatorio_orari` (fasce operative).
- `pazienti` (anagrafica).
- `visite` (visita + molti campi clinici serializzati).
- `fattori_rischio_cv` (1:1 logico con visita).
- `appuntamenti` (agenda, con origine e collegamento follow-up a visita).
- Relazioni FK principali presenti e indici base.

### Punti fragili concreti
- **Coupling forte UI↔DB:** route e componenti importano direttamente funzioni DB; difficile cambiare storage senza impatto diffuso.
- **Concorrenza multi-client non robusta:** controlli conflitto (es. appuntamenti) sono applicativi, non centralizzati transazionalmente tra client.
- **Unità transazionale incompleta in orchestrazioni:** alcuni flussi (es. `visite-complete`) eseguono più scritture su moduli diversi senza transazione end-to-end unica.
- **Campi clinici eterogenei in `TEXT` JSON-like:** scarsa validazione DB, query analitiche limitate, audit medico-legale fragile.
- **Versioning visite parziale:** catena `previous_version_id/is_current_version` presente ma non estesa in modo uniforme a tutti i blocchi clinici/report.
- **Hard delete diffuso:** perdita storico (pazienti/visite/fattori/appuntamenti) non ideale per accountability sanitaria.
- **Sicurezza visibile da codice:**
  - `authenticateUser` fa `SELECT *` e l’oggetto utente con `password_hash` finisce in store/sessione.
  - “Ricordami” salva password in chiaro in `localStorage`.
  - Credenziali demo bootstrap statiche.
  - Nessun audit trail strutturato per accessi/letture cliniche.

### Accoppiamenti forti da gestire in migrazione
- Bootstrap DB in `src/routes/+layout.svelte` dipende da `initDatabase()`.
- Guard layout ambulatorio dipende da `getDatabase()`/`getAmbulatorioById()`.
- Route principali usano direttamente moduli DB (`auth`, `pazienti`, `visite`, `appuntamenti`, `visite-complete`).

---

## B) Decisione architetturale su PostgreSQL

### Opzioni valutate

| Opzione | Pro | Contro | Impatto Tauri/SvelteKit | Coerenza offline-first | Sicurezza/privacy |
|---|---|---|---|---|---|
| 1. PostgreSQL locale gestito dalla desktop app | Minore refactor API iniziale | Operatività complessa su ogni client, non risolve governance multi-sede | Medio-alto | Buona locale, scarsa centralizzazione | Debole (credenziali DB sul client) |
| 2. PostgreSQL remoto + backend API | Controllo centralizzato, RBAC, audit, migrazioni serie | Introduce nuovo servizio backend | Alto ma graduale e difendibile | Riduce offline-first puro | Forte (least privilege, audit, policy) |
| 3. PostgreSQL remoto + layer locale intermedio | Migliore resilienza offline | Complessità elevata (sync/conflict queue) | Molto alto | Ottima | Buona ma complessa |
| 4. Client Tauri diretto a PostgreSQL remoto | Implementazione veloce apparente | Anti-pattern sicurezza, segreti nel client, policy deboli | Medio | Scarsa | Non accettabile per dati sanitari |

### Scelta consigliata
- **Opzione 2: PostgreSQL remoto + backend API**.
- **Motivo finale:** unica opzione che rende il progetto multiutente, auditabile e governabile senza compromessi critici di sicurezza.
- **Nota su offline-first:** per fase 1 si passa a modello online-first; eventuale cache/offline solo lettura in fase successiva.

---

## C) Nuova struttura dati PostgreSQL (target)

## Domini e tabelle target (concrete)

### 1. identity/auth (`iam`)
- `iam.app_user`  
  `id uuid PK`, `username citext UNIQUE`, `first_name`, `last_name`, `email`, `status`, `is_service_account`, `created_at`, `updated_at`, `disabled_at`.
- `iam.user_credential`  
  `user_id PK/FK -> app_user`, `password_hash`, `password_algo`, `password_changed_at`, `must_rotate`.
- `iam.role`  
  `id bigserial PK`, `code UNIQUE`, `name`.
- `iam.permission`  
  `id bigserial PK`, `code UNIQUE`, `description`.
- `iam.role_permission`  
  `role_id FK`, `permission_id FK`, `PK(role_id, permission_id)`.
- `iam.user_role`  
  `user_id FK`, `role_id FK`, `scope_type`, `scope_id`, `PK(user_id, role_id, scope_type, scope_id)`.
- `iam.user_session`  
  `id uuid PK`, `user_id FK`, `refresh_token_hash`, `issued_at`, `expires_at`, `revoked_at`, `device_info`, `ip_address`.

### 2. organization (`org`)
- `org.ambulatorio`  
  `id bigserial PK`, `code UNIQUE`, `name`, `is_active`, `created_at`, `updated_at`.
- `org.ambulatorio_settings`  
  `ambulatorio_id PK/FK`, `min_visit_minutes`, `standard_visit_minutes`, `report_base_uri`, `timezone`, `created_at`, `updated_at`.
- `org.ambulatorio_theme`  
  `ambulatorio_id PK/FK`, `logo_path`, `color_primary`, `color_secondary`, `color_accent`.
- `org.ambulatorio_operating_window`  
  `id bigserial PK`, `ambulatorio_id FK`, `weekday`, `start_time`, `end_time`, `max_patients_per_day`, vincolo unique su fascia.

### 3. patients (`patient`)
- `patient.patient`  
  `id uuid PK`, `ambulatorio_id FK`, `first_name`, `last_name`, `birth_date`, `birth_place`, `sex`, `tax_code`, `temporary_code`, `exemptions`, `address`, `city`, `cap`, `province`, `phone`, `email`, `is_active`, `archived_at`, `created_by`, `updated_by`, `created_at`, `updated_at`, `deleted_at`.
- `patient.patient_contact`  
  `id bigserial PK`, `patient_id FK`, `contact_type`, `contact_value`, `is_primary`, `created_at`.
- Indici: ricerca per `ambulatorio_id`, `last_name`, `tax_code` (partial unique quando valido).

### 4. clinical_encounters (`clinical`)
- `clinical.encounter`  
  `id uuid PK`, `ambulatorio_id FK`, `patient_id FK`, `status`, `current_revision_id`, `created_by`, `created_at`, `updated_at`, `deleted_at`.
- `clinical.encounter_revision`  
  `id uuid PK`, `encounter_id FK`, `revision_no`, `supersedes_revision_id`, `visit_at`, `visit_type`, `reason`, `author_user_id`, `signed_at`, `signed_by`, `is_void`, `void_reason`, `created_at`, unique `(encounter_id, revision_no)`.
- `clinical.encounter_anthropometrics`  
  `revision_id PK/FK`, `height_cm`, `weight_kg`, `bmi`, `bsa`.
- `clinical.encounter_anamnesis`  
  `revision_id PK/FK`, `cardiologica_text`, `internistica_text`.
- `clinical.encounter_cv_risk_factor`  
  `revision_id PK/FK`, campi oggi in `fattori_rischio_cv`.
- `clinical.encounter_fh_assessment`  
  `revision_id PK/FK`, boolean/score/classification.
- `clinical.encounter_lipid_therapy`  
  `revision_id PK/FK`, campi strutturati terapia ipolipemizzante.
- `clinical.encounter_home_therapy`  
  `revision_id PK/FK`, `content_text`.
- `clinical.encounter_current_evaluation`  
  `revision_id PK/FK`, `content_text`.
- `clinical.encounter_lab_result`  
  `revision_id FK`, `exam_code`, `exam_date`, `value_text`, `value_numeric`, `unit`, `PK(revision_id, exam_code)`.
- `clinical.encounter_cv_risk_evaluation`  
  `revision_id PK/FK`, `risk_level`, `target_ldl`, `current_ldl`, `ldl_source`, `status`, `status_message`.
- `clinical.encounter_echocardiography`  
  `revision_id PK/FK`, `payload_jsonb`, `schema_version`.
- `clinical.encounter_conclusion`  
  `revision_id PK/FK`, `conclusion_text`, `diagnosis_text`, `note_text`, `followup_at`, `followup_reason`, `followup_tests`.
- `clinical.encounter_signature`  
  `id uuid PK`, `revision_id FK`, `sign_role`, `full_name`, `title`, `display_order`, unique `(revision_id, sign_role, display_order)`.

### 5. appointments (`scheduling`)
- `scheduling.appointment`  
  `id uuid PK`, `ambulatorio_id FK`, `patient_id FK`, `start_at`, `end_at`, `duration_minutes`, `status`, `reason`, `origin`, `source_encounter_revision_id FK`, `created_by`, `updated_by`, `created_at`, `updated_at`, `deleted_at`, unique partial su `source_encounter_revision_id`.

### 6. reporting (`reporting`)
- `reporting.report_template`  
  `id uuid PK`, `code UNIQUE`, `name`, `version`, `storage_uri`, `is_active`, `created_at`.
- `reporting.report_document`  
  `id uuid PK`, `encounter_revision_id FK`, `template_id FK`, `version_no`, `status`, `storage_uri`, `file_sha256`, `file_size_bytes`, `mime_type`, `generated_by`, `generated_at`, `signed_at`, `signed_by`, unique `(encounter_revision_id, version_no)`.

### 7. audit (`audit`)
- `audit.audit_event`  
  `id bigserial PK`, `occurred_at`, `actor_user_id`, `action`, `entity_schema`, `entity_table`, `entity_pk`, `ambulatorio_id`, `patient_id`, `correlation_id`, `app_version`, `device_id`, `ip_address`, `before_data jsonb`, `after_data jsonb`.
- `audit.patient_access_log`  
  `id bigserial PK`, `occurred_at`, `actor_user_id`, `patient_id`, `encounter_id`, `access_type`, `reason`, `correlation_id`.

---

## 5) Policy “normalizzare vs JSONB” (decisione esplicita)

- **Normalizzare (SI):** anagrafica paziente, fattori rischio CV, FH assessment, terapia ipolipemizzante, lab results, valutazione rischio CV, follow-up, firme, appuntamenti, metadata referti.
- **Testo strutturato semplice (TEXT):** anamnesi cardiologica/internistica, terapia domiciliare, valutazione odierna, conclusioni/diagnosi/note (contenuti narrativi clinici).
- **JSONB controllato (NO ovunque, SI mirato):**
  - `clinical.encounter_echocardiography.payload_jsonb` (blocco evolutivo, non ancora rigidamente standardizzato).
  - `audit.before_data/after_data` (naturale per diff eventi).
- **Versioning:** tutto il clinico collegato a `encounter_revision`, quindi storicizzato legalmente senza overwrite.

---

## D) Versioning e storicizzazione

- Modello attuale `previous_version_id/is_current_version` è utile ma parziale.
- Modello proposto:
  - `encounter` = identità logica.
  - `encounter_revision` = append-only; ogni modifica crea nuova revisione.
  - `encounter.current_revision_id` punta all’ultima.
- **Last-write-wins** implementato senza perdita informativa:
  - vince l’ultima revisione come “corrente”.
  - revisioni precedenti restano in storico.
- Referti versionati separatamente in `reporting.report_document` con `version_no`, hash file, autore e timestamp.
- Soft delete per entità principali; hard delete solo per dati tecnici non clinici (con policy esplicita).

---

## E) Sicurezza e privacy (misure pratiche)

- Eliminare subito:
  - password in chiaro in `localStorage`.
  - `password_hash` restituito al client/sessionStorage.
- Autenticazione:
  - credenziali interne con hash `Argon2id`.
  - access token breve + refresh token hashato su `iam.user_session`.
- Autorizzazione:
  - RBAC con scope ambulatorio (`iam.user_role` con scope).
  - least privilege DB: client non parla mai direttamente con PostgreSQL.
- Audit:
  - audit scritture obbligatorio su domini patient/clinical/scheduling/reporting.
  - audit letture paziente/referto via `audit.patient_access_log`.
- Cifratura:
  - TLS in transito.
  - cifratura a riposo su volume DB + backup cifrati.
- Backup:
  - backup giornaliero cifrato + test restore periodico.
- Pseudonimizzazione ambienti non-prod:
  - tool ETL che offusca CF, nominativi, contatti.
- Separazione ambienti:
  - dev/test/prod isolati con credenziali distinte.
- Allegati/referti:
  - file in object storage o filesystem sicuro; DB solo metadati + hash.
- Retention:
  - policy esplicita su audit e log applicativi.
- Accountability:
  - `created_by/updated_by`, correlation id, app version, device id su eventi critici.

---

## F) Impatto sul codice esistente (file richiesti)

### `src/lib/db/config.ts`
- **Resta:** configurazione runtime centrale.
- **Refactor:** da path SQLite a config API (`API_BASE_URL`, timeout, retry policy, env).
- **Nuovo:** config storage locale solo per cache non-clinica e report output locale.

### `src/lib/db/client.ts`
- **Resta:** punto unico di accesso dati.
- **Refactor totale:** wrapper SQL -> HTTP client (`fetch`/SDK) con interceptor auth/correlation-id.
- **Non deve più fare:** `Database.load(...)` o query SQL lato client.

### `src/lib/db/schema.ts`
- **Resta:** bootstrap applicativo.
- **Refactor:** da `initDatabase()` a `initDataProvider()` (health-check API, session restore, feature flags).
- **Non deve più fare:** creazione/migrazione schema DB.

### `src/lib/db/migrations.ts`
- **Resta concetto, non file frontend:** migrazioni spostate nel backend (`server/migrations`).
- **Frontend:** rimosso/deprecato.

### `src/lib/db/auth.ts`
- **Resta firma ad alto livello (login/logout/utenti).**
- **Refactor:** chiamate API auth/users.
- **Correzione obbligatoria:** non esporre mai `password_hash` al client.

### `src/lib/db/pazienti.ts`
- **Resta contratto funzionale CRUD/search.**
- **Refactor:** repository API + DTO mapping.
- **Correzione:** reinserire filtro ambulatorio lato server (oggi c’è comportamento non coerente).

### `src/lib/db/visite.ts`
- **Resta interfaccia funzionale per UI.**
- **Refactor:** endpoint encounter/revisions + mapping blocchi clinici.
- **Nuovo:** gestione revisioni invece di update in-place.

### `src/lib/db/visite-complete.ts`
- **Resta orchestration**, ma spostata lato backend service transactionale.
- **Frontend:** invoca endpoint unico (`POST /encounters`, `POST /encounters/{id}/revisions`).

### `src/lib/utils/visit-clinical.ts`
- **Resta quasi invariato** (logica clinica/calcolo).
- **Piccoli adattamenti:** input/output tipizzati sui nuovi DTO.

### Generazione referti
- **Resta motore DOCX locale** (se richiesto).
- **Nuovo:** salvataggio metadati referto su backend (`report_document`) con hash/versione/template.

### Route principali
- **Resta UX e routing.**
- **Refactor progressivo:** da import diretto `src/lib/db/*` a service layer `src/lib/services/*`.
- **Non devono più accedere direttamente al DB:** login, pazienti, visite, appuntamenti, impostazioni utenti.

---

## G) Piano di migrazione incrementale (no big bang)

## Fase 1 — Fondazione backend + schema PostgreSQL
- **Obiettivo:** creare backend API skeleton e schema target iniziale.
- **File coinvolti:** nuovo `server/` (API, DB pool, migration runner), nuove migration SQL.
- **Rischio:** deriva schema rispetto a campi UI reali.
- **Test:** migration apply/rollback, test FK/constraint, smoke health endpoint.
- **Done quando:** ambiente dev avvia API + DB con migrazioni idempotenti.

## Fase 2 — Data access abstraction nel frontend
- **Obiettivo:** introdurre `service/repository layer` senza cambiare UI.
- **File coinvolti:** `src/lib/db/client.ts`, nuovo `src/lib/services/*`, adapter feature flag.
- **Rischio:** regressioni diffuse per coupling storico.
- **Test:** unit test mapping DTO, smoke test route principali.
- **Done quando:** app funziona con provider `sqlite` e `api` dietro stessa interfaccia.

## Fase 3 — Identity/Auth centralizzato
- **Obiettivo:** spostare login/utenti/ruoli su API.
- **File coinvolti:** `auth.ts`, `stores/auth.ts`, route login/impostazioni utenti.
- **Rischio:** session handling e compatibilità ruoli.
- **Test:** login, refresh token, revoca sessione, RBAC per route sensibili.
- **Done quando:** nessun `password_hash` in client storage, auth interamente API-driven.

## Fase 4 — Organization + Patients
- **Obiettivo:** migrare ambulatori, settings, orari, anagrafica pazienti.
- **File coinvolti:** `ambulatori.ts`, `pazienti.ts`, route dashboard/pazienti/impostazioni.
- **Rischio:** mismatch vincoli CF e dati legacy TMP.
- **Test:** CRUD pazienti, ricerca, filtro per ambulatorio, permessi per ruolo.
- **Done quando:** pazienti/ambulatori letti/scritti via API in produzione pilota.

## Fase 5 — Clinical encounters + structured blocks
- **Obiettivo:** migrare visite e blocchi clinici a modello revisionato.
- **File coinvolti:** `visite.ts`, `visite-complete.ts`, `visit-clinical.ts`, route `visite` e `visite/nuova`.
- **Rischio:** perdita semantica da JSON legacy.
- **Test:** creazione visita, revisione visita, storico revisioni, calcoli clinici invariati.
- **Done quando:** tutte le visite nuove entrano nel nuovo schema revisionale.

## Fase 6 — Appointments e follow-up
- **Obiettivo:** migrare agenda/follow-up con link a revisioni visita.
- **File coinvolti:** `appuntamenti.ts`, route appuntamenti, conclusioni/follow-up block.
- **Rischio:** regressioni su conflitti orari.
- **Test:** create/update/delete appuntamenti, follow-up da visita, gestione collisioni.
- **Done quando:** agenda opera solo via API con stessi flussi UI.

## Fase 7 — Reporting metadata + file governance
- **Obiettivo:** mantenere DOCX locale ma tracciare metadata/versioni nel DB.
- **File coinvolti:** `generateVisitaReferto.ts`, route visite/pazienti.
- **Rischio:** incoerenza file system vs metadata.
- **Test:** generazione referto, hash, version increment, lookup per visita.
- **Done quando:** ogni referto generato ha metadata persistiti.

## Fase 8 — Audit trail e hardening sicurezza
- **Obiettivo:** attivare audit scrittura/lettura, policy backup/retention, pseudonimizzazione test.
- **File coinvolti:** backend middleware, trigger audit, job backup, tool data masking.
- **Rischio:** overhead prestazionale.
- **Test:** verifica eventi audit per create/update/view/export, restore backup, masking quality.
- **Done quando:** audit completo su domini clinici e controlli sicurezza operativi.

## Fase 9 — Migrazione dati e cutover
- **Obiettivo:** ETL SQLite→PostgreSQL con validazioni integrità e go-live.
- **File coinvolti:** tool ETL (`scripts/migrate-sqlite-to-postgres.ts`), mapping/parsing.
- **Rischio:** qualità dati legacy, parsing JSON sporchi.
- **Test:** row counts per tabella, checksum campi critici, test E2E flussi clinici.
- **Done quando:** zero blocker P1, utenti pilota operativi, rollback plan pronto.

---

## H) Cambiamenti API/interfacce (pubbliche interne al progetto)
- Nuovo contratto API:
  - `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`
  - `GET/POST/PATCH /ambulatori`, `.../settings`, `.../operating-windows`
  - `GET/POST/PATCH /patients`
  - `GET/POST /encounters`, `POST /encounters/{id}/revisions`, `GET /encounters/{id}/revisions`
  - `GET/POST/PATCH /appointments`
  - `POST /reports/generate-metadata`, `GET /reports/by-encounter/{revisionId}`
- Frontend types:
  - separare `DomainType` UI da `ApiDto`.
  - mapping centralizzato in service layer.
- Compatibilità:
  - adapter signatures simili ai moduli `src/lib/db/*` attuali per ridurre regressioni.

---

## 9) SQL DDL iniziale PostgreSQL (baseline)

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE SCHEMA IF NOT EXISTS org;
CREATE SCHEMA IF NOT EXISTS iam;
CREATE SCHEMA IF NOT EXISTS patient;
CREATE SCHEMA IF NOT EXISTS clinical;
CREATE SCHEMA IF NOT EXISTS scheduling;
CREATE SCHEMA IF NOT EXISTS reporting;
CREATE SCHEMA IF NOT EXISTS audit;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ORG
CREATE TABLE org.ambulatorio (
  id BIGSERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE org.ambulatorio_settings (
  ambulatorio_id BIGINT PRIMARY KEY REFERENCES org.ambulatorio(id) ON DELETE CASCADE,
  min_visit_minutes SMALLINT NOT NULL CHECK (min_visit_minutes >= 10),
  standard_visit_minutes SMALLINT NOT NULL CHECK (standard_visit_minutes >= min_visit_minutes),
  report_base_uri TEXT,
  timezone TEXT NOT NULL DEFAULT 'Europe/Rome',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE org.ambulatorio_theme (
  ambulatorio_id BIGINT PRIMARY KEY REFERENCES org.ambulatorio(id) ON DELETE CASCADE,
  logo_path TEXT,
  color_primary TEXT NOT NULL,
  color_secondary TEXT NOT NULL,
  color_accent TEXT NOT NULL
);

CREATE TABLE org.ambulatorio_operating_window (
  id BIGSERIAL PRIMARY KEY,
  ambulatorio_id BIGINT NOT NULL REFERENCES org.ambulatorio(id) ON DELETE CASCADE,
  weekday SMALLINT NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  max_patients_per_day INTEGER NOT NULL CHECK (max_patients_per_day >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_window_range CHECK (start_time < end_time),
  CONSTRAINT ux_window UNIQUE (ambulatorio_id, weekday, start_time, end_time)
);

-- IAM
CREATE TABLE iam.app_user (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username CITEXT UNIQUE NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email CITEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'disabled', 'locked')),
  is_service_account BOOLEAN NOT NULL DEFAULT FALSE,
  disabled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE iam.user_credential (
  user_id UUID PRIMARY KEY REFERENCES iam.app_user(id) ON DELETE CASCADE,
  password_hash TEXT NOT NULL,
  password_algo TEXT NOT NULL DEFAULT 'argon2id',
  must_rotate BOOLEAN NOT NULL DEFAULT FALSE,
  password_changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE iam.role (
  id BIGSERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL
);

CREATE TABLE iam.permission (
  id BIGSERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  description TEXT NOT NULL
);

CREATE TABLE iam.role_permission (
  role_id BIGINT NOT NULL REFERENCES iam.role(id) ON DELETE CASCADE,
  permission_id BIGINT NOT NULL REFERENCES iam.permission(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE iam.user_role (
  user_id UUID NOT NULL REFERENCES iam.app_user(id) ON DELETE CASCADE,
  role_id BIGINT NOT NULL REFERENCES iam.role(id) ON DELETE CASCADE,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('global', 'ambulatorio')),
  scope_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role_id, scope_type, scope_id),
  CONSTRAINT ck_scope CHECK (
    (scope_type = 'global' AND scope_id IS NULL) OR
    (scope_type = 'ambulatorio' AND scope_id IS NOT NULL)
  )
);

CREATE TABLE iam.user_session (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES iam.app_user(id) ON DELETE CASCADE,
  refresh_token_hash TEXT NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  device_info JSONB,
  ip_address INET
);

CREATE INDEX idx_user_session_user ON iam.user_session(user_id);
CREATE INDEX idx_user_session_exp ON iam.user_session(expires_at);

-- PATIENT
CREATE TABLE patient.patient (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ambulatorio_id BIGINT NOT NULL REFERENCES org.ambulatorio(id),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  birth_date DATE NOT NULL,
  birth_place TEXT NOT NULL,
  sex TEXT NOT NULL CHECK (sex IN ('M', 'F', 'Altro')),
  tax_code CITEXT,
  temporary_code TEXT,
  exemptions TEXT,
  address TEXT,
  city TEXT,
  cap TEXT,
  province TEXT,
  phone TEXT,
  email TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  archived_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  created_by UUID REFERENCES iam.app_user(id),
  updated_by UUID REFERENCES iam.app_user(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ux_patient_tax_code_valid
ON patient.patient ((upper(tax_code)))
WHERE tax_code IS NOT NULL AND length(tax_code) = 16 AND deleted_at IS NULL;

CREATE INDEX idx_patient_ambulatorio_name ON patient.patient(ambulatorio_id, last_name, first_name);
CREATE INDEX idx_patient_active ON patient.patient(is_active) WHERE deleted_at IS NULL;

CREATE TABLE patient.patient_contact (
  id BIGSERIAL PRIMARY KEY,
  patient_id UUID NOT NULL REFERENCES patient.patient(id) ON DELETE CASCADE,
  contact_type TEXT NOT NULL CHECK (contact_type IN ('phone', 'email', 'address', 'emergency')),
  contact_value TEXT NOT NULL,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- CLINICAL
CREATE TABLE clinical.encounter (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ambulatorio_id BIGINT NOT NULL REFERENCES org.ambulatorio(id),
  patient_id UUID NOT NULL REFERENCES patient.patient(id),
  status TEXT NOT NULL CHECK (status IN ('draft', 'completed', 'signed', 'cancelled')),
  current_revision_id UUID,
  created_by UUID NOT NULL REFERENCES iam.app_user(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE clinical.encounter_revision (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_id UUID NOT NULL REFERENCES clinical.encounter(id) ON DELETE CASCADE,
  revision_no INTEGER NOT NULL CHECK (revision_no >= 1),
  supersedes_revision_id UUID REFERENCES clinical.encounter_revision(id),
  visit_at TIMESTAMPTZ NOT NULL,
  visit_type TEXT NOT NULL,
  reason TEXT NOT NULL,
  author_user_id UUID NOT NULL REFERENCES iam.app_user(id),
  signed_at TIMESTAMPTZ,
  signed_by UUID REFERENCES iam.app_user(id),
  is_void BOOLEAN NOT NULL DEFAULT FALSE,
  void_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (encounter_id, revision_no)
);

ALTER TABLE clinical.encounter
ADD CONSTRAINT fk_encounter_current_revision
FOREIGN KEY (current_revision_id) REFERENCES clinical.encounter_revision(id);

CREATE INDEX idx_encounter_patient_visit ON clinical.encounter(patient_id, created_at DESC);
CREATE INDEX idx_encounter_ambulatorio ON clinical.encounter(ambulatorio_id, created_at DESC);

CREATE TABLE clinical.encounter_anthropometrics (
  revision_id UUID PRIMARY KEY REFERENCES clinical.encounter_revision(id) ON DELETE CASCADE,
  height_cm NUMERIC(5,2),
  weight_kg NUMERIC(5,2),
  bmi NUMERIC(5,2),
  bsa NUMERIC(5,2)
);

CREATE TABLE clinical.encounter_anamnesis (
  revision_id UUID PRIMARY KEY REFERENCES clinical.encounter_revision(id) ON DELETE CASCADE,
  cardiologica_text TEXT,
  internistica_text TEXT
);

CREATE TABLE clinical.encounter_cv_risk_factor (
  revision_id UUID PRIMARY KEY REFERENCES clinical.encounter_revision(id) ON DELETE CASCADE,
  familiarita BOOLEAN NOT NULL DEFAULT FALSE,
  familiarita_note TEXT,
  ipertensione BOOLEAN NOT NULL DEFAULT FALSE,
  diabete BOOLEAN NOT NULL DEFAULT FALSE,
  diabete_durata TEXT,
  diabete_tipo TEXT NOT NULL DEFAULT '' CHECK (diabete_tipo IN ('', '1', '2')),
  dislipidemia BOOLEAN NOT NULL DEFAULT FALSE,
  obesita BOOLEAN NOT NULL DEFAULT FALSE,
  fumo TEXT NOT NULL DEFAULT '',
  fumo_ex_eta TEXT
);

CREATE TABLE clinical.encounter_fh_assessment (
  revision_id UUID PRIMARY KEY REFERENCES clinical.encounter_revision(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  family_history_one_point BOOLEAN NOT NULL DEFAULT FALSE,
  family_history_two_points BOOLEAN NOT NULL DEFAULT FALSE,
  clinical_premature_cad BOOLEAN NOT NULL DEFAULT FALSE,
  clinical_premature_cerebral_or_peripheral BOOLEAN NOT NULL DEFAULT FALSE,
  physical_tendon_xanthomas BOOLEAN NOT NULL DEFAULT FALSE,
  physical_corneal_arcus_before45 BOOLEAN NOT NULL DEFAULT FALSE,
  untreated_ldl_range TEXT NOT NULL DEFAULT '',
  genetic_mutation BOOLEAN NOT NULL DEFAULT FALSE,
  total_score INTEGER NOT NULL DEFAULT 0,
  classification TEXT NOT NULL DEFAULT 'Improbabile'
);

CREATE TABLE clinical.encounter_lipid_therapy (
  revision_id UUID PRIMARY KEY REFERENCES clinical.encounter_revision(id) ON DELETE CASCADE,
  statin_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  statin_dose TEXT NOT NULL DEFAULT '',
  ezetimibe_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ezetimibe_mode TEXT NOT NULL DEFAULT '',
  fibrati_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  fibrati_dose TEXT NOT NULL DEFAULT '',
  omega3_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  omega3_dose TEXT NOT NULL DEFAULT '',
  acido_bempedoico_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  acido_bempedoico_dose TEXT NOT NULL DEFAULT '',
  repatha_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  repatha_dose TEXT NOT NULL DEFAULT '',
  praluent_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  praluent_dose TEXT NOT NULL DEFAULT '',
  leqvio_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  leqvio_dose TEXT NOT NULL DEFAULT ''
);

CREATE TABLE clinical.encounter_home_therapy (
  revision_id UUID PRIMARY KEY REFERENCES clinical.encounter_revision(id) ON DELETE CASCADE,
  content_text TEXT
);

CREATE TABLE clinical.encounter_current_evaluation (
  revision_id UUID PRIMARY KEY REFERENCES clinical.encounter_revision(id) ON DELETE CASCADE,
  content_text TEXT
);

CREATE TABLE clinical.encounter_lab_result (
  revision_id UUID NOT NULL REFERENCES clinical.encounter_revision(id) ON DELETE CASCADE,
  exam_code TEXT NOT NULL CHECK (exam_code IN (
    'hb','plt','creatinina','egfr','colesterolo_totale','hdl','trigliceridi',
    'ldl_calcolato','ldl_diretto','lipoproteina_a','emoglobina_glicata',
    'glicemia','ast','alt','bilirubina_totale','cpk'
  )),
  exam_date DATE,
  value_text TEXT,
  value_numeric NUMERIC(10,3),
  unit TEXT,
  PRIMARY KEY (revision_id, exam_code)
);

CREATE TABLE clinical.encounter_cv_risk_evaluation (
  revision_id UUID PRIMARY KEY REFERENCES clinical.encounter_revision(id) ON DELETE CASCADE,
  risk_level TEXT NOT NULL DEFAULT '' CHECK (risk_level IN ('', 'basso', 'moderato', 'alto', 'molto_alto')),
  target_ldl NUMERIC(10,3),
  current_ldl NUMERIC(10,3),
  ldl_source TEXT NOT NULL DEFAULT '' CHECK (ldl_source IN ('', 'diretto', 'calcolato')),
  status TEXT NOT NULL DEFAULT 'non_valutabile' CHECK (status IN ('non_valutabile', 'raggiunto', 'non_raggiunto')),
  status_message TEXT NOT NULL DEFAULT ''
);

CREATE TABLE clinical.encounter_echocardiography (
  revision_id UUID PRIMARY KEY REFERENCES clinical.encounter_revision(id) ON DELETE CASCADE,
  schema_version INTEGER NOT NULL DEFAULT 1,
  payload_jsonb JSONB NOT NULL
);

CREATE TABLE clinical.encounter_conclusion (
  revision_id UUID PRIMARY KEY REFERENCES clinical.encounter_revision(id) ON DELETE CASCADE,
  conclusion_text TEXT,
  diagnosis_text TEXT,
  note_text TEXT,
  followup_at TIMESTAMPTZ,
  followup_reason TEXT,
  followup_tests TEXT
);

CREATE TABLE clinical.encounter_signature (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  revision_id UUID NOT NULL REFERENCES clinical.encounter_revision(id) ON DELETE CASCADE,
  sign_role TEXT NOT NULL CHECK (sign_role IN ('cardiologo', 'medico_formazione')),
  full_name TEXT NOT NULL,
  title TEXT NOT NULL CHECK (title IN ('dott', 'dott.ssa')),
  display_order INTEGER NOT NULL DEFAULT 1,
  UNIQUE (revision_id, sign_role, display_order)
);

-- SCHEDULING
CREATE TABLE scheduling.appointment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ambulatorio_id BIGINT NOT NULL REFERENCES org.ambulatorio(id),
  patient_id UUID NOT NULL REFERENCES patient.patient(id),
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes >= 10),
  status TEXT NOT NULL CHECK (status IN ('scheduled', 'confirmed', 'completed', 'cancelled', 'no_show')),
  reason TEXT,
  origin TEXT NOT NULL CHECK (origin IN ('manual', 'followup_visit')),
  source_encounter_revision_id UUID REFERENCES clinical.encounter_revision(id),
  created_by UUID REFERENCES iam.app_user(id),
  updated_by UUID REFERENCES iam.app_user(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT ck_appointment_range CHECK (start_at < end_at)
);

CREATE UNIQUE INDEX ux_appointment_source_revision
ON scheduling.appointment(source_encounter_revision_id)
WHERE source_encounter_revision_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX idx_appointment_ambulatorio_time
ON scheduling.appointment(ambulatorio_id, start_at, end_at)
WHERE deleted_at IS NULL;

-- REPORTING
CREATE TABLE reporting.report_template (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  storage_uri TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE reporting.report_document (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_revision_id UUID NOT NULL REFERENCES clinical.encounter_revision(id) ON DELETE CASCADE,
  template_id UUID NOT NULL REFERENCES reporting.report_template(id),
  version_no INTEGER NOT NULL CHECK (version_no >= 1),
  status TEXT NOT NULL CHECK (status IN ('generated', 'signed', 'archived', 'failed')),
  storage_uri TEXT NOT NULL,
  file_sha256 CHAR(64),
  file_size_bytes BIGINT,
  mime_type TEXT NOT NULL DEFAULT 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  generated_by UUID REFERENCES iam.app_user(id),
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  signed_at TIMESTAMPTZ,
  signed_by UUID REFERENCES iam.app_user(id),
  UNIQUE (encounter_revision_id, version_no)
);

CREATE INDEX idx_report_enc_rev ON reporting.report_document(encounter_revision_id, generated_at DESC);

-- AUDIT
CREATE TABLE audit.audit_event (
  id BIGSERIAL PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_user_id UUID REFERENCES iam.app_user(id),
  action TEXT NOT NULL,
  entity_schema TEXT NOT NULL,
  entity_table TEXT NOT NULL,
  entity_pk TEXT NOT NULL,
  ambulatorio_id BIGINT,
  patient_id UUID,
  correlation_id UUID,
  app_version TEXT,
  device_id TEXT,
  ip_address INET,
  before_data JSONB,
  after_data JSONB
);

CREATE INDEX idx_audit_occured ON audit.audit_event(occurred_at DESC);
CREATE INDEX idx_audit_patient ON audit.audit_event(patient_id, occurred_at DESC);

CREATE TABLE audit.patient_access_log (
  id BIGSERIAL PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_user_id UUID NOT NULL REFERENCES iam.app_user(id),
  patient_id UUID NOT NULL REFERENCES patient.patient(id),
  encounter_id UUID REFERENCES clinical.encounter(id),
  access_type TEXT NOT NULL CHECK (access_type IN ('view_patient', 'view_encounter', 'view_report', 'export_report')),
  reason TEXT,
  correlation_id UUID
);

CREATE INDEX idx_patient_access_patient ON audit.patient_access_log(patient_id, occurred_at DESC);

-- updated_at triggers
CREATE TRIGGER trg_ambulatorio_updated BEFORE UPDATE ON org.ambulatorio FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_ambulatorio_settings_updated BEFORE UPDATE ON org.ambulatorio_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_operating_window_updated BEFORE UPDATE ON org.ambulatorio_operating_window FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_app_user_updated BEFORE UPDATE ON iam.app_user FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_patient_updated BEFORE UPDATE ON patient.patient FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_encounter_updated BEFORE UPDATE ON clinical.encounter FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_appointment_updated BEFORE UPDATE ON scheduling.appointment FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
```

---

## 10) Esempio ruoli PostgreSQL e grant

```sql
-- Ruoli tecnici
CREATE ROLE gmd_migrator LOGIN PASSWORD '***';
CREATE ROLE gmd_api_rw LOGIN PASSWORD '***';
CREATE ROLE gmd_api_ro LOGIN PASSWORD '***';
CREATE ROLE gmd_audit_ro LOGIN PASSWORD '***';

-- Connessione DB
GRANT CONNECT ON DATABASE gmd_platform TO gmd_migrator, gmd_api_rw, gmd_api_ro, gmd_audit_ro;

-- Schema usage
GRANT USAGE ON SCHEMA org, iam, patient, clinical, scheduling, reporting, audit TO gmd_api_rw, gmd_api_ro, gmd_audit_ro;
GRANT ALL PRIVILEGES ON SCHEMA org, iam, patient, clinical, scheduling, reporting, audit TO gmd_migrator;

-- RW applicativo backend
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA org, iam, patient, clinical, scheduling, reporting TO gmd_api_rw;
GRANT INSERT ON audit.audit_event, audit.patient_access_log TO gmd_api_rw;

-- RO applicativo (query read-only/analytics controllata)
GRANT SELECT ON ALL TABLES IN SCHEMA org, patient, clinical, scheduling, reporting TO gmd_api_ro;

-- Audit read role
GRANT SELECT ON ALL TABLES IN SCHEMA audit TO gmd_audit_ro;

-- Sequence privileges
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA org, iam, patient, clinical, scheduling, reporting, audit TO gmd_api_rw, gmd_api_ro, gmd_audit_ro;

-- Default privileges per nuove tabelle
ALTER DEFAULT PRIVILEGES IN SCHEMA org, iam, patient, clinical, scheduling, reporting
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO gmd_api_rw;

ALTER DEFAULT PRIVILEGES IN SCHEMA audit
GRANT SELECT ON TABLES TO gmd_audit_ro;
```

**Regola architetturale:** solo il backend usa `gmd_api_rw`; il client desktop non ottiene mai credenziali DB.

---

## 11) Rischi residui e decisioni aperte

- Scelta provider cloud/regione (obbligatorio EU e DPA coerente).
- Strategia file referti: object storage vs filesystem managed.
- Politica retention legale (audit/log/referti) da validare con compliance aziendale.
- Politica CF: univocità globale vs per ambulatorio (default consigliato: globale per record attivi).
- Strategia import iniziale: consigliata sorgente “DB master” con data quality gate.
- Timeline eventuale SSO (fase 2+).

---

## Assunzioni esplicite
- Si mantiene la UI Tauri/SvelteKit esistente nella prima release.
- Modello operativo online-first.
- Semantica conflitto: last-write-wins con storicizzazione revisionale.
- Migrazione incrementale con compat layer, non riscrittura totale.

