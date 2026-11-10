#
# Copyright (c) 2026 IndustryFusion Foundation
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#   http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#
"""Checks the environment keys and the secrets, through Helmfile, and that no committed environment file holds a
secret or a real host. Needs helm, and helm/helmfile (./bootstrap.sh) or helmfile on PATH.

    python helm/test/check_values.py helm

The tables below are the design's: every key, and the variable it sets.
"""

import ast
import base64
import os
import re
import subprocess
import sys
import tempfile
import urllib.parse
from pathlib import Path

import yaml

# Settings: environment key, backend variable.
SETTINGS = {
    "llmProvider": "LLM_PROVIDER", "llmModel": "LLM_MODEL", "llmProviderName": "LLM_PROVIDER_NAME",
    "llmNumCtx": "LLM_NUM_CTX", "llmTimeoutS": "LLM_TIMEOUT_S", "ollamaUrl": "OLLAMA_URL",
    "openaiBaseUrl": "OPENAI_BASE_URL", "langfuseHost": "LANGFUSE_HOST",
    "decisionConfidenceThreshold": "DECISION_CONFIDENCE_THRESHOLD", "maxConcurrentRounds": "MAX_CONCURRENT_ROUNDS",
    "autoArchiveAfterS": "AUTO_ARCHIVE_AFTER_S", "keycloakUrl": "KEYCLOAK_URL", "keycloakRealm": "KEYCLOAK_REALM",
    "keycloakClientId": "KEYCLOAK_CLIENT_ID", "factoryId": "FACTORY_ID",
    "keycloakServiceClientId": "KEYCLOAK_SERVICE_CLIENT_ID", "callbackBaseUrl": "CALLBACK_BASE_URL",
    "machineWatchType": "MACHINE_WATCH_TYPE", "machineWatchAttributes": "MACHINE_WATCH_ATTRIBUTES",
    "gatewayUrl": "GATEWAY_URL", "gatewayKeycloakUrl": "GATEWAY_KEYCLOAK_URL",
    "gatewayKeycloakRealm": "GATEWAY_KEYCLOAK_REALM", "gatewayClientId": "GATEWAY_CLIENT_ID",
    "dataSharingPolicy": "DATA_SHARING_POLICY", "ifricUrl": "IFRIC_URL", "inboxPollIntervalS": "INBOX_POLL_INTERVAL_S",
    "ngsiUrl": "NGSI_URL", "ngsiTenant": "NGSI_TENANT", "ngsiContextUrl": "NGSI_CONTEXT_URL",
    "ngsiAllowedContexts": "NGSI_ALLOWED_CONTEXTS", "pgrestUrl": "PGREST_URL", "alertaUrl": "ALERTA_URL",
    "alertsRefreshIntervalS": "ALERTS_REFRESH_INTERVAL_S", "fusekiUrl": "FUSEKI_URL", "fusekiDataset": "FUSEKI_DATASET",
    "fusekiGraphBase": "FUSEKI_GRAPH_BASE", "mqttBrokerUrl": "MQTT_BROKER_URL", "mqttMgmtUrl": "MQTT_MGMT_URL",
    "mqttBrokerNotifyUrl": "MQTT_BROKER_NOTIFY_URL", "wsAllowedOrigins": "WS_ALLOWED_ORIGINS",
    "timescaleTable": "TIMESCALE_TABLE", "timescaleEntityTable": "TIMESCALE_ENTITY_TABLE",
    "postgresSslMode": "POSTGRES_SSLMODE", "healthTimeoutS": "HEALTH_TIMEOUT_S", "healthCacheS": "HEALTH_CACHE_S",
    "logLevel": "LOG_LEVEL",
}
# Secrets: environment key, backend variable, which is also the shell variable.
SECRETS = {
    "anthropicApiKey": "ANTHROPIC_API_KEY", "openaiApiKey": "OPENAI_API_KEY",
    "langfusePublicKey": "LANGFUSE_PUBLIC_KEY", "langfuseSecretKey": "LANGFUSE_SECRET_KEY",
    "keycloakServiceClientSecret": "KEYCLOAK_SERVICE_CLIENT_SECRET", "eventWebhookSecret": "EVENT_WEBHOOK_SECRET",
    "gatewayClientSecret": "GATEWAY_CLIENT_SECRET", "settingsEncryptionKey": "SETTINGS_ENCRYPTION_KEY",
    "alertaApiKey": "ALERTA_API_KEY", "timescaleDbUrl": "TIMESCALE_DB_URL", "postgresMemoryUrl": "POSTGRES_MEMORY_URL",
}
# The database credentials: environment key, shell variable. Secrets too, but not backend variables: the chart
# keeps them in a Secret of its own, and the Pod builds the database URLs from them.
CREDENTIALS = {"databaseUsername": "DATABASE_USERNAME", "databasePassword": "DATABASE_PASSWORD"}
TEST_CREDENTIALS = {"DATABASE_USERNAME": "check", "DATABASE_PASSWORD": "check"}
# The platform's addresses, written out in full in Section 1 of default.yaml.
PLATFORM = {
    "ngsiUrl": "NGSI_URL", "pgrestUrl": "PGREST_URL", "alertaUrl": "ALERTA_URL", "fusekiUrl": "FUSEKI_URL",
    "mqttBrokerUrl": "MQTT_BROKER_URL", "mqttMgmtUrl": "MQTT_MGMT_URL", "databaseHost": None,
    "callbackBaseUrl": "CALLBACK_BASE_URL",
}
# The sections of default.yaml, as the design lists them.
SECTION_HEADERS = ("# 1. FILLED IN FOR YOU", "# 2. FILL IN FOR YOUR CLUSTER", "# 3. SECRETS")
SECTION_2 = {
    "ingressHost", "ingressClassName", "ingressTlsSecret", "keycloakUrl", "factoryId", "keycloakServiceClientId",
    "llmProvider", "llmModel", "llmProviderName", "ollamaUrl", "openaiBaseUrl", "gatewayUrl", "gatewayKeycloakUrl",
    "gatewayClientId", "ifricUrl", "fusekiGraphBase", "langfuseHost",
}
LOOKUP_KEYS = {"databaseCredentialsSecret", "secretLookups"}
DATABASE = {
    "databaseHost", "databasePort", "databaseTimeseriesName", "databaseMemoryName", "databaseCredentialsSecret",
    "databaseCaSecret",
}
CHART = {
    "namespace", "platformNamespace", "imageRegistry", "imageTag", "imagePullPolicy", "secretLookups",
    "ingressEnabled", "ingressHost", "ingressClassName", "ingressTlsSecret",
}
OLD_VARIABLES = {
    **{f"XANA_{name}": name for name in (
        "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "ALERTA_API_KEY", "GATEWAY_CLIENT_SECRET", "EVENT_WEBHOOK_SECRET",
        "KEYCLOAK_SERVICE_CLIENT_SECRET", "SETTINGS_ENCRYPTION_KEY", "LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY",
    )},
    "XANA_EXISTING_SECRET": "secretLookups", "XANA_INGRESS_HOST": "ingressHost",
    "XANA_KEYCLOAK_URL": "keycloakUrl", "XANA_LANGFUSE_HOST": "langfuseHost",
    "XANA_AUTO_ARCHIVE_AFTER_S": "autoArchiveAfterS",
}
ENVIRONMENTS = ("default", "production")
RESERVED = (".invalid", ".example", ".test", ".local", ".localhost")  # .svc.cluster.local is under .local
PUBLIC_REGISTRY = "ghcr.io/industryfusion"
SECRET_LIKE = re.compile(r"(?i)secret|password|token|apikey|key$")
# Keys whose values are host names or addresses, with or without a scheme.
ADDRESS_KEYS = ("Url", "Host", "Registry", "Origins", "Contexts")
HOST = re.compile(r"(?:^|//|@)([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)(?::\d+)?(?:[/?#]|$)")

