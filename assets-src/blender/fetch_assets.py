"""Download the CC0 Poly Haven sources used by build_dive_bar.py into ./downloads/.

Runs under plain Python 3 or inside Blender (stdlib only). Files that already exist are skipped,
so it's safe to call on every build. Every asset listed here must also appear in
assets-src/LICENSES.md.

    python3 assets-src/blender/fetch_assets.py
"""

import json
import os
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
DOWNLOADS = os.path.join(HERE, "downloads")
API = "https://api.polyhaven.com/files/"
UA = {"User-Agent": "inuman-asset-build/1.0 (CC0 Poly Haven fetch)"}

# id -> (resolution, maps). Maps are Poly Haven file-API keys.
TEXTURES = {
    "wood_table_worn": ("1k", ["Diffuse", "Rough", "nor_gl"]),  # Table (realtime PBR, <=1024)
    "dirty_tiles": ("2k", ["Diffuse", "Rough", "nor_gl"]),  # floor
    "painted_plaster_wall": ("2k", ["Diffuse", "Rough", "nor_gl"]),  # upper walls, ceiling
    "wood_plank_wall": ("2k", ["Diffuse", "Rough", "nor_gl"]),  # wainscot
    "wooden_panels": ("2k", ["Diffuse", "Rough", "nor_gl"]),  # bar counter front
    "dark_wood": ("2k", ["Diffuse", "Rough", "nor_gl"]),  # counter top, shelves
    "dark_wooden_planks": ("1k", ["Diffuse", "Rough", "nor_gl"]),  # back-bar shelves, cabinet
}
MODELS = {
    "plastic_monobloc_chair_01": "1k",
    "plastic_crate_02": "1k",
    "Television_01": "1k",
    "painted_wooden_stool": "1k",
}
HDRIS = {"warm_bar": "1k"}


def _get(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def _save(url, dest):
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return False
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    data = _get(url)
    tmp = dest + ".part"
    with open(tmp, "wb") as f:
        f.write(data)
    os.replace(tmp, dest)
    print(f"[fetch] {os.path.relpath(dest, DOWNLOADS)} ({len(data) // 1024} KB)")
    return True


def _files(asset_id):
    return json.loads(_get(API + asset_id))


def fetch_all():
    os.makedirs(DOWNLOADS, exist_ok=True)
    for asset_id, (res, maps) in TEXTURES.items():
        wanted = [os.path.join(DOWNLOADS, "textures", asset_id, f"{asset_id}_{m}_{res}.jpg") for m in maps]
        if all(os.path.exists(p) for p in wanted):
            continue
        files = _files(asset_id)
        for m, dest in zip(maps, wanted):
            _save(files[m][res]["jpg"]["url"], dest)
    for asset_id, res in MODELS.items():
        root = os.path.join(DOWNLOADS, "models", asset_id)
        gltf_path = os.path.join(root, f"{asset_id}_{res}.gltf")
        if os.path.exists(gltf_path):
            continue
        entry = _files(asset_id)["gltf"][res]["gltf"]
        for rel, info in entry.get("include", {}).items():
            _save(info["url"], os.path.join(root, rel))
        _save(entry["url"], gltf_path)
    for asset_id, res in HDRIS.items():
        dest = os.path.join(DOWNLOADS, "hdris", f"{asset_id}_{res}.hdr")
        if os.path.exists(dest):
            continue
        _save(_files(asset_id)["hdri"][res]["hdr"]["url"], dest)
    return DOWNLOADS


if __name__ == "__main__":
    fetch_all()
    print("[fetch] done ->", DOWNLOADS)
    sys.exit(0)
