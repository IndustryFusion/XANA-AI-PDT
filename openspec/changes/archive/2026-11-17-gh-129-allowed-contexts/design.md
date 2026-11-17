# Design

## Context

The context broker fetches a context named by URL itself, from inside the platform and without checks, so the import lets through only the ETSI core context and the configured ones (`NGSI_CONTEXT_URL`, `NGSI_ALLOWED_CONTEXTS`). Its refusal deliberately repeats no address. The memory database already keeps settings that operators change, such as the dataspace credential.

## Goals / Non-Goals

**Goals:** the platform's own contexts allowed out of the box; the list visible, and extensible without a redeployment; a clear statement of the risk before an address is allowed; a refusal that tells the operator what to do.

**Non-Goals:** roles; fetching and inlining contexts; checking the contexts a context imports.

## Decisions

### D1: An allow list, with a maintained built-in part

The list stays an allow list, made of four parts: the core context, a built-in list in `app/ngsi/contexts.py` (the IFF contexts on `https://industryfusion.github.io/contexts/`), the deployment's, and those added. An entry ending in `/` allows what is below it, compared as text, so a host that only starts with the same name (`industryfusion.github.io.evil.example`) doesn't match.

*Alternatives:*
- A list of forbidden addresses, allowing everything else. The broker fetches later, by itself: a public address can redirect to an internal one, or resolve to one by then, and the backend can't see that.
- Fetching every context in the backend and inlining it. The broker would never fetch, but every entity would carry the whole context, and the broker's caching by URL would be lost.

### D2: Added contexts in the memory database

A table `allowed_contexts` (URL, who added it, when) keeps the added ones. Each backend reads it at most every 30 seconds, before an import and when the list is asked for, so a change made through another backend applies within that time. When it can't be read, the ones read last stay in force, and the list says so.

*Alternative:* the deployment's configuration only. Adding a context would take a redeployment.

### D3: The risk said before, never checked by connecting

Before a context is added, the System area states what allowing any context means, and the backend names the risks of the address: plain http, a host that is or resolves to an address inside the network (the same test as *Import from a URL*), or one that can't be resolved. The backend only resolves the host's name; it never connects to the address, as no route may make it call one (*Service settings*). The risks are said, not refused: the operator may have an internal context server.

### D4: The refusal names an external context only

The reason names the refused context, so the operator sees what to allow, unless the address looks internal: an IP address that isn't public, a name without a dot, or a name ending in `.local`, `.internal`, `.svc` or `localhost`. That keeps the reason from echoing internal addresses, as before. It points to the System area.

## Risks / Trade-offs

- Any signed-in user can add a context; the warning is the only guard until there are roles.
- A public context can later redirect, or its host can later resolve, to an internal address; allowing it trusts its owner, as the warning says.
