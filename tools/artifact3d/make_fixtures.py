"""Golden fixtures for the browser port of the Artifact3-D scar segmentation.

Runs the Python port (scar_segmentation, the reference implementation) stage
by stage on one PLY mesh and dumps every intermediate the JavaScript stage
tests compare against (tests/unit/geometry/artifact3d/*.test.js).

Usage (with the Python port's virtualenv):

    PY=/path/to/scar_segmentation_venv/bin/python
    $PY tools/artifact3d/make_fixtures.py MESH.ply OUT_DIR \
        [--port /path/to/scar_segmentation] [--target 200000] [--seed 0] \
        [--min-scar-faces 50]

    # committed small fixture (100k faces, no decimation):
    $PY tools/artifact3d/make_fixtures.py .../meshes/fumane/RF.c_218.ply \
        tests/fixtures/artifact3d/RF.c_218
    # larger fixture, kept out of git (tests skip it when absent):
    $PY tools/artifact3d/make_fixtures.py .../meshes/castelcivita/CTC_1011.ply \
        tests/fixtures/artifact3d/local/CTC_1011

    # numpy Generator reference draws for the PRNG test:
    $PY tools/artifact3d/make_fixtures.py --rng tests/fixtures/artifact3d/rng_numpy.json

Preprocessing follows pilot_run.py: trimesh process=True + fix_normals,
quadric decimation to `target` faces when the mesh is larger, then
remove_unreferenced_vertices + fix_normals. Labels are transferred back to the
full-resolution (processed) mesh by per-vertex majority + nearest vertex.

Arrays are little-endian, gzip-compressed raw binaries (NAME.f64.gz /
NAME.i32.gz); meta.json carries counts, parameters, the recorded random draws
of the geodesic clustering and per-stage CPU times.
"""

import argparse
import gzip
import json
import os
import sys
import time

os.environ.setdefault("OMP_NUM_THREADS", "1")
os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")

import numpy as np  # noqa: E402

DEFAULT_PORT = "/home/vladimir/Projects/lithic/data/onedrive/scar_segmentation"


def read_ply(path):
    """Minimal binary-little-endian PLY reader: vertices, faces, vertex labels."""
    with open(path, "rb") as fh:
        data = fh.read()
    end = data.index(b"end_header") + len(b"end_header")
    while data[end:end + 1] in (b"\r", b"\n"):
        end += 1
        if data[end - 1:end] == b"\n":
            break
    header = data[:end].decode("ascii", "replace").splitlines()
    assert "format binary_little_endian 1.0" in header, "binary LE PLY expected"
    elements, cur = [], None
    for line in header:
        tok = line.split()
        if not tok:
            continue
        if tok[0] == "element":
            cur = {"name": tok[1], "count": int(tok[2]), "props": []}
            elements.append(cur)
        elif tok[0] == "property":
            cur["props"].append(tok[1:])
    tmap = {"float": "<f4", "float32": "<f4", "double": "<f8", "float64": "<f8",
            "int": "<i4", "int32": "<i4", "uint": "<u4", "uint32": "<u4",
            "uchar": "u1", "uint8": "u1", "char": "i1", "int8": "i1",
            "short": "<i2", "ushort": "<u2"}
    off = end
    out = {}
    for el in elements:
        if any(p[0] == "list" for p in el["props"]):
            # faces: assume a single 'list uchar int' property of triangles
            p = el["props"][0]
            ct, it = tmap[p[1]], tmap[p[2]]
            rec = np.dtype([("n", ct), ("i", it, (3,))])
            arr = np.frombuffer(data, rec, el["count"], off)
            assert (arr["n"] == 3).all(), "triangles only"
            out[el["name"]] = arr["i"].astype(np.int64)
            off += rec.itemsize * el["count"]
        else:
            rec = np.dtype([(p[1], tmap[p[0]]) for p in el["props"]])
            out[el["name"]] = np.frombuffer(data, rec, el["count"], off)
            off += rec.itemsize * el["count"]
    vx = out["vertex"]
    v = np.stack([vx["x"], vx["y"], vx["z"]], axis=1).astype(np.float64)
    labels = vx["labels"].astype(np.int64) if "labels" in vx.dtype.names else None
    return v, out["face"], labels


def save(out_dir, name, arr, kind):
    dt = {"f64": "<f8", "i32": "<i4"}[kind]
    raw = np.ascontiguousarray(arr, dtype=dt).tobytes()
    with open(os.path.join(out_dir, f"{name}.{kind}.gz"), "wb") as fh:
        fh.write(gzip.compress(raw, compresslevel=9, mtime=0))


class RecordingRng:
    """Wraps np.random.default_rng(seed) and records every integers(n) draw."""

    def __init__(self, seed):
        self.g = np.random.default_rng(seed)
        self.draws = []

    def integers(self, n):
        r = int(self.g.integers(n))
        self.draws.append([int(n), r])
        return r


