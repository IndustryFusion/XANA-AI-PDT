# Design

## Context

The gateway reports, per consumer, each capability's status and source (`GET /capabilities/access?consumer=`): `auto` and `on-request` by default, `pending`, `approved` and `denied` when explicit (`protocol.md`, "Effective status"). It has no notion of an access level; XANA derives one. The UI's interface maps statuses to `granted`, `denied` and `default` (`gh-26-dataspace-connection`), which can't tell an `approved` from an `auto`, so the level is worked out in the backend. The IFRIC registry offers `GET /company/get-all-companies`, `GET /company/factories/{id}/owner` and `GET /company/assets/{id}`, besides the company details the backend uses now. There is no conflict with `architecture.md` or the specs.

## Decisions

### Access levels

| Level | Rule, over the capabilities a peer may access here |
|---|---|
| `elevated` | at least one is `approved` |
| `restricted` | none is `approved`, and at least one is `denied` |
| `standard` | only defaults or `pending` |

`approved` means the factory chose to give this peer more than its defaults, which is what an operator wants to keep an eye on. A peer whose access couldn't be read has `access_level: null` and the error, and is counted apart as "unknown", never as standard.

The levels and their counts are answered by a new `GET /api/gateway/access-levels`, which the dashboard reads. Each peer of `GET /api/gateway/peers` and `GET /api/gateway/policies` carries its level too, read in the same way. `policies` stays a list, as before.

Alternative: `elevated` only for an approval of a capability whose default is `on-request`. The answer for an explicit status doesn't say the default, so XANA would need its own copy of the catalogue, which can drift from the contract.

### Configuration

`GET /api/gateway/config` adds the gateway address, the identity provider's address, and the registry address, each masked as the health report masks addresses, and the client in use while connected. The connection state comes from `status`, as now. Secrets, tokens and the encryption key are never read into the answer, and a test checks the answer for the configured secret.

### The builder's current access when approving

The approval panel reads `GET /api/gateway/peers/{builder}/capabilities` when it opens, and offers a refresh. It shows the "here" direction, what the builder may access at this factory, with the status as the gateway has it. A failed read says so, and approving or denying is still possible, since the decision is about the request, not the read.

### Names

`names()` keeps company details first. When they don't name the company (refused, `{company: null}`), it looks in the company directory, read once and kept for 300 seconds, read again sooner when the dataspace token changes. When still unnamed, it asks for the factory's owner, for IDs that are factories. Machine IDs go through a separate `POST /api/ifric/resolve-machines`, which reads `GET /company/assets/{id}` and takes the asset's name. Each lookup failing leaves that ID without a name, as now.

Keeping machines apart means a list of companies doesn't cost asset lookups, and the reverse. The UI already knows which IDs are machines.

Alternative: one `resolve` that tries every kind for every ID. Up to four requests per unknown ID, and an asset and a company with similar names couldn't be told apart.

### Found in implementation

- **The registry has no asset name.** Its asset record holds the asset's ID, its manufacturer, owner and factory, and whether it is twinned, but no name. `resolve-machines` takes `asset_name`, `product_name` or `name` when an answer has one, and otherwise leaves the machine out, so with this registry the screens show machine IDs. Naming assets needs the registry to keep a name, which this change can't add.
- **A stopped registry within 300 seconds of reading the directory** still names the companies in it, from what was read. After that, or after a restart, names are left out and IDs are shown.

### A slow or failing registry

Found in review: names were looked up one after the other where the directory and a factory's owner were asked, with 10 s limits, so a hanging registry made `peers` and `access-levels` take about 10 s per peer, past the UI's 15 s. Now:

- All of one lookup of names ends within 3 s, whatever the number of IDs. What isn't known by then has an empty name in that answer only; running out of time doesn't count as the registry failing, so a long list on a slow registry doesn't stop it being asked.
- A request of a name lookup that takes over 2.5 s, a registry that can't be reached, or 3 server errors in a row pause the registry's name lookups for 30 s. A single server error for one record, a refusal or an unknown company don't.
- The directory kept from an earlier read is used first, also while the registry is paused: only the requests are skipped, so it names the companies in it for its 300 s.
- The directory is read once at a time, with its own 10 s limit. A read still going when a lookup's time is up goes on and is kept for the next lookup.

## Risks

- The directory holds every company in the registry, kept in memory for 300 seconds. It is used only to name IDs XANA already has.
- A peer's level is as fresh as the last read of the policies; the tile reads it on load and refresh.
