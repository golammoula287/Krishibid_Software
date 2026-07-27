"""
Exports the trained disease classifier to ONNX and regenerates labels.json.

Run after training (see notebooks/train_disease_cnn.ipynb):

    python export_onnx.py --checkpoint artifacts/best.pt --version v1

Why ONNX rather than serving PyTorch:
  the API is Node/Express, and standing up a second Python service purely for
  inference would double the deploy surface and the free-tier memory budget. ONNX
  Runtime loads the graph directly in Node, so training stays in Python (where the
  ecosystem is) and serving stays in the MERN stack.

Why INT8 dynamic quantisation:
  the target is a 512 MB free dyno sharing ~1 vCPU. Quantisation cuts the model
  from ~9 MB to ~2.5 MB and roughly halves CPU inference latency, at a typical cost
  of well under one point of accuracy — which is the right trade for a model whose
  low-confidence predictions are withheld from the user anyway.
"""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

import torch
import torch.nn as nn
from torchvision import models

ARTIFACTS = Path(__file__).parent / "artifacts"
IMAGE_SIZE = 224


def build_model(num_classes: int) -> nn.Module:
    """Must mirror the architecture used in training exactly, or load_state_dict fails."""
    model = models.mobilenet_v3_small(weights=None)
    in_features = model.classifier[3].in_features
    model.classifier[3] = nn.Linear(in_features, num_classes)
    return model


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint", default=str(ARTIFACTS / "best.pt"))
    parser.add_argument("--version", default="v1")
    parser.add_argument(
        "--no-quantize",
        action="store_true",
        help="skip INT8 quantisation (larger and slower, but avoids any accuracy loss)",
    )
    args = parser.parse_args()

    checkpoint_path = Path(args.checkpoint)
    if not checkpoint_path.exists():
        raise SystemExit(
            f"checkpoint not found: {checkpoint_path}\n"
            "Run notebooks/train_disease_cnn.ipynb first."
        )

    checkpoint = torch.load(checkpoint_path, map_location="cpu")

    # class_to_idx comes from torchvision's ImageFolder and is the authoritative
    # index order. Deriving labels from it (rather than hand-listing them) is what
    # guarantees the server maps logit i to the same class the model was trained on.
    class_to_idx: dict[str, int] = checkpoint["class_to_idx"]
    labels = [name for name, _ in sorted(class_to_idx.items(), key=lambda kv: kv[1])]

    model = build_model(len(labels))
    model.load_state_dict(checkpoint["state_dict"])
    model.eval()

    fp32_path = ARTIFACTS / f"model-{args.version}-fp32.onnx"
    final_path = ARTIFACTS / f"model-{args.version}.onnx"

    dummy = torch.randn(1, 3, IMAGE_SIZE, IMAGE_SIZE)

    torch.onnx.export(
        model,
        dummy,
        str(fp32_path),
        input_names=["input"],
        output_names=["logits"],
        # Dynamic batch axis so the same artifact could serve a batched endpoint
        # later without re-export.
        dynamic_axes={"input": {0: "batch"}, "logits": {0: "batch"}},
        opset_version=17,
        do_constant_folding=True,
    )
    print(f"exported fp32 -> {fp32_path} ({fp32_path.stat().st_size / 1e6:.2f} MB)")

    if args.no_quantize:
        shutil.copy(fp32_path, final_path)
    else:
        from onnxruntime.quantization import QuantType, quantize_dynamic

        quantize_dynamic(
            model_input=str(fp32_path),
            model_output=str(final_path),
            weight_type=QuantType.QInt8,
        )
        print(f"quantised    -> {final_path} ({final_path.stat().st_size / 1e6:.2f} MB)")

    # ---- regenerate labels.json, preserving hand-written remedies ----
    labels_path = ARTIFACTS / "labels.json"
    existing_meta: dict[str, dict[str, str]] = {}
    if labels_path.exists():
        existing_meta = json.loads(labels_path.read_text(encoding="utf-8")).get("meta", {})

    meta: dict[str, dict[str, str]] = {}
    for label in labels:
        if label in existing_meta:
            # Remedies are written by hand (and reviewed) — never overwrite them.
            meta[label] = existing_meta[label]
        else:
            crop, _, disease = label.partition("__")
            meta[label] = {
                "cropSlug": crop,
                "diseaseSlug": disease or label,
                "remedy": "TODO: add a reviewed remedy for this class before deploying.",
            }

    payload = {
        "modelVersion": f"{args.version}-mobilenetv3s"
        + ("" if args.no_quantize else "-int8"),
        "labels": labels,
        "meta": meta,
    }
    labels_path.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(f"wrote        -> {labels_path} ({len(labels)} classes)")

    missing = [k for k, v in meta.items() if v["remedy"].startswith("TODO")]
    if missing:
        print(f"\n⚠  {len(missing)} class(es) still need a reviewed remedy: {missing}")

    # ---- parity check: ONNX output must match PyTorch ----
    # A silent numerical divergence here would mean the deployed model disagrees with
    # the one whose accuracy was measured, so it is checked rather than assumed.
    import numpy as np
    import onnxruntime as ort

    session = ort.InferenceSession(str(final_path), providers=["CPUExecutionProvider"])
    onnx_logits = session.run(None, {"input": dummy.numpy()})[0]
    with torch.no_grad():
        torch_logits = model(dummy).numpy()

    if args.no_quantize:
        np.testing.assert_allclose(onnx_logits, torch_logits, rtol=1e-3, atol=1e-4)
        print("\nparity check passed (fp32 matches PyTorch)")
    else:
        # Quantisation shifts logits, so compare the decision instead of the values.
        agree = onnx_logits.argmax(1) == torch_logits.argmax(1)
        print(f"\nquantised top-1 agrees with PyTorch on the probe: {bool(agree.all())}")

    print(
        "\nNext: point DISEASE_MODEL_PATH at "
        f"{final_path.relative_to(Path(__file__).parent.parent)} and restart the server."
    )


if __name__ == "__main__":
    main()