failures: list[str] = []


def fail(message: str) -> None:
    failures.append(message)
    print("FAIL:", message)


def helmfile(helm_dir: Path, environment: str, values: dict | None = None, env: dict | None = None,
             credentials: bool = True):
    binary = str(helm_dir / "helmfile") if (helm_dir / "helmfile").exists() else "helmfile"
    command = [binary, "-e", environment]
    file = None
    if values is not None:
        file = tempfile.NamedTemporaryFile("w", suffix=".yaml", delete=False)
        yaml.safe_dump(values, file)
        file.close()
        command += ["--state-values-file", file.name]
    clean = {
        k: v for k, v in os.environ.items()
        if k not in SECRETS.values() and k not in CREDENTIALS.values() and not k.startswith("XANA_")
    }
    if credentials:
        clean |= TEST_CREDENTIALS
    clean["KUBECONFIG"] = os.devnull  # offline: the chart reads no cluster
    try:
        return subprocess.run(
            [*command, "template"], cwd=helm_dir, capture_output=True, text=True, env=clean | (env or {})
        )
    finally:
        if file:
            os.unlink(file.name)


def decoded(document: dict) -> dict:
    """A Secret's values, decoded from data; the chart writes data, so a key it drops is removed on apply."""
    if document.get("kind") == "Secret":
        assert "stringData" not in document, f"{document['metadata']['name']} uses stringData"
        document["stringData"] = {k: base64.b64decode(v).decode() for k, v in (document.get("data") or {}).items()}
    return document


