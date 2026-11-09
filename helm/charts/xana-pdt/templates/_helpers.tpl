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

{{/* The database URLs given as secrets or by secretLookups, as JSON {"TIMESCALE_DB_URL": true, ...}. */}}
{{- define "xana-pdt.givenDatabaseUrls" -}}
{{- $s := .Values.backend.secret | default dict -}}
{{- $given := dict -}}
{{- range list "TIMESCALE_DB_URL" "POSTGRES_MEMORY_URL" -}}
{{- if hasKey $s . }}{{ $_ := set $given . true }}{{ end -}}
{{- end -}}
{{- range $.Values.backend.secretLookups | default list -}}
{{- if has .variable (list "TIMESCALE_DB_URL" "POSTGRES_MEMORY_URL") }}{{ $_ := set $given .variable true }}{{ end -}}
{{- end -}}
{{- toJson $given -}}
{{- end }}

{{/* Whether the Pod builds a database URL: not when both are given as secrets or by secretLookups. */}}
{{- define "xana-pdt.buildsDatabaseUrls" -}}
{{- if lt (len (include "xana-pdt.givenDatabaseUrls" . | fromJson)) 2 -}}
true
{{- end -}}
{{- end }}

{{/* The Secret the chart creates for the database credentials. */}}
{{- define "xana-pdt.databaseSecret" -}}
{{- printf "%s-database" .Release.Name -}}
{{- end }}

{{- /*
Where the database credentials come from, when the Pod builds the URLs: "chart" (databaseCredentials, stored in
the chart's own Secret), "copied" (postgresCredential.secret), or "" when the URLs are given. Stops the render
when neither is there, or when only one of the two credentials is.
*/}}
{{- define "xana-pdt.databaseCredentialsSource" -}}
{{- if include "xana-pdt.buildsDatabaseUrls" . -}}
{{- $c := .Values.backend.databaseCredentials | default dict -}}
{{- $user := $c.username | default "" | toString -}}
{{- $password := $c.password | default "" | toString -}}
{{- if and $user $password -}}
chart
{{- else if $user -}}
{{- fail "DATABASE_USERNAME is set but DATABASE_PASSWORD isn't: set both, or neither." -}}
{{- else if $password -}}
{{- fail "DATABASE_PASSWORD is set but DATABASE_USERNAME isn't: set both, or neither." -}}
{{- else if .Values.backend.postgresCredential.secret -}}
copied
{{- else -}}
{{- fail (printf "The backend has no database credentials in namespace %s. Source envs/iff-cluster.sh, or set DATABASE_USERNAME and DATABASE_PASSWORD; or set databaseCredentialsSecret to a Secret copied into %s; or give TIMESCALE_DB_URL and POSTGRES_MEMORY_URL." .Release.Namespace .Release.Namespace) -}}
{{- end -}}
{{- end -}}
{{- end }}

{{/* The name of the Secret DB_USER and DB_PASSWORD read from. */}}
{{- define "xana-pdt.databaseCredentialsSecret" -}}
{{- if eq (include "xana-pdt.databaseCredentialsSource" .) "chart" -}}
{{ include "xana-pdt.databaseSecret" . }}
{{- else -}}
{{ .Values.backend.postgresCredential.secret }}
{{- end -}}
{{- end }}

{{/* Percent-encodes a value for a URL's user-info: urlquery writes a space as "+" and a "+" as "%2B". */}}
{{- define "xana-pdt.percentEncode" -}}
{{- . | toString | urlquery | replace "+" "%20" -}}
{{- end }}

{{- /*
The secretLookups the backend uses, as JSON {"lookups": [...]}: those whose variable isn't given in
backend.secret. Stops the render for a variable listed twice, or one the chart already sets itself.
*/}}
{{- define "xana-pdt.secretLookups" -}}
{{- $given := .Values.backend.secret | default dict -}}
{{- $set := list -}}
{{- if include "xana-pdt.buildsDatabaseUrls" . -}}
{{- $set = list "DB_USER" "DB_PASSWORD" -}}
{{- end -}}
{{- $seen := dict -}}
{{- $used := list -}}
{{- range .Values.backend.secretLookups | default list -}}
{{- $variable := required "each of secretLookups needs a variable" .variable -}}
{{- if hasKey $seen $variable -}}
{{- fail (printf "secretLookups lists %s more than once; keep one entry." $variable) -}}
{{- end -}}
{{- $_ := set $seen $variable true -}}
{{- if has $variable $set -}}
{{- fail (printf "secretLookups can't set %s: the chart sets it to build the database URLs. Give both database URLs instead, or remove the entry." $variable) -}}
{{- end -}}
{{- if not (hasKey $given $variable) -}}
{{- $used = append $used . -}}
{{- end -}}
{{- end -}}
{{- toJson (dict "lookups" $used) -}}
{{- end }}
