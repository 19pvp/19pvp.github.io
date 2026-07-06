# Architectural Decision: Discord OAuth Gate for Logs

## Date

2026-07-06

## Status

Proposed

## Context & "Why"

The logs page at `web/index.html` exposes journal logs and worldserver controls through the Deno API service in
`service/server.ts`. These routes are operationally sensitive and should only be available to authorized Discord GMs.

The first version should avoid schema changes and keep the auth surface small: use Discord OAuth authorization-code
login, verify guild roles with the Discord bot token, store sessions in server memory, and keep only an opaque signed
session id in an HttpOnly cookie.

## Decisions & Rationale

1. **Use Discord OAuth Authorization-Code Login:**
   - **Why:** Discord is already the identity and GM-role source for the project. The official authorization-code flow
     gives the browser a redirect-based login without exposing bot credentials or OAuth tokens to client JavaScript.
2. **Validate OAuth State with a Short-Lived Signed Cookie:**
   - **Why:** The callback must reject missing or mismatched `state` values to prevent CSRF-style login attacks.
3. **Use In-Memory Sessions for v1:**
   - **Why:** This avoids a new database table while still allowing server-side session revocation and private token
     storage. Service restarts intentionally invalidate sessions and require re-login.
4. **Store Only a Signed Opaque Session Id in the Browser:**
   - **Why:** The browser should not receive Discord tokens, role lists as authority, or mutable session data. The
     `logs_session` cookie should be `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, and expire after 7 days.
5. **Authorize by Existing GM Role Mapping:**
   - **Why:** The Discord bridge already maps `GM_LEVEL_1`, `GM_LEVEL_2`, and `GM_LEVEL_3` role ids to GM levels. Reusing
     that policy keeps admin access consistent across Discord chat sync and the logs UI.
6. **Protect Logs and Worldserver Routes Server-Side:**
   - **Why:** UI gating is not sufficient. The API should require a GM session for `/logs/events`, `/logs/search`,
     `/logs/file`, `/worldserver/status`, `/worldserver/events`, `/worldserver/start`, `/worldserver/stop`, and
     `/worldserver/kill`.
7. **Gate the Browser UI Before Starting Requests:**
   - **Why:** `web/index.html` should call `/auth/me` first and avoid opening EventSource connections or fetching
     logs/status until the server confirms an authorized GM session.

## Constraints

- All the interaction with discord must be made using the api exported from `service/discord.ts` file.
- The new code should be in a new `service/auth.ts` file and have minimal impact on the rest of the codebase

## Planned API

- `GET /auth/discord/login`
  - Creates a short-lived OAuth `state`.
  - Sets `discord_oauth_state` as an HttpOnly signed cookie.
  - Redirects to Discord's OAuth authorize URL with `scope=identify`.
- `GET /auth/discord/callback`
  - Validates `state`.
  - Exchanges `code` with `POST https://discord.com/api/oauth2/token`.
  - Fetches the Discord identity with `GET https://discord.com/api/v10/users/@me`.
  - Fetches guild roles with
    `GET https://discord.com/api/v10/guilds/{guild.id}/members/{user.id}` using the bot token.
  - Creates an in-memory session when the user has a configured GM role.
  - Sets `logs_session` and redirects to `/`.
- `GET /auth/me`
  - Returns `{ authenticated, user, roles, gmLevel }`.
- `POST /auth/logout`
  - Deletes the in-memory session.
  - Best-effort revokes the Discord access token.
  - Clears `logs_session`.

## Configuration

Required environment variables:

- `DISCORD_CLIENT_ID`
- `DISCORD_CLIENT_SECRET`
- `DISCORD_GUILD_ID`
- `DISCORD_TOKEN`
- `SESSION_SECRET`
- `PUBLIC_BASE_URL`

Optional environment variable:

- `WEB_ORIGIN`
  - When the web page is served from a different origin, authenticated routes should return
    `access-control-allow-origin: WEB_ORIGIN` and `access-control-allow-credentials: true`.

The OAuth redirect URI is:

```text
${PUBLIC_BASE_URL}/auth/discord/callback
```

## Rejected Alternatives

### 1. Persisting Sessions in a New Database Table

- **Why Rejected:** Durable sessions are useful later, but v1 does not require persistence across service restarts.
  Avoiding a migration keeps the first implementation smaller and easier to roll back.

### 2. Trusting Client-Side Role State

- **Why Rejected:** Role checks must happen server-side against Discord data fetched by trusted credentials. Client
  JavaScript can only use `/auth/me` for display and request sequencing.

### 3. Protecting Logs but Leaving Worldserver Controls Public

- **Why Rejected:** The current admin UI exposes worldserver controls alongside logs. Keeping those routes public would
  leave the most operationally sensitive actions unauthenticated.

## Weird Behaviors & Things to Keep in Mind

- **Restart Invalidates Sessions:** In-memory sessions are lost when the Deno service restarts.
- **Non-GM Guild Members Are Authenticated but Forbidden:** A user may have a valid Discord identity and guild
  membership but still receive `403` if none of their roles map to a GM level.
- **Missing Guild Membership Fails Login:** If the Discord bot cannot fetch the member record, callback authorization
  should fail.
- **Credentialed CORS Requires a Specific Origin:** Browsers reject credentialed requests with wildcard CORS. Configure
  `WEB_ORIGIN` when the page and API are cross-origin.
- **Do Not Log Secrets:** OAuth access tokens, refresh tokens, auth codes, cookies, and private user data must not be
  logged.

## Verification Plan

- Visit the logs page signed out and confirm it calls `/auth/me` before opening log/status streams.
- Sign in with a Discord account that has a configured GM role and confirm logs, search, download, and worldserver
  controls work.
- Sign in with a guild member without GM roles and confirm the UI shows access denied and protected APIs return `403`.
- Hit `/logs/events` directly without a valid cookie and confirm it returns `401`.
- Call the callback with missing or invalid `state` and confirm it fails.
- Log out and confirm protected endpoints return `401`.
- Restart the service and confirm the previous session no longer works.
- Check service logs for accidental OAuth token, auth code, session cookie, or private-data output.
