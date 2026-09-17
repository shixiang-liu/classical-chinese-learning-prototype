from __future__ import annotations

import copy
import json
import logging
from datetime import datetime, timezone
from typing import Any

from app.config import GROK_API_KEY

from .provider_registry import ToolDefinition, get_provider_definition

logger = logging.getLogger(__name__)

_REMOVED_PROVIDER_NAMES = {"filesystem", "playwright"}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


_CACHE: dict[str, Any] = {
    "source_version_id": None,
    "snapshot": None,
}

_BRIDGE_TOOLS: dict[str, ToolDefinition] = {}


def _normalize_provider_entry(entry: Any) -> dict[str, Any] | None:
    if isinstance(entry, str) and entry.strip():
        name = entry.strip()
        if name in _REMOVED_PROVIDER_NAMES:
            return None
        return {"name": name, "enabled": True, "config": {}}

    if isinstance(entry, dict):
        raw_name = entry.get("name") or entry.get("provider") or entry.get("key")
        if not isinstance(raw_name, str) or not raw_name.strip():
            return None
        if raw_name.strip() in _REMOVED_PROVIDER_NAMES:
            return None
        provider_config = entry.get("config")
        return {
            "name": raw_name.strip(),
            "enabled": bool(entry.get("enabled", True)),
            "config": provider_config if isinstance(provider_config, dict) else {},
        }

    return None


def normalize_mcp_config(config_json: dict[str, Any] | None) -> dict[str, Any]:
    raw = config_json if isinstance(config_json, dict) else {}

    providers_input = raw.get("providers", [])
    providers: list[dict[str, Any]] = []
    if isinstance(providers_input, list):
        for item in providers_input:
            normalized = _normalize_provider_entry(item)
            if normalized is not None:
                providers.append(normalized)

    tool_overrides = raw.get("tool_overrides")
    if not isinstance(tool_overrides, dict):
        tool_overrides = {}

    return {
        "enabled": bool(raw.get("enabled", True)),
        "hot_reload": bool(raw.get("hot_reload", True)),
        "providers": providers,
        "tool_overrides": tool_overrides,
    }


def _tool_override_enabled(tool_overrides: dict[str, Any], tool_name: str) -> bool:
    raw = tool_overrides.get(tool_name)
    if isinstance(raw, bool):
        return raw
    if isinstance(raw, dict):
        return bool(raw.get("enabled", True))
    return True


def _build_provider_status(entry: dict[str, Any], bridge_enabled: bool, checked_at: str) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    provider_name = entry["name"]
    provider_enabled = bool(entry.get("enabled", True))
    provider_config = entry.get("config") if isinstance(entry.get("config"), dict) else {}
    definition = get_provider_definition(provider_name)

    if definition is None:
        status = {
            "name": provider_name,
            "display_name": provider_name,
            "enabled": provider_enabled,
            "registered": False,
            "healthy": False,
            "available": False,
            "runtime_enabled": False,
            "transport": None,
            "tool_count": 0,
            "checked_at": checked_at,
            "notes": [],
            "last_error": f"unknown_provider:{provider_name}",
        }
        return status, {}

    health = definition.probe(provider_config)
    runtime_enabled = bridge_enabled and provider_enabled and health.available
    status = {
        "name": definition.name,
        "display_name": definition.display_name,
        "enabled": provider_enabled,
        "registered": True,
        "healthy": health.healthy,
        "available": health.available,
        "runtime_enabled": runtime_enabled,
        "transport": definition.transport,
        "tool_count": len(definition.tools),
        "checked_at": checked_at,
        "notes": health.notes or [],
        "last_error": health.last_error,
    }

    tools: dict[str, dict[str, Any]] = {}
    for tool in definition.tools:
        tools[tool.name] = {
            "name": tool.name,
            "provider": definition.name,
            "description": tool.description,
            "read_only": tool.read_only,
            "open_world": tool.open_world,
            "registered": True,
            "healthy": health.healthy,
            "available": health.available,
            "enabled": runtime_enabled,
            "runtime_enabled": runtime_enabled,
            "checked_at": checked_at,
            "last_error": health.last_error,
        }

    return status, tools


def _build_bridge_tool_status(
    tool_name: str,
    tool_definition: ToolDefinition,
    *,
    bridge_enabled: bool,
    tool_overrides: dict[str, Any],
    checked_at: str,
) -> dict[str, Any]:
    tool_requested_enabled = _tool_override_enabled(tool_overrides, tool_name)

    if tool_name == "web_search":
        available = bool(GROK_API_KEY)
        last_error = None if available else "grok_api_key_missing"
    else:
        available = False
        last_error = "bridge_tool_not_implemented"

    runtime_enabled = bridge_enabled and tool_requested_enabled and available

    return {
        "name": tool_name,
        "provider": "bridge",
        "description": tool_definition.description,
        "read_only": tool_definition.read_only,
        "open_world": tool_definition.open_world,
        "registered": True,
        "healthy": tool_requested_enabled,
        "available": available,
        "enabled": bridge_enabled and tool_requested_enabled,
        "runtime_enabled": runtime_enabled,
        "checked_at": checked_at,
        "last_error": last_error,
    }


