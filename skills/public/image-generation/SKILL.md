---
name: image-generation
description: Use this skill when the user requests to generate, create, imagine, or visualize images including characters, scenes, products, or any visual content. Supports structured prompts and reference images for guided generation.
---

# Image Generation Skill

## Overview

This skill generates high-quality images using structured prompts and a Python script. The workflow includes creating JSON-formatted prompts and executing image generation with optional reference images.

## Core Capabilities

- Create structured JSON prompts for AIGC image generation
- Support multiple reference images for style/composition guidance
- Generate images through automated Python script execution
- Handle various image generation scenarios (character design, scenes, products, etc.)

## Workflow

### Step 1: Understand Requirements

When a user requests image generation, identify:

- Subject/content: What should be in the image
- Style preferences: Art style, mood, color palette
- Technical specs: Aspect ratio, composition, lighting
- Reference images: Any images to guide generation
- You don't need to check the folder under `/mnt/user-data`

### Step 2: Create Structured Prompt

Generate a structured JSON file in `/mnt/user-data/workspace/` with naming pattern: `{descriptive-name}.json`

### Step 3: Execute Generation

Prefer the host-side MCP tool when it is in your toolset: if `image-generation_generate_image`
is available, call it directly (the structured prompt as `prompt`, plus `reference_images` /
`output_path` / `aspect_ratio` as needed). In local sandbox mode it is the only channel that
can see provider keys — calling the script there always fails on credentials. Only when the
tool is absent (server not registered) run the script below, which requires keys inside the
sandbox environment (container sandbox mode):

Call the Python script:
```bash
python /mnt/skills/public/image-generation/scripts/generate.py \
  --prompt-file /mnt/user-data/workspace/prompt-file.json \
  --reference-images /path/to/ref1.jpg /path/to/ref2.png \
  --output-file /mnt/user-data/outputs/generated-image.jpg
  --aspect-ratio 16:9
```

Parameters:

- `--prompt-file`: Absolute path to JSON prompt file (required)
- `--reference-images`: Absolute paths to reference images (optional, space-separated)
- `--output-file`: Absolute path to output image file (required)
- `--aspect-ratio`: Aspect ratio of the generated image (optional, default: 16:9)

[!NOTE]
Do NOT read the python file, just call it with the parameters.

## Character Generation Example

User request: "Create a Tokyo street style woman character in 1990s"

Create prompt file: `/mnt/user-data/workspace/asian-woman.json`
```json
{
  "characters": [{
    "gender": "female",
    "age": "mid-20s",
    "ethnicity": "Japanese",
    "body_type": "slender, elegant",
    "facial_features": "delicate features, expressive eyes, subtle makeup with emphasis on lips, long dark hair partially wet from rain",
    "clothing": "stylish trench coat, designer handbag, high heels, contemporary Tokyo street fashion",
    "accessories": "minimal jewelry, statement earrings, leather handbag",
    "era": "1990s"
  }],
  "negative_prompt": "blurry face, deformed, low quality, overly sharp digital look, oversaturated colors, artificial lighting, studio setting, posed, selfie angle",
  "style": "Leica M11 street photography aesthetic, film-like rendering, natural color palette with slight warmth, bokeh background blur, analog photography feel",
  "composition": "medium shot, rule of thirds, subject slightly off-center, environmental context of Tokyo street visible, shallow depth of field isolating subject",
  "lighting": "neon lights from signs and storefronts, wet pavement reflections, soft ambient city glow, natural street lighting, rim lighting from background neons",
  "color_palette": "muted naturalistic tones, warm skin tones, cool blue and magenta neon accents, desaturated compared to digital photography, film grain texture"
}
```

Execute generation:
```bash
python /mnt/skills/public/image-generation/scripts/generate.py \
  --prompt-file /mnt/user-data/workspace/cyberpunk-hacker.json \
  --output-file /mnt/user-data/outputs/cyberpunk-hacker-01.jpg \
  --aspect-ratio 2:3
```