def documents(result) -> dict[str, dict]:
    if result.returncode:
        raise AssertionError(result.stderr[-2000:])
    found = [decoded(d) for d in yaml.safe_load_all(result.stdout) if d]
    return {f"{d['kind']}/{d['metadata']['name']}": d for d in found}


def check_keys_known(helm_dir: Path) -> None:
    known = set(SETTINGS) | set(SECRETS) | set(CREDENTIALS) | DATABASE | CHART
    for environment in ENVIRONMENTS:
        for key in yaml.safe_load((helm_dir / f"environment/{environment}.yaml").read_text()) or {}:
            if key not in known:
                fail(f"{environment}.yaml: {key} is not in the design's table of keys")
    default = yaml.safe_load((helm_dir / "environment/default.yaml").read_text())
    for key in known - set(default):
        fail(f"default.yaml: {key} has no default")
    print("keys known, each with a default: checked")


def check_each_setting_reaches_its_variable(helm_dir: Path) -> None:
    # Marks that pass the chart's checks: plain names, and Alerta's address ending in /api. The secrets the
    # marked settings need come from the shell.
    marks = {key: f"mark{n}" for n, key in enumerate(SETTINGS)}
    marks["alertaUrl"] = "http://mark/api"
    needed = {"KEYCLOAK_SERVICE_CLIENT_SECRET": "x", "EVENT_WEBHOOK_SECRET": "x", "OPENAI_API_KEY": "x",
              "ANTHROPIC_API_KEY": "x", "SETTINGS_ENCRYPTION_KEY": "r8kO0dYd9Oq6K3WkLz8m2N1pQ4sT7vX0yB5cE8fH2jA="}
    rendered = documents(helmfile(helm_dir, "default", values=marks, env=needed))
    config = rendered["ConfigMap/xana-pdt-backend"]["data"]
    for key, variable in SETTINGS.items():
        if config.get(variable) != marks[key]:
            fail(f"{key} doesn't reach {variable}: {config.get(variable)!r}")
    print("each setting reaches its variable: checked")


def secret_value(prefix: str, key: str, n: int) -> str:
    """A test value for a secret; the encryption key has the form the chart checks for."""
    if key == "settingsEncryptionKey":
        return (prefix + "A" * 43)[:43] + "="
    return f"{prefix}-{n}"


