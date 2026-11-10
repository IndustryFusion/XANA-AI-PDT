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
{{- define "xana-pdt.labels" -}}
app.kubernetes.io/name: {{ .Chart.Name }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{- define "xana-pdt.selector" -}}
app.kubernetes.io/instance: {{ .root.Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end }}

{{- define "xana-pdt.image" -}}
{{- printf "%s/%s:%s" (trimSuffix "/" .root.Values.imageRegistry) .name (.root.Values.imageTag | default (printf "v%s" .root.Chart.AppVersion)) -}}
{{- end }}

{{- define "xana-pdt.backend" -}}
{{- printf "%s-backend" .Release.Name -}}
{{- end }}

{{- define "xana-pdt.frontend" -}}
{{- printf "%s-frontend" .Release.Name -}}
{{- end }}

{{/* Where the database's CA certificate is mounted, when one is named. */}}
{{- define "xana-pdt.databaseCaPath" -}}
/etc/xana/database-ca/ca.crt
{{- end }}

{{/* The Secret the chart creates for the database credentials. */}}
{{- define "xana-pdt.databaseSecret" -}}
{{- printf "%s-database" .Release.Name -}}
{{- end }}

{{/* Percent-encodes a value for a URL's user-info: urlquery writes a space as "+" and a "+" as "%2B". */}}
{{- define "xana-pdt.percentEncode" -}}
{{- . | toString | urlquery | replace "+" "%20" -}}
{{- end }}

{{- /*
How the platform's Secrets are read: "test" (testLookups, for the render checks only), "cluster" (Helm lookup,
during install or upgrade), or "offline" (helm template, or a diff without cluster access, where lookup gives
nothing). Every namespace has ServiceAccount default, so finding it in platformNamespace means a cluster answers.
*/}}
{{- define "xana-pdt.lookupMode" -}}
{{- if kindIs "map" .Values.testLookups -}}
test
{{- else if lookup "v1" "ServiceAccount" .Values.platformNamespace "default" -}}
cluster
{{- else -}}
offline
{{- end -}}
{{- end }}

{{- /*
A lookup's namespace: dict "root" "namespace". "$namespace" is the release's, "$platformNamespace" is
platformNamespace, empty is platformNamespace, and any other name is used as given. Another "$" name stops.
*/}}
{{- define "xana-pdt.lookupNamespace" -}}
{{- $n := .namespace | default "$platformNamespace" | toString -}}
{{- if eq $n "$namespace" -}}
{{ .root.Release.Namespace }}
{{- else if eq $n "$platformNamespace" -}}
{{ .root.Values.platformNamespace }}
{{- else if hasPrefix "$" $n -}}
{{- fail (printf "%s isn't a namespace the chart knows: use $namespace, $platformNamespace or a namespace's name." $n) -}}
{{- else -}}
{{ $n }}
{{- end -}}
{{- end }}

{{- /*
Reads one key of one Secret: dict "root" "namespace" "name" "key" "mode". Gives JSON {"value": …} or
{"problem": …}. In "test" mode, testLookups maps "<namespace>/<name>" to the Secret's keys, in plain text.
*/}}
{{- define "xana-pdt.readSecret" -}}
{{- $where := printf "Secret %s in namespace %s" .name .namespace -}}
{{- $data := dict -}}
{{- $found := false -}}
{{- if eq .mode "test" -}}
{{- with index .root.Values.testLookups (printf "%s/%s" .namespace .name) -}}
{{- $found = true -}}
{{- range $k, $v := . }}{{ $_ := set $data $k ($v | toString | b64enc) }}{{ end -}}
{{- end -}}
{{- else -}}
{{- with lookup "v1" "Secret" .namespace .name -}}
{{- $found = true -}}
{{- $data = .data | default dict -}}
{{- end -}}
{{- end -}}
{{- if not $found -}}
{{- toJson (dict "problem" (printf "%s not found" $where)) -}}
{{- else if not (index $data .key) -}}
{{- toJson (dict "problem" (printf "key %s not in %s" .key $where)) -}}
{{- else -}}
{{- toJson (dict "value" (index $data .key | b64dec)) -}}
{{- end -}}
{{- end }}

