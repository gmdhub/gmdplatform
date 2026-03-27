# Deploy Backend API Remoto (Render) - GMD Platform

## 1. Crea il servizio Render
Opzione veloce consigliata:
- usa il blueprint [`render.yaml`](/Users/mohamed/Desktop/gmd%20platform/render.yaml) dal repository, così Render precompila già servizio + env base.

Opzione manuale:
1. Vai su Render -> `New` -> `Web Service`.
2. Collega il repository GitHub `gmdplatform`.
3. Seleziona branch release (es. `release/v0.1.1`).
4. Imposta:
   - `Runtime`: `Docker`
   - `Dockerfile Path`: `server/Dockerfile`
   - `Root Directory`: vuoto (root repo)
   - `Health Check Path`: `/health`

## 2. Configura variabili ambiente Render
Imposta queste env nel servizio Render:

- `APP_ENV=production`
- `API_HOST=0.0.0.0`
- `API_JWT_SECRET=<secret-prod-lungo>`
- `ACCESS_TOKEN_TTL_SECONDS=900`
- `REFRESH_TOKEN_TTL_SECONDS=2592000`
- `SUPABASE_DB_URL=<connection-string-prod>`
- `SUPABASE_PROJECT_REF_EXPECTED=gvxzgahxrymnzckevluk`
- `SUPABASE_PROD_PROJECT_REF=gvxzgahxrymnzckevluk`
- `ALLOW_DEV_PROD_DB=NO`
- `CORS_ORIGIN=*`

Nota: Render fornisce `PORT` automaticamente; l'API ora lo supporta (fallback su `API_PORT`).

## 3. Verifica health endpoint
Dopo il deploy:

1. apri `https://<render-domain>/health`
2. atteso:
```json
{ "ok": true, "service": "gmd-platform-api" }
```

## 4. Configura GitHub Actions release desktop
In `GitHub -> Settings -> Secrets and variables -> Actions` crea/aggiorna:

- `PROD_API_BASE_URL=https://<render-domain>`

La pipeline release desktop ora fallisce se:
- il secret manca
- non è HTTPS
- punta a localhost

## 5. Cutover desktop production
1. Trigger workflow `Desktop Release` (oppure commit/tag su branch release/main).
2. Installa il nuovo pacchetto su Windows/macOS.
3. Verifica login e accesso ambulatorio senza backend locale su `127.0.0.1:8787`.

## 6. Sicurezza operativa
- Nessuna credenziale DB viene inclusa nel bundle desktop.
- Il backend embedded è disattivato in release (`GMD_DESKTOP_API_MODE=remote`).
- Le migrazioni DB prod restano su workflow separato/manuale.