def check_secrets_file_and_shell(helm_dir: Path) -> None:
    from_file = {key: secret_value("file", key, n) for n, key in enumerate(SECRETS)}
    # The service client's secret needs its ID and Keycloak, as the backend checks.
    from_file |= {"keycloakServiceClientId": "xana-events", "keycloakUrl": "https://keycloak.example.org/auth"}
    rendered = documents(helmfile(helm_dir, "default", values=from_file))
    secret = rendered["Secret/xana-pdt-backend"]["stringData"]
    for key, variable in SECRETS.items():
        if secret.get(variable) != from_file[key]:
            fail(f"{key} in the file doesn't reach the Secret as {variable}")
    from_shell = {variable: secret_value("shell", key, n) for n, (key, variable) in enumerate(SECRETS.items())}
    rendered = documents(helmfile(helm_dir, "default", values=from_file, env=from_shell))
    secret = rendered["Secret/xana-pdt-backend"]["stringData"]
    for variable, value in from_shell.items():
        if secret.get(variable) != value:
            fail(f"the shell's {variable} doesn't win over the file")
    for name, document in rendered.items():
        text = str(document) if name.startswith("ConfigMap/") else ""
        if any(v in text for v in [*from_shell.values(), *(from_file[k] for k in SECRETS)]):
            fail(f"a secret is in {name}")
    deployment = rendered["Deployment/xana-pdt-backend"]["spec"]["template"]["spec"]["containers"][0]
    if "env" in deployment:
        fail("database URLs given as secrets are still built from postgresCredential")
    print("secrets from the file and the shell, the shell winning, none in a ConfigMap: checked")


def check_langfuse_address(helm_dir: Path) -> None:
    for env, want in (({"LANGFUSE_BASE_URL": "https://base.example.org"}, "https://base.example.org"),
                      ({"LANGFUSE_HOST": "https://host.example.org"}, "https://host.example.org"),
                      ({"LANGFUSE_HOST": "https://same.example.org", "LANGFUSE_BASE_URL": "https://same.example.org/"},
                       "https://same.example.org")):
        config = backend_config(helm_dir, env=env, values={"langfuseHost": "https://file.example.org"})
        if config.get("LANGFUSE_HOST") != want:
            fail(f"{env} gives LANGFUSE_HOST {config.get('LANGFUSE_HOST')!r}, not {want}")
        if "LANGFUSE_BASE_URL" in config:
            fail("the chart passes LANGFUSE_BASE_URL; it passes only LANGFUSE_HOST")
    result = helmfile(helm_dir, "default", env={"LANGFUSE_HOST": "https://a.example.org", "LANGFUSE_BASE_URL": "https://b.example.org"})
    if result.returncode == 0 or "LANGFUSE_HOST and LANGFUSE_BASE_URL name different addresses" not in result.stderr:
        fail("different LANGFUSE_HOST and LANGFUSE_BASE_URL don't stop the render")
    print("LANGFUSE_HOST or LANGFUSE_BASE_URL from the shell, the same or the render stops: checked")


def check_secrets_from_an_env_file(helm_dir: Path) -> None:
    """The README's way: an env file sourced with set -a, then helmfile. Its values win over the file's."""
    with tempfile.TemporaryDirectory() as work:
        env_file = Path(work) / "my-secrets.env"
        env_file.write_text("EVENT_WEBHOOK_SECRET=from-env-file\nDATABASE_USERNAME=env-user\nDATABASE_PASSWORD='env p@ss'\n")
        binary = str(helm_dir / "helmfile") if (helm_dir / "helmfile").exists() else "helmfile"
        clean = {k: v for k, v in os.environ.items() if k not in SECRETS.values() and k not in CREDENTIALS.values()}
        result = subprocess.run(
            ["bash", "-c", 'set -a; source "$1"; set +a; "$2" -e default --state-values-set eventWebhookSecret=from-file template',
             "_", str(env_file), binary],
            cwd=helm_dir, capture_output=True, text=True, env=clean | {"KUBECONFIG": os.devnull},
        )
    rendered = documents(result)
    if rendered["Secret/xana-pdt-backend"]["stringData"].get("EVENT_WEBHOOK_SECRET") != "from-env-file":
        fail("a secret from an env file sourced with set -a doesn't win over the environment file's")
    if rendered["Secret/xana-pdt-database"]["stringData"] != {"username": "env-user", "password": "env%20p%40ss"}:
        fail("the database credentials from an env file sourced with set -a don't reach the chart's Secret")
    print("secrets from an env file sourced with set -a, winning over the file: checked")


