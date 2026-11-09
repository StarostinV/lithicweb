#!/usr/bin/env python3
"""Build the public mesh collection served to the Collection tab.

For each selected artifact this writes an annotated Neurolithic PLY (the same
layout as the app's default export) and adds an entry to catalogue.json.

Sources
-------
- Geometry and metadata: neurolithic_light/data/all_data.h5 (546 meshes).
- Edge labels: the hand-drawn per-vertex edges, never recomputed:
  * labelled PLYs in data/data-dec-2025/LABELED_DATA_ALL (original 295), or
  * the latest accepted fast-verification state (edge_indices) in
    neurolithic_light/server_storage/armando/datasets (251 added in July 2026).
  Each source is checked against the h5: the h5 face labels are the median of
  the three vertex labels, so the chosen vertex labels must reproduce them
  exactly, or the build fails.

Orientation
-----------
The h5 vertices are PCA-aligned, and for about half of the meshes that
alignment is a reflection (determinant -1): the artifact is mirrored and its
triangles are inside-out, so viewers show the far side through the near one.
Such meshes are un-mirrored by negating the third PCA axis, which keeps the
alignment and the vertex order (and therefore the labels). Some meshes are
mirrored with their triangle order also reversed, so their volume is positive;
only the raw scan reveals those, and it is used wherever available (Fumane).
Every published mesh must have a positive signed volume and, where the raw
scan exists, be a proper rotation of it.

Usage
-----
    python build_collection.py --out OUT_DIR [--per-site N] [--sites a,b]
"""
import os

# One numerical thread per process: the build parallelises over meshes, and
# per-process BLAS/OpenMP pools would oversubscribe the cores many times over.
# Must be set before numpy is imported.
for _var in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ.setdefault(_var, "1")

import argparse
import glob
import json
import math
import re
import csv
import struct
from datetime import datetime, timezone
from pathlib import Path

import h5py
import numpy as np
from plyfile import PlyData

LITHIC = Path.home() / "Projects/lithic"
H5 = LITHIC / "neurolithic_light/data/all_data.h5"
LABELED_DIR = LITHIC / "data/data-dec-2025/LABELED_DATA_ALL"
STATES_DIR = LITHIC / "neurolithic_light/server_storage/armando/datasets"
FUMANE_CSV = LITHIC / "data/zenodo_v301/Fumane_3D_metadata.csv"
RAW_FUMANE = LITHIC / "data/zenodo_v301/RF_3D_Meshes"   # raw scans, for the handedness check
METRICS_CSV = LITHIC / "data/onedrive/scar_segmentation/full_run_metrics_546.csv"

