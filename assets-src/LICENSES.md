# Third-party asset licenses

Every third-party asset used to build the shipped files in `public/assets/` is listed here.
Only CC0 sources are allowed. Downloads are fetched by `assets-src/blender/fetch_assets.py`
into `assets-src/blender/downloads/` (gitignored).

## Environment: dive bar (`public/assets/env/dive-bar/`)

All entries below are from [Poly Haven](https://polyhaven.com) under **CC0 1.0** (public domain,
no attribution required; credited anyway).

| Asset | Type | Used for | Source URL | License | Author(s) |
|---|---|---|---|---|---|
| Warm Bar (`warm_bar`, 1k HDR) | HDRI | `env.hdr` (reflections on mid/high tiers), unmodified | https://polyhaven.com/a/warm_bar | CC0 | Greg Zaal (photography), Jarod Guest (processing) |
| Wood Table Worn (`wood_table_worn`, 1k) | Texture | Table: base colour (graded darker/less saturated), roughness, normal | https://polyhaven.com/a/wood_table_worn | CC0 | Dimitrios Savva (photography), Rico Cilliers (processing) |
| Dirty Tiles (`dirty_tiles`, 2k) | Texture | Floor (baked) | https://polyhaven.com/a/dirty_tiles | CC0 | Matterfield (photography), Jenelle van Heerden (processing) |
| Painted Plaster Wall (`painted_plaster_wall`, 2k) | Texture | Upper walls, ceiling (tinted, baked) | https://polyhaven.com/a/painted_plaster_wall | CC0 | Amal Kumar |
| Wood Plank Wall (`wood_plank_wall`, 2k) | Texture | Wainscot (baked) | https://polyhaven.com/a/wood_plank_wall | CC0 | Dimitrios Savva |
| Wooden Panels (`wooden_panels`, 2k) | Texture | Bar counter front (baked) | https://polyhaven.com/a/wooden_panels | CC0 | Dimitrios Savva |
| Dark Wood (`dark_wood`, 2k) | Texture | Counter top, back-bar shelves (baked) | https://polyhaven.com/a/dark_wood | CC0 | Dario Barresi (baking), Dimitrios Savva (photography), Rico Cilliers (tiling) |
| Dark Wooden Planks (`dark_wooden_planks`, 1k) | Texture | Back-bar cabinet, videoke cabinet (baked) | https://polyhaven.com/a/dark_wooden_planks | CC0 | Amal Kumar |
| Plastic Monobloc Chair 01 (`plastic_monobloc_chair_01`, 1k glTF) | Model | Chairs (tinted, baked) | https://polyhaven.com/a/plastic_monobloc_chair_01 | CC0 | Kuutti Siitonen |
| Plastic Crate 02 (`plastic_crate_02`, 1k glTF) | Model | Beer crates (decimated, baked) | https://polyhaven.com/a/plastic_crate_02 | CC0 | Fabi_G |
| Television 01 (`Television_01`, 1k glTF) | Model | Videoke TV (baked) | https://polyhaven.com/a/Television_01 | CC0 | Gabriel Radić |
| Painted Wooden Stool (`painted_wooden_stool`, 1k glTF) | Model | Stool with ice bucket (baked) | https://polyhaven.com/a/painted_wooden_stool | CC0 | Kirill Sannikov |

Original work (no third-party licence): everything else in the scene is modelled procedurally
in `assets-src/blender/build_dive_bar.py`, including the room, bar counter, back bar, bottles
(generic, no labels or brands), chiller, videoke cabinet and speaker, pendant lamp, and the
"INUMAN" neon sign.
