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

import os
import re
import subprocess
import sys
import tempfile
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
DATABASE = {
    "databaseHost", "databasePort", "databaseTimeseriesName", "databaseMemoryName", "databaseCredentialsSecret",
    "databaseCaSecret",
}
CHART = {
    "namespace", "imageRegistry", "imageTag", "imagePullPolicy", "secretLookups",
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
ENVIRONMENTS = ("default", "production", "localAndIonos")
RESERVED = (".invalid", ".example", ".test", ".local", ".localhost")
PUBLIC_REGISTRY = "ghcr.io/industryfusion"
SECRET_LIKE = re.compile(r"(?i)secret|password|token|apikey|key$")
HOST = re.compile(r"(?:^|//|@)([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)(?::\d+)?(?:[/?#]|$)")

failures: list[str] = []


def fail(message: str) -> None:
    failures.append(message)
    print("FAIL:", message)


def helmfile(helm_dir: Path, environment: str, values: dict | None = None, env: dict | None = None):
    binary = str(helm_dir / "helmfile") if (helm_dir / "helmfile").exists() else "helmfile"
    command = [binary, "-e", environment]
    file = None
    if values is not None:
        file = tempfile.NamedTemporaryFile("w", suffix=".yaml", delete=False)
        yaml.safe_dump(values, file)
        file.close()
        command += ["--state-values-file", file.name]
    clean = {k: v for k, v in os.environ.items() if k not in SECRETS.values() and not k.startswith("XANA_")}
    try:
        return subprocess.run(
            [*command, "template"], cwd=helm_dir, capture_output=True, text=True, env=clean | (env or {})
        )
    finally:
        if file:
            os.unlink(file.name)


def documents(result) -> dict[str, dict]:
    if result.returncode:
        raise AssertionError(result.stderr[-2000:])
    found = [d for d in yaml.safe_load_all(result.stdout) if d]
    return {f"{d['kind']}/{d['metadata']['name']}": d for d in found}


def check_keys_known(helm_dir: Path) -> None:
    known = set(SETTINGS) | set(SECRETS) | DATABASE | CHART
    for environment in ENVIRONMENTS:
        for key in yaml.safe_load((helm_dir / f"environment/{environment}.yaml").read_text()) or {}:
            if key not in known:
                fail(f"{environment}.yaml: {key} is not in the design's table of keys")
    default = yaml.safe_load((helm_dir / "environment/default.yaml").read_text())
    for key in known - set(default):
        fail(f"default.yaml: {key} has no default")
    print("keys known, each with a default: checked")


def check_each_setting_reaches_its_variable(helm_dir: Path) -> None:
    marks = {key: f"mark-{n}" for n, key in enumerate(SETTINGS)}
    rendered = documents(helmfile(helm_dir, "default", values=marks))
    config = rendered["ConfigMap/xana-pdt-backend"]["data"]
    for key, variable in SETTINGS.items():
        if config.get(variable) != marks[key]:
            fail(f"{key} doesn't reach {variable}: {config.get(variable)!r}")
    print("each setting reaches its variable: checked")


def check_secrets_file_and_shell(helm_dir: Path) -> None:
    from_file = {key: f"file-{n}" for n, key in enumerate(SECRETS)}
    rendered = documents(helmfile(helm_dir, "default", values=from_file))
    secret = rendered["Secret/xana-pdt-backend"]["stringData"]
    for key, variable in SECRETS.items():
        if secret.get(variable) != from_file[key]:
            fail(f"{key} in the file doesn't reach the Secret as {variable}")
    from_shell = {variable: f"shell-{n}" for n, variable in enumerate(SECRETS.values())}
    rendered = documents(helmfile(helm_dir, "default", values=from_file, env=from_shell))
    secret = rendered["Secret/xana-pdt-backend"]["stringData"]
    for variable, value in from_shell.items():
        if secret.get(variable) != value:
            fail(f"the shell's {variable} doesn't win over the file")
    for name, document in rendered.items():
        text = str(document) if name.startswith("ConfigMap/") else ""
        if any(v in text for v in [*from_shell.values(), *from_file.values()]):
            fail(f"a secret is in {name}")
    deployment = rendered["Deployment/xana-pdt-backend"]["spec"]["template"]["spec"]["containers"][0]
    if "env" in deployment:
        fail("database URLs given as secrets are still built from postgresCredential")
    print("secrets from the file and the shell, the shell winning, none in a ConfigMap: checked")


def check_old_variables_stop(helm_dir: Path) -> None:
    for old, new in OLD_VARIABLES.items():
        result = helmfile(helm_dir, "default", env={old: "old-value-not-to-be-shown"})
        if result.returncode == 0 or f"{old} is no longer read" not in result.stderr or new not in result.stderr:
            fail(f"{old} doesn't stop the render, naming {new}")
        if "old-value-not-to-be-shown" in result.stderr + result.stdout:
            fail(f"the render shows the value of {old}")
    print(f"{len(OLD_VARIABLES)} old variables stop the render, naming their replacements: checked")


def committed_file_problems(name: str, values: dict) -> list[str]:
    found = []
    for key, value in (values or {}).items():
        text = "" if value is None else str(value)
        if key in SECRETS:
            if text:
                found.append(f"{name}: {key} holds a secret; keep it empty and set {SECRETS[key]} in the shell")
            continue
        # These name Secrets in the cluster, or reference their keys; they hold no secret themselves.
        names_secrets = ("ingressTlsSecret", "databaseCredentialsSecret", "databaseCaSecret", "secretLookups")
        if SECRET_LIKE.search(key) and key not in names_secrets:
            found.append(f"{name}: {key} is named like a secret but isn't one of the design's secret keys")
        if key == "imageRegistry" and text.rstrip("/") == PUBLIC_REGISTRY:
            continue
        if "://" not in text and not key.endswith(("Url", "Host")):
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
        "a secret-like key": {"someToken": "x"},
        "a real host": {"ngsiUrl": "http://scorpio.example.org:9090"},
    }
    for what, values in probes.items():
        if not committed_file_problems("probe", values):
            fail(f"the committed-file check doesn't catch {what}")
    for fine in ({"pgrestUrl": "http://pgrest:3000"}, {"ingressHost": "xana.replace-me.invalid"}):
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
        check_committed_files,
    ):
        check(helm_dir)
    if failures:
        sys.exit(1)


if __name__ == "__main__":
    main()