# Sites whose raw scans are published under CC-BY-4.0 (The Open Aurignacian
# Project, Falcucci et al.). Coordinates and dating are quoted from the
# Zenodo records, except where marked approximate.
SITES = {
    "fumane": dict(
        name="Grotta di Fumane", context="Grotta di Fumane",
        region="Veneto, northeastern Italy",
        lat=45.5925, lon=10.9058, coordinates="approximate (not given in the source record)",
        period="Aurignacian and Gravettian",
        dating="c. 41–33 ky cal BP (Higham et al. 2009)",
        datingKa=[41.0, 33.0],
        source=dict(title="The Open Aurignacian Project. Volume 1: Grotta di Fumane in northeastern Italy",
                    authors="Falcucci, A.; Peresani, M.", doi="10.5281/zenodo.15382869", license="CC-BY-4.0"),
    ),
    "castelcivita": dict(
        name="Grotta di Castelcivita", context="Grotta di Castelcivita",
        region="Campania, southern Italy",
        lat=40.49563600, lon=15.20922177, coordinates="as published in the source record",
        period="Protoaurignacian and Early Aurignacian",
        dating="c. 41,000–39,800 years ago (Douka et al. 2014)",
        datingKa=[41.0, 39.8],
        source=dict(title="The Open Aurignacian Project. Volume 2: Grotta di Castelcivita in southern Italy",
                    authors="Falcucci, A.; Moroni, A.", doi="10.5281/zenodo.15383157", license="CC-BY-4.0"),
    ),
    "cala": dict(
        name="Grotta della Cala", context="Grotta della Cala",
        region="Marina di Camerota, Campania, southern Italy",
        lat=40.00108243, lon=15.38095416, coordinates="as published in the source record",
        period="Early Aurignacian",
        dating="after c. 40,000 years ago (spit AU12 OSL 38,390–34,682 cal BP; AU10 14C 38,840–37,637 cal BP)",
        datingKa=[38.84, 34.68],   # span of the two quoted dates
        source=dict(title="The Open Aurignacian Project. Volume 3: Grotta della Cala in southern Italy",
                    authors="Falcucci, A.; Moroni, A.", doi="10.5281/zenodo.15383121", license="CC-BY-4.0"),
    ),
    "bombrini": dict(
        name="Riparo Bombrini", context="Riparo Bombrini",
        region="Balzi Rossi, Liguria, northwestern Italy",
        lat=43.783222, lon=7.535444, coordinates="as published in the source record",
        period="Protoaurignacian (A2, A1) and Early Aurignacian (A0)",
        dating=None,
        datingKa=None,             # no numeric date in the source record
        source=dict(title="The Open Aurignacian Project. Volume 4: Riparo Bombrini in northwestern Italy",
                    authors="Falcucci, A.; Negrino, F.; Riel-Salvatore, J.", doi="10.5281/zenodo.15383190",
                    license="CC-BY-4.0"),
    ),
}
# Everything else in all_data.h5, for the local --all mock only: these sets are
# not cleared for publication, have no verified coordinates or dating, and
# must never be uploaded. Israeli site positions are approximate placeholders.
MOCK_SITES = {
    "maayan_barukh": dict(name="Maayan Barukh", context="Maayan Barukh", region="Upper Galilee, Israel",
                          lat=33.24, lon=35.61, coordinates="approximate (mock)", period=None,
                          dating=None, datingKa=None, source=None),
    "jaljulia": dict(name="Jaljulia", context="Jaljulia", region="Central Israel",
                     lat=32.15, lon=34.95, coordinates="approximate (mock)", period=None,
                     dating=None, datingKa=None, source=None),
    "revadim": dict(name="Revadim", context="Revadim", region="Southern coastal plain, Israel",
                    lat=31.78, lon=34.82, coordinates="approximate (mock)", period=None,
                    dating=None, datingKa=None, source=None),
    "nahal_zihor": dict(name="Nahal Zihor", context="Nahal Zihor", region="Negev, Israel",
                        lat=30.10, lon=34.95, coordinates="approximate (mock)", period=None,
                        dating=None, datingKa=None, source=None),
    "open_air": dict(name="Open air (Hallinan and Cascalheira)", context="Open air", region=None,
                     lat=None, lon=None, coordinates="unknown", period=None,
                     dating=None, datingKa=None, source=None),
    "experimental": dict(name="Experimental", context="Experimental", region=None,
                         lat=None, lon=None, coordinates="none (experimental replicas)", period=None,
                         dating=None, datingKa=None, source=None),
}


def norm(name):
    return re.sub(r"[._]+", "_", re.sub(r"\.ply$", "", str(name), flags=re.I)).lower()


def clean(v):
    """h5 attribute -> JSON value (NaN and bytes handled)."""
    if isinstance(v, bytes):
        v = v.decode()
    if isinstance(v, (np.floating, float)):
        return None if math.isnan(float(v)) else round(float(v), 4)
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.bool_,)):
        return bool(v)
    return v


