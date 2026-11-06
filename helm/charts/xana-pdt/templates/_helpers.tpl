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
{{- printf "%s/%s:%s" .root.Values.image.registry .name (.root.Values.image.tag | default (printf "v%s" .root.Chart.AppVersion)) -}}
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
