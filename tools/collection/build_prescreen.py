#!/usr/bin/env python3
"""Build a prescreen collection: unreviewed meshes from the fast-verification
store with AUTOMATIC edge labels (model output, not reviewed), in the same
format as the official collection, so they can be browsed through the
Collection tab's "Data source" switch and reviewed there.

Selection ("tier A"): not yet reviewed in fast verification, at least 50k
vertices (84% of such meshes were accepted in review), stored model output
available, not already in the official collection (all_data.h5), one entry
per artifact.

Labels: the stored model output, postprocessed with the client's own code
(postprocess_labels.mjs) and its default parameters. Geometry: the raw scans
from the store (identical to the Zenodo release), so handedness is correct;
inside-out triangles, if any, are flipped.

    python build_prescreen.py --out OUT_DIR [--min-vertices 50000] [--workers 12]
"""
import os

for _var in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ.setdefault(_var, "1")

import argparse
import csv
import glob
import json
import re
import subprocess
from datetime import datetime, timezone
from multiprocessing import Pool
from pathlib import Path

import h5py
import numpy as np
from plyfile import PlyData

import build_collection as bc

STORE = bc.LITHIC / "neurolithic_light/server_storage/armando/datasets"
DEFAULT_PARAMS = dict(union_find_max_merge_cost=0.45, union_find_merge_cost="max",
                      min_segment_size=50, union_find_max_segment_size=None)
HERE = Path(__file__).resolve().parent


def fumane_type(row):
    """Artifact type from the Fumane metadata (Class / Blank / Core_classification)."""
    if not row:
        return "Unclassified"
    cls, blank = row.get("Class", ""), row.get("Blank", "")
    if cls == "Core":
        return "Bladelet core" if "ladelet" in row.get("Core_classification", "") else "Core"
    if cls == "Tool":
        return f"Tool ({blank.lower()})" if blank and blank != "NA" else "Tool"
    return blank if blank and blank != "NA" else cls or "Unclassified"


def select(min_vertices):
    """Unreviewed, large enough, with model output, not in the official collection."""
    with h5py.File(bc.H5, "r") as h5:
        official = {bc.norm(bc.clean(h5[k].attrs["ID"])) for k in h5}
    chosen, seen = [], set()
    for ds in sorted(p for p in STORE.iterdir() if p.is_dir()):
        meta = json.loads((ds / ".meshes.json").read_text()) if (ds / ".meshes.json").exists() else {}
        for mdir in sorted(p for p in ds.iterdir() if p.is_dir()):
            info = meta.get(mdir.name, {})
            name = info.get("original_name", mdir.name + ".ply")
            key = bc.norm(name)
            if key in official or key in seen:
                continue
            reviewed = any(json.load(open(f)).get("metadata", {}).get("verdict")
                           for f in glob.glob(str(mdir / "state_*.json")))
            if reviewed or not (mdir / "model_output.npz").exists():
                continue
            if (info.get("num_vertices") or 0) < min_vertices:
                continue
            seen.add(key)
            chosen.append(dict(dataset=ds.name, mesh_dir=str(mdir), name=name))
    return chosen


def export(jobs, work):
    work.mkdir(parents=True, exist_ok=True)
    manifest = []
    for i, job in enumerate(jobs):
        key = f"{i:04d}"
        ply = PlyData.read(job["mesh_dir"] + "/mesh.ply")
        F = np.vstack(ply["face"]["vertex_indices"]).astype(np.int32)
        z = np.load(job["mesh_dir"] + "/model_output.npz")
        if not (work / f"{key}_faces.i32").exists():
            F.tofile(work / f"{key}_faces.i32")
            z["edge_predictions"].astype(np.float32).tofile(work / f"{key}_pred.f32")
            z["face_adjacency"].astype(np.int32).tofile(work / f"{key}_adj.i32")
        manifest.append(dict(key=key, nv=len(ply["vertex"].data), nf=int(z["num_faces"]), params=DEFAULT_PARAMS, **job))
    (work / "manifest.json").write_text(json.dumps(manifest))
    return manifest


_FUMANE = {}


def _init(out, work):
    _FUMANE.update(out=out, work=work, csv={r["ID"]: r for r in csv.DictReader(open(bc.FUMANE_CSV))})


