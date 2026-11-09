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
"""Checks what the chart renders: where secrets come from, that none reach a ConfigMap, and the frontend's
nginx configuration.

    python helm/test/check_render.py helm/charts/xana-pdt

Needs Helm and PyYAML.
"""

import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import yaml

SECRET_VALUE = "render-check-value"
CA_PATH = "/etc/xana/database-ca/ca.crt"


def render(chart: str, *settings: str) -> dict[str, dict]:
    flags = []
    for setting in settings:
        flags += ("--set-json", setting[5:]) if setting.startswith("json:") else ("--set", setting)
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
    urls = {e["name"]: e["value"] for e in container["env"] if e["name"].endswith("_URL")}
    assert urls["TIMESCALE_DB_URL"].endswith("@acid-cluster:5432/tsdb")
    assert urls["POSTGRES_MEMORY_URL"].endswith("@acid-cluster:5432/memory")
    assert not secret_refs(container)
    assert "Secret/x-backend" not in rendered


def check_secrets_with_operator_secret(chart: str) -> None:
    rendered = render(chart, f"backend.secret.ANTHROPIC_API_KEY={SECRET_VALUE}")
    container = backend_container(rendered)
    assert secret_refs(container) == ["x-backend"]
    assert "TIMESCALE_DB_URL" in env_names(container)
    assert rendered["Secret/x-backend"]["stringData"]["ANTHROPIC_API_KEY"] == SECRET_VALUE


def check_one_url_given(chart: str) -> None:
    rendered = render(chart, f"backend.secret.TIMESCALE_DB_URL={SECRET_VALUE}")
    names = env_names(backend_container(rendered))
    assert "TIMESCALE_DB_URL" not in names and "POSTGRES_MEMORY_URL" in names


def check_urls_given(chart: str) -> None:
    rendered = render(
        chart, f"backend.secret.TIMESCALE_DB_URL={SECRET_VALUE}", f"backend.secret.POSTGRES_MEMORY_URL={SECRET_VALUE}"
    )
    container = backend_container(rendered)
    assert secret_refs(container) == ["x-backend"]
    assert not env_names(container)


def check_secret_lookups(chart: str) -> None:
    lookups = (
        'json:backend.secretLookups=[{"variable":"ALERTA_API_KEY","secret":"alerta","key":"alerta-admin-key"},'
        '{"variable":"OPENAI_API_KEY","secret":"mine","key":"openai"}]'
    )
    rendered = render(chart, lookups, f"backend.secret.OPENAI_API_KEY={SECRET_VALUE}")
    env = {e["name"]: e for e in backend_container(rendered)["env"]}
    assert env["ALERTA_API_KEY"]["valueFrom"]["secretKeyRef"] == {"name": "alerta", "key": "alerta-admin-key"}
    assert "OPENAI_API_KEY" not in env  # given as a secret, so taken from there
    assert rendered["Secret/x-backend"]["stringData"]["OPENAI_API_KEY"] == SECRET_VALUE


def render_error(chart: str, *settings: str) -> str:
    flags = []
    for setting in settings:
        flags += ("--set-json", setting[5:]) if setting.startswith("json:") else ("--set", setting)
    result = subprocess.run(["helm", "template", "x", chart, *flags], capture_output=True, text=True)
    assert result.returncode != 0, f"rendered with {settings}"
    return result.stderr


def lookup(variable: str) -> str:
    return '{"variable":"%s","secret":"s","key":"k"}' % variable


def check_secret_lookups_refused(chart: str) -> None:
    error = render_error(chart, f"json:backend.secretLookups=[{lookup('ALERTA_API_KEY')},{lookup('ALERTA_API_KEY')}]")
    assert "secretLookups lists ALERTA_API_KEY more than once" in error, error
    for variable in ("DB_USER", "DB_PASSWORD", "TIMESCALE_DB_URL", "POSTGRES_MEMORY_URL"):
        error = render_error(chart, f"json:backend.secretLookups=[{lookup(variable)}]")
        assert f"secretLookups can't set {variable}: the chart builds it" in error, error
    # Given as a secret, the URL isn't built, so a lookup for it is skipped rather than refused.
    render(chart, f"json:backend.secretLookups=[{lookup('TIMESCALE_DB_URL')}]",
           f"backend.secret.TIMESCALE_DB_URL={SECRET_VALUE}")
    # Without the operator's Secret, nothing is built and a lookup may set the URLs.
    rendered = render(chart, "backend.postgresCredential.secret=",
                      f"json:backend.secretLookups=[{lookup('TIMESCALE_DB_URL')},{lookup('POSTGRES_MEMORY_URL')}]")
    assert env_names(backend_container(rendered)) == {"TIMESCALE_DB_URL", "POSTGRES_MEMORY_URL"}


def render_notes(chart: str, *flags: str) -> str:
    """Renders NOTES.txt offline: helm template leaves it out, so a copy of the chart includes it in a ConfigMap."""
    with tempfile.TemporaryDirectory() as work:
        copy = Path(work) / "chart"
        shutil.copytree(chart, copy)
        notes = (copy / "templates/NOTES.txt").read_text()
        (copy / "templates/_notes_check.tpl").write_text('{{- define "notes-check" -}}' + notes + "{{- end }}")
        (copy / "templates/notes-check.yaml").write_text(
            'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: notes-check\n'
            'data:\n  notes: {{ include "notes-check" . | quote }}\n'
        )
        output = subprocess.run(
            ["helm", "template", "x", str(copy), "--show-only", "templates/notes-check.yaml", *flags],
            check=True, capture_output=True, text=True,
        ).stdout
    return yaml.safe_load(output)["data"]["notes"]