def check_old_variables_stop(helm_dir: Path) -> None:
    for old, new in OLD_VARIABLES.items():
        result = helmfile(helm_dir, "default", env={old: "old-value-not-to-be-shown"})
        if result.returncode == 0 or f"{old} is no longer read" not in result.stderr or new not in result.stderr:
            fail(f"{old} doesn't stop the render, naming {new}")
        if "old-value-not-to-be-shown" in result.stderr + result.stdout:
            fail(f"the render shows the value of {old}")
    print(f"{len(OLD_VARIABLES)} old variables stop the render, naming their replacements: checked")


# Backend settings without an environment key, as the design lists them, each with its reason.
NO_KEY = {
    "LANGFUSE_BASE_URL": "the same setting as LANGFUSE_HOST; accepted from the shell for langfuseHost",
    "BACKEND_HOST": "set by the chart",
    "BACKEND_PORT": "set by the chart",
    "BACKEND_RELOAD": "development only",
    "POSTGRES_SSLROOTCERT": "set from databaseCaSecret",
}


def backend_settings(config: Path) -> set[str]:
    """The variables the backend's Settings class reads: its fields, upper-cased."""
    tree = ast.parse(config.read_text())
    [settings] = [n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == "Settings"]
    return {
        n.target.id.upper() for n in settings.body
        if isinstance(n, ast.AnnAssign) and isinstance(n.target, ast.Name) and n.target.id != "model_config"
    }


def settings_problems(variables: set[str]) -> list[str]:
    covered = set(SETTINGS.values()) | set(SECRETS.values())
    found = [f"the backend reads {v}, which has no environment key and no listed reason" for v in
             sorted(variables - covered - set(NO_KEY))]
    found += [f"{v} has a key but the backend doesn't read it" for v in sorted((covered | set(NO_KEY)) - variables)]
    return found


def check_settings_cover_the_backend(helm_dir: Path) -> None:
    variables = backend_settings(helm_dir.parent / "backend/app/config.py")
    for problem in settings_problems(variables):
        fail(problem)
    # The check itself has to be able to fail.
    if not settings_problems(variables | {"SOME_NEW_SETTING"}):
        fail("the settings check doesn't catch a new backend setting without a key")
    if not settings_problems(variables - {"LLM_MODEL"}):
        fail("the settings check doesn't catch a key the backend no longer reads")
    print(f"{len(variables)} backend settings, each with a key or a listed reason: checked")


def backend_config(helm_dir: Path, **kwargs) -> dict:
    return documents(helmfile(helm_dir, "default", **kwargs))["ConfigMap/xana-pdt-backend"]["data"]


def database_urls(helm_dir: Path, **kwargs) -> dict:
    container = documents(helmfile(helm_dir, "default", **kwargs))["Deployment/xana-pdt-backend"]
    env = container["spec"]["template"]["spec"]["containers"][0].get("env", [])
    return {e["name"]: e.get("value") for e in env if e["name"].endswith("_DB_URL") or e["name"].endswith("MEMORY_URL")}


