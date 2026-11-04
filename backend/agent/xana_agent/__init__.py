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
"""XANA AI PDT diagnostic agent workflow.

A self-contained package: it can be installed, imported and tested without
the backend service, which is one of its consumers.
"""

from xana_agent.scripted import ScriptedChatModel, example_for, register_example

__all__ = ["ScriptedChatModel", "example_for", "register_example"]