def check_notes_list_used_lookups(chart: str) -> None:
    notes = render_notes(
        chart,
        "--set-json", f"backend.secretLookups=[{lookup('ALERTA_API_KEY')},{lookup('OPENAI_API_KEY')}]",
        "--set", f"backend.secret.OPENAI_API_KEY={SECRET_VALUE}",
    )
    assert "ALERTA_API_KEY comes from key k of Secret s" in notes, notes
    assert "OPENAI_API_KEY" not in notes, notes


def check_no_secret_in_a_config_map(chart: str) -> None:
    for settings in (
        [f"backend.secret.ANTHROPIC_API_KEY={SECRET_VALUE}"],
        [f"backend.secret.TIMESCALE_DB_URL={SECRET_VALUE}", f"backend.secret.POSTGRES_MEMORY_URL={SECRET_VALUE}"],
    ):
        for name, document in render(chart, *settings).items():
            if name.startswith("ConfigMap/"):
                assert SECRET_VALUE not in str(document), name
            if name.startswith("Deployment/"):
                assert SECRET_VALUE not in str(document["spec"]["template"]["spec"]["containers"]), name


def check_machine_events_settings(chart: str) -> None:
    rendered = render(
        chart,
        "backend.config.CALLBACK_BASE_URL=http://x-backend:8000",
        f"backend.secret.EVENT_WEBHOOK_SECRET={SECRET_VALUE}",
        f"backend.secret.KEYCLOAK_SERVICE_CLIENT_SECRET={SECRET_VALUE}",
    )
    config = rendered["ConfigMap/x-backend"]["data"]
    assert config["CALLBACK_BASE_URL"] == "http://x-backend:8000"
    assert SECRET_VALUE not in str(config)
    assert SECRET_VALUE not in str(rendered["Deployment/x-backend"])
    assert set(rendered["Secret/x-backend"]["stringData"]) >= {"EVENT_WEBHOOK_SECRET", "KEYCLOAK_SERVICE_CLIENT_SECRET"}


def check_auto_archive_setting(chart: str) -> None:
    config = render(chart, "backend.config.AUTO_ARCHIVE_AFTER_S=0")["ConfigMap/x-backend"]["data"]
    assert config["AUTO_ARCHIVE_AFTER_S"] == "0"
    assert "AUTO_ARCHIVE_AFTER_S" not in render(chart)["ConfigMap/x-backend"]["data"]  # the backend's default


def check_tracing_address(chart: str) -> None:
    rendered = render(
        chart,
        "backend.config.LANGFUSE_HOST=https://traces.example.org",
        f"backend.secret.LANGFUSE_PUBLIC_KEY={SECRET_VALUE}-public",
        f"backend.secret.LANGFUSE_SECRET_KEY={SECRET_VALUE}",
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

    rendered = render(chart, "backend.postgresCredential.caSecret=db-ca")
    assert rendered["ConfigMap/x-backend"]["data"]["POSTGRES_SSLROOTCERT"] == CA_PATH
    [mount] = backend_container(rendered)["volumeMounts"]
    assert mount["readOnly"] is True
    assert f"{mount['mountPath']}/ca.crt" == CA_PATH
    [volume] = rendered["Deployment/x-backend"]["spec"]["template"]["spec"]["volumes"]
    assert volume["name"] == mount["name"]
    assert volume["secret"] == {"secretName": "db-ca", "items": [{"key": "ca.crt", "path": "ca.crt"}]}


def check_frontend_nginx_config(chart: str) -> None:
    rendered = render(chart)
    template = Path(chart).resolve().parents[2] / "frontend/nginx/default.conf.template"
    data = rendered["ConfigMap/x-frontend"]["data"]
    assert data["default.conf.template"] == template.read_text(), "the ConfigMap differs from the image's template"
    pod = rendered["Deployment/x-frontend"]["spec"]["template"]
    [mount] = pod["spec"]["containers"][0]["volumeMounts"]
    assert mount["mountPath"] == "/etc/nginx/templates/default.conf.template"
    assert mount["subPath"] == "default.conf.template" and mount["readOnly"] is True
    [volume] = pod["spec"]["volumes"]
    assert volume["name"] == mount["name"] and volume["configMap"]["name"] == "x-frontend"
    assert pod["metadata"]["annotations"]["checksum/config"]


def check_images(chart: str) -> None:
    rendered = render(chart, "imageRegistry=reg.test:5000/team/", "imageTag=1.2.3")
    images = {
        rendered[name]["spec"]["template"]["spec"]["containers"][0]["image"]
        for name in ("Deployment/x-backend", "Deployment/x-frontend")
    }
    assert images == {"reg.test:5000/team/xana-ai-pdt-backend:1.2.3", "reg.test:5000/team/xana-ai-pdt-frontend:1.2.3"}


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
    check_secrets_with_operator_secret,
    check_one_url_given,
    check_urls_given,
    check_secret_lookups,
    check_secret_lookups_refused,
    check_notes_list_used_lookups,
    check_no_secret_in_a_config_map,
    check_machine_events_settings,
    check_auto_archive_setting,
    check_tracing_address,
    check_database_ca,
    check_frontend_nginx_config,
    check_images,
    check_restricted_pods,
)


def main() -> None:
    for check in CHECKS:
        check(sys.argv[1])
        print(f"{check.__name__}: ok")


if __name__ == "__main__":
    main()
