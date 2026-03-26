# Runbook: Separazione Sicura DB `dev` / `prod` (Supabase)

## 1) Prerequisiti
- Due progetti Supabase separati: `dev` e `prod`.
- Chiavi/credenziali `prod` ruotate prima di andare in produzione.
- Nessun dato sanitario reale in `dev` (solo seed sintetico).

## 2) File env locali
1. Copiare:
   - `server/.env.dev.example` -> `server/.env.dev`
   - `server/.env.prod.example` -> `server/.env.prod`
   - `.env.example` -> `.env` (frontend)
2. Configurare i valori reali:
   - `SUPABASE_DB_URL`
   - `SUPABASE_PROJECT_REF_EXPECTED`
   - `SUPABASE_PROD_PROJECT_REF`
   - `API_JWT_SECRET`
3. In `dev`: `APP_ENV=development`, `ALLOW_DEV_PROD_DB=NO`.
4. In `prod`: `APP_ENV=production`, `ALLOW_DEV_PROD_DB=NO`.

## 3) Comandi sicuri standard
- Avvio API sviluppo (con guardrail): `npm run api:dev:safe`
- Migrazioni dev: `npm run api:migrate:dev`
- Seed sintetico dev: `npm run api:seed:dev`
- ETL sqlite -> postgres dev: `npm run etl:sqlite-to-postgres:dev`

## 4) Comandi produzione (protetti)
- Start API prod: `npm run api:start:prod`
- Migrazioni prod: `npm run api:migrate:prod`
- ETL prod: `npm run etl:sqlite-to-postgres:prod`

Note:
- `api:migrate:prod` richiede `CONFIRM_PROD_MIGRATION=YES` (impostata dallo script).
- `etl:sqlite-to-postgres:prod` richiede `CONFIRM_PROD_ETL=YES`.

## 5) Guardrail attivi
- L'API non parte se il project ref estratto da `SUPABASE_DB_URL` non coincide con `SUPABASE_PROJECT_REF_EXPECTED`.
- In `APP_ENV=development`, se il ref è quello `prod`, l'avvio è bloccato (a meno di `ALLOW_DEV_PROD_DB=YES`).
- Migrazioni in `production` bloccate senza conferma esplicita.

## 6) Pipeline CI/CD
- Migrazioni `dev` automatiche su push `main`.
- Migrazioni `prod` solo manuali (`workflow_dispatch`) con conferma.
- Segreti separati obbligatori:
  - `DEV_SUPABASE_DB_URL`
  - `DEV_SUPABASE_PROJECT_REF`
  - `PROD_SUPABASE_DB_URL`
  - `PROD_SUPABASE_PROJECT_REF`
  - `DEV_API_JWT_SECRET`
  - `PROD_API_JWT_SECRET`

## 7) Procedura emergenza
1. Bloccare write traffic API (deployment stop o maintenance).
2. Validare ref target da log avvio API (`project_ref_actual` / `project_ref_expected`).
3. Se necessario, rollback migration da backup/snapshot Supabase.
4. Riavviare API solo dopo validazione env e ref.
