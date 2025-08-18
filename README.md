# applicationAgent MCP Server

This server uses Google Sign-In for inbound auth and can read Google OAuth Client ID/Secret from macOS Keychain at startup.

## macOS Keychain setup

Save your credentials into the login keychain as generic passwords (project-scoped account names):

```
security add-generic-password -a applicationAgent.GOOGLE_OAUTH_CLIENT_ID -s applicationAgent.google.oauth -w '<your-client-id>' -U
security add-generic-password -a applicationAgent.GOOGLE_OAUTH_CLIENT_SECRET -s applicationAgent.google.oauth -w '<your-client-secret>' -U
```

- `-a` is the account (we use the env var names as accounts)
- `-s` is the service name; you can change it by setting `GOOGLE_CLIENT_KEYCHAIN_SERVICE`

## Load secrets and start

```
npm run start:macos
```

What it does:
- Reads Client ID/Secret from Keychain via `scripts/load-secrets.zsh`
- Writes `.env` with `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` and `OIDC_AUDIENCE`
- Exports them to the shell
- Starts the server via `tsx`

Alternatively, if you already have a `.env`:

```
npm run dev
```

## Notes
- `.env` is ignored by git (see `.gitignore`).
- The server does not use dotenv; it relies on environment variables already present at process start.
- Authorized redirect URI must match: `http://localhost:3000/auth/google/callback` (or your host).