def accepted_states():
    """norm(original_name) -> edge_indices from the latest accepted state."""
    out = {}
    for ds in sorted(STATES_DIR.iterdir()):
        if not ds.is_dir():
            continue
        mi = ds / ".meshes.json"
        midx = json.loads(mi.read_text()) if mi.exists() else {}
        for mdir in sorted(p for p in ds.iterdir() if p.is_dir()):
            best = None
            for s in glob.glob(str(mdir / "state_*.json")):
                try:
                    d = json.load(open(s))
                except Exception:
                    continue
                m = d.get("metadata", {})
                if "verdict" in m and (best is None or m.get("created_at", "") > best[0]):
                    best = (m.get("created_at", ""), d)
            if not best or best[1]["metadata"].get("verdict") != "accept":
                continue
            ei = best[1].get("edge_indices") or []
            if not ei:
                continue
            k = norm(midx.get(mdir.name, {}).get("original_name", mdir.name + ".ply"))
            prev = out.get(k)
            if prev is None or (best[0], len(ei)) > (prev[0], len(prev[1])):
                out[k] = (best[0], ei)
    return {k: v[1] for k, v in out.items()}


def edge_labels_for(sid, n_vertices, faces, h5_face_labels, states):
    """Return (vertex labels 0/1, source description), verified against the h5."""
    candidates = []
    ply = LABELED_DIR / f"{sid}.ply"
    if ply.exists():
        v = PlyData.read(str(ply))["vertex"]
        if "labels" in v.data.dtype.names and len(v.data) == n_vertices:
            candidates.append((np.asarray(v["labels"]).astype(np.int32), "labelled PLY"))
    if norm(sid) in states:
        lab = np.zeros(n_vertices, np.int32)
        ei = np.asarray(states[norm(sid)], np.int64)
        lab[ei[(ei >= 0) & (ei < n_vertices)]] = 1
        candidates.append((lab, "accepted verification state"))
    for lab, src in candidates:
        if np.array_equal(np.median(lab[faces].astype(float), -1), h5_face_labels):
            return lab, src
    raise RuntimeError(f"{sid}: no edge-label source reproduces the h5 face labels "
                       f"({[s for _, s in candidates] or 'none found'})")


def signed_volume(V, F):
    a, b, c = V[F[:, 0]], V[F[:, 1]], V[F[:, 2]]
    return float(np.einsum("ij,ij->i", a, np.cross(b, c)).sum() / 6)


def unmirror(sid, V, F):
    """Return (vertices, faces, whether anything was changed) with the
    artifact's true handedness and outward-facing triangles.

    Two upstream defects are repaired: a reflected PCA alignment (mirror
    image, inside-out triangles: negative volume), and a mirror image whose
    triangle order was also reversed (positive volume, so only a comparison
    with the raw scan reveals it). The third PCA axis is negated, which keeps
    the alignment and the vertex order, so the vertex labels stay valid."""
    changed = False
    if signed_volume(V.astype(np.float64), F) < 0:
        V = V.copy()
        V[:, 2] *= -1
        changed = True
    raw = RAW_FUMANE / f"{sid}.ply"
    if raw.exists():
        r = PlyData.read(str(raw))["vertex"]
        R = np.stack([r["x"], r["y"], r["z"]], 1).astype(np.float64)
        if len(R) == len(V):
            def det_to_raw(W):
                M, *_ = np.linalg.lstsq(R - R.mean(0), W.astype(np.float64) - W.mean(0), rcond=None)
                return np.linalg.det(M)
            if det_to_raw(V) < 0:
                V = V.copy()
                V[:, 2] *= -1
                F = F[:, [0, 2, 1]]          # mirroring flips winding; restore outward triangles
                changed = True
            if det_to_raw(V) < 0:
                raise RuntimeError(f"{sid}: published mesh is a mirror image of the raw scan")
    if signed_volume(V.astype(np.float64), F) <= 0:
        raise RuntimeError(f"{sid}: signed volume not positive after un-mirroring")
    return V, F, changed


