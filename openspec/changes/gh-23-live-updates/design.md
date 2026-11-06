# Design

## Context

The explorer already subscribes through `subscribeEntities` and polls `getLiveUpdateHealth`. Sign-in offers `on_sign_in` hooks, and refreshes the token in the background.

## Findings: what was checked first

From the platform's charts and authentication service, and a real Scorpio (6.0.2) and EMQX (5.8.8, the platform's version).

**May the operator's token subscribe? Yes, given the role below.**

- EMQX authenticates each connection over HTTP to the platform's MQTT bridge (`/auth`), with the user name, the password as the token, and the client ID, and authorises each topic through `/acl`.
- `/auth` verifies the token against Keycloak. A token with `Factory-Admin` or `Factory-Reader` under `resource_access.scorpio.roles` is allowed, whatever the user name, and its client ID is recorded as a factory user.
- `/acl` allows such a client to publish and subscribe on any topic outside `spBv1.0/`. `spBv1.0/` topics are limited to its own realm.

**Setup needed:**

| Need | Status on the platform |
|---|---|
| The operator has `Factory-Admin` or `Factory-Reader` on client `scorpio` | Must be assigned to each operator. The realm's test user has `Factory-Admin`. Without it the connection is refused and the state says so. |
| The token's audience includes `mqtt-broker` | The `scorpio` client's mapper already adds it. |
| Scorpio can reach EMQX | `MQTT_BROKER_NOTIFY_URL`, because Scorpio may need a different address from the backend's. |

**Other findings:**

| Question | Finding | Consequence |
|---|---|---|
| Authentication timing | EMQX checks the token when a client connects. A connected client is not dropped when the token expires. | The backend's own connection stays, and uses the newest token on a reconnect. |
| How Scorpio publishes | The endpoint is `mqtt://<user>:<token>@host:port/topic`, so **the token is in the subscription**. | See decision 3. |
| `receiverInfo` | The 6.0.2 image fails every MQTT notification with a null pointer error if `receiverInfo` is missing, while the subscription still reads as `ok`. The platform's own test omits it. | It is always sent. |
| `notifierInfo` | MQTT version or QoS entries were refused with 400 here. | Not sent. Delivery is QoS 0, so a change during an outage isn't redelivered. |
| All types | `entities: [{"type": "*"}]` is accepted. | The subscription covers everything, and the backend filters per browser. |
| Payload | `{"metadata": [...], "body": {"subscriptionId", "data": [{"id", "type", <attributes>}]}}`. | Parsed defensively; other messages are dropped. |
| Renewal | `PATCH /subscriptions/{id}` changes `expiresAt` and the endpoint in place. | Renewal has no gap. |
| Deletion | Deleted entities are not notified. | Not shown live. |
| Broker logs | Scorpio's errors print the subscription's fields, but its endpoint only as an object reference. A long token did not appear in its logs. | Recorded; applies to the version tested. |

## Decisions

### 1. One subscription per backend, filtered per browser

One subscription, with a random topic per process. Each `/api/ngsi/ws` client states a type or IDs, and gets only those. Each client has a bounded queue. A client that falls behind is closed, so it can't hold others up or silently lose messages; it reconnects.

**Alternative:** one subscription per browser. Rejected: more state in the broker, and more to leave behind.

### 2. Rotation is noticed by watching the token

The manager checks every 5 seconds whether the session's token changed, and patches the subscription if so. It renews 1 hour before `expiresAt`, and checks every 60 seconds that the subscription still exists, creating it again if not. `app/auth.py` doesn't change, in keeping with the current session decision (#36).

**Alternative:** a refresh hook in the session. It reacts sooner, but changes a design under review for little gain, as the old token stays valid for about a minute after rotation.

### 3. Tokens in addresses

The endpoint is built only where it is sent, and is never stored, logged or returned. The log filter also masks `scheme://user:password@` and anything shaped like a JWT, so a library's message can't carry one.

**The limit that remains:** anyone who may read subscriptions from Scorpio can read the token until it expires. Scorpio has no other way to give credentials for an MQTT endpoint.

**Alternatives:** the platform's own tests use the broker's admin password in the address, which is a far worse secret to expose; a service account would avoid an operator's token, but the platform's `scorpio` client is public, and this is the question already open in `gh-21-keycloak-sign-in`, decision 3.

### 4. Nothing left behind

- Sign-out deletes the subscription first, while the token still works. The route does this, so the session is unchanged.
- Shutdown deletes it.
- If the session ends without a sign-out, or the process dies, the token is no longer renewed, and the subscription runs out by `expiresAt`, at most 24 hours later. It holds a token which has expired by then or soon after.
- The first start after sign-in removes older subscriptions with the same name, left by an earlier process. **Limit:** two backends sharing one broker would remove each other's once at start; each then creates its own again within 60 seconds.

### 5. MQTT client

`aiomqtt` (BSD-3-Clause), on `paho-mqtt`, which is widely used and fits asyncio. **Alternatives:** `gmqtt` (less used), writing the protocol (no).

`MQTT_MGMT_URL` is used only for the broker's unauthenticated `/status`, to tell "the broker is up but refuses us" from "the broker is down" in the health detail.

### 6. State

`/api/ngsi/subscription-health` gives `status` (`ok` or `unavailable`), `state` (`waiting_for_sign_in`, `connecting`, `active`, `broker_unavailable`, `refused`, `subscription_failed`, `stopped`), `detail` and `expires_at`. It never holds the endpoint. The UI's existing indicator and its resubscribe after `ok` apply as they are.

## Risks and limits

- **Open API.** Anyone who can reach the backend can read the stream while the shared session stands (see #36).
- **The platform's authentication service was not run here.** It needs Kafka, Redis and more of the platform. Its `/auth` and `/acl` rules were read from its code, and a small stand-in with the same rules was used in front of a real EMQX and Keycloak. The PR states this.
- **Changes during an outage are not replayed.** The explorer's values can be stale until reloaded or changed again.
