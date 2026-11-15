# Design

## Context

The gateway's capability access answers carry a status (`auto`, `on-request`, `pending`, `approved`, `denied`), a label and a description. The backend maps the status to `granted`, `default` or `denied` (*Status mapping*) and passes label and description on, but the page shows only the mapping and its own names.

A failed connect raises a refusal with a kind and a message. Nothing else about the failure reaches the page.

The client ID is the operator's company or the configured one. Without either, the state is `not_configured`, the same as an unconfigured deployment.

## Goals / Non-Goals

**Goals:** an overview at a glance; the gateway's statuses and names; enough detail to diagnose a failed connect; a correct hint when only a sign-in is missing.

**Non-Goals:** new gateway operations; editing the tier; showing token claims.

## Decisions

### D1: The gateway status beside the mapping, not instead of it

Each capability keeps `status` (`granted`, `default`, `denied`) and gains `gateway_status`, the gateway's own value when it is one of the five it defines, else nothing. Clients that use the mapping keep working, and the page shows the gateway's status when there is one.

*Alternatives:*
- Replace the mapping. That breaks the access levels and existing clients.
- Derive auto versus on request in the page from a fixed list of defaults. That goes stale when the gateway's defaults change.

### D2: Actions by status

The page offers what fits the status:

| Status | Actions |
|---|---|
| auto | deny |
| on request, pending | approve, deny |
| approved | deny, reset |
| denied | approve, reset |

Without a gateway status, it falls back to every action except the one leading to the current mapping. Each action is confirmed, as today.

*Alternative:* the same three actions everywhere, which offers actions that change nothing.

### D3: Refusals can carry details

A refusal gets an optional `details` object, sent beside `kind` and `message`. Connect failures fill it:
- the stage (`identity_provider` or `gateway`);
- the address with credentials masked, as the configuration endpoint already masks them;
- the client;
- the HTTP status;
- the identity provider's OAuth `error` code, from the standard vocabulary (such as `invalid_client`), cut to 64 characters; never its `error_description`, as it is another service's message;
- or, for a failure to connect at all, the error's class name.

Never a secret, a token or a broker message. The page shows the message, plus the details behind a disclosure.

*Alternatives:* more messages, which mix diagnosis into what operators read first; or logging only, which operators can't see.

### D4: `needs_sign_in` in the status

The status gains `needs_sign_in`, true when the gateway and its identity provider are configured but no client is known. The page then asks for a sign-in instead of saying that nothing is configured.

*Alternative:* a separate state. That changes every client of `state`.

### D5: One gateway card, the tier folded, peers below

- The connection card takes the configuration's rows. The configuration card goes away.
- A token box shows validity, expiry and the time left, ticking each second without announcing it, in the warning tone in the last minute and in the danger tone once expired.
- The tier becomes one line with a disclosure.
- The peers follow the card.

*Alternatives:* keep the cards and only reorder them, which keeps the duplicate state; or a side-by-side layout, which narrows the peers.

### D6: Peer type and grants in the list

The peer list carries `participant_type` and `approved` from the gateway. The page shows the type's last term in words (`…#machine_builder` → *Machine builder*). For an elevated peer it shows the approved capabilities as pills marked low, medium or high sensitivity, by the tier order, in text as well as colour.

## Risks / Trade-offs

- [The gateway's labels may differ from what XANA sends at a tier] → The tier text keeps saying exactly what is sent, and uses the gateway's names only as names.
- [The OAuth error code is a short hint only] → Together with the step and the HTTP status, it tells a wrong secret from an unknown client or an unreachable service.
