"""MCP stdio thin shell over the image-generation skill core.

Runs on the HOST, not inside the sandbox: in local sandbox mode DeerFlow scrubs
every ``*KEY*``-shaped env var from skill subprocesses, so this server — launched
with explicit env from extensions_config.json — is the only key channel there,
and it is also how external MCP clients (Qoder and friends) reach the same core.
"""
import contextlib
import functools
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import anyio
from mcp.server.fastmcp import FastMCP

sys.path.insert(0, str(Path(__file__).resolve().parent))
import generate  # noqa: E402  # sibling module; plain import keeps SkillScan clean

MNT_USER_DATA = "/mnt/user-data/"


def _remap_mnt(arg: str) -> str:
    """Translate a sandbox-view ``/mnt/user-data/...`` path into its host path.

    DeerFlow pins this server's cwd to the thread workspace
    (``.../user-data/workspace``), so the user-data root is ``cwd.parent``.
    Host-native paths (external callers) pass through untouched.
    """
    if arg.startswith(MNT_USER_DATA):
        return str(Path.cwd().parent / arg[len(MNT_USER_DATA):])
    return arg


def _is_deerflow_layout() -> bool:
    cwd = Path.cwd()
    return cwd.name == "workspace" and (cwd.parent / "outputs").is_dir()


def _resolve_output_dir() -> Path:
    if _is_deerflow_layout():
        return Path.cwd().parent / "outputs"
    return Path.cwd()


def _run(prompt: str, output_path: str, reference_images: list[str] | None, aspect_ratio: str) -> str:
    refs = [_remap_mnt(r) for r in (reference_images or [])]
    if output_path:
        out = Path(_remap_mnt(output_path))
        if not out.is_absolute():
            out = Path.cwd() / out
    else:
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S-%f")
        out = _resolve_output_dir() / f"generated-{stamp}.png"
    try:
        with tempfile.TemporaryDirectory() as tmp:
            prompt_file = Path(tmp) / "prompt.json"
            prompt_file.write_text(prompt, encoding="utf-8")
            message = generate.generate_image(str(prompt_file), refs, str(out), aspect_ratio)
    except Exception as exc:
        return f"Error while generating image: {exc}"
    if _is_deerflow_layout():
        # Forward-slash relative path token; DeerFlow rewrites it to /mnt/user-data/...
        # (backslash/drive absolute paths are never translated on Windows).
        try:
            rel_path = out.relative_to(Path.cwd(), walk_up=True).as_posix()
        except ValueError:
            rel_path = str(out)
        return f"{message}\n{rel_path}"
    return f"{message}\n{out}"


mcp = FastMCP("image-generation")


@mcp.tool()
async def generate_image(
    prompt: str,
    output_path: str = "",
    reference_images: list[str] | None = None,
    aspect_ratio: str = "16:9",
) -> str:
    """Generate an image via the image-generation skill core (qwen/Gemini/MiniMax).

    Returns the core's message plus, on a second line, the output image path:
    a cwd-relative forward-slash path under DeerFlow, an absolute path otherwise.
    """
    with contextlib.redirect_stdout(sys.stderr):  # generate.py prints would corrupt stdio JSON-RPC
        return await anyio.to_thread.run_sync(
            functools.partial(_run, prompt, output_path, reference_images, aspect_ratio)
        )


if __name__ == "__main__":
    mcp.run()
