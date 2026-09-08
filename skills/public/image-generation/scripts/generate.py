import base64
import json
import os

import requests

MINIMAX_DEFAULT_HOST = "https://api.minimaxi.com"
# MiniMax image-01 caps the prompt at 1500 characters and rejects longer requests
# with a generic "invalid params" error, so validate before calling the API.
MINIMAX_PROMPT_MAX_CHARS = 1500


def validate_image(image_path: str) -> bool:
    """Validate if an image file can be opened and is not corrupted."""
    from PIL import Image  # lazy import: keeps module importable without Pillow

    try:
        with Image.open(image_path) as image:
            image.verify()
        with Image.open(image_path) as image:
            image.load()
        return True
    except Exception as exc:
        print(f"Warning: Image '{image_path}' is invalid or corrupted: {exc}")
        return False


def _resolve_provider(override_env: str, existing_provider: str, has_existing_creds: bool) -> str:
    """Pick the generation provider.

    1. Explicit <SKILL>_PROVIDER override wins.
    2. Otherwise prefer the existing provider when its credentials are present.
    3. Otherwise fall back to MiniMax when MINIMAX_API_KEY is set.
    4. Otherwise fall back to qwen when DASHSCOPE_API_KEY is set.
    """
    override = os.getenv(override_env)
    if override:
        return override.strip().lower()
    if has_existing_creds:
        return existing_provider
    if os.getenv("MINIMAX_API_KEY"):
        return "minimax"
    if os.getenv("DASHSCOPE_API_KEY"):
        return "qwen"
    raise ValueError(
        f"No credentials found. Set GEMINI_API_KEY for {existing_provider}, "
        f"MINIMAX_API_KEY for minimax, or DASHSCOPE_API_KEY for qwen "
        f"(optionally force with {override_env})."
    )


def _minimax_host() -> str:
    return os.getenv("MINIMAX_API_HOST", MINIMAX_DEFAULT_HOST).rstrip("/")


DASHSCOPE_DEFAULT_HOST = "https://dashscope.aliyuncs.com"
# qwen-image sizes must stay within 512*512..2048*2048 pixels and a 1:8..8:1 ratio.
QWEN_SIZE_TABLE = {
    "1:1": "1024*1024",
    "16:9": "1664*928",
    "9:16": "928*1664",
    "4:3": "1248*936",
    "3:4": "936*1248",
    "3:2": "1248*832",
    "2:3": "832*1248",
}
QWEN_DEFAULT_SIZE = "1024*1024"
QWEN_MAX_REFERENCE_IMAGES = 3


def _dashscope_host() -> str:
    return os.getenv("DASHSCOPE_API_HOST", DASHSCOPE_DEFAULT_HOST).rstrip("/")


def _qwen_size(aspect_ratio: str) -> str:
    """Map an aspect ratio (or explicit width*height) onto a qwen-legal size."""
    if aspect_ratio in QWEN_SIZE_TABLE:
        return QWEN_SIZE_TABLE[aspect_ratio]
    width, sep, height = aspect_ratio.partition("*")
    if sep and width.isdigit() and height.isdigit():
        w, h = int(width), int(height)
        if 512 * 512 <= w * h <= 2048 * 2048 and 1 / 8 <= w / h <= 8:
            return f"{w}*{h}"
    return QWEN_DEFAULT_SIZE


def _check_base_resp(payload: dict) -> None:
    base = payload.get("base_resp") or {}
    if base.get("status_code", 0) != 0:
        raise Exception(
            f"MiniMax error {base.get('status_code')}: {base.get('status_msg')}"
        )


def _guess_mime(image_path: str) -> str:
    ext = os.path.splitext(image_path)[1].lower()
    return {
        ".png": "image/png",
        ".webp": "image/webp",
        ".gif": "image/gif",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
    }.get(ext, "image/jpeg")


