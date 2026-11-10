# Design

## Context

After #72, `deployment/kubernetes` has three environments (`default`, `production`, `localAndIonos`). The platform's address keys are empty in `default.yaml`, and `values.yaml.gotmpl` derives them from `platformNamespace`. Secrets come from the shell or the environment file. The database credentials come from `envs/iff-cluster.sh` or a Secret copied into `xana-pdt`, and `secretLookups` are read by the Pod from Secrets in `xana-pdt`. The backend checks pairs of settings, such as `SETTINGS_ENCRYPTION_KEY` with `GATEWAY_URL`, only when it starts.

This change, as #75 sets out, modifies the requirements "Installable chart", "Helm layout and environments", "Environment keys", "Backend secrets", "No secret or real host committed", "Platform namespace", "Database credentials in the release's namespace" and "Local test cluster on the default environment". It removes "The localAndIonos environment", and it adds "Sections of the default environment", "Platform Secrets read when deploying" and "Checked when deploying". There is no conflict with `architecture.md`, whose deployment section is updated. The backend is unchanged.

## Decisions

### Environments

- `default` (`default.yaml`) and `production` (`default.yaml`, then `production.yaml`). `environment/localAndIonos.yaml` is removed.
- `production.yaml` keeps only `imageTag: v0.1.0`, `imagePullPolicy: IfNotPresent` and `ingressTlsSecret: xana-tls`, each with a comment.
- On its own, Helmfile answers an unknown environment with `no releases found that matches specified selector() and environment(localAndIonos)`, which doesn't say why. So `helmfile.yaml.gotmpl` stops first, for that name only: "localAndIonos was removed: use -e default or -e production, and put your cluster's values in Section 2 of environment/default.yaml (see helm/README.md)." Any other unknown name gets Helmfile's own message.

### `default.yaml`: three sections

`default.yaml` holds every key the chart reads, in three sections. Each section opens with a header block, and each key has the comment its section asks for:

```yaml
# =====================================================================================================
# 1. FILLED IN FOR YOU
#    The platform's in-cluster addresses and XANA's defaults. Change one only if your platform differs.
# =====================================================================================================
ngsiUrl: http://scorpio-all-in-one-runner.iff.svc.cluster.local:9090   # the context broker

# =====================================================================================================
# 2. FILL IN FOR YOUR CLUSTER
#    External addresses and choices only you know. Each says what it is, an example, and what empty does.
# =====================================================================================================
# The platform's Keycloak as browsers reach it, with /auth if it has it.
#   Example:  https://keycloak.example.org/auth
#   If empty: sign-in is off, and anyone who reaches the UI can use it.
keycloakUrl: ""

# =====================================================================================================
# 3. SECRETS
#    Keep them empty here. Set the shell variable instead, for example from your own env file:
#      set -a; source my-secrets.env; set +a
#    A secret given neither way is read from the platform's Secrets when deploying (see the end).
# =====================================================================================================
# SETTINGS_ENCRYPTION_KEY
#   For:      encrypts the dataspace client secret that operators enter, in the database.
#   Required: when gatewayUrl is set.
#   Get:      python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())'
settingsEncryptionKey: ""
```

**Section 1, "Filled in for you":**
- `namespace: xana-pdt`, `platformNamespace: iff`.
- The images: `imageRegistry`, `imageTag`, `imagePullPolicy`.
- The platform's addresses, written out in full as `<service>.iff.svc.cluster.local`:
  - `ngsiUrl: http://scorpio-all-in-one-runner.iff.svc.cluster.local:9090`
  - `pgrestUrl: http://pgrest.iff.svc.cluster.local:3000`
  - `alertaUrl: http://alerta.iff.svc.cluster.local:8080/api`
  - `fuseki` at `http://fuseki.iff.svc.cluster.local:3030`, `fusekiDataset: iff`
  - `mqttBrokerUrl: mqtt://emqx-listeners.iff.svc.cluster.local:1883`, `mqttMgmtUrl: http://emqx-dashboard.iff.svc.cluster.local:18083`, `mqttBrokerNotifyUrl`
  - `databaseHost: acid-cluster.iff.svc.cluster.local`
- `callbackBaseUrl: http://xana-pdt-backend.xana-pdt.svc.cluster.local:8000`, the backend as Scorpio reaches it.
- The databases, realms and the client: `databasePort`, `databaseTimeseriesName`, `databaseMemoryName`, `postgresSslMode`, `databaseCaSecret`, `timescaleTable`, `timescaleEntityTable`, `keycloakRealm`, `keycloakClientId`, `gatewayKeycloakRealm`, `dataSharingPolicy`, `machineWatchType`, `machineWatchAttributes`, `ngsiTenant`, `ngsiContextUrl`, `ngsiAllowedContexts`.
- The operational defaults: `llmNumCtx`, `llmTimeoutS`, `decisionConfidenceThreshold`, `maxConcurrentRounds`, `autoArchiveAfterS`, `alertsRefreshIntervalS`, `inboxPollIntervalS`, `healthTimeoutS`, `healthCacheS`, `logLevel`, `wsAllowedOrigins`, `ingressEnabled`.

