# Design

## Context

Since #130, an import may name the core context, a built-in list (the IFF contexts), the deployment's, and contexts added in the System area. The routes that change the list, and the risks check, are open to every signed-in operator. The backend signs in operators itself, with a password grant on the platform's client, and holds one session (#36); the platform's realm defines `Factory-Admin`, `Factory-Writer` and `Factory-Reader` on that client.

## Goals / Non-Goals

**Goals:** only a factory admin changes what the broker may fetch; everyone else still sees what is allowed and who may change it; common vocabularies importable without adding them.

**Non-Goals:** roles elsewhere in XANA; per-operator sessions (#36); a configurable role.

## Decisions

### D1: The role from the session's own token

The backend reads the operator's roles from `resource_access.<client>.roles` in the access token its session obtained from Keycloak itself, never from anything the caller sends. The client is `KEYCLOAK_CLIENT_ID`.

*Alternatives:*
- Asking Keycloak (token introspection or the user's role mappings) on every change: an extra call and a service client with more rights, for a token the backend received from Keycloak a moment ago.
- A role list kept in XANA: a second place to administer operators.

### D2: `Factory-Admin` on the platform's client

The platform already uses this role for whoever administers a factory, so no realm needs a change. `Factory-Writer` and `Factory-Reader` don't suffice: allowing a context decides what the broker fetches from inside the platform.

*Alternative:* a new XANA role, or a configurable one. Each deployment's realm would need it first; a setting can follow if a deployment asks.

### D3: Refused as `unauthorized`, with HTTP 403

No new error kind: the data sources already map 403 to `unauthorized`, which nothing treats as a sign-out. The message names the role, such as "Only an operator with Factory-Admin on client scorpio can change the allowed contexts."

*Alternative:* a new kind `forbidden`, which every screen and both sources would have to learn for one card.

### D4: The risks check for admins only

It tells whether a name resolves inside the network, which only someone who may allow the address needs.

### D5: Without sign-in, nobody may change the list

With `KEYCLOAK_URL` unset, no token carries the role, so the list is read-only and only the deployment's configuration extends it.

*Alternative:* allowing everyone when sign-in is off. A deployment that leaves sign-in off would quietly let anyone who reaches it decide what the broker fetches.

### D6: Built-in well-known contexts, served by their own host

The built-in list, in `app/ngsi/contexts.py`, holds the IFF contexts and well-known vocabularies whose own host serves the context, each with a label:

| Entry | Label |
|---|---|
| `https://industryfusion.github.io/contexts/` | IndustryFusion |
| `https://uri.etsi.org/ngsi-ld/` | ETSI NGSI-LD |
| `https://schema.org/` | schema.org |
| `https://smartdatamodels.org/context.jsonld` | Smart Data Models |
| `https://raw.githubusercontent.com/smart-data-models/data-models/master/context.jsonld` | Smart Data Models |
| `https://fiware.github.io/data-models/` | FIWARE data models |
| `https://www.w3.org/ns/` | W3C vocabularies |
| `https://www.w3.org/2018/credentials/v1` | W3C Verifiable Credentials 1.1 |
| `https://ref.gs1.org/voc/data/gs1Voc.jsonld` | GS1 Web Vocabulary |

Each was fetched as `application/ld+json` and answered from its own host, without a redirect to another one. Redirect services such as `w3id.org` and `purl.org` are left out: they can point anywhere, so their entries would allow whatever they point to. So are paths below which others can publish: raw.githubusercontent.com serves a fork's commits under the parent repository's path, by SHA and through `refs/pull/<n>/head`, so only the exact Smart Data Models context on the `master` branch is built in there; a branch name resolves in the parent repository. Where a host serves several contexts of one owner and only that owner publishes there, the entry is the path they share; otherwise the single URL.

*Alternative:* whole hosts, such as `https://www.w3.org/`. Pages there redirect to other hosts that the list never meant to allow.

### D7: The list says who may change it

`GET /api/ngsi/contexts` adds `mayChange` (the operator has the role) and `changeRole` (the role, with the client), and a `label` per context (the built-in ones and the core). The System area shows the list either way; without the role it offers neither *Allow…* nor *Remove…* and says which role may change it. The mock source gets a development control for an operator without the role, and refuses as the backend does: nobody may change the list with sign-in off or while signed out. When the backend has no memory database, the list says that first, as nobody can add a context then.

### D8: The import's refusal says who may allow a context

A refused context's reason already points to the System area; it now adds that an operator with `Factory-Admin` on the platform's client can allow it there, so an operator without the role knows whom to ask.

## Risks / Trade-offs

- **One session per backend (#36):** the operator signed in last decides for every browser until per-operator sessions exist.
- **Prefix entries trust their owners:** `https://schema.org/` or `https://www.w3.org/ns/` allow whatever those owners publish below them, as the IFF entry does today.
- **Roles change at the next token:** a role removed in Keycloak applies once the session's token is renewed, within its lifetime (5 minutes on the platform).