With reference images:
```json
{
  "characters": [{
    "gender": "based on [Image 1]",
    "age": "based on [Image 1]",
    "ethnicity": "human from [Image 1] adapted to Star Wars universe",
    "body_type": "based on [Image 1]",
    "facial_features": "matching [Image 1] with slight weathered look from space travel",
    "clothing": "Star Wars style outfit - worn leather jacket with utility vest, cargo pants with tactical pouches, scuffed boots, belt with holster",
    "accessories": "blaster pistol on hip, comlink device on wrist, goggles pushed up on forehead, satchel with supplies, personal vehicle based on [Image 2]",
    "era": "Star Wars universe, post-Empire era"
  }],
  "prompt": "Character inspired by [Image 1] standing next to a vehicle inspired by [Image 2] on a bustling alien planet street in Star Wars universe aesthetic. Character wearing worn leather jacket with utility vest, cargo pants with tactical pouches, scuffed boots, belt with blaster holster. The vehicle adapted to Star Wars aesthetic with weathered metal panels, repulsor engines, desert dust covering, parked on the street. Exotic alien marketplace street with multi-level architecture, weathered metal structures, hanging market stalls with colorful awnings, alien species walking by as background characters. Twin suns casting warm golden light, atmospheric dust particles in air, moisture vaporators visible in distance. Gritty lived-in Star Wars aesthetic, practical effects look, film grain texture, cinematic composition.",
  "negative_prompt": "clean futuristic look, sterile environment, overly CGI appearance, fantasy medieval elements, Earth architecture, modern city",
  "style": "Star Wars original trilogy aesthetic, lived-in universe, practical effects inspired, cinematic film look, slightly desaturated with warm tones",
  "composition": "medium wide shot, character in foreground with alien street extending into background, environmental storytelling, rule of thirds",
  "lighting": "warm golden hour lighting from twin suns, rim lighting on character, atmospheric haze, practical light sources from market stalls",
  "color_palette": "warm sandy tones, ochre and sienna, dusty blues, weathered metals, muted earth colors with pops of alien market colors",
  "technical": {
    "aspect_ratio": "9:16",
    "quality": "high",
    "detail_level": "highly detailed with film-like texture"
  }
}
```
```bash
python /mnt/skills/public/image-generation/scripts/generate.py \
  --prompt-file /mnt/user-data/workspace/star-wars-scene.json \
  --reference-images /mnt/user-data/uploads/character-ref.jpg /mnt/user-data/uploads/vehicle-ref.jpg \
  --output-file /mnt/user-data/outputs/star-wars-scene-01.jpg \
  --aspect-ratio 16:9
```

## Common Scenarios

Use different JSON schemas for different scenarios.

**Character Design**:
- Physical attributes (gender, age, ethnicity, body type)
- Facial features and expressions
- Clothing and accessories
- Historical era or setting
- Pose and context

**Scene Generation**:
- Environment description
- Time of day, weather
- Mood and atmosphere
- Focal points and composition

**Product Visualization**:
- Product details and materials
- Lighting setup
- Background and context
- Presentation angle

## Specific Templates

Read the following template file only when matching the user request.

- [Doraemon Comic](templates/doraemon.md)

## Output Handling

After generation:

- Images are typically saved in `/mnt/user-data/outputs/`
- Share generated images with user using present_files tool
- Provide brief description of the generation result
- Offer to iterate if adjustments needed

## Tips: Enhancing Generation with Reference Images

For scenarios where visual accuracy is critical, **use the `image_search` tool first** to find reference images before generation.

**Recommended scenarios for using image_search tool:**
- **Character/Portrait Generation**: Search for similar poses, expressions, or styles to guide facial features and body proportions
- **Specific Objects or Products**: Find reference images of real objects to ensure accurate representation
- **Architectural or Environmental Scenes**: Search for location references to capture authentic details
- **Fashion and Clothing**: Find style references to ensure accurate garment details and styling

**Example workflow:**
1. Call the `image_search` tool to find suitable reference images:
   ```
   image_search(query="Japanese woman street photography 1990s", size="Large")
   ```