def vertex_segments(n, F, labels):
    """Segment id per vertex as the client computes them: connected regions of
    non-edge vertices (edge vertices get -1)."""
    parent = np.arange(n)
    e = np.concatenate([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]])
    e = e[(labels[e[:, 0]] == 0) & (labels[e[:, 1]] == 0)]
    a, b = e[:, 0], e[:, 1]
    while True:
        pa, pb = parent[a], parent[b]
        if np.array_equal(pa, pb):
            break
        m = np.minimum(pa, pb)
        np.minimum.at(parent, pa, m)
        np.minimum.at(parent, pb, m)
        while True:                      # pointer jumping
            nxt = parent[parent]
            if np.array_equal(nxt, parent):
                break
            parent = nxt
    seg = parent.copy()
    seg[labels != 0] = -1
    return seg


def fibonacci_sphere(k):
    i = np.arange(k) + 0.5
    phi = np.arccos(1 - 2 * i / k)
    theta = np.pi * (1 + 5 ** 0.5) * i
    return np.stack([np.cos(theta) * np.sin(phi), np.cos(phi), np.sin(theta) * np.sin(phi)], 1)


def best_view(V, F, labels, n_dirs=200, res=160, min_silhouette=0.75):
    """Camera direction (from the object towards the camera) that shows the
    most annotation: for each candidate direction, a depth buffer of face
    centroids finds the visible faces, and the score is the sum over visible
    scars, except the largest segment (drawn in the plain object colour), of
    sqrt(visible pixels): many visible scars count more than one huge one.
    Only views whose silhouette is at least `min_silhouette` of the largest
    one compete, so flat pieces are seen face-on, never edge-on."""
    V = V.astype(np.float64) - V.mean(0)          # the client centres the mesh the same way
    seg = vertex_segments(len(V), F, labels)
    ids, counts = np.unique(seg[seg >= 0], return_counts=True)
    plain = ids[np.argmax(counts)] if len(ids) else -2
    # face -> segment: majority of its non-edge vertices (ties: first)
    fs = seg[F]
    face_seg = np.where(fs[:, 0] >= 0, fs[:, 0], np.where(fs[:, 1] >= 0, fs[:, 1], fs[:, 2]))
    informative = (face_seg >= 0) & (face_seg != plain)

    cent = V[F].mean(1)
    normal = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
    radius = np.linalg.norm(V, axis=1).max() * 1.01
    views = []
    for d in fibonacci_sphere(n_dirs):
        # orthonormal image axes
        up = np.array([0.0, 1.0, 0.0]) if abs(d[1]) < 0.9 else np.array([1.0, 0.0, 0.0])
        u = np.cross(up, d); u /= np.linalg.norm(u)
        w = np.cross(d, u)
        front = normal @ d > 0
        idx = np.nonzero(front)[0]
        px = np.clip(((cent[idx] @ u / radius + 1) / 2 * res).astype(int), 0, res - 1)
        py = np.clip(((cent[idx] @ w / radius + 1) / 2 * res).astype(int), 0, res - 1)
        depth = cent[idx] @ d                      # larger = closer to the camera
        pix = py * res + px
        order = np.lexsort((-depth, pix))          # per pixel, closest face first
        first = np.ones(len(order), bool)
        first[1:] = pix[order][1:] != pix[order][:-1]
        visible = idx[order[first]]
        vis_seg = face_seg[visible][informative[visible]]
        if len(vis_seg) == 0:
            score = 0.0
        else:
            _, c = np.unique(vis_seg, return_counts=True)
            score = float(np.sqrt(c).sum())
        views.append((d, len(visible), score))      # occupied pixels = silhouette
    largest = max(v[1] for v in views)
    best = max((v for v in views if v[1] >= min_silhouette * largest), key=lambda v: v[2])[0]
    return [round(float(x), 4) for x in best]


