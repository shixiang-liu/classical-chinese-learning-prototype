from __future__ import annotations

import importlib.util
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx

from app.config import APP_ROOT, GROK_API_KEY, ULTRARAG_BASE_URL, ULTRARAG_SEARCH_URL, ULTRARAG_SERVER_ROOT, ULTRARAG_TIMEOUT_SECONDS


@dataclass(frozen=True)
class ToolDefinition:
    name: str
    description: str
    read_only: bool = True
    open_world: bool = True


@dataclass(frozen=True)
class ProviderHealth:
    healthy: bool
    available: bool
    last_error: str | None = None
    notes: list[str] | None = None


@dataclass(frozen=True)
class ProviderDefinition:
    name: str
    display_name: str
    transport: str
    tools: tuple[ToolDefinition, ...]

    def probe(self, config: dict[str, Any]) -> ProviderHealth:
        if self.name == "filesystem":
            app_root = Path(str(config.get("root_path") or APP_ROOT))
            if app_root.exists():
                return ProviderHealth(
                    healthy=True,
                    available=True,
                    notes=["local_workspace_ready"],
                )
            return ProviderHealth(
                healthy=False,
                available=False,
                last_error=f"workspace_path_missing:{app_root}",
            )

        if self.name == "playwright":
            cli_available = shutil.which("playwright") is not None
            package_available = importlib.util.find_spec("playwright") is not None
            if cli_available or package_available:
                return ProviderHealth(
                    healthy=True,
                    available=True,
                    notes=["local_browser_automation_ready"],
                )
            return ProviderHealth(
                healthy=True,
                available=False,
                last_error="playwright_runtime_missing",
                notes=["provider_registered_but_runtime_not_installed"],
            )

        if self.name == "grok-search":
            if GROK_API_KEY:
                return ProviderHealth(
                    healthy=True,
                    available=True,
                    notes=["xai_responses_web_search_ready"],
                )
            return ProviderHealth(
                healthy=False,
                available=False,
                last_error="grok_api_key_missing",
                notes=["configure_GROK_API_KEY_or_grok_search_config"],
            )

        if self.name == "ultrarag":
            mode = str(config.get("mode") or "auto").strip().lower()
            base_url = str(config.get("base_url") or ULTRARAG_BASE_URL).rstrip("/")
            search_url = str(config.get("search_url") or ULTRARAG_SEARCH_URL).strip()
            server_root = str(config.get("server_root") or ULTRARAG_SERVER_ROOT).strip()
            package_available = importlib.util.find_spec("ultrarag") is not None

            if mode in {"auto", "python"} and package_available and server_root:
                return ProviderHealth(
                    healthy=True,
                    available=True,
                    notes=[f"ultrarag_python_ready:{server_root}"],
                )

            if mode in {"auto", "python"} and package_available:
                return ProviderHealth(
                    healthy=True,
                    available=True,
                    notes=["ultrarag_module_ready"],
                )

            if mode in {"auto", "http"} and (search_url or base_url):
                probe_url = search_url or base_url
                try:
                    with httpx.Client(timeout=ULTRARAG_TIMEOUT_SECONDS, follow_redirects=True, trust_env=False) as client:
                        response = client.get(probe_url)
                    if response.status_code < 500:
                        return ProviderHealth(
                            healthy=True,
                            available=True,
                            notes=[f"ultrarag_http_ready:{probe_url}"],
                        )
                    return ProviderHealth(
                        healthy=False,
                        available=False,
                        last_error=f"ultrarag_http_{response.status_code}",
                        notes=[f"probe_url:{probe_url}"],
                    )
                except Exception as exc:
                    return ProviderHealth(
                        healthy=False,
                        available=False,
                        last_error=f"ultrarag_unreachable:{type(exc).__name__}",
                        notes=[f"probe_url:{probe_url}"],
                    )

            return ProviderHealth(
                healthy=False,
                available=False,
                last_error="ultrarag_not_configured",
                notes=["set_server_root_for_python_mode_or_search_url_for_http_mode"],
            )

        return ProviderHealth(
            healthy=False,
            available=False,
            last_error=f"unknown_provider:{self.name}",
        )


_REGISTRY: dict[str, ProviderDefinition] = {
    "filesystem": ProviderDefinition(
        name="filesystem",
        display_name="Filesystem",
        transport="local",
        tools=(
            ToolDefinition("read_file", "Read text files from the local workspace."),
            ToolDefinition("list_directory", "List files and directories in the local workspace."),
            ToolDefinition("search_files", "Search the local workspace for files by pattern."),
        ),
    ),
    "playwright": ProviderDefinition(
        name="playwright",
        display_name="Playwright",
        transport="local",
        tools=(
            ToolDefinition("browser_navigate", "Open and navigate web pages in a controlled browser."),
            ToolDefinition("browser_snapshot", "Capture structured page state for diagnostics."),
            ToolDefinition("browser_take_screenshot", "Capture page or element screenshots."),
        ),
    ),
    "grok-search": ProviderDefinition(
        name="grok-search",
        display_name="Grok Search",
        transport="remote",
        tools=(
            ToolDefinition("web_search", "Run up-to-date web search through the current xAI-backed search path."),
            ToolDefinition("collections_search", "Search document collections through the xAI retrieval path."),
        ),
    ),
    "ultrarag": ProviderDefinition(
        name="ultrarag",
        display_name="UltraRAG",
        transport="remote",
        tools=(
            ToolDefinition("retriever_search", "Query UltraRAG retrieval servers for grounded context."),
            ToolDefinition("generation_generate", "Call UltraRAG generation servers inside an MCP-style RAG pipeline."),
            ToolDefinition("evaluation_evaluate", "Run UltraRAG evaluation tools for retrieval or generation quality."),
        ),
    ),
}


def get_provider_definition(name: str) -> ProviderDefinition | None:
    return _REGISTRY.get(name.strip().lower())


def list_provider_definitions() -> list[ProviderDefinition]:
    return list(_REGISTRY.values())
