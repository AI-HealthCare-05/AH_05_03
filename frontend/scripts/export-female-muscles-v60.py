"""Export the v60 female muscle and superficial bone-coverage layers."""

from __future__ import annotations

import argparse
import importlib.util
import sys
from pathlib import Path


def parse_args() -> argparse.Namespace:
    values = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    return parser.parse_args(values)


def load_export_helpers():
    path = Path(__file__).with_name("export-female-final-anatomy-layers.py")
    spec = importlib.util.spec_from_file_location("ieobom_export_helpers", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load export helpers from {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main() -> None:
    args = parse_args()
    helpers = load_export_helpers()
    sources = {
        obj
        for obj in helpers.collection_objects("FEMALE_MUSCLE_WORK")
        if obj.type in {"MESH", "CURVE", "SURFACE"}
        and not bool(obj.get("IEOBOM_webExclude"))
        and (obj.type != "MESH" or bool(obj.data.polygons))
    }
    report = helpers.export_layer(Path(args.output).expanduser().resolve(), sources, "muscular")
    print("IEOBOM_V60_EXPORT", report)


if __name__ == "__main__":
    main()