2. Download the returned image URLs to local files
3. Use the downloaded images as `--reference-images` parameter in the generation script

This approach significantly improves generation quality by providing the model with concrete visual guidance rather than relying solely on text descriptions.

## Providers (Gemini / MiniMax / qwen)

This skill auto-selects the provider by environment variables (no CLI change):

- `GEMINI_API_KEY` set → use Gemini (default, unchanged).
- Only `MINIMAX_API_KEY` set → use MiniMax (`/v1/image_generation`, model `image-01`).
- Only `DASHSCOPE_API_KEY` set → use qwen (`qwen-image-3.0`, DashScope multimodal-generation).
- Force one explicitly with `IMAGE_GENERATION_PROVIDER=gemini|minimax|qwen`.

MiniMax optional overrides: `MINIMAX_API_HOST` (default `https://api.minimaxi.com`),
`MINIMAX_IMAGE_MODEL` (default `image-01`). Reference images are sent as the MiniMax
`subject_reference` character image. The CLI and `--prompt-file` / `--reference-images`
/ `--output-file` / `--aspect-ratio` arguments are identical for all providers.

qwen optional overrides: `DASHSCOPE_API_HOST` (default `https://dashscope.aliyuncs.com`;
workspace-prefixed maas hosts are accepted), `QWEN_IMAGE_MODEL` (default `qwen-image-3.0`).
Reference images (validated first, at most 3) are sent as base64 data URLs inside
`input.messages[0].content`; more than 3 valid references returns an error without
calling the API. The response carries a 24-hour image URL, which the script downloads
into the output file. `prompt_extend` stays off on purpose — the authored prompt is
already compressed by the calling agent, and server-side rewriting would drift intent;
`watermark` is off and `n` is 1.

**qwen prompt handling (provider-internal).** Same rule as MiniMax: only the JSON
`prompt` field is sent as the single text entry; a JSON `negative_prompt` field, when
present, is mapped to `parameters.negative_prompt`. The `--aspect-ratio` argument maps
onto a qwen `size` (`width*height`) via a fixed table (1:1, 16:9, 9:16, 4:3, 3:4, 3:2,
2:3); explicit `width*height` values pass through when within the API's area and
ratio bounds, otherwise the default `1024*1024` is used.

## MCP server (host-side key channel)

`scripts/mcp_server.py` exposes this skill's core as an MCP stdio server (server name
`image-generation`, one `generate_image` tool). In local sandbox mode the sandbox
strips every `*KEY*`-shaped variable from skill subprocesses, so the script cannot see
provider keys there; the MCP server runs on the host with explicit env from
`extensions_config.json` (`"DASHSCOPE_API_KEY": "$DASHSCOPE_API_KEY"`) and is the only
key channel in that mode, as well as the channel for external MCP clients. Register it
by editing `extensions_config.json` directly — a disabled example entry ships in
`extensions_config.example.json`. The tool returns the image path cwd-relative
(forward slashes) so DeerFlow maps it into `/mnt/user-data/outputs/...`;
`/mnt/user-data/...` arguments are mapped back to host paths server-side.

**MiniMax prompt handling (provider-internal).** Authoring is provider-agnostic — write
the same structured JSON regardless of which provider is active. MiniMax `image-01`
consumes a single text string, so the MiniMax path itself sends only the JSON `prompt`
field (the other fields such as `style` / `composition` / `negative_prompt` apply to the
Gemini path) and enables `prompt_optimizer` so MiniMax expands it server-side. MiniMax
caps that prompt at 1500 characters; if the `prompt` field is longer, the script returns
an error instead of calling the API. The Gemini path receives the full structured JSON.

## Notes

- Always use English for prompts regardless of user's language
- JSON format ensures structured, parsable prompts
- Reference images enhance generation quality significantly
- Iterative refinement is normal for optimal results
- For character generation, include the detailed character object plus a consolidated prompt field
- Always include a consolidated `prompt` field in the structured JSON (every scenario): single-string providers (MiniMax, qwen) send only that field; without it the entire JSON is sent as the text prompt