def check_platform_addresses(helm_dir: Path) -> None:
    default = yaml.safe_load((helm_dir / "environment/default.yaml").read_text())
    if default.get("namespace") != "xana-pdt" or default.get("platformNamespace") != "iff":
        fail("default.yaml: namespace isn't xana-pdt, or platformNamespace isn't iff")
    for key in PLATFORM:
        host = urllib.parse.urlsplit(str(default.get(key)) if "://" in str(default.get(key)) else f"x://{default.get(key)}")
        if not (host.hostname or "").endswith(".svc.cluster.local"):
            fail(f"default.yaml: {key} isn't written out as <service>.<namespace>.svc.cluster.local: {default.get(key)!r}")
    # platformNamespace changes no address: each is used as written.
    for values in (None, {"platformNamespace": "platform"}):
        config = backend_config(helm_dir, values=values)
        for key, variable in PLATFORM.items():
            if variable and config.get(variable) != default[key]:
                fail(f"{key} with {values} renders {config.get(variable)!r}, not {default[key]!r}")
        for variable, url in database_urls(helm_dir, values=values).items():
            if f"@{default['databaseHost']}:5432/" not in (url or ""):
                fail(f"{variable} with {values} is {url!r}")
    given = {"ngsiUrl": "http://given:1", "databaseHost": "db.given"}
    config = backend_config(helm_dir, values=given)
    if config.get("NGSI_URL") != "http://given:1":
        fail("a given ngsiUrl isn't used as given")
    if not all("@db.given:5432/" in (url or "") for url in database_urls(helm_dir, values=given).values()):
        fail("a given databaseHost isn't used as given")
    print("platform addresses written out in full, used as written, whatever platformNamespace is: checked")


def section_problems(text: str) -> list[str]:
    """The sections of default.yaml, the key placement, and each key's comments."""
    found = []
    positions = [text.find(h) for h in SECTION_HEADERS]
    if -1 in positions or positions != sorted(positions):
        return [f"default.yaml: the section headers {SECTION_HEADERS} aren't all there, in order"]
    parts = [text[positions[0]:positions[1]], text[positions[1]:positions[2]], text[positions[2]:]]
    expected_3 = set(SECRETS) | set(CREDENTIALS) | LOOKUP_KEYS
    for number, part in enumerate(parts, 1):
        lines = part.splitlines()
        for index, line in enumerate(lines):
            match = re.match(r"^([A-Za-z][A-Za-z0-9]*):", line)
            if not match:
                continue
            key = match.group(1)
            want = 2 if key in SECTION_2 else 3 if key in expected_3 else 1
            if want != number:
                found.append(f"default.yaml: {key} is in Section {number}, not Section {want}")
            comments = []
            for previous in reversed(lines[:index]):
                if not previous.startswith("#"):
                    break
                comments.insert(0, previous)
            block = "\n".join(comments)
            if number == 2 and not ("Example:" in block and "If empty:" in block):
                found.append(f"default.yaml: {key} in Section 2 lacks its Example: or If empty: line")
            if number == 3 and key in set(SECRETS) | set(CREDENTIALS):
                variable = SECRETS.get(key) or CREDENTIALS[key]
                if not comments or comments[0] != f"# {variable}" or not all(
                    f"#   {label}:" in block for label in ("For", "Required", "Get")
                ):
                    found.append(f"default.yaml: {key} lacks its heading {variable}, or a For:, Required: or Get: line")
    return found


def check_sections(helm_dir: Path) -> None:
    text = (helm_dir / "environment/default.yaml").read_text()
    for problem in section_problems(text):
        fail(problem)
    # The check itself has to be able to fail.
    probes = {
        "a missing Example line": text.replace("#   Example:  https://keycloak.example.org/auth\n", "", 1),
        "a missing Get line": text.replace("#   Get:      openssl rand -hex 32\n", "", 1),
        "a key in the wrong section": text.replace("keycloakUrl: \"\"\n", "", 1).replace(
            "logLevel: INFO\n", "logLevel: INFO\nkeycloakUrl: \"\"\n", 1),
        "sections out of order": text.replace("# 3. SECRETS", "# 3. SECRET", 1),
    }
    for what, probe in probes.items():
        if probe == text or not section_problems(probe):
            fail(f"the sections check doesn't catch {what}")
    print("default.yaml in its three sections, each key placed and explained: checked")


def leaked_credentials(rendered: dict, username: str, password: str) -> list[str]:
    """Documents other than the chart's database Secret that hold a credential, raw or percent-encoded."""
    values = {username, password, urllib.parse.quote(username, safe=""), urllib.parse.quote(password, safe="")}
    found = []
    for name, document in rendered.items():
        if name == "Secret/xana-pdt-database" or not name.startswith(("Secret/", "ConfigMap/")):
            continue
        text = str(document.get("stringData") or document.get("data") or {})
        found += [f"{name} holds a database credential" for value in values if value in text]
    return found


