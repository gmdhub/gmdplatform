# API Remota (Strada 1)

Con questa modalita l'app desktop non usa piu `127.0.0.1:8787`:

- frontend Tauri chiama un endpoint pubblico (`VITE_API_BASE_URL`)
- backend API gira su un servizio cloud (Render/Railway/Fly.io/VM)
- database resta PostgreSQL Supabase

## Variabili backend richieste

Imposta queste env sul servizio dove deployi `server/`:

- `APP_ENV=production`
- `API_HOST=0.0.0.0`
- `PORT` oppure `API_PORT` (il codice ora supporta entrambi)
- `API_JWT_SECRET=<secret forte>`
- `ACCESS_TOKEN_TTL_SECONDS=900`
- `REFRESH_TOKEN_TTL_SECONDS=2592000`
- `SUPABASE_DB_URL=<connection string prod>`
- `SUPABASE_PROJECT_REF_EXPECTED=<project ref prod>`
- `SUPABASE_PROD_PROJECT_REF=<project ref prod>`
- `ALLOW_DEV_PROD_DB=NO`
- `CORS_ORIGIN=*`

## Deploy rapido (Docker)

Il repository include `server/Dockerfile`.

Build locale immagine:

```bash
docker build -f server/Dockerfile -t gmd-platform-api .
```

Run locale:

```bash
docker run --rm -p 8787:8787 --env-file server/.env.prod gmd-platform-api
```

## Build desktop con API remota

Per la release desktop imposta:

- `GMD_DESKTOP_API_MODE=remote`
- `VITE_API_BASE_URL=https://api.<tuo-dominio>`

Nel workflow GitHub la variabile richiesta e':

- secret `PROD_API_BASE_URL`

Se manca, la build release viene bloccata.