def majority_vertex_labels(f, face_labels, nv):
    # copied from pilot_run.py (ties -> largest label)
    pairs = np.stack([f.ravel(), np.repeat(face_labels, 3)], axis=1)
    uniq, counts = np.unique(pairs, axis=0, return_counts=True)
    order = np.lexsort((counts, uniq[:, 0]))
    uniq, counts = uniq[order], counts[order]
    last = np.r_[uniq[1:, 0] != uniq[:-1, 0], True]
    vl = np.zeros(nv, dtype=int)
    vl[uniq[last, 0]] = uniq[last, 1]
    return vl


def rng_reference(path):
    """numpy Generator(PCG64).integers reference draws for the JS PRNG test."""
    cases = []
    for seed in [0, 1, 2, 7, 42, 12345, 2 ** 32 + 5, 2 ** 63 + 11]:
        g = np.random.default_rng(seed)
        bounds = [1, 2, 3, 10, 97, 1000, 65536, 200000, 2 ** 31 - 1, 2 ** 32 - 1,
                  2 ** 32, 2 ** 40 + 3, 123457, 5, 99991] * 3
        draws = [[str(n), str(int(g.integers(n)))] for n in bounds]
        cases.append({"seed": str(seed), "draws": draws})
    with open(path, "w") as fh:
        json.dump({"numpy": np.__version__, "cases": cases}, fh, indent=0)
    print(f"wrote {path}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("mesh", nargs="?")
    ap.add_argument("out_dir", nargs="?")
    ap.add_argument("--port", default=DEFAULT_PORT)
    ap.add_argument("--target", type=int, default=200_000)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--min-scar-faces", type=int, default=50)
    ap.add_argument("--rng", help="only write the numpy PRNG reference JSON")
    args = ap.parse_args()
    if args.rng:
        rng_reference(args.rng)
        return

    sys.path.insert(0, args.port)
    import trimesh
    from scipy.spatial import cKDTree
    from scar_segmentation import (curvature, ridges, smoothness, clustering,
                                   merging, graphcut)
    from scar_segmentation.pipeline import SegmentationParams
    from scar_segmentation.mesh_utils import reorient_mesh

    os.makedirs(args.out_dir, exist_ok=True)
    T = {}

    def tick(name, t0):
        T[name] = round(time.process_time() - t0, 4)

    v_ply, f_ply, gt = read_ply(args.mesh)
    t0 = time.process_time()
    mesh_full = trimesh.Trimesh(v_ply, f_ply, process=True)
    trimesh.repair.fix_normals(mesh_full)
    tick("0 process+fix_normals", t0)
    v_full = np.asarray(mesh_full.vertices, float)
    f_full = np.asarray(mesh_full.faces, int)

    t0 = time.process_time()
    mesh = mesh_full
    decimated = False
    if len(mesh.faces) > args.target:
        mesh = mesh_full.simplify_quadric_decimation(face_count=args.target)
        mesh.remove_unreferenced_vertices()
        trimesh.repair.fix_normals(mesh)
        decimated = True
    tick("0 decimate", t0)
    v_raw = np.asarray(mesh.vertices, float)   # decimated, not reoriented
    f = np.asarray(mesh.faces, int)

    p = SegmentationParams(min_scar_faces=args.min_scar_faces, seed=args.seed)

    t0 = time.process_time()
    v = reorient_mesh(v_raw)
    tick("0 reorient", t0)

    t0 = time.process_time()
    Cmin, Cmax, Umin, Umax = curvature.compute_curvature(v, f, p.curvature_smoothing)
    edges = np.unique(np.sort(
        np.vstack([f[:, [0, 1]], f[:, [1, 2]], f[:, [2, 0]]]), axis=1), axis=0)
    h = np.linalg.norm(v[edges[:, 0]] - v[edges[:, 1]], axis=1).mean()
    scale = p.reference_edge_length / h
    Cmax = Cmax * scale
    tick("1 curvature", t0)
    Cmax_raw = Cmax.copy()

    t0 = time.process_time()
    rs = ridges.detect_crest_ridges(v, f, Cmax, Umax,
                                    candidate_threshold=p.curvature_threshold_low)
    tick("2 crest lines", t0)
    # recover crest vertex ids: RidgeSet.points == v[crest_idx] (ascending ids)
    crest_idx = np.zeros(0, int)
    if len(rs.points):
        _, crest_idx = cKDTree(v).query(rs.points, k=1)
        assert np.array_equal(v[crest_idx], rs.points)
        assert np.array_equal(rs.strength, Cmax_raw[crest_idx])
    crest_idx = np.asarray(crest_idx, int)

    t0 = time.process_time()
    Cmax = curvature.update_curvature(
        v, Cmax, rs.points, rs.strength,
        curvature_threshold1=p.boost_threshold1,
        curvature_threshold2=p.boost_threshold2)
    tick("3 ridge boost", t0)

    t0 = time.process_time()
    _, fp, ew = smoothness.build_smoothness_graph(
        v, f, Cmax, rs, curvature_threshold=p.curvature_threshold_mid,
        curvature_high_threshold=p.curvature_threshold_high)
    tick("4 smoothness graph", t0)

    rng = RecordingRng(p.seed)
    t0 = time.process_time()
    L, VL, centers = clustering.geodesic_clustering(
        v, f, Cmax, Wc=p.speed_weights,
        curvature_thresholds=(p.curvature_threshold_low, p.curvature_threshold_mid,
                              p.curvature_threshold_high),
        neighborhood_geo_distance=p.neighborhood_geo_distance,
        max_clusters=p.max_clusters, rng=rng)
    tick("5 geodesic clustering", t0)

    t0 = time.process_time()
    ML = merging.merge_clusters(v, f, Cmax, L,
                                ridge_curvature_low=p.ridge_curvature_low,
                                ridge_high_curvature_ratio=p.ridge_high_curvature_ratio)
    tick("6 merge", t0)

    # record every energy evaluation to recover the final (uncompacted) energy
    energies = []
    orig_energy = graphcut._energy

    def rec_energy(*a, **k):
        e = orig_energy(*a, **k)
        energies.append(float(e))
        return e

    graphcut._energy = rec_energy
    t0 = time.process_time()
    GL = graphcut.alpha_expansion_potts(ML, fp, ew, data_cost=p.data_cost,
                                        smooth_cost=p.smooth_cost, verbose=False)
    tick("7 graph cut", t0)
    graphcut._energy = orig_energy
    E = energies[0]
    for e in energies[1:]:
        if e < E - 1e-9:
            E = e

    t0 = time.process_time()
    GL2 = merging.merge_small_final(GL, fp, p.min_scar_faces) \
        if p.min_scar_faces > 0 else GL
    tick("7b small-scar cleanup", t0)

    t0 = time.process_time()
    pred_dec_vertex = majority_vertex_labels(f, GL2, len(v_raw))
    _, nearest = cKDTree(v_raw).query(v_full, k=1)
    pred_full_vertex = pred_dec_vertex[nearest]
    tick("8 label transfer", t0)

    save(args.out_dir, "v", v, "f64")
    save(args.out_dir, "f", f, "i32")
    save(args.out_dir, "Cmin", Cmin, "f64")
    save(args.out_dir, "Cmax_raw", Cmax_raw, "f64")
    save(args.out_dir, "Umax", Umax, "f64")
    save(args.out_dir, "Cmax", Cmax, "f64")
    save(args.out_dir, "crest_idx", crest_idx, "i32")
    save(args.out_dir, "crest_edges", rs.edges, "i32")
    save(args.out_dir, "fp", fp, "i32")
    save(args.out_dir, "ew", ew, "f64")
    save(args.out_dir, "VL", VL, "i32")
    save(args.out_dir, "L", L, "i32")
    save(args.out_dir, "centers", centers, "i32")
    save(args.out_dir, "ML", ML, "i32")
    save(args.out_dir, "GL", GL, "i32")
    save(args.out_dir, "GL2", GL2, "i32")
    save(args.out_dir, "pred_dec_vertex", pred_dec_vertex, "i32")
    if decimated:
        save(args.out_dir, "v_raw", v_raw, "f64")
        save(args.out_dir, "v_full", v_full, "f64")
        save(args.out_dir, "f_full", f_full, "i32")
    save(args.out_dir, "pred_full_vertex", pred_full_vertex, "i32")

    meta = dict(
        mesh=os.path.basename(args.mesh), numpy=np.__version__,
        trimesh=trimesh.__version__,
        nv_ply=int(len(v_ply)), nf_ply=int(len(f_ply)),
        nv_full=int(len(v_full)), nf_full=int(len(f_full)),
        decimated=decimated, target=args.target,
        nv=int(len(v)), nf=int(len(f)), mean_edge=float(h), cmax_scale=float(scale),
        vsize=float(v[:, 0].max() - v[:, 0].min()),
        params=dict(seed=p.seed, min_scar_faces=p.min_scar_faces,
                    data_cost=p.data_cost, smooth_cost=p.smooth_cost),
        n_crest_points=int(len(rs.points)), n_crest_edges=int(len(rs.edges)),
        n_face_pairs=int(len(fp)),
        n_clusters=int(L.max()), n_merged=int(ML.max()), n_graphcut=int(GL.max()),
        n_final=int(GL2.max()),
        energy_initial=energies[0], energy_final=E, n_energy_evals=len(energies),
        rng_draws=rng.draws, cpu_seconds=T,
    )
    with open(os.path.join(args.out_dir, "meta.json"), "w") as fh:
        json.dump(meta, fh, indent=1)
    print(json.dumps({k: meta[k] for k in meta if k != "rng_draws"}, indent=1))


if __name__ == "__main__":
    main()
