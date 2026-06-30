# GMD API su Supabase Edge (cutover completo)

## Architettura

- Desktop (Tauri/SvelteKit) -> HTTPS `https://<project-ref>.supabase.co/functions/v1/gmd-api`
- Nessun backend locale su `127.0.0.1:8787` in produzione
- Nessuna credenziale DB nel client desktop

## Endpoint runtime

- Funzione: `supabase/functions/gmd-api/index.ts`
- Config: `supabase/config.toml` con `verify_jwt = false`
- Router/API mantenuta tramite `server/src/app.ts` + `app.inject(...)`

## Env Edge richieste

- `APP_ENV`
- `API_HOST`
- `API_PORT`
- `API_JWT_SECRET`
- `ACCESS_TOKEN_TTL_SECONDS`
- `REFRESH_TOKEN_TTL_SECONDS`
- `SUPABASE_DB_URL`
- `SUPABASE_PROJECT_REF_EXPECTED`
- `SUPABASE_PROD_PROJECT_REF`
- `ALLOW_DEV_PROD_DB`
- `CORS_ORIGIN`

## Deploy locale

```bash
supabase login
supabase functions deploy gmd-api --project-ref <project-ref> --no-verify-jwt
```

## Workflow CI

- File: `.github/workflows/supabase-edge-deploy.yml`
- Dev deploy automatico su push branch (`main`, `release/**`)
- Prod deploy automatico su tag `v*`
- Deploy manuale con `workflow_dispatch`

## Rotazione password obbligatoria

- Endpoint login restituisce `password_rotation_required`
- Endpoint nuova password: `POST /auth/rotate-password`
- Hashing/verifica password lato DB con `pgcrypto` (`crypt`, `gen_salt('bf')`)