def _to_data_url(image_path: str) -> str:
    with open(image_path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode("utf-8")
    return f"data:{_guess_mime(image_path)};base64,{b64}"


def _ensure_output_dir(output_file: str) -> None:
    """Create the output file's parent directory so nested paths don't fail."""
    output_dir = os.path.dirname(output_file)
    if output_dir:
        os.makedirs(output_dir, exist_ok=True)


def _single_text_prompt(raw: str) -> str:
    """Extract the single text prompt a single-string provider expects.

    The shared prompt file is structured JSON (a consolidated ``prompt`` plus
    Gemini-oriented fields like ``style`` / ``composition`` / ``negative_prompt``),
    but single-string providers (MiniMax, qwen) consume one text entry. Use the
    JSON ``prompt`` field; fall back to the raw text for plain-text prompt files
    or JSON without a ``prompt`` field.
    """
    text = raw.strip()
    try:
        data = json.loads(text)
    except (ValueError, json.JSONDecodeError):
        return text
    if isinstance(data, dict):
        core = data.get("prompt")
        if isinstance(core, str) and core.strip():
            return core.strip()
    return text


def _generate_image_minimax(
    prompt: str, reference_images: list[str], output_file: str, aspect_ratio: str
) -> str:
    minimax_api_key = os.getenv("MINIMAX_API_KEY")
    if not minimax_api_key:
        return "MINIMAX_API_KEY is not set"
    prompt = _single_text_prompt(prompt)
    if len(prompt) > MINIMAX_PROMPT_MAX_CHARS:
        return (
            f"Prompt is {len(prompt)} characters but MiniMax image-01 accepts at most "
            f"{MINIMAX_PROMPT_MAX_CHARS}. Shorten the prompt to stay within the limit; "
            f"reference images plus a tighter description usually recover the detail."
        )
    body = {
        "model": os.getenv("MINIMAX_IMAGE_MODEL", "image-01"),
        "prompt": prompt,
        "aspect_ratio": aspect_ratio,
        "response_format": "base64",
        "n": 1,
        "prompt_optimizer": True,
    }
    if reference_images:
        # Reference images are passed as character subjects as-is; unlike the Gemini
        # path we do not pre-validate them — invalid files surface as a MiniMax API error.
        body["subject_reference"] = [
            {"type": "character", "image_file": _to_data_url(p)} for p in reference_images
        ]
    response = requests.post(
        f"{_minimax_host()}/v1/image_generation",
        headers={"Authorization": f"Bearer {minimax_api_key}", "Content-Type": "application/json"},
        json=body,
        timeout=60,
    )
    response.raise_for_status()
    payload = response.json()
    _check_base_resp(payload)
    images = (payload.get("data") or {}).get("image_base64") or []
    if not images:
        raise Exception("MiniMax returned no image data")
    _ensure_output_dir(output_file)
    with open(output_file, "wb") as f:
        f.write(base64.b64decode(images[0]))
    return f"Successfully generated image to {output_file}"


def _generate_image_gemini(
    prompt: str, reference_images: list[str], output_file: str, aspect_ratio: str
) -> str:
    parts = []
    valid_reference_images = []
    for ref_img in reference_images:
        if validate_image(ref_img):
            valid_reference_images.append(ref_img)
        else:
            print(f"Skipping invalid reference image: {ref_img}")
    if len(valid_reference_images) < len(reference_images):
        skipped = len(reference_images) - len(valid_reference_images)
        print(f"Note: {skipped} reference image(s) were skipped due to validation failure.")

    for reference_image in valid_reference_images:
        with open(reference_image, "rb") as f:
            image_b64 = base64.b64encode(f.read()).decode("utf-8")
        parts.append({"inlineData": {"mimeType": _guess_mime(reference_image), "data": image_b64}})

    gemini_api_key = os.getenv("GEMINI_API_KEY")
    if not gemini_api_key:
        return "GEMINI_API_KEY is not set"
    response = requests.post(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent",
        headers={"x-goog-api-key": gemini_api_key, "Content-Type": "application/json"},
        json={
            "generationConfig": {"imageConfig": {"aspectRatio": aspect_ratio}},
            "contents": [{"parts": [*parts, {"text": prompt}]}],
        },
        timeout=120,
    )
    response.raise_for_status()
    data = response.json()
    response_parts: list[dict] = data["candidates"][0]["content"]["parts"]
    image_parts = [part for part in response_parts if part.get("inlineData", False)]
    if len(image_parts) == 1:
        base64_image = image_parts[0]["inlineData"]["data"]
        _ensure_output_dir(output_file)
        with open(output_file, "wb") as f:
            f.write(base64.b64decode(base64_image))
        return f"Successfully generated image to {output_file}"
    raise Exception("Failed to generate image")


def _generate_image_qwen(
    prompt: str, reference_images: list[str], output_file: str, aspect_ratio: str
) -> str:
    dashscope_api_key = os.getenv("DASHSCOPE_API_KEY")
    if not dashscope_api_key:
        return "DASHSCOPE_API_KEY is not set"
    text = _single_text_prompt(prompt)
    negative_prompt = None
    try:
        structured = json.loads(prompt.strip())
    except (ValueError, json.JSONDecodeError):
        structured = None
    if isinstance(structured, dict):
        candidate = structured.get("negative_prompt")
        if isinstance(candidate, str) and candidate.strip():
            negative_prompt = candidate.strip()

    valid_reference_images = []
    for ref_img in reference_images:
        if validate_image(ref_img):
            valid_reference_images.append(ref_img)
        else:
            print(f"Skipping invalid reference image: {ref_img}")
    if len(valid_reference_images) > QWEN_MAX_REFERENCE_IMAGES:
        return (
            f"qwen accepts at most {QWEN_MAX_REFERENCE_IMAGES} reference images but "
            f"{len(valid_reference_images)} valid ones were given; drop some or merge them."
        )

    content = [{"image": _to_data_url(p)} for p in valid_reference_images]
    content.append({"text": text})
    parameters = {
        "size": _qwen_size(aspect_ratio),
        "prompt_extend": False,
        "watermark": False,
        "n": 1,
    }
    if negative_prompt:
        parameters["negative_prompt"] = negative_prompt
    body = {
        "model": os.getenv("QWEN_IMAGE_MODEL", "qwen-image-3.0"),
        "input": {"messages": [{"role": "user", "content": content}]},
        "parameters": parameters,
    }
    response = requests.post(
        f"{_dashscope_host()}/api/v1/services/aigc/multimodal-generation/generation",
        headers={"Authorization": f"Bearer {dashscope_api_key}", "Content-Type": "application/json"},
        json=body,
        timeout=120,
    )
    response.raise_for_status()
    payload = response.json()
    choices = (payload.get("output") or {}).get("choices") or []
    image_url = ""
    if choices:
        for entry in choices[0].get("message", {}).get("content", []):
            if isinstance(entry, dict) and entry.get("image"):
                image_url = entry["image"]
                break
    if not image_url:
        raise Exception("qwen returned no image")
    # The API returns a URL valid for 24h, not inline bytes — download to keep the artifact.
    download = requests.get(image_url, timeout=120)
    download.raise_for_status()
    _ensure_output_dir(output_file)
    with open(output_file, "wb") as f:
        f.write(download.content)
    return f"Successfully generated image to {output_file}"


def generate_image(
    prompt_file: str,
    reference_images: list[str],
    output_file: str,
    aspect_ratio: str = "16:9",
) -> str:
    with open(prompt_file, "r", encoding="utf-8") as f:
        prompt = f.read()
    provider = _resolve_provider(
        "IMAGE_GENERATION_PROVIDER", "gemini", bool(os.getenv("GEMINI_API_KEY"))
    )
    if provider == "minimax":
        return _generate_image_minimax(prompt, reference_images, output_file, aspect_ratio)
    if provider in ("gemini", "google"):
        return _generate_image_gemini(prompt, reference_images, output_file, aspect_ratio)
    if provider in ("qwen", "dashscope"):
        return _generate_image_qwen(prompt, reference_images, output_file, aspect_ratio)
    raise ValueError(
        f"Unknown image provider: {provider!r} (use 'gemini', 'minimax', or 'qwen')"
    )


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Generate images using Gemini, MiniMax, or qwen API")
    parser.add_argument("--prompt-file", required=True, help="Absolute path to JSON prompt file")
    parser.add_argument("--reference-images", nargs="*", default=[],
                        help="Absolute paths to reference images (space-separated)")
    parser.add_argument("--output-file", required=True, help="Output path for generated image")
    parser.add_argument("--aspect-ratio", required=False, default="16:9",
                        help="Aspect ratio of the generated image")
    args = parser.parse_args()

    try:
        print(generate_image(args.prompt_file, args.reference_images,
                             args.output_file, args.aspect_ratio))
    except Exception as e:
        print(f"Error while generating image: {e}")