def write_ply(path, vertices, faces, labels, comments):
    header = "ply\nformat binary_little_endian 1.0\n"
    header += "".join(f"comment metadata {k} {v}\n" for k, v in comments.items() if v not in (None, ""))
    header += (f"element vertex {len(vertices)}\nproperty float x\nproperty float y\nproperty float z\n"
               f"property int labels\nelement face {len(faces)}\nproperty list uchar int vertex_indices\n"
               "element arrow 0\nproperty int start_index\nproperty int end_index\nend_header\n")
    vrec = np.empty(len(vertices), dtype=[("p", "<f4", 3), ("l", "<i4")])
    vrec["p"] = vertices
    vrec["l"] = labels
    frec = np.empty(len(faces), dtype=[("n", "u1"), ("i", "<i4", 3)])
    frec["n"] = 3
    frec["i"] = faces
    with open(path, "wb") as f:
        f.write(header.encode())
        f.write(vrec.tobytes())
        f.write(frec.tobytes())


def select(h5, per_site, sites, table):
    """Pick up to per_site meshes per site, alternating types, smallest first."""
    context_to_site = {s["context"]: k for k, s in table.items()}
    by_site = {}
    for key in h5:
        a = h5[key].attrs
        site = context_to_site.get(clean(a["Contex"]))
        if site in sites:
            by_site.setdefault(site, []).append((clean(a["Type"]), h5[key]["vertices"].shape[0], key))
    chosen = []
    for site in sites:
        groups = {}
        for t, n, key in sorted(by_site.get(site, []), key=lambda r: (r[0], r[1])):
            groups.setdefault(t, []).append(key)
        order = []
        while any(groups.values()) and len(order) < per_site:
            for t in sorted(groups):
                if groups[t] and len(order) < per_site:
                    order.append(groups[t].pop(0))
        chosen += [(site, k) for k in order]
    return chosen


def dataset_card(catalogue):
    """Hugging Face dataset card: license, contents and sources."""
    sources = "\n".join(
        f"- {s['source']['authors']} {s['source']['title']}. https://doi.org/{s['source']['doi']} "
        f"({s['source']['license']})" for s in catalogue["sites"])
    approx = [s["name"] for s in catalogue["sites"] if s["coordinates"].startswith("approximate")]
    note = f" Approximate locations: {', '.join(approx)}." if approx else ""
    return f"""---
license: cc-by-4.0
pretty_name: {catalogue['name']}
tags: [archaeology, lithics, 3d, mesh, segmentation]
---

# {catalogue['name']}

{len(catalogue['items'])} annotated 3D meshes of lithic artifacts from {len(catalogue['sites'])} sites, browsed by the
Collection tab of the NeuroLithic web client. Each mesh is a binary PLY with
per-vertex scar-boundary labels (`labels`, 1 = edge) drawn by the NeuroLithic
team; `catalogue.json` lists artifacts, sites and metadata; `thumbs/` holds
preview images.

## Sources

Raw scans:

{sources}

Site coordinates and dating are quoted from these records.{note}
"""


# Per-process state for the worker pool (set by _init_worker)
_W = {}


def _init_worker(out, table):
    _W.update(out=out, table=table, h5=h5py.File(H5, "r"), states=accepted_states(),
              fumane={r["ID"]: r for r in csv.DictReader(open(FUMANE_CSV))},
              scars={r["sample_id"]: int(r["n_scars_gt"]) for r in csv.DictReader(open(METRICS_CSV))})