def check_database_credentials(helm_dir: Path) -> None:
    username, password = "shell-user-7d1", "shell p@ss-7d1"
    # With another backend secret too, so the backend's own Secret is rendered and can be checked.
    rendered = documents(helmfile(helm_dir, "default", credentials=False, env={
        "DATABASE_USERNAME": username, "DATABASE_PASSWORD": password, "ANTHROPIC_API_KEY": "other-secret"}))
    if rendered["Secret/xana-pdt-database"]["stringData"] != {"username": username, "password": "shell%20p%40ss-7d1"}:
        fail("DATABASE_USERNAME and DATABASE_PASSWORD don't reach the chart's database Secret, percent-encoded")
    if "Secret/xana-pdt-backend" not in rendered:
        fail("the backend's own Secret isn't rendered, so the credentials check below proves nothing")
    for problem in leaked_credentials(rendered, username, password):
        fail(problem)
    # The check itself has to be able to fail.
    probe = {"Secret/xana-pdt-backend": {"stringData": {"X": "shell%20p%40ss-7d1"}}, "ConfigMap/c": {"data": {"Y": username}}}
    if len(leaked_credentials(probe, username, password)) != 2:
        fail("the credentials check doesn't catch a credential in the backend's Secret or a ConfigMap")
    rendered = documents(helmfile(helm_dir, "default", credentials=False,
                                  values={"databaseUsername": "file-user", "databasePassword": "file"},
                                  env={"DATABASE_PASSWORD": "shell"}))
    if rendered["Secret/xana-pdt-database"]["stringData"] != {"username": "file-user", "password": "shell"}:
        fail("the shell's database credentials don't win over the file's")
    # Without a cluster (KUBECONFIG=/dev/null) and without credentials, the render goes on and says so.
    result = helmfile(helm_dir, "default", credentials=False)
    if result.returncode or "Not read: the database credentials, from Secret ngb.acid-cluster.credentials" not in result.stdout:
        fail("the default environment without credentials or a cluster doesn't render with the note")
    result = helmfile(helm_dir, "default", values={"platformNamespace": ""})
    if result.returncode == 0 or "platformNamespace is empty" not in result.stderr:
        fail("an empty platformNamespace doesn't stop the render")
    print("database credentials from the shell or the file, the shell winning, in no other Secret or ConfigMap,"
          " or the render stops: checked")


def referenced_secrets(rendered: dict) -> set[str]:
    names = set()
    for name, d in rendered.items():
        if name.startswith("Ingress/"):
            names |= {t["secretName"] for t in d["spec"].get("tls", []) if t.get("secretName")}
        if name.startswith("Deployment/"):
            spec = d["spec"]["template"]["spec"]
            names |= {s["name"] for s in spec.get("imagePullSecrets", [])}
            names |= {v["secret"]["secretName"] for v in spec.get("volumes", []) if "secret" in v}
            for c in spec["containers"]:
                names |= {e["secretRef"]["name"] for e in c.get("envFrom", []) if "secretRef" in e}
                names |= {e["valueFrom"]["secretKeyRef"]["name"] for e in c.get("env", [])
                          if "secretKeyRef" in e.get("valueFrom", {})}
    return names


def check_secrets_in_the_namespace(helm_dir: Path) -> None:
    """Each environment names only Secrets the chart renders, and the ones it configures, which must be in xana-pdt."""
    for environment, configured in (("default", set()), ("production", {"xana-tls"})):
        rendered = documents(helmfile(helm_dir, environment))
        own = {n.split("/", 1)[1] for n in rendered if n.startswith("Secret/")}
        if referenced_secrets(rendered) - own != configured:
            fail(f"{environment} names Secrets {sorted(referenced_secrets(rendered) - own)}, not {sorted(configured)}")
    print("each environment names only its own Secrets and the configured ones: checked")


