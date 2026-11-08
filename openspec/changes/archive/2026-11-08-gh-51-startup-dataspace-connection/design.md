# Design

## Context

`gh-26-dataspace-connection` connects by itself after sign-in, or at startup when sign-in is off, and tries 3 times at startup, 60 seconds apart. The inbox poller (#29) and the registry client (#27) already use the connection's token whenever there is one, so once the backend is connected at startup they work with nobody signed in. There is no conflict with `architecture.md`; its "Dataspace connection" paragraph gains one sentence.

## Decisions

### Connect at startup whatever the sign-in setting

The startup connection runs whenever the gateway is configured. With sign-in on and nobody signed in, the operator's `ifric_company_id` is not known, so the client is `GATEWAY_CLIENT_ID`, which is the rule from #26. Without `GATEWAY_CLIENT_ID` the state stays `not_configured` until someone signs in, as now.

A stored disconnect still wins: an operator who disconnected has said the backend should not connect by itself, and that holds after a restart.

### Which identity, when an operator of another company signs in

The rule from #26 chooses the client when a connection is made: the operator's `ifric_company_id`, else `GATEWAY_CLIENT_ID`. A sign-in only connects when the backend isn't connected, so a connection made at startup as `GATEWAY_CLIENT_ID` stays when an operator whose token names another company signs in. Replacing it would need that company's secret, which the backend doesn't have, and would drop the token the inbox is using. To act as another company, the operator disconnects and connects again; the connection is then made under the rule as it applies at that moment.

The status and configuration name the client in use while connected, and the client that would be used otherwise, so an operator can see the difference.

Alternatives considered:

| Option | Why not |
|---|---|
| Reconnect as the operator's company at each sign-in | Needs a secret per company; one operator signing in would cut the inbox off for everyone if that grant fails |
| Refuse sign-in of an operator of another company | Sign-in is about the operator, not the dataspace client; it would lock operators out over a backend setting |

### Retry while unreachable

The issue asks for a startup failure to be retried, and the point of the change is to receive messages without anyone acting. So a refusal as `unavailable` (identity provider or gateway not reachable, or the memory database not reachable to read the stored secret) is retried every 60 seconds until the connection is made, the operator disconnects, or the backend stops. A refusal as `unauthorized` or `conflict` (a rejected secret, a token without `participant_id`, a key that can't read the stored secret) is not retried, as repeating it changes nothing. The same applies to the connection attempted after sign-in, so that both are handled alike.

Alternative: keep 3 tries. A backend that started before Keycloak was ready for more than 3 minutes would then not connect until someone signed in, which is the case the issue is about.

### What health shows

The `dataspace_connector` check stays `degraded` while not connected. Its detail adds the reason of the last failed attempt, without addresses or secrets, and says whether the backend is still trying or has stopped and why. The `gateway` check is unchanged.

## Risks

- Retrying every 60 seconds against an identity provider that is down sends one token request a minute. That is the renewal loop's rate already.
- The backend acts in the dataspace as `GATEWAY_CLIENT_ID` from startup, with nobody signed in. That is already so with sign-in off; the deployment chooses the client by setting it.
