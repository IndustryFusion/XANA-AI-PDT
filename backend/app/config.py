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
"""Backend configuration, read from environment variables (and `backend/.env`).

`get_llm()` is the only place that creates the language model.
"""

from __future__ import annotations

import re
from functools import lru_cache
from typing import Literal

from langchain_core.language_models.chat_models import BaseChatModel
from pydantic import Field, SecretStr, ValidationError, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.redact import Redactor, url_password

Provider = Literal["ollama", "anthropic", "openai", "scripted"]


class ConfigError(Exception):
    """The configuration cannot be used; the message names the variables, never their values."""


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", env_ignore_empty=True, extra="ignore")

    llm_provider: Provider = "ollama"
    llm_model: str = Field("llama3.1", min_length=1)
    llm_provider_name: str | None = None
    llm_num_ctx: int = Field(32768, gt=0)
    ollama_url: str = "http://localhost:11434"
    anthropic_api_key: SecretStr | None = None
    openai_api_key: SecretStr | None = None
    openai_base_url: str | None = None
    llm_timeout_s: float = Field(120, gt=0)

    langfuse_public_key: str | None = None
    langfuse_secret_key: SecretStr | None = None
    langfuse_host: str | None = None

    decision_confidence_threshold: float = Field(0.9, ge=0, le=1)
    max_concurrent_rounds: int = Field(2, ge=1)

    ngsi_url: str = "http://localhost:9090"
    ngsi_tenant: str | None = None
    timescale_db_url: SecretStr = SecretStr("postgresql://xana@localhost:5432/tsdb")
    timescale_table: str = "attributes"
    postgres_memory_url: SecretStr = SecretStr("postgresql://xana@localhost:5432/memory")

    health_timeout_s: float = Field(3, gt=0)
    health_cache_s: float = Field(10, ge=0)

    backend_host: str = "127.0.0.1"
    backend_port: int = Field(8000, ge=1, le=65535)
    backend_reload: bool = False
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"

    @field_validator("timescale_table")
    @classmethod
    def _plain_table_name(cls, value: str) -> str:
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?", value):
            raise ValueError("must be a table name (letters, digits, underscores, optional schema)")
        return value

    @field_validator("anthropic_api_key", "openai_api_key")
    @classmethod
    def _key_without_spaces(cls, value: SecretStr | None) -> SecretStr | None:
        if value is not None and any(c.isspace() for c in value.get_secret_value()):
            raise ValueError("must not contain spaces or line breaks")
        return value

    @model_validator(mode="after")
    def _cloud_provider_has_key(self) -> Settings:
        if self.llm_provider == "anthropic" and not self.anthropic_api_key:
            raise ValueError("ANTHROPIC_API_KEY is required when LLM_PROVIDER is anthropic")
        if self.llm_provider == "openai" and not self.openai_api_key and not self.openai_base_url:
            raise ValueError("OPENAI_API_KEY is required when LLM_PROVIDER is openai without OPENAI_BASE_URL")
        return self

    @model_validator(mode="after")
    def _tracing_keys_come_together(self) -> Settings:
        if bool(self.langfuse_public_key) != bool(self.langfuse_secret_key):
            raise ValueError("LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY must be set together")
        return self

    @property
    def llm_label(self) -> str:
        """The provider as operators know it, for example `OpenVINO`."""
        return self.llm_provider_name or self.llm_provider

    def redactor(self) -> Redactor:
        """Masks every secret this configuration holds."""
        return Redactor(
            [
                self.anthropic_api_key and self.anthropic_api_key.get_secret_value(),
                self.openai_api_key and self.openai_api_key.get_secret_value(),
                self.langfuse_secret_key and self.langfuse_secret_key.get_secret_value(),
                url_password(self.timescale_db_url.get_secret_value()),
                url_password(self.postgres_memory_url.get_secret_value()),
            ]
        )


def load_settings(**overrides: object) -> Settings:
    """Reads the settings; raises `ConfigError` naming each invalid variable."""
    try:
        return Settings(**overrides)
    except ValidationError as error:
        problems = []
        for item in error.errors(include_input=False, include_url=False):
            message = item["msg"].removeprefix("Value error, ")
            problems.append(f"{str(item['loc'][0]).upper()}: {message}" if item["loc"] else message)
        raise ConfigError("Invalid configuration:\n  " + "\n  ".join(problems)) from None


@lru_cache
def get_settings() -> Settings:
    return load_settings()


def get_llm(settings: Settings | None = None) -> BaseChatModel:
    """The chat model of the configured provider."""
    s = settings or get_settings()
    match s.llm_provider:
        case "ollama":
            from langchain_ollama import ChatOllama

            return ChatOllama(
                model=s.llm_model,
                base_url=s.ollama_url,
                num_ctx=s.llm_num_ctx,
                reasoning=False,
                client_kwargs={"timeout": s.llm_timeout_s},
            )
        case "anthropic":
            from langchain_anthropic import ChatAnthropic

            return ChatAnthropic(model=s.llm_model, api_key=s.anthropic_api_key, timeout=s.llm_timeout_s)
        case "openai":
            from langchain_openai import ChatOpenAI

            # An OpenAI-compatible server may have no key; the client still needs a value to send.
            api_key = s.openai_api_key or SecretStr("not-needed")
            return ChatOpenAI(model=s.llm_model, api_key=api_key, base_url=s.openai_base_url, timeout=s.llm_timeout_s)
        case "scripted":
            from xana_agent.testing import StepScript

            # Fixed answers that pass through every pause: one question first, then a
            # confident diagnosis once the operator has clarified.
            return StepScript("clarified").model()
    raise ConfigError(f"LLM_PROVIDER: unknown provider {s.llm_provider}")
