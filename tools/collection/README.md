# Collection build

Builds the public mesh collection read by the Collection tab
(`src/components/collectionPanel.js`): annotated Neurolithic PLYs, thumbnails
and `catalogue.json`, published as a Hugging Face dataset.

1. `python build_collection.py --out OUT_DIR [--per-site N] [--sites fumane,cala]`
   writes `meshes/`, `catalogue.json` and the dataset card `README.md`. Every
   mesh's hand-drawn edge labels are checked against `all_data.h5`; the build
   stops if they do not reproduce it.
2. Serve the built client and `OUT_DIR` (with CORS), then
   `node render_thumbs.mjs APP_URL COLLECTION_URL RAW_DIR` and
   `python crop_thumbs.py RAW_DIR OUT_DIR`.
3. Run step 1 again so the catalogue lists the thumbnails.
4. Upload `OUT_DIR` to the dataset repository, then pin the client to that
   commit (`DEFAULT_COLLECTION_URL`).

Only sets whose raw scans are published under an open license belong here;
`SITES` in `build_collection.py` records each source, its DOI and license.
