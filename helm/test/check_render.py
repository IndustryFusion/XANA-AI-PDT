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
"""Checks what the chart renders: where secrets come from, and that none reach a ConfigMap.

    python helm/test/check_render.py helm/charts/xana-pdt

Needs Helm and PyYAML.
"""

import subprocess
import sys

import yaml

SECRET_VALUE = "render-check-value"
CA_PATH = "/etc/xana/database-ca/ca.crt"


def render(chart: str, *settings: str) -> dict[str, dict]:
    flags = [flag for setting in settings for flag in ("--set", setting)]
    output = subprocess.run(["helm", "template", "x", chart, *flags], check=True, capture_output=True, text=True).stdout
    documents = [d for d in yaml.safe_load_all(output) if d]
    return {f"{d['kind']}/{d['metadata']['name']}": d for d in documents}


def backend_container(rendered: dict[str, dict]) -> dict:
    return rendered["Deployment/x-backend"]["spec"]["template"]["spec"]["containers"][0]


def env_names(container: dict) -> set[str]:
    return {e["name"] for e in container.get("env", [])}


def secret_refs(container: dict) -> list[str]:
    return [e["secretRef"]["name"] for e in container.get("envFrom", []) if "secretRef" in e]


def check_operator_secret(chart: str) -> None:
    rendered = render(chart)
    container = backend_container(rendered)
    assert {"DB_USER", "DB_PASSWORD", "TIMESCALE_DB_URL", "POSTGRES_MEMORY_URL"} <= env_names(container)
    credentials = [
        e["valueFrom"]["secretKeyRef"]["name"] for e in container["env"] if e["name"] in ("DB_USER", "DB_PASSWORD")
    ]
    assert credentials == ["ngb.acid-cluster.credentials"] * 2
    assert not secret_refs(container)
    assert "Secret/x-backend" not in rendered


def check_existing_secret_comes_first(chart: str) -> None:
    rendered = render(chart, "secrets.existingSecret=mine", f"secrets.values.ANTHROPIC_API_KEY={SECRET_VALUE}")
    container = backend_container(rendered)
    assert secret_refs(container) == ["mine"]
    assert not env_names(container)
    assert "Secret/x-backend" not in rendered
    assert SECRET_VALUE not in str(rendered)


def check_values_with_operator_secret(chart: str) -> None:
    rendered = render(chart, f"secrets.values.ANTHROPIC_API_KEY={SECRET_VALUE}")
    container = backend_container(rendered)
    assert secret_refs(container) == ["x-backend"]
    assert "TIMESCALE_DB_URL" in env_names(container)
    assert rendered["Secret/x-backend"]["stringData"]["ANTHROPIC_API_KEY"] == SECRET_VALUE


def check_values_only(chart: str) -> None:
    rendered = render(chart, "database.credentialsSecret=", f"secrets.values.TIMESCALE_DB_URL={SECRET_VALUE}")
    container = backend_container(rendered)
    assert secret_refs(container) == ["x-backend"]
    assert not env_names(container)


def check_no_secret_in_a_config_map(chart: str) -> None:
    for settings in (
        [f"secrets.values.ANTHROPIC_API_KEY={SECRET_VALUE}"],
        ["database.credentialsSecret=", f"secrets.values.TIMESCALE_DB_URL={SECRET_VALUE}"],
    ):
        for name, document in render(chart, *settings).items():
            if name.startswith("ConfigMap/"):
                assert SECRET_VALUE not in str(document), name
            if name.startswith("Deployment/"):
                assert SECRET_VALUE not in str(document["spec"]["template"]["spec"]["containers"]), name


def check_machine_events_settings(chart: str) -> None:
    rendered = render(
        chart,
        "config.CALLBACK_BASE_URL=http://x-backend:8000",
        f"secrets.values.EVENT_WEBHOOK_SECRET={SECRET_VALUE}",
        f"secrets.values.KEYCLOAK_SERVICE_CLIENT_SECRET={SECRET_VALUE}",
    )
    config = rendered["ConfigMap/x-backend"]["data"]
    assert config["CALLBACK_BASE_URL"] == "http://x-backend:8000"
    assert SECRET_VALUE not in str(config)
    assert SECRET_VALUE not in str(rendered["Deployment/x-backend"])
    assert set(rendered["Secret/x-backend"]["stringData"]) >= {"EVENT_WEBHOOK_SECRET", "KEYCLOAK_SERVICE_CLIENT_SECRET"}


def check_auto_archive_setting(chart: str) -> None:
    config = render(chart, "config.AUTO_ARCHIVE_AFTER_S=0")["ConfigMap/x-backend"]["data"]
    assert config["AUTO_ARCHIVE_AFTER_S"] == "0"
    assert "AUTO_ARCHIVE_AFTER_S" not in render(chart)["ConfigMap/x-backend"]["data"]  # the backend's default


def check_tracing_address(chart: str) -> None:
    rendered = render(
        chart,
        "config.LANGFUSE_HOST=https://traces.example.org",
        f"secrets.values.LANGFUSE_PUBLIC_KEY={SECRET_VALUE}-public",
        f"secrets.values.LANGFUSE_SECRET_KEY={SECRET_VALUE}",
    )
    config = rendered["ConfigMap/x-backend"]["data"]
    assert config["LANGFUSE_HOST"] == "https://traces.example.org"
    assert SECRET_VALUE not in str(config) and SECRET_VALUE not in str(rendered["Deployment/x-backend"])
    assert {"LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY"} <= set(rendered["Secret/x-backend"]["stringData"])
    assert "LANGFUSE_HOST" not in render(chart)["ConfigMap/x-backend"]["data"]


def check_database_ca(chart: str) -> None:
    without = render(chart)
    assert "POSTGRES_SSLROOTCERT" not in without["ConfigMap/x-backend"]["data"]
    assert "volumeMounts" not in backend_container(without)

    rendered = render(chart, "database.caCert.secret=db-ca", "database.caCert.key=root.pem")
    assert rendered["ConfigMap/x-backend"]["data"]["POSTGRES_SSLROOTCERT"] == CA_PATH
    [mount] = backend_container(rendered)["volumeMounts"]
    assert mount["readOnly"] is True
    assert f"{mount['mountPath']}/ca.crt" == CA_PATH
    [volume] = rendered["Deployment/x-backend"]["spec"]["template"]["spec"]["volumes"]
    assert volume["name"] == mount["name"]
    assert volume["secret"] == {"secretName": "db-ca", "items": [{"key": "root.pem", "path": "ca.crt"}]}


def check_restricted_pods(chart: str) -> None:
    rendered = render(chart)
    for name in ("Deployment/x-backend", "Deployment/x-frontend"):
        pod = rendered[name]["spec"]["template"]["spec"]
        assert pod["securityContext"]["runAsNonRoot"] is True
        assert pod["securityContext"]["seccompProfile"] == {"type": "RuntimeDefault"}
        security = pod["containers"][0]["securityContext"]
        assert security["allowPrivilegeEscalation"] is False
        assert security["capabilities"] == {"drop": ["ALL"]}


CHECKS = (
    check_operator_secret,
    check_existing_secret_comes_first,
    check_values_with_operator_secret,
    check_values_only,
    check_no_secret_in_a_config_map,
    check_machine_events_settings,
    check_auto_archive_setting,
    check_tracing_address,
    check_database_ca,
    check_restricted_pods,
)


def main() -> None:
    for check in CHECKS:
        check(sys.argv[1])
        print(f"{check.__name__}: ok")


if __name__ == "__main__":
    main()
