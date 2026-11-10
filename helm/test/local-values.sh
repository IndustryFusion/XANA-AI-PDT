#!/usr/bin/env bash
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
# Prints the values file of the local test cluster: the default environment with the locally built images, the
# scripted model, the stand-in database without TLS, nginx on xana.localhost, no machine events, and two
# secretLookups read when deploying: one from a Secret in xana-pdt (helm/test/xana-pdt-test-secrets.yaml), by
# its namespace, and one from the stand-ins in iff. The database credentials are read from the stand-in
# operator's Secret in iff. XANA goes in xana-pdt and the stand-ins are in iff, the defaults. It is generated,
# not committed:
#
#   helm/test/local-values.sh > "$RUNNER_TEMP/local-values.yaml"
#   ./helmfile -e default --state-values-file "$RUNNER_TEMP/local-values.yaml" sync
set -euo pipefail

cat <<'VALUES'
imageRegistry: xana-local
imageTag: dev
imagePullPolicy: Never
llmProvider: scripted
postgresSslMode: prefer
ingressClassName: nginx
ingressHost: xana.localhost
callbackBaseUrl: ""
secretLookups:
  - { variable: EVENT_WEBHOOK_SECRET, secret: xana-test-lookup, key: webhook, namespace: xana-pdt }
  - { variable: ALERTA_API_KEY, secret: alerta, key: alerta-admin-key }
VALUES