RETIRED_KEYS = {"ingressClass": "ingressClassName", "existingSecret": "secretLookups", "extraConfig": "its own key"}


def check_retired_keys_stop(helm_dir: Path) -> None:
    for old, new in RETIRED_KEYS.items():
        result = helmfile(helm_dir, "default", values={old: "x"})
        if result.returncode == 0 or f"{old} in the environment file is no longer read" not in result.stderr or new not in result.stderr:
            fail(f"{old} in an environment file doesn't stop the render, naming {new}")
    print(f"{len(RETIRED_KEYS)} retired environment keys stop the render, naming their replacements: checked")


def committed_file_problems(name: str, values: dict) -> list[str]:
    found = []
    for key, value in (values or {}).items():
        text = "" if value is None else str(value)
        if key in SECRETS or key in CREDENTIALS:
            if text:
                variable = SECRETS.get(key) or CREDENTIALS[key]
                found.append(f"{name}: {key} holds a secret; keep it empty and set {variable} in the shell")
            continue
        # These name Secrets in the cluster, or reference their keys; they hold no secret themselves.
        names_secrets = ("ingressTlsSecret", "databaseCredentialsSecret", "databaseCaSecret", "secretLookups")
        if SECRET_LIKE.search(key) and key not in names_secrets:
            found.append(f"{name}: {key} is named like a secret but isn't one of the design's secret keys")
        if key == "imageRegistry" and text.rstrip("/") == PUBLIC_REGISTRY:
            continue  # the published images, and nothing else on that registry
        if "://" not in text and not key.endswith(ADDRESS_KEYS):
            continue  # not an address
        for host in HOST.findall(text):
            if not host.lower().endswith(RESERVED):
                found.append(f"{name}: {key} names the host {host}, which isn't under {', '.join(RESERVED)}")
    return found


def check_committed_files(helm_dir: Path) -> None:
    for environment in ENVIRONMENTS:
        name = f"{environment}.yaml"
        for problem in committed_file_problems(name, yaml.safe_load((helm_dir / f"environment/{name}").read_text())):
            fail(problem)
    # The check itself has to be able to fail.
    probes = {
        "a secret value": {"anthropicApiKey": "sk-real"},
        "a database password": {"databasePassword": "real"},
        "a secret-like key": {"someToken": "x"},
        "a real host": {"ngsiUrl": "http://scorpio.example.org:9090"},
        "a real registry": {"imageRegistry": "registry.ionos.example-corp.com/xana"},
        "another path on the public registry": {"imageRegistry": "ghcr.io/someone-else"},
        "a real Ingress host": {"ingressHost": "xana.example-corp.com"},
        "a real origin": {"wsAllowedOrigins": "https://xana.example-corp.com"},
    }
    for what, values in probes.items():
        if not committed_file_problems("probe", values):
            fail(f"the committed-file check doesn't catch {what}")
    for fine in (
        {"pgrestUrl": "http://pgrest:3000"}, {"ingressHost": "xana.replace-me.invalid"},
        {"imageRegistry": "ghcr.io/industryfusion"}, {"imageRegistry": "registry.replace-me.invalid/xana"},
        {"llmModel": "llama3.1"},
    ):
        if committed_file_problems("probe", fine):
            fail(f"the committed-file check refuses {fine}")
    print("no secret or real host in committed environment files: checked")


def main() -> None:
    helm_dir = Path(sys.argv[1]).resolve()
    for check in (
        check_keys_known,
        check_each_setting_reaches_its_variable,
        check_secrets_file_and_shell,
        check_old_variables_stop,
        check_secrets_from_an_env_file,
        check_langfuse_address,
        check_retired_keys_stop,
        check_platform_addresses,
        check_sections,
        check_database_credentials,
        check_secrets_in_the_namespace,
        check_settings_cover_the_backend,
        check_committed_files,
    ):
        check(helm_dir)
    if failures:
        sys.exit(1)


if __name__ == "__main__":
    main()
