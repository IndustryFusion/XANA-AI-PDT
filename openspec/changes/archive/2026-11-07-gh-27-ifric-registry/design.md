# Design

## Answers to the questions in the issue

### 1. Does the dataspace client's token carry `participant_id`?

Yes. `keycloak.md` in the dataspace repository makes it a hardcoded claim of every participant's client, and a real token from a local dataspace had it. The registry's access control matches that claim against a company's `company_ifric_id`, so **a participant's ID has to equal its company's `company_ifric_id`**, which `keycloak.md` also states for participants onboarded from the registry. A participant that matches no company gets `403` on the routes that need a party, and the registry and dataspace must share a realm, as the registry checks the issuer.

### 2. Does a machine's NGSI-LD ID equal the registry's `asset_ifric_id`?

Not by anything either side guarantees. The registry looks an asset up by `asset_ifric_id`, a URN it was given when the asset was registered. XANA's sample machines are `urn:ngsi-ld:Machine:…`. Where the twin's entity was created with the registry's URN as its ID they are equal, and this is what this change relies on: XANA asks with the entity ID, unchanged. Where they differ, the registry answers `{company: null}`, so the machine has no known builder, escalation says why, and nothing is sent to a wrong party.

**Proposal for where they differ, not built here:** a property on the machine's entity holding the registry's URN, for example `assetIfricId`, read before asking the registry, with the entity ID as the fallback. It needs agreement on the property's name with whoever provisions the twin, so it is raised with the maintainers in the Pull Request.

### 3. Where do machine names come from?

From the context broker: the entity's `name`, or else the last part of its ID, as the diagnostic workflow already does. Registry assets have no name field.

## Decisions

### What a failure gives

| Case | `resolve` (names) | Builder | Factory |
|---|---|---|---|
| Not found (`200` with `null`, or an empty list) | Left out | No builder, with a reason | `not_found` |
| `403` | Empty name | No builder, with a reason | `unavailable`, except that a `403` on the owner only leaves the owner out |
| Unreachable, timeout, `5xx` | Empty name | No builder, with a reason | `unavailable` |
| No dataspace token | Empty name | No builder, with a reason | `unavailable` |

An empty name is how the issue describes a failed lookup, and it is what lets a screen tell it from an unknown ID: both show the ID. `resolve-builders` gives only names, like the interface, and the reason is for #28's preflight, which calls the same function.

Alternative: fail the whole `resolve` call. One bad ID would then cost every name on the screen.

### Asking for several

`resolve` asks one by one, up to 8 at a time, for at most 200 IDs per call, as the registry has no bulk route the issue allows. Each ID is asked once per call.

### Public profiles

A peer's company comes as a public profile, with fewer fields. Only what came back is used, so an absent field is left out.

### Identifiers

Each is sent as one path segment, with `:` as `%3A`. Answers keyed by identifier aren't key-mapped in the UI's source: an ID holding `_` must stay as it is.

### Health

`ifric` reads the own company with the dataspace token. `401` and `403` are `error`: for the registry, the token not being accepted or the company not being matched means the routes can't work. No token is `degraded`. No `IFRIC_URL` is `ok`, saying so, and doesn't count towards the overall state.

### Local setup

A stub of the four routes in `sample_data/`, under the profile `ifric`, as the registry's own compose has its own PostgreSQL, Keycloak and setup steps. It answers like the registry for the sample machines, and doesn't check tokens.

## Conflicts

None with `architecture.md`. Its escalation flow's call to the registry stays. Conversation with `gh-26-dataspace-connection`: a peer's `name` becomes its company's name here, and stays the ID without a registry.
