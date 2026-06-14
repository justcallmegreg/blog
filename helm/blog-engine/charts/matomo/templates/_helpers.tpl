{{- define "matomo.fullname" -}}
{{- printf "%s-matomo" .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "matomo.mariadb.fullname" -}}
{{- printf "%s-matomo-mariadb" .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "matomo.labels" -}}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: matomo
{{- end -}}

{{- define "matomo.mariadb.secretName" -}}
{{- if .Values.mariadb.auth.existingSecret -}}{{ .Values.mariadb.auth.existingSecret }}{{- else -}}{{ include "matomo.mariadb.fullname" . }}{{- end -}}
{{- end -}}