def _build_snapshot(config_row: dict[str, Any]) -> dict[str, Any]:
    config_json = config_row.get("config_json") if isinstance(config_row.get("config_json"), dict) else {}
    normalized = normalize_mcp_config(config_json)
    bridge_enabled = bool(normalized["enabled"])
    checked_at = _now_iso()

    providers_detail: dict[str, dict[str, Any]] = {}
    provider_configs: dict[str, dict[str, Any]] = {}
    tools: dict[str, dict[str, Any]] = {}

    for entry in normalized["providers"]:
        provider_status, provider_tools = _build_provider_status(entry, bridge_enabled, checked_at)
        providers_detail[provider_status["name"]] = provider_status
        provider_configs[provider_status["name"]] = copy.deepcopy(entry.get("config") if isinstance(entry.get("config"), dict) else {})
        tools.update(provider_tools)

    for tool_name, tool_definition in _BRIDGE_TOOLS.items():
        tools[tool_name] = _build_bridge_tool_status(
            tool_name,
            tool_definition,
            bridge_enabled=bridge_enabled,
            tool_overrides=normalized["tool_overrides"],
            checked_at=checked_at,
        )

    fatal_errors = [
        item["last_error"]
        for item in providers_detail.values()
        if item.get("enabled") and not item.get("healthy") and item.get("last_error")
    ]

    effective_tools = sorted(
        tool_name
        for tool_name, status in tools.items()
        if status.get("runtime_enabled")
    )

    snapshot = {
        "config_key": config_row["config_key"],
        "enabled": bridge_enabled,
        "providers": [entry["name"] for entry in normalized["providers"]],
        "hot_reload": bool(normalized["hot_reload"]),
        "updated_by": config_row.get("updated_by"),
        "updated_at": config_row.get("updated_at"),
        "version_id": config_row.get("version_id"),
        "summary": config_row.get("summary"),
        "source_version_id": config_row.get("source_version_id"),
        "last_reload": checked_at,
        "last_error": fatal_errors[0] if fatal_errors else None,
        "healthy": not fatal_errors,
        "healthy_provider_count": sum(1 for item in providers_detail.values() if item.get("healthy")),
        "runtime_ready_provider_count": sum(1 for item in providers_detail.values() if item.get("runtime_enabled")),
        "providers_detail": providers_detail,
        "provider_configs": provider_configs,
        "tools": tools,
        "runtime_policy": {
            "effective_tools": effective_tools,
            "web_search_enabled": bool(tools.get("web_search", {}).get("runtime_enabled")),
            "bridge_enabled": bridge_enabled,
        },
    }
    return snapshot


def get_mcp_status_snapshot(config_row: dict[str, Any], *, force_reload: bool = False) -> dict[str, Any]:
    config_json = config_row.get("config_json") if isinstance(config_row.get("config_json"), dict) else {}
    normalized = normalize_mcp_config(config_json)
    version_id = config_row.get("version_id") or f"configless:{hash(json.dumps(normalized, sort_keys=True, ensure_ascii=False))}"

    cached_snapshot = _CACHE.get("snapshot")
    cached_version_id = _CACHE.get("source_version_id")

    if cached_snapshot is not None and not force_reload:
        if cached_version_id == version_id:
            return copy.deepcopy(cached_snapshot)
        if not normalized["hot_reload"]:
            return copy.deepcopy(cached_snapshot)

    snapshot = _build_snapshot(config_row)
    _CACHE["source_version_id"] = version_id
    _CACHE["snapshot"] = snapshot
    logger.info("mcp runtime snapshot refreshed (version=%s)", version_id)
    return copy.deepcopy(snapshot)


def resolve_runtime_controls(*, requested_web_search_enabled: bool, mcp_status: dict[str, Any]) -> dict[str, Any]:
    tools = mcp_status.get("tools") if isinstance(mcp_status.get("tools"), dict) else {}
    web_search_status = tools.get("web_search") if isinstance(tools.get("web_search"), dict) else {}

    web_search_enabled = bool(requested_web_search_enabled and web_search_status.get("runtime_enabled"))
    reason: str | None = None
    if requested_web_search_enabled and not mcp_status.get("enabled", True):
        reason = "mcp_disabled"
    elif requested_web_search_enabled and not web_search_status.get("enabled", False):
        reason = "web_search_disabled"
    elif requested_web_search_enabled and not web_search_status.get("available", False):
        reason = str(web_search_status.get("last_error") or "web_search_unavailable")

    return {
        "web_search_requested": bool(requested_web_search_enabled),
        "web_search_enabled": web_search_enabled,
        "bridge_enabled": bool(mcp_status.get("enabled")),
        "bridge_healthy": bool(mcp_status.get("healthy")),
        "reason": reason,
        "effective_tools": list(mcp_status.get("runtime_policy", {}).get("effective_tools", [])),
        "providers": list(mcp_status.get("providers", [])),
        "providers_detail": copy.deepcopy(mcp_status.get("providers_detail", {})),
        "provider_configs": copy.deepcopy(mcp_status.get("provider_configs", {})),
        "source_version_id": mcp_status.get("version_id"),
    }
