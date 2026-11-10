{{/*
Copyright (c) 2026 IndustryFusion Foundation

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

  http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/}}
{{- /*
The checks the backend makes when it starts (backend/app/config.py), made when deploying instead, with the
backend's own messages. dict "root" "resolved". A secret a lookup would give without a cluster to read it
from counts as present, so nothing stops a render that apply would pass.
*/}}
{{- define "xana-pdt.checks" -}}
{{- $c := .root.Values.backend.config | default dict -}}
{{- $s := .resolved.secret -}}
{{- $pending := .resolved.pending -}}
{{- $has := dict -}}
{{- range $k, $v := $s }}{{ if $v }}{{ $_ := set $has $k true }}{{ end }}{{ end -}}
{{- range $pending }}{{ $_ := set $has . true }}{{ end -}}
{{- $makeKey := "Make one with: python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())'" -}}
{{- $value := dict -}}
{{- range $k, $v := $c }}{{ $_ := set $value $k ($v | toString) }}{{ end -}}
{{- /* The language model. */ -}}
{{- if and (eq ($value.LLM_PROVIDER | default "") "anthropic") (not $has.ANTHROPIC_API_KEY) -}}
{{- fail "ANTHROPIC_API_KEY is required when LLM_PROVIDER is anthropic" -}}
{{- end -}}
{{- if and (eq ($value.LLM_PROVIDER | default "") "openai") (not $has.OPENAI_API_KEY) (not $value.OPENAI_BASE_URL) -}}
{{- fail "OPENAI_API_KEY is required when LLM_PROVIDER is openai without OPENAI_BASE_URL" -}}
{{- end -}}
{{- /* The dataspace. */ -}}
{{- with $s.SETTINGS_ENCRYPTION_KEY -}}
{{- if not (regexMatch "^[A-Za-z0-9_-]{43}=$" (toString .)) -}}
{{- fail (printf "SETTINGS_ENCRYPTION_KEY is not a valid key. %s" $makeKey) -}}
{{- end -}}
{{- end -}}
{{- if and $value.GATEWAY_URL (not $has.SETTINGS_ENCRYPTION_KEY) -}}
{{- fail (printf "SETTINGS_ENCRYPTION_KEY is required when GATEWAY_URL is set. %s" $makeKey) -}}
{{- end -}}
{{- if and $value.GATEWAY_URL (not $value.GATEWAY_KEYCLOAK_URL) -}}
{{- fail "GATEWAY_KEYCLOAK_URL is required when GATEWAY_URL is set" -}}
{{- end -}}
{{- /* Machine events. */ -}}
{{- if and $value.CALLBACK_BASE_URL (not $has.EVENT_WEBHOOK_SECRET) -}}
{{- fail "EVENT_WEBHOOK_SECRET is required when CALLBACK_BASE_URL is set. Make one with: openssl rand -hex 32; or leave callbackBaseUrl empty for no machine events." -}}
{{- end -}}
{{- if or (and $value.KEYCLOAK_SERVICE_CLIENT_ID (not $has.KEYCLOAK_SERVICE_CLIENT_SECRET)) (and $s.KEYCLOAK_SERVICE_CLIENT_SECRET (not $value.KEYCLOAK_SERVICE_CLIENT_ID)) -}}
{{- fail "KEYCLOAK_SERVICE_CLIENT_ID and KEYCLOAK_SERVICE_CLIENT_SECRET must be set together" -}}
{{- end -}}
{{- if and $value.KEYCLOAK_SERVICE_CLIENT_ID (not $value.KEYCLOAK_URL) -}}
{{- fail "KEYCLOAK_URL is required when KEYCLOAK_SERVICE_CLIENT_ID is set" -}}
{{- end -}}
{{- /* Tracing: a key only a lookup would give, without a cluster, isn't known to be missing. */ -}}
{{- if or (and $s.LANGFUSE_PUBLIC_KEY (not $has.LANGFUSE_SECRET_KEY)) (and $s.LANGFUSE_SECRET_KEY (not $has.LANGFUSE_PUBLIC_KEY)) -}}
{{- fail "LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY must be set together" -}}
{{- end -}}
{{- /* Single values. */ -}}
{{- with $value.ALERTA_URL -}}
{{- if not (hasSuffix "/api" (trimSuffix "/" .)) -}}
{{- fail "alertaUrl (ALERTA_URL) must end in /api, for example http://alerta:8080/api; without it, Alerta answers with its web page" -}}
{{- end -}}
{{- end -}}
{{- with $value.FUSEKI_DATASET -}}
{{- if not (regexMatch "^[A-Za-z0-9_\\-]+$" .) -}}
{{- fail "fusekiDataset (FUSEKI_DATASET) must be a dataset name (letters, digits, dashes, underscores)" -}}
{{- end -}}
{{- end -}}
{{- range $key, $variable := dict "timescaleTable" "TIMESCALE_TABLE" "timescaleEntityTable" "TIMESCALE_ENTITY_TABLE" -}}
{{- with index $value $variable -}}
{{- if not (regexMatch "^[A-Za-z_][A-Za-z0-9_]*(\\.[A-Za-z_][A-Za-z0-9_]*)?$" .) -}}
{{- fail (printf "%s (%s) must be a table name (letters, digits, underscores, optional schema)" $key $variable) -}}
{{- end -}}
{{- end -}}
{{- end -}}
{{- range $name := list "ANTHROPIC_API_KEY" "OPENAI_API_KEY" "ALERTA_API_KEY" "EVENT_WEBHOOK_SECRET" -}}
{{- if regexMatch "\\s" (index $s $name | default "" | toString) -}}
{{- fail (printf "%s must not contain spaces or line breaks" $name) -}}
{{- end -}}
{{- end -}}
{{- end }}
