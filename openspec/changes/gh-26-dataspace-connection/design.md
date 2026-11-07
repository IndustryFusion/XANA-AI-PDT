# Design

## Context

The contract is `gateway-api.md` and `keycloak.md` in the dataspace repository. `architecture.md` names the gateway routes for later phases only. There is no conflict with it, except that its example sets `GATEWAY_KEYCLOAK_REALM=iff`, and the contract's realm is `dataspace`. The default follows the contract, and the example is corrected.

## Decisions

### One connection per backend process, in memory, with the secret in the database

Like the operator's session (`gh-21-keycloak-sign-in`), the token lives in memory only. The secret and whether the operator wants a connection live in the single row of `gateway_credentials`.

Alternative: keep the secret only in the environment. The issue asks for the table, and a secret typed on the screen needs a place to live.

### Where the secret comes from

In this order: what the operator typed, `GATEWAY_CLIENT_SECRET`, the stored row. A secret is stored, encrypted, once Keycloak accepted it, so a typing mistake never replaces a working one. The environment comes before the row so that rotating it takes effect.

### The key is needed whenever the gateway is configured

Any configured gateway may end up storing a secret, so `GATEWAY_URL` without a valid `SETTINGS_ENCRYPTION_KEY` stops the backend at startup, naming the variable. A key that cannot read the stored row, for example after it was changed, gives `conflict` on connect and the operator can enter the secret again. Encryption is Fernet from `cryptography` (authenticated AES), as there is no suitable function in the standard library.

Alternative: start anyway and refuse only when a secret must be stored. That hides a configuration fault until the first connect.

### Who the client is

`ifric_company_id` of the operator's token, else `GATEWAY_CLIENT_ID`. The token carries the participant ID that is shown (`participant_id`). If there is neither, the state is `not_configured`.

### Refreshing

`client_credentials` has no refresh token, so renewing is a new grant. A loop checks every 60 seconds and renews with 120 seconds or less left. After 3 failures in a row it stops. `status` reports the count and a detail, and the state becomes `expired` when the token runs out. Connecting again starts afresh. A `401` from the gateway renews once and repeats a read, as the contract advises. Renewals are one at a time, so concurrent requests share one.

Alternative: keep trying forever. The issue says to stop.

### Connecting by itself

After sign-in, or at startup when sign-in is off, unless the operator disconnected, which is stored. Startup tries 3 times, 60 seconds apart, as Keycloak may be starting too. Signing out of XANA leaves the connection alone, since it is not the operator's token and #29's inbox must go on.

### Access statuses

| Dataspace | Interface |
|---|---|
| `auto`, `approved` | `granted` |
| `on-request`, `pending` | `default` |
| `denied` | `denied` |

### Refusals

`404` is `not_found`, `409` is `conflict`, `403` and `422` are refused requests, so `conflict` and `invalid`. `502`, `503`, `504`, no answer, and `401` after a renewal are `unavailable`, with a message naming the gateway and no address or token. `connect` tells a rejected credential (`401`/`400` from Keycloak: `unauthorized`) from one that can't be reached (`unavailable`).

### Health

`gateway` is `GET /health`. `connector` reads through the participant's adapter with the token (`GET /capabilities/requests?status=pending`), as the agent contract offers no connector check and agents never call connectors. So a failing connector behind a working adapter does not show: this check can show only that the path up to the adapter works, and its detail says so. Not configured gives `ok` with that detail, so that a deployment without the dataspace is not degraded by it.

### `policies`

The issue names the route without a shape. It answers what each compatible peer may access here, from `GET /capabilities/access?consumer=`, with one failed peer marked as such.

## Risks

- One connection per process, like the operator's session.
- The backend's own API is not protected, so network access to it must be limited (`gh-21-keycloak-sign-in`). `token-claims` returns claims only, never a token.
