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
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from cryptography.fernet import Fernet
from langchain_core.language_models.chat_models import BaseChatModel
from pydantic import Field, SecretStr, ValidationError, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.redact import Redactor, url_password
from xana_agent.sources.ontology import is_iri

Provider = Literal["ollama", "anthropic", "openai", "scripted"]

_MAKE_KEY = "Make one with: python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())'"


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

    keycloak_url: str | None = None
    keycloak_realm: str = "iff"
    keycloak_client_id: str = "scorpio"
    factory_id: str | None = None

    gateway_url: str | None = None
    gateway_keycloak_url: str | None = None
    gateway_keycloak_realm: str = "dataspace"
    gateway_client_id: str | None = None
    gateway_client_secret: SecretStr | None = None
    settings_encryption_key: SecretStr | None = None
    data_sharing_policy: Literal["minimal", "adjacent", "timeseries"] = "minimal"
    ifric_url: str | None = None
    inbox_poll_interval_s: float = Field(15, gt=0)

    ngsi_url: str = "http://localhost:9090"
    ngsi_tenant: str | None = None
    ngsi_context_url: str | None = None
    ngsi_allowed_contexts: str | None = None
    pgrest_url: str = "http://pgrest:3000"
    alerta_url: str = "http://alerta:8080/api"
    alerta_api_key: SecretStr | None = None
    alerts_refresh_interval_s: int = Field(30, gt=0)
    fuseki_url: str = "http://fuseki:3030"
    fuseki_dataset: str = "iff"
    fuseki_graph_base: str | None = None
    mqtt_broker_url: str = "mqtt://emqx-listeners:1883"
    mqtt_mgmt_url: str = "http://emqx-dashboard:18083"
    mqtt_broker_notify_url: str | None = None
    ws_allowed_origins: str | None = None
    timescale_db_url: SecretStr = SecretStr("postgresql://xana@localhost:5432/tsdb")
    timescale_table: str = "attributes"
    timescale_entity_table: str = "entities"
    postgres_memory_url: SecretStr = SecretStr("postgresql://xana@localhost:5432/memory")
    postgres_sslmode: Literal["disable", "allow", "prefer", "require", "verify-ca", "verify-full"] | None = None
    postgres_sslrootcert: str | None = None

    health_timeout_s: float = Field(3, gt=0)
    health_cache_s: float = Field(10, ge=0)

    backend_host: str = "127.0.0.1"
    backend_port: int = Field(8000, ge=1, le=65535)
    backend_reload: bool = False
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"

    @field_validator("alerta_url")
    @classmethod
    def _alerta_address(cls, value: str) -> str:
        address = with_scheme(value, "http").rstrip("/")
        if not address.endswith("/api"):
            raise ValueError(
                "must end in /api, for example http://alerta:8080/api; without it, Alerta answers with its web page"
            )
        return address

    @field_validator("fuseki_dataset")
    @classmethod
    def _plain_dataset_name(cls, value: str) -> str:
        if not re.fullmatch(r"[A-Za-z0-9_\-]+", value):
            raise ValueError("must be a dataset name (letters, digits, dashes, underscores)")
        return value

    @field_validator("fuseki_graph_base")
    @classmethod
    def _safe_graph_base(cls, value: str | None) -> str | None:
        if value is not None and not is_iri(value):
            raise ValueError("must be an IRI without spaces, quotes or brackets; it goes into SPARQL queries")
        return value

    @field_validator("pgrest_url", "fuseki_url", "mqtt_mgmt_url", "gateway_url", "gateway_keycloak_url", "ifric_url")
    @classmethod
    def _http_address(cls, value: str | None) -> str | None:
        return value and with_scheme(value, "http")

    @field_validator("mqtt_broker_url", "mqtt_broker_notify_url")
    @classmethod
    def _mqtt_address(cls, value: str | None) -> str | None:
        return value and with_scheme(value, "mqtt")

    @field_validator("timescale_table", "timescale_entity_table")
    @classmethod
    def _plain_table_name(cls, value: str) -> str:
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?", value):
            raise ValueError("must be a table name (letters, digits, underscores, optional schema)")
        return value

    @field_validator("anthropic_api_key", "openai_api_key", "alerta_api_key")
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
    def _gateway_is_complete(self) -> Settings:
        if self.settings_encryption_key:
            try:
                Fernet(self.settings_encryption_key.get_secret_value())
            except ValueError:
                raise ValueError(f"SETTINGS_ENCRYPTION_KEY is not a valid key. {_MAKE_KEY}") from None
        if self.gateway_url and not self.settings_encryption_key:
            raise ValueError(f"SETTINGS_ENCRYPTION_KEY is required when GATEWAY_URL is set. {_MAKE_KEY}")
        if self.gateway_url and not self.gateway_keycloak_url:
            raise ValueError("GATEWAY_KEYCLOAK_URL is required when GATEWAY_URL is set")
        return self

    @model_validator(mode="after")
    def _tracing_keys_come_together(self) -> Settings:
        if bool(self.langfuse_public_key) != bool(self.langfuse_secret_key):
            raise ValueError("LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY must be set together")
        return self

    @model_validator(mode="after")
    def _apply_database_tls(self) -> Settings:
        tls = {"sslmode": self.postgres_sslmode, "sslrootcert": self.postgres_sslrootcert}
        self.postgres_memory_url = SecretStr(_with_query(self.postgres_memory_url.get_secret_value(), tls))
        self.timescale_db_url = SecretStr(_with_query(self.timescale_db_url.get_secret_value(), tls))
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
                self.alerta_api_key and self.alerta_api_key.get_secret_value(),
                self.gateway_client_secret and self.gateway_client_secret.get_secret_value(),
                self.settings_encryption_key and self.settings_encryption_key.get_secret_value(),
                url_password(self.timescale_db_url.get_secret_value()),
                url_password(self.postgres_memory_url.get_secret_value()),
            ]
        )


def with_scheme(address: str, scheme: str) -> str:
    """The address with a scheme, for values written as `host:port`."""
    return address if "://" in address else f"{scheme}://{address}"


def _with_query(url: str, values: dict[str, str | None]) -> str:
    """The URL with `values` added to its query, keeping what it already states."""
    parts = urlsplit(url)
    stated = dict(parse_qsl(parts.query))
    added = {k: v for k, v in values.items() if v and k not in stated}
    return urlunsplit(parts._replace(query=urlencode({**stated, **added}))) if added else url


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
