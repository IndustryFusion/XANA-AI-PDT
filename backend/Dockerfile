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

# Backend image for the local environment (development only).
FROM python:3.12-slim

WORKDIR /srv/backend
COPY agent/pyproject.toml agent/
COPY agent/xana_agent agent/xana_agent
COPY pyproject.toml ./
COPY app app
COPY migrations migrations
COPY sample_data sample_data
RUN pip install --no-cache-dir -e "./agent[anthropic,openai]" -e ".[tracing]" \
    && useradd --system --uid 10001 xana
USER xana

EXPOSE 8000
CMD ["python", "-m", "app"]