Each key in Section 1 has a short trailing or preceding comment saying what it is.

**Section 2, "Fill in for your cluster":** each key has a comment with what it is, an `Example:` line, and an `If empty:` line:
- The Ingress: `ingressHost` (default `xana.local`, which resolves nowhere), `ingressClassName` (`traefik`), `ingressTlsSecret` (empty: plain HTTP; the Secret has to be in `xana-pdt`).
- Sign-in: `keycloakUrl`, `factoryId`, `keycloakServiceClientId`.
- The language model: `llmProvider`, `llmModel`, `llmProviderName`, `ollamaUrl`, `openaiBaseUrl`.
- The dataspace and IFRIC: `gatewayUrl`, `gatewayKeycloakUrl`, `gatewayClientId`, `ifricUrl`.
- `fusekiGraphBase` (it names Fuseki's external host), and `langfuseHost`.

**Section 3, "Secrets":**
- Every secret key, empty, each with a comment naming its shell variable (the heading line), then `For:`, `Required:` and `Get:` lines:

| Key | Shell variable | Required | Get |
|---|---|---|---|
| `anthropicApiKey` | `ANTHROPIC_API_KEY` | with `llmProvider: anthropic` | Anthropic's console |
| `openaiApiKey` | `OPENAI_API_KEY` | with `llmProvider: openai` and no `openaiBaseUrl` | OpenAI's dashboard |
| `alertaApiKey` | `ALERTA_API_KEY` | for alerts | Alerta's admin key, in Secret `alerta` |
| `eventWebhookSecret` | `EVENT_WEBHOOK_SECRET` | with `callbackBaseUrl` | `openssl rand -hex 32` |
| `keycloakServiceClientSecret` | `KEYCLOAK_SERVICE_CLIENT_SECRET` | with `keycloakServiceClientId` | the client's credentials in Keycloak |
| `settingsEncryptionKey` | `SETTINGS_ENCRYPTION_KEY` | with `gatewayUrl` | the Fernet command above |
| `gatewayClientSecret` | `GATEWAY_CLIENT_SECRET` | never; else the operator enters it | the dataspace's Keycloak client |
| `langfusePublicKey`, `langfuseSecretKey` | `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY` | together, for traces | the Langfuse project's settings |
| `databaseUsername`, `databasePassword` | `DATABASE_USERNAME`, `DATABASE_PASSWORD` | unless read from the operator's Secret, or both URLs given | the operator's Secret |
| `timescaleDbUrl`, `postgresMemoryUrl` | `TIMESCALE_DB_URL`, `POSTGRES_MEMORY_URL` | never; they replace the URLs built from the credentials | |

- Then, under a sub-heading "Read from the platform's Secrets when deploying", `databaseCredentialsSecret` and `secretLookups` (below).

A check reads `default.yaml` and fails if a section header is missing or out of order; if a key is in the wrong section by the design's lists; if a Section 2 key lacks its `Example:` or `If empty:` line; if a Section 3 secret lacks its `For:`, `Required:` or `Get:` line; or if a Section 1 platform address isn't written out with `.svc.cluster.local`.

### `platformNamespace`: kept, for lookups only

The derivation is removed: `values.yaml.gotmpl` passes each address as it is written. `platformNamespace` stays in Section 1, as the namespace the chart reads platform Secrets from: the database operator's Secret, and each `secretLookups` entry without a `namespace` of its own. It no longer changes any address. The chart's own `values.yaml` gets the same full addresses.

Alternative: remove it and write `iff` in each lookup entry. It would then have to be changed in several places for a platform in another namespace.

### Where a secret comes from

For each backend secret and for the database credentials, the first of these that gives a value:
1. the shell variable of the backend's name (`DATABASE_USERNAME`/`DATABASE_PASSWORD` for the credentials);
2. the environment file's key;
3. when deploying, Helm `lookup` of the platform's Secret, as configured below.

The release's existing Secret is not a fourth source. It would keep a value after its source is gone, hide a password change on the platform until someone notices, and make "a run without a secret removes it" false. A secret that must persist, such as `SETTINGS_ENCRYPTION_KEY`, is then caught by the paired check instead: `apply` without it, with `gatewayUrl` set, stops rather than replacing it with nothing.

**Lookups**, in the chart, so plain `helm upgrade` behaves the same:
- `databaseCredentialsSecret` (default `ngb.acid-cluster.credentials`) is read in `platformNamespace`, keys `username` and `password`. The values go into `xana-pdt-database`, percent-encoded, as with credentials from the shell. Copying it into `xana-pdt` is no longer needed; the Pod-time `secretKeyRef` to a copied Secret is removed.
- `secretLookups` entries become `{variable, secret, key, namespace}`, with `namespace` defaulting to `platformNamespace`. Each is read when deploying and its value copied into the backend's Secret in `xana-pdt`. The Pod no longer reads them with `secretKeyRef`.
- The default `secretLookups` in `default.yaml` match what `envs/iff-cluster.sh` reads: `ALERTA_API_KEY` from `alerta`/`alerta-admin-key`, and `EVENT_WEBHOOK_SECRET`, `SETTINGS_ENCRYPTION_KEY`, `GATEWAY_CLIENT_SECRET`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` from `xana-pdt-credentials` by variable name. `KEYCLOAK_SERVICE_CLIENT_SECRET` from `keycloak-client-secret-xana` is listed as a commented example, because it needs `keycloakServiceClientId` set with it.
- A lookup that finds no Secret or key leaves the variable unset. That stops the render only when something needs it: the database credentials (unless both URLs are given), or a paired check below. The message names the Secret, key and namespace it read.
- A lookup for `DB_USER` or `DB_PASSWORD` still stops the render.

**Without a cluster.** `helm template`, `helmfile template`, and a `diff` that helm-diff renders offline, give `lookup` nothing. The chart tells this apart from "not found" by looking up the `default` ServiceAccount in `platformNamespace`, which every namespace has. Without a cluster:
- nothing is looked up, and the database and backend Secrets carry a YAML comment: "The platform's Secrets weren't read: this render had no cluster (helm template, or a diff without --dry-run=server). apply reads <names> from <namespace>.";
- the "nothing found" stop and every paired check that a looked-up value could satisfy are skipped, so nothing stops that `apply` would pass. Checks on values given in the shell or the file still run.

`helmfile apply` diffs first, offline unless helm-diff is given cluster access. The diff then shows the looked-up keys as removed, and `apply` goes on to `sync`, which reads them. The README says to use `--suppress-secrets`, and that `--diff-args=--dry-run=server` makes the diff read them too. The implementation checks the latter offline only as far as the flag being accepted; it isn't run against a cluster in this change.

**RBAC.** The lookups run with the deploying user's own credentials, in their kubeconfig: `get` on the named Secrets, and on ServiceAccount `default`, in `platformNamespace` (and in any other namespace a `secretLookups` entry names), besides what installing in `xana-pdt` already needs. Nothing is granted inside the cluster: XANA's Pods get no ServiceAccount token, Role or RoleBinding for this. A lookup the user may not make fails the render with Helm's own error, naming the resource.

`envs/iff-cluster.sh` keeps working: what it exports is the shell, which comes first.

### Checked when deploying

The chart stops the render with the backend's own message (the same text as `backend/app/config.py`), adding how to fix it where useful:

| Check | Message (backend's), plus hint |
|---|---|
| `gatewayUrl` without `SETTINGS_ENCRYPTION_KEY` | "SETTINGS_ENCRYPTION_KEY is required when GATEWAY_URL is set. Make one with: python -c '…'" |
| `SETTINGS_ENCRYPTION_KEY` not 44 URL-safe base64 characters | "SETTINGS_ENCRYPTION_KEY is not a valid key. Make one with: …" |
| `gatewayUrl` without `gatewayKeycloakUrl` | "GATEWAY_KEYCLOAK_URL is required when GATEWAY_URL is set" |
| `callbackBaseUrl` without `EVENT_WEBHOOK_SECRET` | "EVENT_WEBHOOK_SECRET is required when CALLBACK_BASE_URL is set", plus "Make one with: openssl rand -hex 32, or leave callbackBaseUrl empty for no machine events" |
| `keycloakServiceClientId` and `KEYCLOAK_SERVICE_CLIENT_SECRET` not together | "KEYCLOAK_SERVICE_CLIENT_ID and KEYCLOAK_SERVICE_CLIENT_SECRET must be set together" |
| `keycloakServiceClientId` without `keycloakUrl` | "KEYCLOAK_URL is required when KEYCLOAK_SERVICE_CLIENT_ID is set" |
| the two Langfuse keys not together | "LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY must be set together" |
| `LANGFUSE_HOST` and `LANGFUSE_BASE_URL` differ | "LANGFUSE_HOST and LANGFUSE_BASE_URL name different addresses; set one of them, or the same in both" |
| `llmProvider: anthropic` without `ANTHROPIC_API_KEY` | "ANTHROPIC_API_KEY is required when LLM_PROVIDER is anthropic" |
| `llmProvider: openai` without `OPENAI_API_KEY` or `openaiBaseUrl` | "OPENAI_API_KEY is required when LLM_PROVIDER is openai without OPENAI_BASE_URL" |
| `alertaUrl` not ending in `/api` | the backend's "must end in /api, …", naming `alertaUrl` |
| `fusekiDataset`, `timescaleTable`, `timescaleEntityTable` not plain names | the backend's messages, naming the key |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `ALERTA_API_KEY`, `EVENT_WEBHOOK_SECRET` with spaces | "must not contain spaces or line breaks", naming the variable |

A check fails when a chart message for these is not, word for word, in `backend/app/config.py`, so the two stay in step. A check on a secret that a lookup could give is skipped without a cluster, as above.

`callbackBaseUrl` is now filled in, so a default install needs `EVENT_WEBHOOK_SECRET`: from the shell, the file, or `xana-pdt-credentials` in `iff` through the default lookup. The message says how to make one, or to empty `callbackBaseUrl`.

### `LANGFUSE_BASE_URL`

The backend accepts both names. Langfuse's own instructions give the address in an env file with the keys, so the chart accepts `LANGFUSE_HOST` and `LANGFUSE_BASE_URL` from the shell as well as `langfuseHost` from the file, the shell winning. This is the one setting that isn't a secret and still comes from the shell. Both set to different addresses stop the render, as the backend would. The chart passes only `LANGFUSE_HOST`.

### README

- A table of the three sections: what each holds and who sets it.
- An example `my-secrets.env` with every variable from Section 3 and empty values, git-ignored by its name pattern (`*.env` already is, at the root; the README suggests keeping it outside the repository).
- The steps: copy the TLS Secret into `xana-pdt` if there is one; fill in Section 2; `set -a; source my-secrets.env; set +a`; `./helmfile -e default apply --suppress-secrets`.
- The lookups, their RBAC, and what `template` and `diff` show without a cluster.
- `LANGFUSE_BASE_URL` as another name for `LANGFUSE_HOST`.

### For an install made with the previous layout (#72)

- **Addresses:** they are written out in `default.yaml`. A copy of `default.yaml` with empty address keys now gets none of the derived defaults: take the new file and move your values across. `platformNamespace` no longer changes any address.
- **`localAndIonos`:** gone. Put its values into Section 2 of your `default.yaml`, and use `-e production` for its overrides.
- **Database credentials:** read from the operator's Secret when deploying. `envs/iff-cluster.sh` is optional. A copy of that Secret in `xana-pdt` is no longer used; `databaseCredentialsSecret` names the Secret in `platformNamespace`.
- **`secretLookups`:** read when deploying, not by the Pod. An entry naming a Secret in `xana-pdt` needs `namespace: xana-pdt`. After a change to a looked-up Secret, apply again; the backend restarts through the Secret's checksum.
- **Checks:** a missing paired secret now stops `apply`, rather than the Pod. With the default `callbackBaseUrl`, that includes `EVENT_WEBHOOK_SECRET`.

### Testing

As the maintainer decided, no run on a local cluster is planned for this change:
- offline renders with `KUBECONFIG=/dev/null`: `helm template` and `helmfile template` for both environments;
- `check_values.py`, `check_render.py`, `check_environments.py` (repurposed for `production` and the removed environment), shellcheck;
- CI, whose install job runs on its own kind cluster as today, now installing without sourcing `envs/iff-cluster.sh`, so the lookups are exercised there.

Lookup results can't be produced offline. The chart's lookup logic takes the looked-up Secrets through one helper; the render checks give it test data in place of the cluster's, through a value used only by the checks, and the offline path is checked as it is.

### Found while implementing

- **An empty `ingressHost`** now renders an Ingress rule without a host, which answers for any name, instead of a rule with `host: ""`. Section 2 says what empty does for every key, and this one had none.
- **The key format check** accepts 43 URL-safe base64 characters and a closing `=`, which is what `Fernet.generate_key()` gives; a key in another form the backend would also accept, such as standard base64, is refused when deploying.
- **The render checks' test data** goes in through a chart value, `testLookups` ("<namespace>/<name>" to the Secret's keys), which no environment file sets. With it, the chart behaves as with a cluster.

## Risks

- **A diff without cluster access** shows looked-up keys as removed on every `apply`, so `apply` always syncs. `--suppress-secrets` hides the noise; `--diff-args=--dry-run=server` avoids it.
- **The deploying user needs read access to the platform's Secrets.** Someone without it gets Helm's error, and can still give everything from the shell.
- **The default `callbackBaseUrl`** makes `EVENT_WEBHOOK_SECRET` required on a default install; the message says how to make one, or how to turn machine events off.
- **The skip detection** relies on ServiceAccount `default` in `platformNamespace`. With the namespace missing, lookups are skipped as if offline; the database stop then can't run, and the Pod reports the missing credentials when it starts.
