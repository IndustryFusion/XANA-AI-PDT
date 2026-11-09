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

import base64
import json
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.parse
from pathlib import Path

import yaml

SECRET_VALUE = "render-check-value"
CA_PATH = "/etc/xana/database-ca/ca.crt"


# Database credentials, as envs/iff-cluster.sh exports them, unless a check says otherwise. The password needs
# percent-encoding in a URL.
CREDENTIALS = ("backend.databaseCredentials.username=xana", "backend.databaseCredentials.password=p@ss:w/rd %+x")
ENCODED_PASSWORD = "p%40ss%3Aw%2Frd%20%25%2Bx"


def flags_for(settings, credentials: bool) -> list[str]:
    flags = []
    for setting in (*CREDENTIALS, *settings) if credentials else settings:
        if setting.startswith("json:"):
            flags += ("--set-json", setting[5:])
        elif setting.startswith("backend.databaseCredentials."):
            # As JSON, so a comma, backslash or = in the value is taken as it is.
            key, value = setting.split("=", 1)
            flags += ("--set-json", f"{key}={json.dumps(value)}")
        else:
            flags += ("--set", setting)
    return flags


def render(chart: str, *settings: str, credentials: bool = True) -> dict[str, dict]:
    flags = flags_for(settings, credentials)
    output = subprocess.run(["helm", "template", "x", chart, *flags], check=True, capture_output=True, text=True).stdout
    documents = [decoded(d) for d in yaml.safe_load_all(output) if d]
    return {f"{d['kind']}/{d['metadata']['name']}": d for d in documents}


def decoded(document: dict) -> dict:
    """A Secret's values, decoded from data; the chart writes data, so a key it drops is removed on apply."""
    if document.get("kind") == "Secret":
        assert "stringData" not in document, f"{document['metadata']['name']} uses stringData"
        document["stringData"] = {k: base64.b64decode(v).decode() for k, v in (document.get("data") or {}).items()}
    return document


def backend_container(rendered: dict[str, dict]) -> dict:
    return rendered["Deployment/x-backend"]["spec"]["template"]["spec"]["containers"][0]


def env_names(container: dict) -> set[str]:
    return {e["name"] for e in container.get("env", [])}


def secret_refs(container: dict) -> list[str]:
    return [e["secretRef"]["name"] for e in container.get("envFrom", []) if "secretRef" in e]


def credential_secrets(container: dict) -> list[str]:
    return [
        e["valueFrom"]["secretKeyRef"]["name"] for e in container["env"] if e["name"] in ("DB_USER", "DB_PASSWORD")
    ]


def check_operator_secret(chart: str) -> None:
    """From the shell: the credentials in the chart's own Secret, percent-encoded."""
    rendered = render(chart)
    container = backend_container(rendered)
    assert {"DB_USER", "DB_PASSWORD", "TIMESCALE_DB_URL", "POSTGRES_MEMORY_URL"} <= env_names(container)
    assert credential_secrets(container) == ["x-database"] * 2
    assert rendered["Secret/x-database"]["stringData"] == {"username": "xana", "password": ENCODED_PASSWORD}
    assert urllib.parse.unquote(ENCODED_PASSWORD) == "p@ss:w/rd %+x"
    urls = {e["name"]: e["value"] for e in container["env"] if e["name"].endswith("_URL")}
    assert urls["TIMESCALE_DB_URL"] == "postgresql://$(DB_USER):$(DB_PASSWORD)@acid-cluster.iff:5432/tsdb"
    assert urls["POSTGRES_MEMORY_URL"] == "postgresql://$(DB_USER):$(DB_PASSWORD)@acid-cluster.iff:5432/memory"
    assert not secret_refs(container)
    assert "Secret/x-backend" not in rendered


def check_copied_secret(chart: str) -> None:
    rendered = render(chart, "backend.postgresCredential.secret=copied", credentials=False)
    assert credential_secrets(backend_container(rendered)) == ["copied"] * 2
    assert "Secret/x-database" not in rendered
    # Credentials given win over a copied Secret.
    rendered = render(chart, "backend.postgresCredential.secret=copied")
    assert credential_secrets(backend_container(rendered)) == ["x-database"] * 2


def check_no_credentials(chart: str) -> None:
    error = render_error(chart, credentials=False)
    for named in ("no database credentials in namespace default", "envs/iff-cluster.sh", "DATABASE_USERNAME",
                  "DATABASE_PASSWORD", "databaseCredentialsSecret", "TIMESCALE_DB_URL and POSTGRES_MEMORY_URL"):
        assert named in error, error
    error = render_error(chart, "backend.databaseCredentials.username=xana", credentials=False)
    assert "DATABASE_USERNAME is set but DATABASE_PASSWORD isn't" in error, error
    error = render_error(chart, "backend.databaseCredentials.password=x", credentials=False)
    assert "DATABASE_PASSWORD is set but DATABASE_USERNAME isn't" in error, error
    # Both URLs given: no credentials needed.
    render(chart, f"backend.secret.TIMESCALE_DB_URL={SECRET_VALUE}", f"backend.secret.POSTGRES_MEMORY_URL={SECRET_VALUE}",
           credentials=False)