def finalize_one(m):
    out, work = _FUMANE["out"], _FUMANE["work"]
    ply = PlyData.read(m["mesh_dir"] + "/mesh.ply")
    v = ply["vertex"]
    V = np.stack([v["x"], v["y"], v["z"]], 1).astype(np.float32)
    F = np.fromfile(work / f"{m['key']}_faces.i32", np.int32).reshape(-1, 3)
    labels = np.fromfile(work / f"{m['key']}_labels.u8", np.uint8).astype(np.int32)
    flipped = bc.signed_volume(V.astype(np.float64), F) < 0
    if flipped:                       # raw scan: true handedness, only the winding is inverted
        F = F[:, [0, 2, 1]]
    sid = re.sub(r"\.ply$", "", m["name"], flags=re.I)
    row = _FUMANE["csv"].get(sid)
    rel = f"meshes/fumane/{sid}.ply"
    (out / rel).parent.mkdir(parents=True, exist_ok=True)
    src = bc.SITES["fumane"]["source"]
    bc.write_ply(out / rel, V, F, labels, {
        "id": sid, "site": bc.SITES["fumane"]["name"], "type": fumane_type(row),
        "annotation": "automatic", "source_doi": src["doi"], "license": src["license"],
    })
    item = dict(
        id=sid, site="fumane", type=fumane_type(row), dataset="Falcucci & Peresani (Open Aurignacian Project, vol. 1)",
        source="Falcucci et al. 2023 + Linsel et al", file=rel, bytes=(out / rel).stat().st_size,
        vertices=int(len(V)), faces=int(len(F)), edgeVertices=int(labels.sum()),
        annotation="automatic", labelSource="model prediction (unreviewed)", reviewQueue=m["dataset"],
        view=bc.best_view(V, F, labels),
    )
    if (out / f"thumbs/{sid}.webp").exists():
        item["thumb"] = f"thumbs/{sid}.webp"
    if row:
        item.update(unit=row["Stratigraphic_unit"], rawMaterial=row["Raw_material"], blank=row["Blank"],
                    technology=row["Technology"],
                    dimensionsMm=[float(row[k]) for k in ("Length", "Width", "Thickness") if row[k] not in ("", "NA")])
    item = {k: val for k, val in item.items() if val not in (None, "", [])}
    return item, flipped


def dataset_card(cat):
    s = cat["sources"][0]
    return f"""---
license: cc-by-4.0
pretty_name: {cat['name']}
tags: [archaeology, lithics, 3d, mesh, segmentation, prescreening]
---

# {cat['name']}

{len(cat['items'])} 3D meshes of lithic artifacts from Grotta di Fumane with
**automatic, unreviewed** scar-boundary labels (`labels`, 1 = edge): NeuroLithic
model predictions postprocessed with the web client's defaults. They are a
prescreening set for expert review in the NeuroLithic web client (Collection
tab, "Data source": `neurolithic/<this dataset>`), not ground truth, and should
not be used for training without review. Each artifact has `annotation:
automatic`; `reviewQueue` names its fast-verification queue.

Selection: meshes not yet reviewed in fast verification, with at least 50,000
vertices (in review so far, 84% of such predictions were accepted, most of them
after manual corrections), not part of the official collection.

## Source

Raw scans: {s['authors']} {s['title']}. https://doi.org/{s['doi']} ({s['license']})
"""


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--min-vertices", type=int, default=50_000)
    ap.add_argument("--workers", type=int, default=12)
    args = ap.parse_args()
    work = args.out / "_work"

    jobs = select(args.min_vertices)
    print(f"selected {len(jobs)} meshes", flush=True)
    manifest = export(jobs, work)
    subprocess.run(["node", "--experimental-detect-module", "--no-warnings",
                    str(HERE / "postprocess_labels.mjs"), str(work)], check=True)

    items, flipped = [], 0
    with Pool(args.workers, initializer=_init, initargs=(args.out, work)) as pool:
        for n, (item, fl) in enumerate(pool.imap(finalize_one, manifest, chunksize=1), 1):
            items.append(item)
            flipped += fl
            print(f"[{n}/{len(manifest)}] {item['id']}", flush=True)

    src = bc.SITES["fumane"]["source"]
    cat = dict(
        name="Fumane prescreen, tier A (automatic labels, unreviewed)",
        version=1,
        generated=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        description="Automatic NeuroLithic predictions for expert prescreening; not reviewed.",
        sites=[dict(id="fumane", **{f: val for f, val in bc.SITES["fumane"].items() if f != "context"})],
        sources=[dict(id="Falcucci et al. 2023 + Linsel et al", label="Falcucci & Peresani (Open Aurignacian Project, vol. 1)",
                      count=len(items), **src)],
        items=items,
    )
    (args.out / "catalogue.json").write_text(json.dumps(cat, indent=1, ensure_ascii=False))
    (args.out / "README.md").write_text(dataset_card(cat))
    print(f"\n{len(items)} meshes ({flipped} with inverted winding fixed), "
          f"{sum(i['bytes'] for i in items) / 1e6:.0f} MB -> {args.out}")


if __name__ == "__main__":
    main()
