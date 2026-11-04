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
import os
import re
import subprocess
import sys
from pathlib import Path

import pytest

from app.config import ConfigError, Settings, get_llm, load_settings

BACKEND = Path(__file__).resolve().parents[1]


def test_defaults_without_environment():
    s = load_settings(_env_file=None)
    assert s.llm_provider == "ollama"
    assert s.llm_model == "llama3.1"
    assert s.decision_confidence_threshold == 0.9
    assert s.timescale_table == "attributes"


@pytest.mark.parametrize(
    ("variable", "value", "expected"),
    [
        ("DECISION_CONFIDENCE_THRESHOLD", "1.5", "DECISION_CONFIDENCE_THRESHOLD"),
        ("LLM_PROVIDER", "gemini", "LLM_PROVIDER"),
        ("TIMESCALE_TABLE", "x; drop table y", "TIMESCALE_TABLE"),
    ],
)
def test_invalid_setting_names_variable(monkeypatch, variable, value, expected):
    monkeypatch.setenv(variable, value)
    with pytest.raises(ConfigError) as error:
        load_settings(_env_file=None)
    assert expected in str(error.value)


def test_missing_cloud_key_is_named(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "anthropic")
    with pytest.raises(ConfigError, match="ANTHROPIC_API_KEY is required"):
        load_settings(_env_file=None)


def test_invalid_secret_is_named_but_not_shown(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "openai")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-very secret-value")
    with pytest.raises(ConfigError) as error:
        load_settings(_env_file=None)
    assert "OPENAI_API_KEY" in str(error.value)
    assert "secret-value" not in str(error.value)


def test_secrets_hidden_in_repr():
    s = load_settings(_env_file=None, llm_provider="anthropic", anthropic_api_key="sk-ant-123456")
    assert "sk-ant-123456" not in repr(s)


def test_empty_values_count_as_unset(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "")
    monkeypatch.setenv("NGSI_TENANT", "")
    s = load_settings(_env_file=None)
    assert s.anthropic_api_key is None
    assert s.ngsi_tenant is None


def test_every_setting_is_documented():
    documented = set(re.findall(r"^([A-Z0-9_]+)=", (BACKEND / ".env.example").read_text(), re.M))
    assert documented == {name.upper() for name in Settings.model_fields}


def test_secret_variables_have_no_value_in_example():
    text = (BACKEND / ".env.example").read_text()
    for name in ("ANTHROPIC_API_KEY", "OPENAI_API_KEY"):
        assert re.search(rf"^{name}=$", text, re.M)


def test_start_refused_with_message():
    env = {k: v for k, v in os.environ.items() if not k.isupper() or k in ("PATH", "HOME")}
    env["DECISION_CONFIDENCE_THRESHOLD"] = "1.5"
    result = subprocess.run(
        [sys.executable, "-m", "app"],
        cwd=BACKEND / "tests",
        env=env,  # noqa: S603
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert result.returncode == 2
    assert "DECISION_CONFIDENCE_THRESHOLD" in result.stderr


@pytest.mark.parametrize(
    ("provider", "extra", "class_name"),
    [
        ("ollama", {}, "ChatOllama"),
        ("anthropic", {"anthropic_api_key": "sk-ant-test"}, "ChatAnthropic"),
        ("openai", {"openai_api_key": "sk-test"}, "ChatOpenAI"),
        ("scripted", {}, "ScriptedChatModel"),
    ],
)
def test_llm_follows_configuration(provider, extra, class_name):
    s = Settings(_env_file=None, llm_provider=provider, llm_model="some-model", **extra)
    assert type(get_llm(s)).__name__ == class_name


def test_scripted_model_needs_no_network(block_network):
    from pydantic import BaseModel

    class Decision(BaseModel):
        root_cause: str
        confidence: float

    llm = get_llm(Settings(_env_file=None, llm_provider="scripted"))
    answer = llm.with_structured_output(Decision).invoke("Why is the spindle vibrating?")
    assert isinstance(answer, Decision)
    assert llm.invoke("hello").content
