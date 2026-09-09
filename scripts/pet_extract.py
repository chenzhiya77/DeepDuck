#!/usr/bin/env python3
"""DeerFlow agent-pet video→sheet extractor (spec §8 / §8.1).

Encodes the §8.1 pipeline contract in code so the four hard rules cannot be
violated by hand: uniform keying params and one locked global crop box (both
live in a single shared config file), integer-stride decimation with fps
dividing SOURCE_FPS, drop-duplicate-last-frame for loop clips, and a
divisibility guard that keeps every loop step (including the wrap) uniform so
no per-loop seam tick can slip in.

Requires ffmpeg/ffprobe on PATH. Stdlib only.

    python scripts/pet_extract.py base --ref parrot.png --out base_A.png
    python scripts/pet_extract.py measure --video clip.mp4
    python scripts/pet_extract.py sheet --video clip.mp4 --config pet.json \
        --state done --mode oneshot --window 24 72 --stride 2 --out done.webp
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path

SOURCE_FPS = 24
MAX_FRAMES = 32  # spec §8 rule 5: decode-memory / byte budget at 512 px/frame
MEASURED_DECODE_WIDTH_OK = 20480  # spec §8 rule 5, measured 2026-09-10
WARN_DECODE_WIDTH = 16384  # WebGL MAX_TEXTURE_SIZE; CSS images decoded fine above it


def fail(msg: str) -> None:
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(1)


def load_config(path: Path) -> dict:
    cfg = json.loads(path.read_text(encoding="utf-8"))
    key = cfg.setdefault("key", {"color": "0x62DB7E", "similarity": 0.30, "blend": 0.08})
    cfg.setdefault("frame", 512)
    if "crop" in cfg:
        x, y, w, h = cfg["crop"]
        key["_crop"] = f"crop={w}:{h}:{x}:{y}"
    return cfg


def nb_frames(video: Path) -> int:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=nb_frames", "-of", "default=nw=1:nk=1", str(video)],
        capture_output=True, text=True, check=True).stdout.strip()
    if out.isdigit():
        return int(out)
    dur = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=duration", "-of", "default=nw=1:nk=1", str(video)],
        capture_output=True, text=True, check=True).stdout.strip()
    return round(float(dur) * SOURCE_FPS)


def key_filter(cfg: dict) -> str:
    k = cfg["key"]
    return f"colorkey={k['color']}:{k['similarity']}:{k['blend']}"


def measure(args: argparse.Namespace) -> None:
    cfg = load_config(Path(args.config)) if args.config else {
        "key": {"color": "0x62DB7E", "similarity": 0.30, "blend": 0.08}, "frame": 512}
    div = args.scale_div
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=width,height", "-of", "json", str(args.video)],
        capture_output=True, text=True, check=True)
    stream = json.loads(probe.stdout)["streams"][0]
    w, h = stream["width"], stream["height"]
    sw, sh = w // div, h // div
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(args.video),
         "-vf", f"{key_filter(cfg)},scale={sw}:{sh}:flags=area",
         "-f", "rawvideo", "-pix_fmt", "rgba", "-"],
        capture_output=True, check=True).stdout
    frame_bytes = sw * sh * 4
    npix = sw * sh
    xs, ys = [], []
    for f in range(len(raw) // frame_bytes):
        base = f * frame_bytes
        for q in range(npix):
            if raw[base + q * 4 + 3] > 100:
                xs.append(q % sw)
                ys.append(q // sw)
    if not xs:
        fail("no non-key pixels found; check key color/similarity")
    box = [min(xs) * div, min(ys) * div, (max(xs) - min(xs) + 1) * div, (max(ys) - min(ys) + 1) * div]
    n = nb_frames(args.video)
    print(json.dumps({
        "union_bbox": box,
        "margins": {"left": box[0], "right": w - box[0] - box[2], "top": box[1], "bottom": h - box[1] - box[3]},
        "frames": n,
        "loop_strides_dividing_n_minus_1": [s for s in range(1, 9) if (n - 1) % s == 0 and (n - 1) // s <= MAX_FRAMES and SOURCE_FPS % s == 0],
    }, indent=2))
    print("note: the GLOBAL crop box is the union of this output across ALL clips "
          "(spec §8.1 rule 3); put it in the shared config as \"crop\": [x, y, w, h].")


def sheet(args: argparse.Namespace) -> None:
    cfg = load_config(Path(args.config))
    if "crop" not in cfg:
        fail("config has no \"crop\"; run `measure` on every clip and set the global union box first (spec §8.1 rule 3)")
    if SOURCE_FPS % args.stride != 0:
        fail(f"stride {args.stride} does not divide {SOURCE_FPS}; fps would be non-integer and steps would jitter (spec §8 rule 6 ladder {sorted({SOURCE_FPS // s for s in range(1, 9)})})")
    n = nb_frames(args.video)
    if args.mode == "loop":
        # first=last frame makes frame n-1 a duplicate of frame 0: drop it, then
        # require the remainder to divide evenly so the wrap step equals every
        # other step (otherwise one seam tick per loop, forever).
        if (n - 1) % args.stride != 0:
            fail(f"loop clip has {n} frames; (n-1)={n - 1} not divisible by stride {args.stride} "
                 f"-> the wrap step would differ from the others (seam tick). "
                 f"Divisible strides: {[s for s in range(1, 9) if (n - 1) % s == 0]}")
        indices = list(range(0, n - 1, args.stride))
    else:
        if not args.window:
            fail("oneshot mode requires --window START END (frame indices)")
        indices = list(range(args.window[0], args.window[1], args.stride))
    if len(indices) > MAX_FRAMES:
        fail(f"{len(indices)} frames exceeds the {MAX_FRAMES}/state budget (spec §8 rule 5)")
    fps = SOURCE_FPS // args.stride
    width = len(indices) * cfg["frame"]
    if width > MEASURED_DECODE_WIDTH_OK:
        fail(f"sheet width {width}px exceeds the measured decode ceiling {MEASURED_DECODE_WIDTH_OK}px")
    if width > WARN_DECODE_WIDTH:
        print(f"warn: sheet width {width}px is above WebGL MAX_TEXTURE_SIZE {WARN_DECODE_WIDTH}px; "
              "CSS backgrounds decoded fine at 20480 in the 2026-09-10 measurement, but re-verify on target browsers")

    select = "select='" + "+".join(f"eq(n\\,{i})" for i in indices) + "'"
    vf = f"{select},{key_filter(cfg)},{cfg['key']['_crop']},scale={cfg['frame']}:{cfg['frame']}:flags=area"
    with tempfile.TemporaryDirectory() as td:
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(args.video),
                        "-vf", vf, "-fps_mode", "passthrough", f"{td}/f%04d.png"], check=True)
        produced = sorted(Path(td).glob("f*.png"))
        if len(produced) != len(indices):
            fail(f"expected {len(indices)} frames, ffmpeg produced {len(produced)}")
        inputs: list[str] = []
        for p in produced:
            inputs += ["-i", str(p)]
        stack = f"hstack=inputs={len(produced)}"
        subprocess.run(["ffmpeg", "-v", "error", "-y", *inputs,
                        "-filter_complex", stack,
                        "-c:v", "libwebp", "-quality", "85", str(args.out)], check=True)
    manifest = {args.state: {"frames": len(indices), "fps": fps, "loop": args.mode == "loop"}}
    print(json.dumps(manifest))
    print(f"wrote {args.out} ({width}x{cfg['frame']}, {len(indices)} frames @ {fps}fps, "
          f"playback {len(indices) / fps:.2f}s)")


def base(args: argparse.Namespace) -> None:
    # spec §8.1 rule 5: layout authority lives in this deterministic composite,
    # not in any image model (they do not honor ratio/position text commands).
    bottom = args.canvas_size - args.y - args.bird_height
    if args.bird_height > args.canvas_size * 0.65:
        fail(f"bird height {args.bird_height} exceeds 65% of canvas {args.canvas_size}; "
             "wing/flap motion headroom collapses (spec §8.1 rule 3)")
    if bottom < 80:
        fail(f"bottom margin {bottom}px < 80px; sigh-sink/crouch (≈40-80px) would clip the feet (spec §8.1 rule 3)")
    fc = (f"[1:v]scale=-2:{args.bird_height}:flags=lanczos,format=rgba[k];"
          f"[0:v][k]overlay=(W-w)/2:{args.y}")
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y",
         "-f", "lavfi", "-i", f"color=c=0x{args.canvas}:s={args.canvas_size}x{args.canvas_size}",
         "-i", str(args.ref),
         "-filter_complex", fc, "-frames:v", "1", str(args.out)], check=True)
    print(f"wrote {args.out} ({args.canvas_size}x{args.canvas_size}, "
          f"bird {args.bird_height}px at y={args.y}, margins top={args.y} bottom={bottom} "
          f"sides=({args.canvas_size}-bird_width)/2)")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    m = sub.add_parser("measure", help="print the keyed union bbox of one clip (run per clip; global crop = union of all)")
    m.add_argument("--video", type=Path, required=True)
    m.add_argument("--config", type=Path, help="optional config supplying key params")
    m.add_argument("--scale-div", type=int, default=10, help="bbox precision divisor (default 10 => ±10px)")
    m.set_defaults(fn=measure)
    s = sub.add_parser("sheet", help="extract, key, crop, scale and stack one state sheet")
    s.add_argument("--video", type=Path, required=True)
    s.add_argument("--config", type=Path, required=True, help="shared config: key params + locked global crop + frame size")
    s.add_argument("--state", required=True)
    s.add_argument("--mode", choices=["loop", "oneshot"], required=True)
    s.add_argument("--stride", type=int, required=True)
    s.add_argument("--window", type=int, nargs=2, metavar=("START", "END"), help="oneshot frame-index window")
    s.add_argument("--out", type=Path, required=True)
    s.set_defaults(fn=sheet)
    b = sub.add_parser("base", help="composite the deterministic base frame (spec §8.1 rule 5): transparent ref onto solid canvas at locked scale/position")
    b.add_argument("--ref", type=Path, required=True, help="transparent-background character reference")
    b.add_argument("--out", type=Path, required=True)
    b.add_argument("--canvas", default="FF00FF", help="canvas hex without # (default magenta FF00FF; green forbidden, green wings)")
    b.add_argument("--canvas-size", type=int, default=1920, help="square canvas edge = video generation resolution")
    b.add_argument("--bird-height", type=int, default=1152, help="bird height in px (default 1152 = 60 percent of a 1920 canvas)")
    b.add_argument("--y", type=int, default=668, help="bird box top edge (default leaves 100px bottom margin)")
    b.set_defaults(fn=base)
    args = ap.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
