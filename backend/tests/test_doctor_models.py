"""Task 3 (spec §5.8): ``make doctor`` counts the merged model set.

``check_models_configured`` must read config.yaml models UNION ``models_config.json``
(UI-managed) so a user who configured models only through the web UI is not told to
run ``make setup``. A malformed ``models_config.json`` must never crash doctor — it
degrades to the config.yaml set and records the error.
"""

from __future__ import annotations

import json
from pathlib import Path

import doctor
import pytest
import yaml


@pytest.fixture
def env_paths(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setenv("DEER_FLOW_MODELS_CONFIG_PATH", str(tmp_path / "models_config.json"))
    return tmp_path


def _write_yaml(root: Path, models: list[dict]) -> Path:
    cfg = root / "config.yaml"
    cfg.write_text(yaml.safe_dump({"config_version": 5, "models": models}), encoding="utf-8")
    return cfg


def test_doctor_counts_ui_models_when_yaml_empty(env_paths: Path):
    cfg = _write_yaml(env_paths, [])
    (env_paths / "models_config.json").write_text(
        json.dumps(
            {
                "models": [
                    {
                        "name": "ui-model",
                        "use": "deerflow.models.patched_deepseek:PatchedChatDeepSeek",
                        "model": "deepseek-chat",
                        "api_key": "sk-x",
                    }
                ]
            }
        ),
        encoding="utf-8",
    )

    result = doctor.check_models_configured(cfg)

    assert result.status == "ok"
    assert "1 model" in result.detail


def test_doctor_survives_malformed_models_config(env_paths: Path):
    cfg = _write_yaml(env_paths, [])
    (env_paths / "models_config.json").write_text(json.dumps({"models": "oops"}), encoding="utf-8")

    result = doctor.check_models_configured(cfg)

    assert result.status in {"fail", "warn"}
    assert "models_config" in result.detail.lower()