def build_item(job):
    """Write one annotated PLY and return its catalogue entry (or an error)."""
    site, key = job
    out, table = _W["out"], _W["table"]
    g = _W["h5"][key]
    a = {k: clean(v) for k, v in g.attrs.items()}
    sid = a["ID"]
    try:
        V = g["vertices"][:].astype(np.float32)
        F = g["faces"][:].astype(np.int32)
        labels, label_source = edge_labels_for(sid, len(V), F, g["labels"][:], _W["states"])
        V, F, flipped = unmirror(sid, V, F)
    except RuntimeError as err:
        return dict(error=str(err), id=sid)

    src = table[site].get("source") or {}
    rel = f"meshes/{site}/{sid}.ply"
    out_path = out / rel
    out_path.parent.mkdir(parents=True, exist_ok=True)
    write_ply(out_path, V, F, labels, {
        "id": sid, "site": table[site]["name"], "type": a["Type"],
        "dataset": a["Dataset"].replace(" ", "_") if a.get("Dataset") else None,
        "source_doi": src.get("doi"), "license": src.get("license"),
    })

    item = dict(
        id=sid, site=site, type=a["Type"], dataset=a.get("Dataset"),
        file=rel, bytes=out_path.stat().st_size,
        vertices=int(len(V)), faces=int(len(F)), edgeVertices=int(labels.sum()),
        scars=_W["scars"].get(sid), surfaceArea=a.get("surface_area"), volume=a.get("raw_volume"),
        labelSource=label_source,
        view=best_view(V, F, labels),
    )
    # Thumbnails are rendered with the app afterwards (see README); include if present
    if (out / f"thumbs/{sid}.webp").exists():
        item["thumb"] = f"thumbs/{sid}.webp"

    z = _W["fumane"].get(sid)
    if z:
        item.update(unit=z["Stratigraphic_unit"], rawMaterial=z["Raw_material"], blank=z["Blank"],
                    technology=z["Technology"],
                    dimensionsMm=[float(z[k]) for k in ("Length", "Width", "Thickness") if z[k] not in ("", "NA")])
    else:
        item.update(rawMaterial=a.get("Raw-Material"), technology=a.get("Technology"))
    item = {k: v for k, v in item.items() if v not in (None, "", [])}
    item["_log"] = (f"{sid:14s} {site:12s} {a['Type']:14s} {len(V):8d} v  {int(labels.sum()):6d} edges  "
                    f"({label_source}{', un-mirrored' if flipped else ''})")
    return item


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--per-site", type=int, default=12)
    ap.add_argument("--sites", default=",".join(SITES))
    ap.add_argument("--all", action="store_true",
                    help="LOCAL MOCK ONLY: every mesh in the h5, including sets not cleared for publication")
    ap.add_argument("--workers", type=int, default=8)
    args = ap.parse_args()
    table = {**SITES, **MOCK_SITES} if args.all else SITES
    sites = list(table) if args.all else [s for s in args.sites.split(",") if s]
    per_site = 10 ** 9 if args.all else args.per_site

    with h5py.File(H5, "r") as h5:
        jobs = select(h5, per_site, sites, table)
    items, failed = [], []
    from multiprocessing import Pool
    with Pool(args.workers, initializer=_init_worker, initargs=(args.out, table)) as pool:
        for n, item in enumerate(pool.imap(build_item, jobs, chunksize=1), 1):
            if "error" in item:
                failed.append(item)
                print(f"[{n}/{len(jobs)}] SKIPPED {item['id']}: {item['error']}", flush=True)
                if not args.all:
                    raise SystemExit(item["error"])
                continue
            print(f"[{n}/{len(jobs)}] {item.pop('_log')}", flush=True)
            items.append(item)

    catalogue = dict(
        name="Lithic collection (MOCK, local only)" if args.all else "Lithic collection (preview)",
        version=1,
        generated=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        description="Annotated 3D meshes of lithic artifacts. Edge annotations by the Neurolithic team; "
                    "raw scans from the cited sources.",
        sites=[dict(id=k, **{f: v for f, v in s.items() if f != "context"}) for k, s in table.items() if k in sites],
        items=items,
    )
    (args.out / "catalogue.json").write_text(json.dumps(catalogue, indent=1, ensure_ascii=False))
    if not args.all:
        (args.out / "README.md").write_text(dataset_card(catalogue))
    total = sum(i["bytes"] for i in items) / 1e6
    print(f"\n{len(items)} meshes, {total:.0f} MB -> {args.out}" + (f"; {len(failed)} skipped" if failed else ""))


if __name__ == "__main__":
    main()