def check_special_characters(chart: str) -> None:
    for password in ("a b", "a+b", "%41", "x@y:z/w?#[]!$&'()*,;=", "ümlaut", "$(DB_USER)"):
        stored = render(chart, "backend.databaseCredentials.username=xana",
                        f"backend.databaseCredentials.password={password}", credentials=False
                        )["Secret/x-database"]["stringData"]["password"]
        assert urllib.parse.unquote(stored) == password, (password, stored)
        assert re.fullmatch(r"[A-Za-z0-9._~%-]*", stored), stored


def check_only_own_secrets(chart: str) -> None:
    """Every Secret the Pods and the Ingress name is one the chart renders, unless configured: these resolve in
    the release's namespace, so a configured one has to be there."""
    def named(rendered: dict) -> set[str]:
        names = set()
        for kind_name, d in rendered.items():
            if kind_name.startswith("Ingress/"):
                names |= {t["secretName"] for t in d["spec"].get("tls", []) if t.get("secretName")}
            if not kind_name.startswith("Deployment/"):
                continue
            spec = d["spec"]["template"]["spec"]
            names |= {s["name"] for s in spec.get("imagePullSecrets", [])}
            names |= {v["secret"]["secretName"] for v in spec.get("volumes", []) if "secret" in v}
            for c in spec["containers"]:
                names |= set(secret_refs(c))
                names |= {e["valueFrom"]["secretKeyRef"]["name"] for e in c.get("env", [])
                          if "secretKeyRef" in e.get("valueFrom", {})}
        return names

    for settings, configured in (
        ((), set()),
        ((f"backend.secret.ANTHROPIC_API_KEY={SECRET_VALUE}",), set()),
        (("backend.postgresCredential.caSecret=db-ca", f"json:backend.secretLookups=[{lookup('ALERTA_API_KEY')}]"),
         {"db-ca", "s"}),
        # As the production environment sets it, and a pull Secret.
        (("ingress.tlsSecret=xana-tls", 'json:imagePullSecrets=[{"name":"registry-pull"}]'), {"xana-tls", "registry-pull"}),
    ):
        rendered = render(chart, *settings)
        own = {n.split("/", 1)[1] for n in rendered if n.startswith("Secret/")}
        assert named(rendered) - own == configured, (settings, named(rendered), own)


def check_credentials_restart(chart: str) -> None:
    def checksum(password: str) -> str:
        rendered = render(chart, "backend.databaseCredentials.username=xana",
                          f"backend.databaseCredentials.password={password}", credentials=False)
        return rendered["Deployment/x-backend"]["spec"]["template"]["metadata"]["annotations"]["checksum/database"]
    assert checksum("one") != checksum("two")


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


def render_error(chart: str, *settings: str, credentials: bool = True) -> str:
    flags = flags_for(settings, credentials)
    result = subprocess.run(["helm", "template", "x", chart, *flags], capture_output=True, text=True)
    assert result.returncode != 0, f"rendered with {settings}"
    return result.stderr


def lookup(variable: str) -> str:
    return '{"variable":"%s","secret":"s","key":"k"}' % variable


def check_secret_lookups_refused(chart: str) -> None:
    error = render_error(chart, f"json:backend.secretLookups=[{lookup('ALERTA_API_KEY')},{lookup('ALERTA_API_KEY')}]")
    assert "secretLookups lists ALERTA_API_KEY more than once" in error, error
    for variable in ("DB_USER", "DB_PASSWORD"):
        error = render_error(chart, f"json:backend.secretLookups=[{lookup(variable)}]")
        assert f"secretLookups can't set {variable}: the chart sets it" in error, error
    # A URL from a lookup isn't built.
    rendered = render(chart, f"json:backend.secretLookups=[{lookup('TIMESCALE_DB_URL')}]")
    env = backend_container(rendered)["env"]
    assert [e["name"] for e in env].count("TIMESCALE_DB_URL") == 1
    assert {"DB_USER", "POSTGRES_MEMORY_URL"} <= env_names(backend_container(rendered))
    # Both URLs from lookups: nothing is built, and no credentials are needed.
    rendered = render(chart, f"json:backend.secretLookups=[{lookup('TIMESCALE_DB_URL')},{lookup('POSTGRES_MEMORY_URL')}]",
                      credentials=False)
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
            ["helm", "template", "x", str(copy), "--show-only", "templates/notes-check.yaml", *flags_for((), True), *flags],
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
    assert "kept in\nSecret x-database" in notes, notes
    notes = render_notes(chart, "--set", "backend.databaseCredentials.username=", "--set",
                         "backend.databaseCredentials.password=", "--set", "backend.postgresCredential.secret=copied")
    assert "come from Secret copied" in notes, notes


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
    check_copied_secret,
    check_no_credentials,
    check_special_characters,
    check_only_own_secrets,
    check_credentials_restart,
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