{{- /*
The backend's secrets and database credentials, resolved, as JSON:
  mode       how the platform's Secrets were read (see lookupMode)
  secret     each variable: from backend.secret (the shell, else the environment file), else a secretLookups entry
  lookedUp   [{variable, secret, key, namespace}] of the entries read
  pending    variables a lookup would give, not read for want of a cluster
  problems   {variable: why its lookup found nothing}
  database   {source, username, password}: source "given", "lookup", "offline", or "urls" when both URLs are given
Stops the render for a lookup listed twice or for DB_USER or DB_PASSWORD, for only one of the two credentials,
and, with a cluster, for no credentials found.
*/}}
{{- define "xana-pdt.resolved" -}}
{{- $mode := include "xana-pdt.lookupMode" . -}}
{{- $given := .Values.backend.secret | default dict -}}
{{- $secret := deepCopy $given -}}
{{- $lookedUp := list -}}
{{- $pending := list -}}
{{- $problems := dict -}}
{{- $seen := dict -}}
{{- range .Values.backend.secretLookups | default list -}}
{{- $variable := required "each of secretLookups needs a variable" .variable -}}
{{- if hasKey $seen $variable -}}
{{- fail (printf "secretLookups lists %s more than once; keep one entry." $variable) -}}
{{- end -}}
{{- $_ := set $seen $variable true -}}
{{- if has $variable (list "DB_USER" "DB_PASSWORD") -}}
{{- fail (printf "secretLookups can't set %s: the chart sets it to build the database URLs. Give both database URLs instead, or remove the entry." $variable) -}}
{{- end -}}
{{- if not (hasKey $given $variable) -}}
{{- $entry := dict "variable" $variable "secret" (required "each of secretLookups needs a secret" .secret) "key" (required "each of secretLookups needs a key" .key) "namespace" (include "xana-pdt.lookupNamespace" (dict "root" $ "namespace" .namespace)) -}}
{{- if eq $mode "offline" -}}
{{- $pending = append $pending $variable -}}
{{- else -}}
{{- $read := include "xana-pdt.readSecret" (dict "root" $ "namespace" $entry.namespace "name" $entry.secret "key" $entry.key "mode" $mode) | fromJson -}}
{{- if hasKey $read "value" -}}
{{- $_ := set $secret $variable $read.value -}}
{{- $lookedUp = append $lookedUp $entry -}}
{{- else -}}
{{- $_ := set $problems $variable $read.problem -}}
{{- end -}}
{{- end -}}
{{- end -}}
{{- end -}}
{{- $urls := 0 -}}
{{- range list "TIMESCALE_DB_URL" "POSTGRES_MEMORY_URL" -}}
{{- if or (hasKey $secret .) (has . $pending) }}{{ $urls = add1 $urls }}{{ end -}}
{{- end -}}
{{- $c := .Values.backend.databaseCredentials | default dict -}}
{{- $user := $c.username | default "" | toString -}}
{{- $password := $c.password | default "" | toString -}}
{{- $database := dict "source" "urls" -}}
{{- if lt $urls 2 -}}
{{- if and $user $password -}}
{{- $database = dict "source" "given" "username" $user "password" $password -}}
{{- else if $user -}}
{{- fail "DATABASE_USERNAME is set but DATABASE_PASSWORD isn't: set both, or neither." -}}
{{- else if $password -}}
{{- fail "DATABASE_PASSWORD is set but DATABASE_USERNAME isn't: set both, or neither." -}}
{{- else if eq $mode "offline" -}}
{{- $database = dict "source" "offline" -}}
{{- else -}}
{{- $name := .Values.backend.postgresCredential.secret -}}
{{- $dbNamespace := include "xana-pdt.lookupNamespace" (dict "root" $ "namespace" .Values.backend.postgresCredential.namespace) -}}
{{- $why := "databaseCredentialsSecret is empty" -}}
{{- if $name -}}
{{- $u := include "xana-pdt.readSecret" (dict "root" $ "namespace" $dbNamespace "name" $name "key" "username" "mode" $mode) | fromJson -}}
{{- $p := include "xana-pdt.readSecret" (dict "root" $ "namespace" $dbNamespace "name" $name "key" "password" "mode" $mode) | fromJson -}}
{{- if and (hasKey $u "value") (hasKey $p "value") -}}
{{- $database = dict "source" "lookup" "username" $u.value "password" $p.value "secret" $name "namespace" $dbNamespace -}}
{{- else -}}
{{- $why = $u.problem | default $p.problem -}}
{{- end -}}
{{- end -}}
{{- if ne $database.source "lookup" -}}
{{- fail (printf "The backend has no database credentials: %s. Set DATABASE_USERNAME and DATABASE_PASSWORD, set databaseCredentialsSecret and databaseCredentialsNamespace to the database operator's Secret (read in %s), or give TIMESCALE_DB_URL and POSTGRES_MEMORY_URL." $why $dbNamespace) -}}
{{- end -}}
{{- end -}}
{{- end -}}
{{- toJson (dict "mode" $mode "secret" $secret "lookedUp" $lookedUp "pending" $pending "problems" $problems "database" $database) -}}
{{- end }}

{{- /* The note a Secret carries when the platform's Secrets weren't read. */}}
{{- define "xana-pdt.offlineNote" -}}
# The platform's Secrets weren't read: this render had no cluster (helm template, or a diff without
# --dry-run=server). apply reads them, and XANA's own, each in the namespace its entry names.
{{- end }}
