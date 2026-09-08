"""Tests for the image-generation MCP stdio thin shell.

Run with the backend venv (it carries the mcp SDK):
    cd backend && uv run pytest ../tests/skills/test_image_generation_mcp_server.py -v
"""
import importlib.util
import sys
from pathlib import Path

import pytest

pytest.importorskip("mcp")

REPO_ROOT = Path(__file__).resolve().parents[2]
SERVER_PATH = REPO_ROOT / "skills" / "public" / "image-generation" / "scripts" / "mcp_server.py"

spec = importlib.util.spec_from_file_location("image_generation_mcp_server", SERVER_PATH)
srv = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = srv
spec.loader.exec_module(srv)


def _fake_generate(monkeypatch, captured, message="Successfully generated image to out"):
    def fake(prompt_file, reference_images, output_file, aspect_ratio):
        captured["prompt_file"] = prompt_file
        captured["refs"] = reference_images
        captured["out"] = output_file
        captured["aspect"] = aspect_ratio
        return message

    monkeypatch.setattr(srv.generate, "generate_image", fake)


def _make_deerflow_layout(tmp_path: Path) -> Path:
    (tmp_path / "workspace").mkdir()
    (tmp_path / "outputs").mkdir()
    return tmp_path / "workspace"


def test_remap_mnt_passes_host_paths_through():
    assert srv._remap_mnt("E:/some/host.png") == "E:/some/host.png"
    assert srv._remap_mnt("/mnt/user-data") == "/mnt/user-data"


def test_remap_mnt_translates_sandbox_view(monkeypatch, tmp_path):
    monkeypatch.chdir(_make_deerflow_layout(tmp_path))
    assert srv._remap_mnt("/mnt/user-data/uploads/r.png") == str(tmp_path / "uploads" / "r.png")


def test_resolve_output_dir_prefers_sibling_outputs(monkeypatch, tmp_path):
    monkeypatch.chdir(_make_deerflow_layout(tmp_path))
    assert srv._resolve_output_dir() == tmp_path / "outputs"


def test_resolve_output_dir_falls_back_to_cwd(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    assert srv._resolve_output_dir() == tmp_path


def test_run_returns_relative_token_in_deerflow_layout(monkeypatch, tmp_path):
    monkeypatch.chdir(_make_deerflow_layout(tmp_path))
    captured = {}
    _fake_generate(monkeypatch, captured)
    result = srv._run("a red apple", "", None, "16:9")

    token = result.splitlines()[-1]
    assert token.startswith("../outputs/generated-")
    assert token.endswith(".png")
    assert "\\" not in token
    assert Path(captured["out"]).parent == tmp_path / "outputs"


def test_run_returns_absolute_path_outside_deerflow_layout(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    captured = {}
    _fake_generate(monkeypatch, captured)
    result = srv._run("a red apple", "", None, "16:9")

    token = result.splitlines()[-1]
    assert Path(token).is_absolute()
    assert Path(token).parent == tmp_path


def test_run_remaps_refs_and_output_path(monkeypatch, tmp_path):
    monkeypatch.chdir(_make_deerflow_layout(tmp_path))
    captured = {}
    _fake_generate(monkeypatch, captured)
    srv._run("scene", "/mnt/user-data/outputs/x.png",
             ["/mnt/user-data/uploads/r.png"], "1:1")

    assert captured["refs"] == [str(tmp_path / "uploads" / "r.png")]
    assert captured["out"] == str(tmp_path / "outputs" / "x.png")


def test_run_returns_error_string_on_exception(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)

    def boom(prompt_file, reference_images, output_file, aspect_ratio):
        raise ValueError("boom")

    monkeypatch.setattr(srv.generate, "generate_image", boom)
    result = srv._run("x", "", None, "16:9")
    assert "boom" in result
    assert result.startswith("Error while generating image:")


def test_run_prompt_file_is_temporary(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    captured = {}
    _fake_generate(monkeypatch, captured)
    srv._run("a red apple", "", None, "16:9")
    assert not Path(captured["prompt_file"]).exists()


def test_tool_is_registered():
    names = [tool.name for tool in srv.mcp._tool_manager.list_tools()]
    assert "generate_image" in names
