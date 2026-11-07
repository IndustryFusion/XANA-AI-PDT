# Design

## Conflicts

- **The spec `operator-ui/system-health` says service settings are editable, with changes used by the next health check, and `frontend/docs/data-interface.md` describes `saveServiceSettings`.** The issue says addresses must not be accepted from the browser for backend calls. So on a backend they are read-only. The mock keeps its form, as it makes no backend calls. A requirement is added here for the backend source, and the spec's scenario stands for the mock.
- **`connector` becomes `dataspace_connector`,** as the issue names it. Nothing else reads the ID: screens show the label.

## Decisions

### Whether operators can override addresses at runtime

**No.** `GET /api/config` shows each address as deployed, with a password masked, and `saveServiceSettings` on a backend is refused as `conflict`.

| Alternative | Why not |
|---|---|
| Overrides stored in the backend, used by health checks only | The report would describe something other than what the backend uses |
| Overrides used for backend calls | An operator could point the backend's tokens and data at any address: that is what the issue rules out |
| Overrides limited to a list set at deployment | A feature nobody asked for, and the same as a redeployment |

### Automatic archive of finished runs

**Dropped.** A finished run stays in the open list until an operator archives it. Every approved spec has archiving as the operator's act, and with #30 a run can fail with nobody watching, so moving it out of sight by a timer would hide just that. The list can grow with triggered runs. Alternative: archive finished runs after a retention time, which keeps the list short and can be added later without loss.

### Checks

| ID | Probe | Failure |
|---|---|---|
| `alerta` | `GET {ALERTA_URL}/alerts/count` with the key | 401/403: the key is refused |
| `mqtt` | An MQTT connection to `MQTT_BROKER_URL` with the operator's token, as live updates do | Refused credentials. With sign-in on and nobody signed in, only reachability can be checked, which is `degraded` |
| `pgrest` | `GET {PGREST_URL}/{table}?limit=1` with the operator's token | 401/403 |
| `gateway` | `GET /health`, as before | |
| `dataspace_connector` | Through the adapter, as before, with what that can't see in its detail | |
| `ifric` | As before | 401/403 |
| `fuseki` | `ASK` for any triple in the dataset | 401/403, or no dataset. **An empty one is `degraded`** |

Each check gains `probe` (the address, with a password masked) and `hint` (what to look at when it fails). A service with a default address is always probed, so a service that isn't installed shows red: a report can't tell that from one that stopped. Those with no default keep their "not configured" and stay out of the overall result. The memory check's address is masked as before.

`mqtt` opens a real connection, as a TCP check can't tell a refused token. It takes a client ID of its own, and ends at once.

`machine_events` with Scorpio stopped is `degraded`, not `error`, so that only Scorpio's own check is red.

With nobody signed in on a platform that needs a token, `broker` and `pgrest` read as failed: a 401 is a failure, as the issue asks.

### Without the mock

`src/data/sources/backend/index.js` no longer imports the mock source. An operation with no implementation rejects as `unavailable` by the data facade, which is the interface's rule. `DevControls` is gone from backend builds. A test checks every interface operation is served and that nothing under `sources/backend` imports the mock.

## Architectural implications

The report now says more about addresses, and `/api/config` too, on an API that is open until #36. So both hold no secret: passwords are masked, and neither shows a key or token. They still reveal internal addresses to anyone who can reach them, as the health report already does.
