"""Inuman "dive bar" environment: build from scratch, bake, export.

Headless only:
    scripts/blender-run.sh assets-src/blender/build_dive_bar.py [options]

Options (all optional):
    --stage design|bake|all  design = build + preview renders + save .blend (no bake)
                             bake/all = build + bake + denoise + export raw GLB + save .blend
    --samples N              Cycles samples for the lighting bake (default 512, OIDN-denoised after)
    --atlas N                atlas resolution (default 2048)
    --preview-dir DIR        where design / bake preview PNGs go (Windows path). Default: ./previews
    --preview-samples N      samples for design previews (default 48)

Coordinates: Blender is Z-up; the glTF exporter converts to Y-up, so Blender (x, y, z) -> glTF (x, z, -y).
The table top surface is at z = 0 (glTF y = 0), centred on the origin, long side along X.
The floor is at z = -0.75. The player's camera sits at Blender (0, -0.85, 0.95), looking toward +Y.

Outputs:
    assets-src/blender/export/dive-bar.raw.glb       unoptimised export (input to scripts/build-assets.mjs)
    assets-src/blender/bake/dive-bar_atlas.png       final baked atlas (linear radiance, sRGB-encoded; gitignored)
    assets-src/blender/dive_bar.blend                authoring scene + baked export objects
    public/assets/env/dive-bar/env.hdr               1k reflection HDRI (Poly Haven warm_bar)
"""

import bmesh
import bpy
import json
import math
import os
import random
import shutil
import sys
import time
import warnings

import numpy as np
from mathutils import Matrix, Vector

warnings.filterwarnings("ignore", category=DeprecationWarning)

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
DL = os.path.join(HERE, "downloads")
EXPORT_DIR = os.path.join(HERE, "export")
BAKE_DIR = os.path.join(HERE, "bake")
PUBLIC_DIR = os.path.join(REPO, "public", "assets", "env", "dive-bar")
BLEND_PATH = os.path.join(HERE, "dive_bar.blend")

FLOOR = -0.75
CEIL = 2.05
ROOM_X = (-2.4, 2.4)
ROOM_Y = (-2.0, 2.8)
COUNTER_FRONT_Y = 1.35
COUNTER_TOP_Z = 0.30
LAMP_BULB = Vector((0.0, 0.0, 0.80))  # bulb centre, glTF (0, 0.80, 0)
KEY_LIGHT_POS = LAMP_BULB - Vector((0, 0, 0.056))  # just under the bulb mesh, glTF (0, 0.744, 0)
KEY_LIGHT_K = 2700
KEY_LIGHT_W = 45.0
# Television_01 screen rectangle in model-local space (x centre, y offset from front, z above base)
TV_SCREEN = dict(x=-0.065, y=-0.004, z=0.235, w=0.40, h=0.30)

# glTF camera contract (Y-up) -> Blender (Z-up)
CAMERAS = {
    "portrait": dict(pos=(0, 0.95, 0.85), target=(0, 0, -0.05), fov=50, res=(277, 600)),
    "landscape": dict(pos=(0, 1.0, 1.1), target=(0, 0, -0.05), fov=50, res=(1067, 600)),
    "seated": dict(pos=(0, 0.45, 1.05), target=(0, 0.25, -1.5), fov=60, res=(1067, 600)),
    "overview": dict(pos=(2.1, 1.6, 1.7), target=(-0.4, -0.2, -0.6), fov=70, res=(1067, 600)),
}


def gl2bl(v):
    x, y, z = v
    return Vector((x, -z, y))


# --------------------------------------------------------------------------------------------
# args
# --------------------------------------------------------------------------------------------
def parse_args():
    a = sys.argv[1:]
    opts = {
        "stage": "all",
        "samples": 512,
        "atlas": 2048,
        "preview_dir": os.path.join(HERE, "previews"),
        "preview_samples": 48,
    }
    i = 0
    while i < len(a):
        k = a[i].lstrip("-").replace("-", "_")
        if k in opts and i + 1 < len(a):
            v = a[i + 1]
            opts[k] = int(v) if isinstance(opts[k], int) else v
            i += 2
        else:
            i += 1
    return opts


def log(*args):
    print(f"[dive-bar {time.strftime('%H:%M:%S')}]", *args, flush=True)


# --------------------------------------------------------------------------------------------
# scene / render setup
# --------------------------------------------------------------------------------------------
def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.unit_settings.system = "METRIC"
    sc.unit_settings.scale_length = 1.0
    world = bpy.data.worlds.new("World")
    sc.world = world
    world.use_nodes = True
    bg = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
    bg.inputs["Color"].default_value = (0.02, 0.012, 0.008, 1)
    bg.inputs["Strength"].default_value = 0.0
    return sc


def setup_cycles(sc, samples):
    try:
        sc.render.engine = "CYCLES"
    except TypeError as e:
        raise RuntimeError(f"Cycles unavailable: {e}")
    prefs = bpy.context.preferences.addons["cycles"].preferences
    chosen = None
    for kind in ("OPTIX", "CUDA"):
        try:
            prefs.compute_device_type = kind
        except TypeError:
            continue
        prefs.get_devices()
        devs = [d for d in prefs.devices if d.type == kind]
        if devs:
            for d in prefs.devices:
                d.use = d.type == kind
            chosen = kind
            break
    sc.cycles.device = "GPU" if chosen else "CPU"
    log("cycles device:", chosen or "CPU")
    sc.cycles.samples = samples
    sc.cycles.use_adaptive_sampling = True
    sc.cycles.adaptive_threshold = 0.01
    sc.cycles.max_bounces = 8
    sc.cycles.diffuse_bounces = 4
    sc.cycles.glossy_bounces = 3
    sc.cycles.transmission_bounces = 6
    sc.cycles.transparent_max_bounces = 8
    sc.cycles.sample_clamp_indirect = 8.0
    sc.cycles.blur_glossy = 1.0
    sc.cycles.caustics_reflective = False
    sc.cycles.caustics_refractive = False
    sc.cycles.use_denoising = True
    sc.cycles.denoiser = "OPENIMAGEDENOISE"
    sc.view_settings.view_transform = "AgX"
    sc.view_settings.look = "None"
    sc.view_settings.exposure = 0.0
    sc.render.film_transparent = False


# --------------------------------------------------------------------------------------------
# materials
# --------------------------------------------------------------------------------------------
_img_cache = {}


def load_img(path, non_color=False):
    key = (path, non_color)
    if key in _img_cache:
        return _img_cache[key]
    img = bpy.data.images.load(path, check_existing=True)
    if non_color:
        img.colorspace_settings.name = "Non-Color"
    _img_cache[key] = img
    return img


def tex(asset, m, res):
    return os.path.join(DL, "textures", asset, f"{asset}_{m}_{res}.jpg")


def new_material(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    return m, nt, out


def mix_color_node(nt, blend="MULTIPLY", fac=1.0):
    n = nt.nodes.new("ShaderNodeMix")
    n.data_type = "RGBA"
    n.blend_type = blend
    n.inputs[0].default_value = fac
    a = next(s for s in n.inputs if s.name == "A" and s.type == "RGBA")
    b = next(s for s in n.inputs if s.name == "B" and s.type == "RGBA")
    o = next(s for s in n.outputs if s.type == "RGBA")
    return n, a, b, o


def pbr_material(name, asset, res, tint=None, rough_add=0.0, normal_strength=1.0, value=1.0, sat=1.0, metallic=0.0):
    m, nt, out = new_material(name)
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(bsdf.outputs[0], out.inputs[0])
    uv = nt.nodes.new("ShaderNodeUVMap")
    uv.uv_map = "UVMap"
    td = nt.nodes.new("ShaderNodeTexImage")
    td.image = load_img(tex(asset, "Diffuse", res))
    nt.links.new(uv.outputs[0], td.inputs[0])
    col = td.outputs[0]
    if sat != 1.0 or value != 1.0:
        hsv = nt.nodes.new("ShaderNodeHueSaturation")
        hsv.inputs["Saturation"].default_value = sat
        hsv.inputs["Value"].default_value = value
        nt.links.new(col, hsv.inputs["Color"])
        col = hsv.outputs[0]
    if tint is not None:
        _, a, b, o = mix_color_node(nt, "MULTIPLY")
        nt.links.new(col, a)
        b.default_value = (*tint, 1)
        col = o
    nt.links.new(col, bsdf.inputs["Base Color"])
    tr = nt.nodes.new("ShaderNodeTexImage")
    tr.image = load_img(tex(asset, "Rough", res), True)
    nt.links.new(uv.outputs[0], tr.inputs[0])
    if rough_add:
        add = nt.nodes.new("ShaderNodeMath")
        add.operation = "ADD"
        add.use_clamp = True
        add.inputs[1].default_value = rough_add
        nt.links.new(tr.outputs[0], add.inputs[0])
        nt.links.new(add.outputs[0], bsdf.inputs["Roughness"])
    else:
        nt.links.new(tr.outputs[0], bsdf.inputs["Roughness"])
    tn = nt.nodes.new("ShaderNodeTexImage")
    tn.image = load_img(tex(asset, "nor_gl", res), True)
    nt.links.new(uv.outputs[0], tn.inputs[0])
    nm = nt.nodes.new("ShaderNodeNormalMap")
    nm.uv_map = "UVMap"
    nm.inputs["Strength"].default_value = normal_strength
    nt.links.new(tn.outputs[0], nm.inputs["Color"])
    nt.links.new(nm.outputs[0], bsdf.inputs["Normal"])
    bsdf.inputs["Metallic"].default_value = metallic
    return m


def flat_material(name, color, rough=0.5, metallic=0.0, spec=0.5, coat=0.0):
    m, nt, out = new_material(name)
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(bsdf.outputs[0], out.inputs[0])
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Specular IOR Level"].default_value = spec
    bsdf.inputs["Coat Weight"].default_value = coat
    m.diffuse_color = (*color, 1)
    return m


def emissive_material(name, color, light_strength, camera_strength=1.0, base=None):
    """Emitter that lights the scene with `light_strength` but bakes/renders to camera at
    `camera_strength`, so its own atlas texels stay in [0, 1] with a saturated hue."""
    m, nt, out = new_material(name)
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = (*color, 1)
    lp = nt.nodes.new("ShaderNodeLightPath")
    mad = nt.nodes.new("ShaderNodeMath")
    mad.operation = "MULTIPLY_ADD"
    mad.inputs[1].default_value = camera_strength - light_strength
    mad.inputs[2].default_value = light_strength
    nt.links.new(lp.outputs["Is Camera Ray"], mad.inputs[0])
    nt.links.new(mad.outputs[0], em.inputs["Strength"])
    nt.links.new(em.outputs[0], out.inputs[0])
    m.diffuse_color = (*color, 1)
    return m


def screen_material(name, light_strength=4.0):
    """Videoke screen: blue gradient with lyric bars, procedural (no text, no logos)."""
    m, nt, out = new_material(name)
    uvn = nt.nodes.new("ShaderNodeUVMap")
    uvn.uv_map = "UVMap"
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(uvn.outputs[0], sep.inputs[0])
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (0.02, 0.05, 0.35, 1)
    ramp.color_ramp.elements[1].color = (0.25, 0.05, 0.45, 1)
    nt.links.new(sep.outputs["Y"], ramp.inputs[0])
    # lyric bars: |v - c| < h for two rows, x in [x0, x1]
    col = ramp.outputs[0]
    for (vc, x0, x1, c) in ((0.34, 0.12, 0.88, (0.95, 0.95, 1.0)), (0.2, 0.2, 0.7, (1.0, 0.85, 0.3))):
        d = nt.nodes.new("ShaderNodeMath")
        d.operation = "SUBTRACT"
        d.inputs[1].default_value = vc
        nt.links.new(sep.outputs["Y"], d.inputs[0])
        ab = nt.nodes.new("ShaderNodeMath")
        ab.operation = "ABSOLUTE"
        nt.links.new(d.outputs[0], ab.inputs[0])
        lt = nt.nodes.new("ShaderNodeMath")
        lt.operation = "LESS_THAN"
        lt.inputs[1].default_value = 0.035
        nt.links.new(ab.outputs[0], lt.inputs[0])
        gx0 = nt.nodes.new("ShaderNodeMath")
        gx0.operation = "GREATER_THAN"
        gx0.inputs[1].default_value = x0
        nt.links.new(sep.outputs["X"], gx0.inputs[0])
        lx1 = nt.nodes.new("ShaderNodeMath")
        lx1.operation = "LESS_THAN"
        lx1.inputs[1].default_value = x1
        nt.links.new(sep.outputs["X"], lx1.inputs[0])
        m1 = nt.nodes.new("ShaderNodeMath")
        m1.operation = "MULTIPLY"
        nt.links.new(lt.outputs[0], m1.inputs[0])
        nt.links.new(gx0.outputs[0], m1.inputs[1])
        m2 = nt.nodes.new("ShaderNodeMath")
        m2.operation = "MULTIPLY"
        nt.links.new(m1.outputs[0], m2.inputs[0])
        nt.links.new(lx1.outputs[0], m2.inputs[1])
        mx, a, b, o = mix_color_node(nt, "MIX")
        nt.links.new(m2.outputs[0], mx.inputs[0])
        nt.links.new(col, a)
        b.default_value = (*c, 1)
        col = o
    em = nt.nodes.new("ShaderNodeEmission")
    nt.links.new(col, em.inputs["Color"])
    lp = nt.nodes.new("ShaderNodeLightPath")
    mad = nt.nodes.new("ShaderNodeMath")
    mad.operation = "MULTIPLY_ADD"
    mad.inputs[1].default_value = 0.85 - light_strength
    mad.inputs[2].default_value = light_strength
    nt.links.new(lp.outputs["Is Camera Ray"], mad.inputs[0])
    nt.links.new(mad.outputs[0], em.inputs["Strength"])
    nt.links.new(em.outputs[0], out.inputs[0])
    return m


def tint_imported(ob, rgb, value=1.0):
    """Multiply an imported glTF material's base colour (baked only, so node edits are fine)."""
    for m in ob.data.materials:
        nt = m.node_tree
        bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
        sock = bsdf.inputs["Base Color"]
        if not sock.is_linked:
            sock.default_value = tuple(c * t * value for c, t in zip(sock.default_value[:3], rgb)) + (1,)
            continue
        src = sock.links[0].from_socket
        _, a, b, o = mix_color_node(nt, "MULTIPLY")
        nt.links.new(src, a)
        b.default_value = (rgb[0] * value, rgb[1] * value, rgb[2] * value, 1)
        nt.links.new(o, sock)


def build_materials():
    M = {}
    M["floor"] = pbr_material("Floor_Tiles", "dirty_tiles", "2k", value=0.85, rough_add=-0.05)
    M["plaster"] = pbr_material("Wall_Plaster", "painted_plaster_wall", "2k", tint=(0.55, 0.78, 0.66), normal_strength=0.6)
    M["ceiling"] = pbr_material("Ceiling_Plaster", "painted_plaster_wall", "2k", tint=(0.8, 0.78, 0.72), normal_strength=0.4)
    M["wainscot"] = pbr_material("Wall_Wainscot", "wood_plank_wall", "2k", tint=(1.0, 0.85, 0.7), normal_strength=0.8)
    M["counter_front"] = pbr_material("Counter_Panels", "wooden_panels", "2k", value=0.9)
    M["dark_wood"] = pbr_material("Dark_Wood", "dark_wood", "2k", value=0.8)
    M["planks"] = pbr_material("Shelf_Planks", "dark_wooden_planks", "1k", tint=(1.0, 0.8, 0.6))
    M["trim"] = flat_material("Trim_DarkWood", (0.06, 0.03, 0.015), rough=0.45)
    M["black"] = flat_material("Black_Plastic", (0.015, 0.015, 0.016), rough=0.4)
    M["acrylic"] = flat_material("Neon_Backboard", (0.01, 0.01, 0.012), rough=0.15, spec=0.6)
    M["metal"] = flat_material("Brushed_Steel", (0.6, 0.6, 0.62), rough=0.3, metallic=1.0)
    M["brass"] = flat_material("Brass", (0.75, 0.55, 0.25), rough=0.3, metallic=1.0)
    M["fridge_white"] = flat_material("Fridge_Enamel", (0.72, 0.72, 0.7), rough=0.35)
    M["fridge_red"] = flat_material("Fridge_Red", (0.45, 0.03, 0.03), rough=0.4)
    M["fridge_inner"] = flat_material("Fridge_Interior", (0.8, 0.82, 0.85), rough=0.5)
    M["shade_out"] = flat_material("Lamp_Shade_Outer", (0.03, 0.16, 0.09), rough=0.35, coat=0.6)
    M["shade_in"] = flat_material("Lamp_Shade_Inner", (0.85, 0.82, 0.75), rough=0.4)
    M["glass_amber"] = flat_material("Glass_Amber", (0.20, 0.07, 0.012), rough=0.1, spec=0.8, coat=0.3)
    M["glass_green"] = flat_material("Glass_Green", (0.02, 0.13, 0.04), rough=0.1, spec=0.8, coat=0.3)
    M["glass_clear"] = flat_material("Glass_Liquor", (0.22, 0.1, 0.025), rough=0.1, spec=0.8, coat=0.3)
    M["glass_gin"] = flat_material("Glass_Gin", (0.1, 0.14, 0.13), rough=0.1, spec=0.8, coat=0.3)
    M["cap_gold"] = flat_material("Cap_Gold", (0.7, 0.5, 0.15), rough=0.35, metallic=1.0)
    M["cap_silver"] = flat_material("Cap_Silver", (0.6, 0.6, 0.6), rough=0.35, metallic=1.0)
    M["cap_red"] = flat_material("Cap_Red", (0.4, 0.03, 0.02), rough=0.4)
    M["neon_pink"] = emissive_material("Neon_Pink", (1.0, 0.07, 0.42), light_strength=60.0, camera_strength=1.0)
    M["neon_amber"] = emissive_material("Neon_Amber", (1.0, 0.42, 0.04), light_strength=30.0, camera_strength=1.0)
    M["bulb"] = emissive_material("Lamp_Bulb", (1.0, 0.72, 0.42), light_strength=8.0, camera_strength=1.0)
    M["fridge_light"] = emissive_material("Fridge_Light", (0.85, 0.93, 1.0), light_strength=6.0, camera_strength=1.0)
    M["led_amber"] = emissive_material("LED_Amber", (1.0, 0.55, 0.18), light_strength=8.0, camera_strength=1.0)
    M["vk_led"] = emissive_material("Videoke_LED", (0.1, 1.0, 0.3), light_strength=2.0, camera_strength=0.9)
    M["screen"] = screen_material("Videoke_Screen", light_strength=5.0)
    return M


# --------------------------------------------------------------------------------------------
# geometry helpers
# --------------------------------------------------------------------------------------------
def coll(name, parent=None):
    c = bpy.data.collections.get(name) or bpy.data.collections.new(name)
    if c.name not in [x.name for x in (parent or bpy.context.scene.collection).children]:
        (parent or bpy.context.scene.collection).children.link(c)
    return c


AUTH = None  # authoring collection


def obj_from_bm(name, bm, mats, weight=1.0, smooth=False):
    me = bpy.data.meshes.new(name)
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    ob = bpy.data.objects.new(name, me)
    AUTH.objects.link(ob)
    ob["lm_weight"] = weight
    if smooth:
        for p in me.polygons:
            p.use_smooth = True
    return ob


SKIP = frozenset()


def bm_box(bm, mn, mx, mat=0, skip=SKIP):
    """Axis-aligned box. skip: subset of {'-x','+x','-y','+y','-z','+z'} faces to omit."""
    x0, y0, z0 = mn
    x1, y1, z1 = mx
    co = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0), (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
    v = [bm.verts.new(c) for c in co]
    faces = {"-z": (0, 3, 2, 1), "+z": (4, 5, 6, 7), "-y": (0, 1, 5, 4), "+x": (1, 2, 6, 5), "+y": (2, 3, 7, 6), "-x": (3, 0, 4, 7)}
    out = []
    for k, f in faces.items():
        if k in skip:
            continue
        face = bm.faces.new([v[i] for i in f])
        face.material_index = mat
        out.append(face)
    return out


def bm_quad(bm, corners, mat=0):
    vs = [bm.verts.new(c) for c in corners]
    f = bm.faces.new(vs)
    f.material_index = mat
    return f


def lathe_bm(bm, profile, segs, mat_of_band=None, offset=(0, 0, 0), phase=0.0):
    """Surface of revolution around Z. profile: [(r, z), ...] bottom to top; r == 0 closes a pole."""
    ox, oy, oz = offset
    rings = []
    made = []
    uvl = bm.loops.layers.uv.get("Lightmap") or bm.loops.layers.uv.new("Lightmap")
    cust = bm.faces.layers.int.get("lm_custom") or bm.faces.layers.int.new("lm_custom")
    circ = 2 * math.pi * max(r for r, _ in profile)
    arc_len = [0.0]
    for (r0, z0), (r1, z1) in zip(profile, profile[1:]):
        arc_len.append(arc_len[-1] + math.hypot(r1 - r0, z1 - z0))
    for r, z in profile:
        if r < 1e-6:
            rings.append([bm.verts.new((ox, oy, oz + z))])
        else:
            rings.append([
                bm.verts.new((ox + r * math.cos(phase + 2 * math.pi * i / segs), oy + r * math.sin(phase + 2 * math.pi * i / segs), oz + z))
                for i in range(segs)
            ])
    for k in range(len(rings) - 1):
        A, B = rings[k], rings[k + 1]
        mi = mat_of_band(k) if mat_of_band else 0
        for i in range(segs):
            j = (i + 1) % segs
            if len(A) == 1 and len(B) == 1:
                continue
            ui, uj, um = circ * i / segs, circ * (i + 1) / segs, circ * (i + 0.5) / segs
            va, vb = arc_len[k], arc_len[k + 1]
            if len(A) == 1:
                f = bm.faces.new((A[0], B[j], B[i]))
                uvs = ((um, va), (uj, vb), (ui, vb))
            elif len(B) == 1:
                f = bm.faces.new((A[i], A[j], B[0]))
                uvs = ((ui, va), (uj, va), (um, vb))
            else:
                f = bm.faces.new((A[i], A[j], B[j], B[i]))
                uvs = ((ui, va), (uj, va), (uj, vb), (ui, vb))
            for loop, uv in zip(f.loops, uvs):
                loop[uvl].uv = uv
            f[cust] = 1
            f.material_index = mi
            f.smooth = True
    for r in rings:
        made.extend(r)
    return made


def sweep_tube_bm(bm, pts, radius, sides=8, mat=0, cyclic=False):
    """Round tube along a 3D polyline (mitred rings) with a single-strip lightmap UV."""
    uvl = bm.loops.layers.uv.get("Lightmap") or bm.loops.layers.uv.new("Lightmap")
    cust = bm.faces.layers.int.get("lm_custom") or bm.faces.layers.int.new("lm_custom")
    P = [Vector(p) for p in pts]
    if cyclic and (P[0] - P[-1]).length < 1e-9:
        P = P[:-1]
    n = len(P)
    tangents = []
    for i in range(n):
        if cyclic:
            a, b = P[i - 1], P[(i + 1) % n]
            t = (P[i] - a).normalized() + (b - P[i]).normalized()
        else:
            t = (P[min(i + 1, n - 1)] - P[max(i - 1, 0)])
        tangents.append(t.normalized())
    ref = Vector((0, 1, 0))  # tubes lie roughly in the XZ plane: keep the ring frame stable
    rings = []
    for p, t in zip(P, tangents):
        u = ref.cross(t)
        if u.length < 1e-6:
            u = Vector((1, 0, 0)).cross(t)
        u.normalize()
        v = t.cross(u).normalized()
        rings.append([bm.verts.new(p + radius * (math.cos(2 * math.pi * k / sides) * u + math.sin(2 * math.pi * k / sides) * v)) for k in range(sides)])
    s_len = [0.0]
    for i in range(1, n + (1 if cyclic else 0)):
        s_len.append(s_len[-1] + (P[i % n] - P[i - 1]).length)
    circ = 2 * math.pi * radius
    segs = n if cyclic else n - 1
    for i in range(segs):
        A, B = rings[i], rings[(i + 1) % n]
        for k in range(sides):
            kk = (k + 1) % sides
            f = bm.faces.new((A[k], A[kk], B[kk], B[k]))
            f.material_index = mat
            f.smooth = True
            f[cust] = 1
            for loop, uv in zip(f.loops, ((s_len[i], circ * k / sides), (s_len[i], circ * (k + 1) / sides), (s_len[i + 1], circ * (k + 1) / sides), (s_len[i + 1], circ * k / sides))):
                loop[uvl].uv = uv
    if not cyclic:
        for ring, sgn, sv in ((rings[0], -1, s_len[0]), (rings[-1], 1, s_len[-1])):
            vs = ring if sgn > 0 else ring[::-1]
            f = bm.faces.new(vs)
            f.material_index = mat
            f[cust] = 1
            for loop in f.loops:  # caps collapse onto the strip end (no extra islands)
                loop[uvl].uv = (sv, circ * ring.index(loop.vert) / sides)


def box_uv(ob, scale=1.0, uv_name="UVMap", rotate=False, offset=(0.0, 0.0)):
    """World-space box projection so tiled textures keep real-world size across objects."""
    me = ob.data
    if uv_name not in me.uv_layers:
        me.uv_layers.new(name=uv_name)
    uvl = me.uv_layers[uv_name].data
    mw = ob.matrix_world
    nm = mw.to_3x3().inverted().transposed()
    for poly in me.polygons:
        n = (nm @ poly.normal).normalized()
        ax = max(range(3), key=lambda i: abs(n[i]))
        for li in poly.loop_indices:
            co = mw @ me.vertices[me.loops[li].vertex_index].co
            if ax == 0:
                u, v = (co.y if n.x > 0 else -co.y), co.z
            elif ax == 1:
                u, v = (-co.x if n.y > 0 else co.x), co.z
            else:
                u, v = co.x, (co.y if n.z > 0 else -co.y)
            if rotate:
                u, v = v, -u
            uvl[li].uv = (u / scale + offset[0], v / scale + offset[1])


def import_model(model_id):
    path = os.path.join(DL, "models", model_id, f"{model_id}_1k.gltf")
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in new if o.type == "MESH"]
    for o in new:
        for c in list(o.users_collection):
            c.objects.unlink(o)
    proto = meshes[0]
    proto.parent = None
    for o in new:
        if o is not proto:
            bpy.data.objects.remove(o)
    return proto


def place_instance(proto, name, loc, rot_z_deg=0.0, weight=1.0, scale=1.0, tilt=(0.0, 0.0)):
    ob = proto.copy()
    ob.name = name
    AUTH.objects.link(ob)
    ob.rotation_euler = (math.radians(tilt[0]), math.radians(tilt[1]), math.radians(rot_z_deg))
    ob.scale = (scale, scale, scale)
    # put the lowest vertex on loc.z
    zmin = min((Vector(c).z for c in proto.bound_box))
    ob.location = (loc[0], loc[1], loc[2] - zmin * scale)
    ob["lm_weight"] = weight
    ob["lm_from_uvmap"] = 1
    return ob


# --------------------------------------------------------------------------------------------
# scene pieces
# --------------------------------------------------------------------------------------------
def build_room(M):
    x0, x1 = ROOM_X
    y0, y1 = ROOM_Y
    wain = FLOOR + 1.05
    rail = 0.035
    # floor in three strips so the lightmap spends texels where the camera looks; the seams sit
    # under the counter kick plate (y=1.4) and behind the player (y=-0.9)
    for name, ya, yb, w in (("Floor_Front", y0, -0.9, 0.3), ("Floor_Main", -0.9, 1.4, 1.0), ("Floor_Back", 1.4, y1, 0.35)):
        bm = bmesh.new()
        bm_quad(bm, [(x0, ya, FLOOR), (x1, ya, FLOOR), (x1, yb, FLOOR), (x0, yb, FLOOR)])
        fl = obj_from_bm(name, bm, [M["floor"]], weight=w)
        box_uv(fl, 2.26)
    # ceiling (normal down)
    bm = bmesh.new()
    bm_quad(bm, [(x0, y0, CEIL), (x0, y1, CEIL), (x1, y1, CEIL), (x1, y0, CEIL)])
    ce = obj_from_bm("Ceiling", bm, [M["ceiling"]], weight=0.2)
    box_uv(ce, 2.0)

    # walls: lower wainscot (wood) + upper plaster, normals facing into the room
    def wall(name, a, b, normal, weight_lo, weight_hi):
        # a, b: (x, y) endpoints, listed so that (b - a) x up == normal (inward)
        bm = bmesh.new()
        (ax, ay), (bx, by) = a, b
        nx, ny = normal
        t = 0.015  # wainscot thickness
        bm_quad(bm, [(ax + nx * t, ay + ny * t, FLOOR), (bx + nx * t, by + ny * t, FLOOR), (bx + nx * t, by + ny * t, wain), (ax + nx * t, ay + ny * t, wain)], 0)
        lo = obj_from_bm(name + "_Wainscot", bm, [M["wainscot"]], weight=weight_lo)
        box_uv(lo, 1.0, rotate=False)
        bm = bmesh.new()
        bm_quad(bm, [(ax, ay, wain), (bx, by, wain), (bx, by, CEIL), (ax, ay, CEIL)], 0)
        hi = obj_from_bm(name + "_Plaster", bm, [M["plaster"]], weight=weight_hi)
        box_uv(hi, 2.0)
        # chair rail on top of the wainscot
        bm = bmesh.new()
        if abs(nx) > 0:
            bm_box(bm, (min(ax, ax + nx * 0.04), min(ay, by), wain - 0.02), (max(ax, ax + nx * 0.04), max(ay, by), wain + rail), 0, skip={"-x" if nx > 0 else "+x"})
        else:
            bm_box(bm, (min(ax, bx), min(ay, ay + ny * 0.04), wain - 0.02), (max(ax, bx), max(ay, ay + ny * 0.04), wain + rail), 0, skip={"-y" if ny > 0 else "+y"})
        r = obj_from_bm(name + "_Rail", bm, [M["trim"]], weight=0.5)
        box_uv(r, 1.0)
        # skirting
        bm = bmesh.new()
        if abs(nx) > 0:
            bm_box(bm, (min(ax, ax + nx * 0.03), min(ay, by), FLOOR), (max(ax, ax + nx * 0.03), max(ay, by), FLOOR + 0.09), 0, skip={"-z", "-x" if nx > 0 else "+x"})
        else:
            bm_box(bm, (min(ax, bx), min(ay, ay + ny * 0.03), FLOOR), (max(ax, bx), max(ay, ay + ny * 0.03), FLOOR + 0.09), 0, skip={"-z", "-y" if ny > 0 else "+y"})
        s = obj_from_bm(name + "_Skirting", bm, [M["trim"]], weight=0.5)
        box_uv(s, 1.0)

    wall("WallBack", (x0, y1), (x1, y1), (0, -1), 0.5, 0.45)
    wall("WallLeft", (x0, y0), (x0, y1), (1, 0), 0.7, 0.45)
    wall("WallRight", (x1, y1), (x1, y0), (-1, 0), 0.7, 0.45)
    wall("WallFront", (x1, y0), (x0, y0), (0, 1), 0.25, 0.2)


def build_counter(M):
    cx0, cx1 = -1.5, 1.3
    fy, by = COUNTER_FRONT_Y, COUNTER_FRONT_Y + 0.6
    kick = 0.10
    top = COUNTER_TOP_Z
    thick = 0.045
    # front panel body
    bm = bmesh.new()
    bm_box(bm, (cx0, fy, FLOOR + kick), (cx1, by, top - thick), 0, skip={"-z", "+z", "+y", "-x", "+x"})
    body = obj_from_bm("Counter_Front", bm, [M["counter_front"]], weight=1.6)
    box_uv(body, 2.1, offset=(0.0, 0.12))
    bm = bmesh.new()
    bm_box(bm, (cx0, fy, FLOOR + kick), (cx1, by, top - thick), 0, skip={"-z", "+z", "-y"})
    body = obj_from_bm("Counter_Sides", bm, [M["counter_front"]], weight=0.45)
    box_uv(body, 2.1, offset=(0.0, 0.12))
    # kick plate (recessed)
    bm = bmesh.new()
    bm_box(bm, (cx0 + 0.04, fy + 0.05, FLOOR), (cx1 - 0.04, by, FLOOR + kick), 0, skip={"-z", "+z"})
    k = obj_from_bm("Counter_Kick", bm, [M["trim"]], weight=0.6)
    box_uv(k, 1.0)
    # top slab with overhang
    bm = bmesh.new()
    bm_box(bm, (cx0 - 0.05, fy - 0.08, top - thick), (cx1 + 0.05, by + 0.03, top), 0)
    t = obj_from_bm("Counter_Top", bm, [M["dark_wood"]], weight=0.9)
    box_uv(t, 2.0)
    # foot rail (brass) along the front
    bm = bmesh.new()
    lathe_bm(bm, [(0.0, 0.0), (0.016, 0.0), (0.016, cx1 - cx0 - 0.2), (0.0, cx1 - cx0 - 0.2)], 10)
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(90), 3, "Y"))
    bmesh.ops.translate(bm, verts=bm.verts, vec=(cx0 + 0.1, fy - 0.16, FLOOR + 0.2))
    for x in (cx0 + 0.25, cx1 - 0.25):
        bm_box(bm, (x - 0.012, fy - 0.17, FLOOR + 0.19), (x + 0.012, fy, FLOOR + 0.21), 0, skip={"+y"})
    obj_from_bm("Counter_FootRail", bm, [M["brass"]], weight=0.8, smooth=True)


def build_back_bar(M, rng):
    x0, x1 = -1.35, 1.15
    y_wall = ROOM_Y[1] - 0.015
    # base cabinet
    bm = bmesh.new()
    bm_box(bm, (x0, y_wall - 0.42, FLOOR), (x1, y_wall, 0.12), 0, skip={"+y", "-z"})
    cab = obj_from_bm("BackBar_Cabinet", bm, [M["planks"]], weight=0.5)
    box_uv(cab, 1.0)
    # shelves
    bm = bmesh.new()
    shelf_z = [0.5, 0.88]
    for z in shelf_z:
        bm_box(bm, (x0 + 0.05, y_wall - 0.24, z - 0.03), (x1 - 0.05, y_wall, z), 0, skip={"+y"})
    sh = obj_from_bm("BackBar_Shelves", bm, [M["dark_wood"]], weight=0.5)
    box_uv(sh, 1.5)
    # amber LED strips under each shelf (front edge) + matching soft area lights
    bm = bmesh.new()
    for z in shelf_z:
        bm_box(bm, (x0 + 0.08, y_wall - 0.22, z - 0.034), (x1 - 0.08, y_wall - 0.2, z - 0.03), 0, skip={"+z"})
    obj_from_bm("BackBar_LED", bm, [M["led_amber"]], weight=0.3)
    for i, z in enumerate(shelf_z):
        add_area_light(f"BackBar_LED_Light_{i}", (0.5 * (x0 + x1), y_wall - 0.18, z - 0.045), (x1 - x0 - 0.2, 0.04), 9.0, color=(1.0, 0.6, 0.25), rot=(0, 0, 0))
    # bottles on the shelves and on the base cabinet top
    for zi, z in enumerate([0.12] + shelf_z):
        x = x0 + 0.12
        while x < x1 - 0.1:
            if zi == 0:
                kind = rng.choice(["liquor_round", "liquor_square", "gin", "beer_lo"])
            else:
                kind = rng.choices(["beer_lo", "beer_lo_green", "liquor_round", "liquor_square", "gin"], weights=[3, 2, 2, 2, 1])[0]
            bottle(M, kind, (x + rng.uniform(-0.01, 0.01), y_wall - 0.1 - rng.uniform(0, 0.05), z), weight=0.5, rng=rng)
            x += 0.09 if kind.startswith("beer") else 0.115


BOTTLES = {}


def bottle_mesh(M, kind):
    if kind in BOTTLES:
        return BOTTLES[kind]
    bm = bmesh.new()
    if kind in ("beer_amber", "beer_green", "beer_crate", "beer_lo", "beer_lo_green"):
        r = 0.031
        prof = [(0, 0), (r * 0.92, 0.0), (r, 0.006), (r, 0.135), (r * 0.94, 0.15), (r * 0.72, 0.17), (r * 0.45, 0.195), (r * 0.4, 0.232), (r * 0.46, 0.236), (r * 0.46, 0.246), (0, 0.247)]
        segs = 9
        if kind in ("beer_crate", "beer_lo", "beer_lo_green"):
            prof = [(0, 0), (r, 0.0), (r, 0.14), (r * 0.72, 0.17), (r * 0.42, 0.2), (r * 0.42, 0.236), (r * 0.46, 0.246), (0, 0.247)]
            segs = 7
        glass = 0 if kind != "beer_green" else 1
        n = len(prof) - 1
        lathe_bm(bm, prof, segs, mat_of_band=lambda k: 2 if k >= n - 2 else 0)
        green = kind in ("beer_green", "beer_lo_green")
        mats = [M["glass_green"] if green else M["glass_amber"], M["glass_green"], M["cap_silver"] if green else M["cap_gold"]]
    elif kind == "liquor_round":
        r = 0.04
        prof = [(0, 0), (r * 0.95, 0), (r, 0.008), (r, 0.19), (r * 0.8, 0.225), (r * 0.36, 0.25), (r * 0.33, 0.285), (r * 0.4, 0.29), (r * 0.4, 0.315), (0, 0.316)]
        n = len(prof) - 1
        lathe_bm(bm, prof, 12, mat_of_band=lambda k: 1 if k >= n - 2 else 0)
        mats = [M["glass_clear"], M["cap_red"]]
    elif kind == "gin":
        r = 0.036
        prof = [(0, 0), (r, 0), (r, 0.2), (r * 0.6, 0.235), (r * 0.36, 0.255), (r * 0.36, 0.28), (r * 0.42, 0.285), (r * 0.42, 0.3), (0, 0.301)]
        n = len(prof) - 1
        lathe_bm(bm, prof, 10, mat_of_band=lambda k: 1 if k >= n - 2 else 0)
        mats = [M["glass_gin"], M["cap_silver"]]
    else:  # liquor_square: 4-segment lathe with 45deg phase gives a square body
        r = 0.052
        prof = [(0, 0), (r, 0), (r, 0.17), (r * 0.6, 0.2), (r * 0.26, 0.215), (r * 0.26, 0.255), (r * 0.32, 0.26), (r * 0.32, 0.28), (0, 0.281)]
        n = len(prof) - 1
        lathe_bm(bm, prof, 4, mat_of_band=lambda k: 1 if k >= n - 2 else 0, phase=math.pi / 4)
        for f in bm.faces:
            f.smooth = False
        mats = [M["glass_clear"], M["black"]]
    me = bpy.data.meshes.new("Bottle_" + kind)
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    BOTTLES[kind] = me
    return me


def bottle(M, kind, loc, weight=1.0, rng=None, rot=None, name=None):
    me = bottle_mesh(M, kind)
    ob = bpy.data.objects.new(name or f"Bottle_{kind}", me)
    AUTH.objects.link(ob)
    ob.location = loc
    ob.rotation_euler = (0, 0, rot if rot is not None else (rng.uniform(0, 6.28) if rng else 0))
    ob["lm_weight"] = weight
    return ob


def build_crates(M, rng, crate_proto):
    stacks = [
        # (x, y, rot, levels, bottle kind)
        (1.42, 0.86, 8.0, 2, "beer_crate"),
        (-1.2, 0.92, -6.0, 1, "beer_crate_green"),
        (1.86, 0.32, 80.0, 1, "beer_crate"),
    ]
    cw, cd, ch = 0.506, 0.406, 0.254
    for si, (x, y, rot, levels, kind) in enumerate(stacks):
        for lv in range(levels):
            ob = place_instance(crate_proto, f"Crate_{si}_{lv}", (x, y, FLOOR + lv * (ch - 0.012)), rot + rng.uniform(-3, 3), weight=0.85 if lv == levels - 1 else 0.6)
        # bottles in the top crate: 6 x 4 grid in crate-local space
        top_z = FLOOR + (levels - 1) * (ch - 0.012) + 0.012
        R = Matrix.Rotation(math.radians(rot), 3, "Z")
        for i in range(6):
            for j in range(4):
                if rng.random() < 0.08:
                    continue
                lx = (i - 2.5) * 0.077
                ly = (j - 1.5) * 0.088
                p = R @ Vector((lx, ly, 0))
                k = "beer_crate"
                b = bottle(M, k, (x + p.x, y + p.y, top_z), weight=0.6, rng=rng)
                if kind == "beer_crate_green":
                    b.data = bottle_mesh(M, "beer_crate_green_m")


def build_chiller(M, rng):
    """Upright glass-door beverage chiller (no glass pane: open frame, lit interior)."""
    x0, x1 = -2.36, -1.74
    y0, y1 = 1.42, 2.06
    z0, z1 = FLOOR, FLOOR + 1.92
    w = 0.045  # wall thickness
    bm = bmesh.new()
    # shell: back, sides, bottom, top (enamel)
    bm_box(bm, (x0, y1 - w, z0 + 0.1), (x1, y1, z1 - 0.22), 0, skip={"+y"})
    bm_box(bm, (x0, y0, z0 + 0.1), (x0 + w, y1, z1 - 0.22), 0, skip={"-x"})
    bm_box(bm, (x1 - w, y0, z0 + 0.1), (x1, y1, z1 - 0.22), 0)
    bm_box(bm, (x0, y0, z0), (x1, y1, z0 + 0.16), 0, skip={"-z"})
    bm_box(bm, (x0, y0, z1 - 0.28), (x1, y1, z1 - 0.22), 0)
    # header light box (red with a lit panel)
    bm_box(bm, (x0, y0 + 0.02, z1 - 0.22), (x1, y1, z1), 1, skip={"+y"})
    # door frame (front ring)
    fy = y0 - 0.03
    for (a, b) in [((x0, fy, z0 + 0.16), (x1, y0, z0 + 0.22)), ((x0, fy, z1 - 0.34), (x1, y0, z1 - 0.28)), ((x0, fy, z0 + 0.16), (x0 + 0.05, y0, z1 - 0.28)), ((x1 - 0.05, fy, z0 + 0.16), (x1, y0, z1 - 0.28))]:
        bm_box(bm, a, b, 2, skip={"+y"})
    # handle
    bm_box(bm, (x1 - 0.085, fy - 0.035, z0 + 0.6), (x1 - 0.065, fy, z0 + 1.2), 2)
    # interior liner (inner faces are the shell's faces; add a bright back liner)
    bm_quad(bm, [(x0 + w, y1 - w - 0.002, z0 + 0.16), (x1 - w, y1 - w - 0.002, z0 + 0.16), (x1 - w, y1 - w - 0.002, z1 - 0.28), (x0 + w, y1 - w - 0.002, z1 - 0.28)], 3)
    ob = obj_from_bm("Chiller_Body", bm, [M["fridge_white"], M["fridge_red"], M["black"], M["fridge_inner"]], weight=0.9)
    box_uv(ob, 1.0)
    # lit header panel and interior light strip
    bm = bmesh.new()
    bm_quad(bm, [(x0 + 0.06, y0 + 0.015, z1 - 0.19), (x1 - 0.06, y0 + 0.015, z1 - 0.19), (x1 - 0.06, y0 + 0.015, z1 - 0.04), (x0 + 0.06, y0 + 0.015, z1 - 0.04)], 0)
    bm_box(bm, (x0 + 0.08, y0 + 0.02, z1 - 0.3), (x1 - 0.08, y0 + 0.06, z1 - 0.285), 0, skip={"+z"})
    obj_from_bm("Chiller_Lights", bm, [M["fridge_light"]], weight=0.6)
    add_area_light("Chiller_Light", ((x0 + x1) / 2, (y0 + y1) / 2, z1 - 0.31), (x1 - x0 - 0.12, y1 - y0 - 0.1), 14.0, color=(0.85, 0.93, 1.0))
    # wire shelves + bottles
    bm = bmesh.new()
    shelves = [z0 + 0.22, z0 + 0.62, z0 + 1.0, z0 + 1.36]
    for z in shelves[1:]:
        bm_box(bm, (x0 + w, y0 + 0.03, z - 0.012), (x1 - w, y1 - w, z), 0)
    obj_from_bm("Chiller_Shelves", bm, [M["metal"]], weight=0.5)
    for si, z in enumerate(shelves):
        kind = ["beer_lo", "beer_lo_green", "beer_lo", "beer_lo_green"][si]
        for row in range(2):
            for i in range(6):
                if row == 1 and i % 2:
                    continue
                bx = x0 + w + 0.055 + i * 0.087 + row * 0.04
                by_ = y0 + 0.1 + row * 0.2
                bottle(M, kind, (bx, by_, z), weight=0.7 if row == 0 else 0.3, rng=rng)


def build_videoke(M, tv_proto, rng):
    # low cabinet with an open shelf holding the videoke machine
    cx, cy = 1.95, 1.55
    w, d, h = 0.78, 0.46, 0.52
    x0, x1, y0, y1 = cx - w / 2, cx + w / 2, cy - d / 2, cy + d / 2
    bm = bmesh.new()
    t = 0.025
    bm_box(bm, (x0, y0, FLOOR + h - t), (x1, y1, FLOOR + h), 0)  # top
    bm_box(bm, (x0, y0, FLOOR), (x1, y1, FLOOR + 0.05), 0, skip={"-z"})  # plinth
    bm_box(bm, (x0, y0, FLOOR), (x0 + t, y1, FLOOR + h), 0, skip={"-z"})
    bm_box(bm, (x1 - t, y0, FLOOR), (x1, y1, FLOOR + h), 0, skip={"-z"})
    bm_box(bm, (x0, y1 - t, FLOOR), (x1, y1, FLOOR + h), 0, skip={"-z"})
    bm_box(bm, (x0, y0, FLOOR + 0.25), (x1, y1, FLOOR + 0.27), 0)  # mid shelf
    cab = obj_from_bm("Videoke_Cabinet", bm, [M["planks"]], weight=0.9)
    box_uv(cab, 1.0)
    # videoke machine on the mid shelf, speaker beside the cabinet
    bm = bmesh.new()
    bm_box(bm, (x0 + 0.08, y0 + 0.05, FLOOR + 0.27), (x1 - 0.12, y1 - 0.06, FLOOR + 0.36), 0, skip={"-z"})
    # speaker box on the floor to the left of the cabinet
    sx0, sx1, sy0, sy1 = x0 - 0.36, x0 - 0.04, cy - 0.15, cy + 0.17
    bm_box(bm, (sx0, sy0, FLOOR), (sx1, sy1, FLOOR + 0.62), 0, skip={"-z"})
    for zc, rc in ((FLOOR + 0.22, 0.11), (FLOOR + 0.5, 0.045)):
        vs = lathe_bm(bm, [(0.0, 0.0), (rc, 0.0), (rc, 0.008), (0.0, 0.008)], 18)
        bmesh.ops.rotate(bm, verts=vs, cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(90), 3, "X"))
        bmesh.ops.translate(bm, verts=vs, vec=((sx0 + sx1) / 2, sy0, zc))
    obj_from_bm("Videoke_Machine_Speaker", bm, [M["black"]], weight=0.8, smooth=False)
    # LED display on the machine
    bm = bmesh.new()
    bm_quad(bm, [(x0 + 0.14, y0 + 0.049, FLOOR + 0.30), (x0 + 0.32, y0 + 0.049, FLOOR + 0.30), (x0 + 0.32, y0 + 0.049, FLOOR + 0.33), (x0 + 0.14, y0 + 0.049, FLOOR + 0.33)], 0)
    obj_from_bm("Videoke_LED", bm, [M["vk_led"]], weight=1.0)
    # TV on top, turned toward the table
    rot = 28.0
    tv = place_instance(tv_proto, "Videoke_TV", (cx, cy + 0.02, FLOOR + h), rot, weight=1.0)
    bpy.context.view_layer.update()
    # screen plane in TV-local space
    bm = bmesh.new()
    zmin = min(Vector(c).z for c in tv_proto.bound_box)
    sw, sh, sz, sxo = TV_SCREEN["w"], TV_SCREEN["h"], zmin + TV_SCREEN["z"], TV_SCREEN["x"]
    front = min(Vector(c).y for c in tv_proto.bound_box) + TV_SCREEN["y"]
    bm_quad(bm, [(sxo - sw / 2, front, sz - sh / 2), (sxo + sw / 2, front, sz - sh / 2), (sxo + sw / 2, front, sz + sh / 2), (sxo - sw / 2, front, sz + sh / 2)])
    scr = obj_from_bm("Videoke_Screen", bm, [M["screen"]], weight=1.6)
    me = scr.data
    uvl = me.uv_layers.new(name="UVMap").data
    for li, uvc in zip(range(4), [(0, 0), (1, 0), (1, 1), (0, 1)]):
        uvl[li].uv = uvc
    scr.matrix_world = tv.matrix_world.copy()
    scr["screen_local"] = (sxo, front, sz)
    add_area_light("Videoke_Screen_Light", (0, 0, 0), (0.38, 0.28), 6.0, color=(0.35, 0.3, 1.0))
    L = bpy.data.objects["Videoke_Screen_Light"]
    L.matrix_world = tv.matrix_world @ Matrix.Translation((sxo, front - 0.02, sz)) @ Matrix.Rotation(math.radians(-90), 4, "X")
    # microphone resting on the cabinet top
    bm = bmesh.new()
    lathe_bm(bm, [(0, 0), (0.012, 0), (0.016, 0.16), (0.024, 0.17), (0.026, 0.2), (0.02, 0.225), (0, 0.23)], 10)
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(90), 3, "Y") @ Matrix.Rotation(math.radians(0), 3, "Z"))
    mic = obj_from_bm("Videoke_Mic", bm, [M["black"]], weight=0.8, smooth=True)
    mic.location = (x0 + 0.08, y0 + 0.08, FLOOR + h + 0.026)
    mic.rotation_euler = (0, 0, math.radians(-25))


def build_lamp(M):
    # enamel pendant over the table: shade outer/inner + bulb + cord + ceiling rose
    bm = bmesh.new()
    top = LAMP_BULB.z + 0.09
    # closed profile: outer surface down to rim, back up the inner surface
    outer = [(0.0, top + 0.03), (0.035, top + 0.03), (0.04, top), (0.07, top - 0.03), (0.15, top - 0.09), (0.19, top - 0.135), (0.2, top - 0.14)]
    inner = [(0.192, top - 0.142), (0.185, top - 0.136), (0.145, top - 0.095), (0.066, top - 0.037), (0.034, top - 0.012), (0.0, top - 0.012)]
    # one closed profile: inner pole -> inner surface -> rim -> outer surface -> outer pole
    seq = inner[::-1] + outer[::-1]
    n_inner = len(inner) - 1
    lathe_bm(bm, seq, 24, mat_of_band=lambda k: 1 if k < n_inner + 1 else 0, offset=(LAMP_BULB.x, LAMP_BULB.y, 0))
    obj_from_bm("Lamp_Shade", bm, [M["shade_out"], M["shade_in"]], weight=0.6, smooth=True)
    # socket + bulb
    bm = bmesh.new()
    lathe_bm(bm, [(0, top - 0.012), (0.018, top - 0.012), (0.018, LAMP_BULB.z + 0.035), (0.0, LAMP_BULB.z + 0.035)], 12, offset=(LAMP_BULB.x, LAMP_BULB.y, 0))
    obj_from_bm("Lamp_Socket", bm, [M["black"]], weight=0.4, smooth=True)
    bm = bmesh.new()
    bulb_prof = [(0.0, -0.05), (0.025, -0.045), (0.04, -0.025), (0.045, 0.0), (0.035, 0.025), (0.016, 0.04), (0.0, 0.045)]
    lathe_bm(bm, [(r, LAMP_BULB.z + z) for r, z in bulb_prof], 14, offset=(LAMP_BULB.x, LAMP_BULB.y, 0))
    obj_from_bm("Lamp_Bulb", bm, [M["bulb"]], weight=0.5, smooth=True)
    # cord + rose
    bm = bmesh.new()
    lathe_bm(bm, [(0.0035, top + 0.03), (0.0035, CEIL - 0.02)], 6, offset=(LAMP_BULB.x, LAMP_BULB.y, 0))
    lathe_bm(bm, [(0.05, CEIL - 0.03), (0.05, CEIL - 0.0)], 12, offset=(LAMP_BULB.x, LAMP_BULB.y, 0))
    lathe_bm(bm, [(0.0, CEIL - 0.03), (0.05, CEIL - 0.03)], 12, offset=(LAMP_BULB.x, LAMP_BULB.y, 0))
    obj_from_bm("Lamp_Cord", bm, [M["black"]], weight=0.2, smooth=True)
    # key light (2700 K) - the app should mirror this for the realtime table
    ld = bpy.data.lights.new("Key_Pendant", "SPOT")
    ld.energy = KEY_LIGHT_W
    ld.use_temperature = True
    ld.temperature = KEY_LIGHT_K
    ld.color = (1, 1, 1)
    ld.spot_size = math.radians(118)
    ld.spot_blend = 0.55
    ld.shadow_soft_size = 0.035
    lo = bpy.data.objects.new("Key_Pendant", ld)
    AUTH.objects.link(lo)
    lo.location = KEY_LIGHT_POS
    # small up-light leaking out of the shade top (keeps the ceiling from going pitch black)
    lu = bpy.data.lights.new("Pendant_Leak", "POINT")
    lu.energy = 2.0
    lu.use_temperature = True
    lu.temperature = KEY_LIGHT_K
    lu.shadow_soft_size = 0.05
    lob = bpy.data.objects.new("Pendant_Leak", lu)
    AUTH.objects.link(lob)
    lob.location = (LAMP_BULB.x, LAMP_BULB.y, top + 0.06)


def add_area_light(name, loc, size, energy, color=(1, 1, 1), rot=(0, 0, 0), temperature=None):
    ld = bpy.data.lights.new(name, "AREA")
    ld.shape = "RECTANGLE"
    ld.size, ld.size_y = size
    ld.energy = energy
    ld.color = color
    if temperature:
        ld.use_temperature = True
        ld.temperature = temperature
    lo = bpy.data.objects.new(name, ld)
    AUTH.objects.link(lo)
    lo.location = loc
    lo.rotation_euler = rot
    return lo


def build_counter_props(M, rng):
    # a few bottles + an ice bucket on the counter top (seen in upright views)
    top = COUNTER_TOP_Z
    y = COUNTER_FRONT_Y + 0.22
    for x, kind in ((-1.2, "liquor_square"), (-1.08, "gin"), (-0.98, "liquor_round"), (0.95, "beer_amber"), (1.05, "beer_green")):
        bottle(M, kind, (x, y + rng.uniform(-0.03, 0.05), top), weight=0.5, rng=rng)
    bm = bmesh.new()
    lathe_bm(bm, [(0, 0), (0.085, 0), (0.11, 0.2), (0.115, 0.205), (0.1, 0.205), (0.075, 0.03), (0.0, 0.03)], 16)
    b = obj_from_bm("Ice_Bucket", bm, [M["metal"]], weight=0.5, smooth=True)
    b.location = (0.62, y + 0.05, top)
    for i in range(5):
        a = i * 2 * math.pi / 5
        ob = bottle(M, "beer_crate", (0.62 + 0.05 * math.cos(a), y + 0.05 + 0.05 * math.sin(a), top + 0.02), weight=0.5, rng=rng)
        ob.rotation_euler = (math.radians(8 * math.cos(a)), math.radians(-8 * math.sin(a)), 0)
    # warm bulb over the counter for the bartender area
    lp = bpy.data.lights.new("Counter_Bulb", "POINT")
    lp.energy = 14.0
    lp.use_temperature = True
    lp.temperature = 2600
    lp.shadow_soft_size = 0.05
    lo = bpy.data.objects.new("Counter_Bulb", lp)
    AUTH.objects.link(lo)
    lo.location = (-0.1, 2.25, 1.55 - 0.045)
    bm = bmesh.new()
    lathe_bm(bm, [(0.0, -0.035), (0.03, -0.025), (0.035, 0.0), (0.02, 0.03), (0.0, 0.035)], 10, offset=(-0.1, 2.25, 1.55))
    lathe_bm(bm, [(0.003, 0.035), (0.003, CEIL - 1.55)], 5, offset=(-0.1, 2.25, 1.55))
    obj_from_bm("Counter_Bulb_Mesh", bm, [M["bulb"]], weight=0.2, smooth=True)


def fillet(pts, rad, n=3):
    """Round polyline corners (2D) like bent neon glass."""
    if len(pts) < 3:
        return pts
    out = [pts[0]]
    for i in range(1, len(pts) - 1):
        p0, p1, p2 = Vector(pts[i - 1]), Vector(pts[i]), Vector(pts[i + 1])
        d0 = (p0 - p1)
        d2 = (p2 - p1)
        r = min(rad, d0.length * 0.45, d2.length * 0.45)
        a = p1 + d0.normalized() * r
        b = p1 + d2.normalized() * r
        for k in range(n + 1):
            t = k / n
            q = (1 - t) ** 2 * a + 2 * (1 - t) * t * p1 + t ** 2 * b
            out.append((q.x, q.y))
    out.append(pts[-1])
    return out


def arc(cx, cy, r, a0, a1, n):
    return [(cx + r * math.cos(a0 + (a1 - a0) * k / n), cy + r * math.sin(a0 + (a1 - a0) * k / n)) for k in range(n + 1)]


def build_neon(M):
    """'INUMAN' in single-stroke pink neon with an amber frame, on a dark backboard,
    mounted on the bar counter front (the only spot the in-app camera actually sees)."""
    H = 0.135
    widths = {"I": 0.0, "N": 0.09, "U": 0.09, "M": 0.117, "A": 0.1}
    gap = 0.047
    word = "INUMAN"
    total = sum(widths[c] for c in word) + gap * (len(word) - 1)
    slant = 0.16
    strokes = []
    x = -total / 2
    for c in word:
        w = widths[c]
        if c == "I":
            strokes.append([(x, 0), (x, H)])
        elif c == "N":
            strokes.append(fillet([(x, 0), (x, H), (x + w, 0), (x + w, H)], 0.012))
        elif c == "U":
            r = w / 2
            strokes.append([(x, H)] + arc(x + r, r, r, math.pi, 2 * math.pi, 10) + [(x + w, H)])
        elif c == "M":
            strokes.append(fillet([(x, 0), (x, H), (x + w / 2, H * 0.32), (x + w, H), (x + w, 0)], 0.012))
        elif c == "A":
            strokes.append(fillet([(x, 0), (x + w / 2, H), (x + w, 0)], 0.012))
            strokes.append([(x + w * 0.24, H * 0.36), (x + w * 0.76, H * 0.36)])
        x += w + gap
    cz = -0.2  # sign centre height (Blender z); counter front visible up to ~z=+0.08 in portrait
    y_tube = COUNTER_FRONT_Y - 0.035
    base_z = cz - H / 2

    def to3(p, y=y_tube):
        u, v = p
        return (u + v * slant - H * slant / 2, y, base_z + v)

    bm = bmesh.new()
    for st in strokes:
        sweep_tube_bm(bm, [to3(p) for p in st], 0.0055, sides=8, mat=0)
    obj_from_bm("Neon_INUMAN", bm, [M["neon_pink"]], weight=2.2)
    # amber frame: rounded rectangle around the word
    fw, fh, rr = total / 2 + 0.062, H / 2 + 0.04, 0.028
    cyz = H / 2
    rect = []
    for (cx_, cy_, a0) in ((fw - rr, cyz + fh - rr, 0), (-fw + rr, cyz + fh - rr, math.pi / 2), (-fw + rr, cyz - fh + rr, math.pi), (fw - rr, cyz - fh + rr, 1.5 * math.pi)):
        rect += arc(cx_, cy_, rr, a0, a0 + math.pi / 2, 4)
    bm = bmesh.new()
    sweep_tube_bm(bm, [(u, y_tube + 0.004, base_z + v) for u, v in rect], 0.0045, sides=8, mat=0, cyclic=True)
    obj_from_bm("Neon_Frame", bm, [M["neon_amber"]], weight=2.0)
    # dark acrylic backboard on standoffs
    bw, bh = fw + 0.035, fh + 0.03
    bm = bmesh.new()
    bm_box(bm, (-bw, COUNTER_FRONT_Y - 0.016, base_z + cyz - bh), (bw, COUNTER_FRONT_Y - 0.004, base_z + cyz + bh), 0, skip={"+y"})
    for sx in (-bw + 0.03, bw - 0.03):
        for sz in (base_z + cyz - bh + 0.03, base_z + cyz + bh - 0.03):
            bm_box(bm, (sx - 0.006, y_tube - 0.004, sz - 0.006), (sx + 0.006, COUNTER_FRONT_Y - 0.016, sz + 0.006), 1, skip={"+y"})
    obj_from_bm("Neon_Backboard", bm, [M["acrylic"], M["metal"]], weight=1.6)
    # tube supports (small clear posts) are omitted; electrodes hidden behind the board.


def build_chairs(M, chair_proto, stool_proto, rng):
    # Monobloc chairs around the table (none directly across: that's where the neon counter is)
    chairs = [
        ((-1.02, 0.02), 90 + 2),  # left end, facing +X
        ((1.03, -0.04), -90 - 4),  # right end, facing -X
        ((0.8, 0.98), -34),  # far right, pulled out, turned toward the table
    ]
    for i, ((x, y), rz) in enumerate(chairs):
        place_instance(chair_proto, f"Chair_{i}", (x, y, FLOOR), rz + rng.uniform(-3, 3), weight=1.0)
    sx, sy = -1.72, 0.5
    place_instance(stool_proto, "Stool_0", (sx, sy, FLOOR), 15, weight=0.9)
    # ice bucket with beers on the stool
    top = FLOOR + 0.579
    bm = bmesh.new()
    lathe_bm(bm, [(0, 0), (0.08, 0), (0.105, 0.19), (0.11, 0.195), (0.095, 0.195), (0.07, 0.03), (0.0, 0.03)], 16)
    b = obj_from_bm("Stool_Bucket", bm, [M["metal"]], weight=0.9, smooth=True)
    b.location = (sx, sy, top)
    for i in range(4):
        a = i * 2 * math.pi / 4 + 0.4
        ob = bottle(M, "beer_crate", (sx + 0.045 * math.cos(a), sy + 0.045 * math.sin(a), top + 0.02), weight=0.9, rng=rng)
        ob.rotation_euler = (math.radians(9 * math.cos(a)), math.radians(-9 * math.sin(a)), 0)


def graded_copy(src, name, sat=1.0, value=1.0, non_color=False):
    """Copy (optionally saturation/value graded, in the image's own encoding) saved as JPEG next to
    the bakes, so the exported glTF image gets a clean, stable name."""
    w, h = src.size
    a = np.empty(w * h * src.channels, dtype=np.float32)
    src.pixels.foreach_get(a)
    a = a.reshape(h, w, src.channels)
    rgb = a[..., :3]
    if sat != 1.0 or value != 1.0:
        luma = (rgb * np.array([0.2126, 0.7152, 0.0722], np.float32)).sum(-1, keepdims=True)
        rgb = np.clip((luma + (rgb - luma) * sat) * value, 0, 1)
    out = np.concatenate([rgb, np.ones((h, w, 1), np.float32)], -1)
    img = bpy.data.images.new(name, w, h, alpha=False)
    if non_color:
        img.colorspace_settings.name = "Non-Color"
    img.pixels.foreach_set(out.ravel())
    os.makedirs(BAKE_DIR, exist_ok=True)
    img.filepath_raw = os.path.join(BAKE_DIR, name + ".jpg")
    img.file_format = "JPEG"
    try:
        img.save(quality=92)
    except TypeError:
        img.save()
    return img


def build_table(M):
    """The play surface: 1.3 x 0.9 m worn wood, top surface at z=0. Exported with PBR (not baked)."""
    L, W, T = 1.3, 0.9, 0.042
    cr = 0.035  # corner radius
    ch = 0.004  # top chamfer
    bm = bmesh.new()

    def rrect(hx, hy, r, z, n=4):
        pts = []
        for cx, cy, a0 in ((hx - r, hy - r, 0), (-hx + r, hy - r, math.pi / 2), (-hx + r, -hy + r, math.pi), (hx - r, -hy + r, 1.5 * math.pi)):
            for k in range(n + 1):
                a = a0 + (math.pi / 2) * k / n
                pts.append(bm.verts.new((cx + r * math.cos(a), cy + r * math.sin(a), z)))
        return pts

    r_top = rrect(L / 2 - ch, W / 2 - ch, cr - ch, 0.0)
    r_mid = rrect(L / 2, W / 2, cr, -ch)
    r_low = rrect(L / 2, W / 2, cr, -T + ch)
    r_bot = rrect(L / 2 - ch, W / 2 - ch, cr - ch, -T)
    top_face = bm.faces.new(r_top)
    for A, B in ((r_top, r_mid), (r_mid, r_low), (r_low, r_bot)):
        n = len(A)
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((B[i], B[j], A[j], A[i]))
    bm.faces.new(list(reversed(r_bot)))
    # apron + legs
    ins = 0.065
    ah = 0.085
    at = 0.022
    hx, hy = L / 2 - ins, W / 2 - ins
    bm_box(bm, (-hx, -hy, -T - ah), (hx, -hy + at, -T), 0, skip={"+z"})
    bm_box(bm, (-hx, hy - at, -T - ah), (hx, hy, -T), 0, skip={"+z"})
    bm_box(bm, (-hx, -hy + at, -T - ah), (-hx + at, hy - at, -T), 0, skip={"+z"})
    bm_box(bm, (hx - at, -hy + at, -T - ah), (hx, hy - at, -T), 0, skip={"+z"})
    lw = 0.062
    for sx in (-1, 1):
        for sy in (-1, 1):
            cx, cy = sx * (hx - lw / 2 + 0.004), sy * (hy - lw / 2 + 0.004)
            v = []
            for z, half in ((-T, lw / 2), (FLOOR, lw / 2 * 0.78)):
                for (dx, dy) in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                    v.append(bm.verts.new((cx + dx * half, cy + dy * half, z)))
            for i in range(4):
                j = (i + 1) % 4
                bm.faces.new((v[4 + i], v[4 + j], v[j], v[i]))
            bm.faces.new((v[4], v[5], v[6], v[7])[::-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new("Table")
    bm.to_mesh(me)
    bm.free()
    m = pbr_material("Table_Wood", "wood_table_worn", "1k", normal_strength=1.0)
    # bake the colour grade into a real texture (the glTF exporter can't carry HSV nodes):
    # a little darker and less saturated so white cards pop under the warm 2700 K key light
    for n in [n for n in m.node_tree.nodes if n.type == "TEX_IMAGE" and n.image]:
        if "Diffuse" in n.image.name:
            n.image = graded_copy(n.image, "Table_BaseColor", sat=0.8, value=0.85)
        elif "Rough" in n.image.name:
            n.image = graded_copy(n.image, "Table_Roughness", non_color=True)
        elif "nor_gl" in n.image.name:
            n.image = graded_copy(n.image, "Table_Normal", non_color=True)
    m.use_backface_culling = True
    me.materials.append(m)
    ob = bpy.data.objects.new("Table", me)
    AUTH.objects.link(ob)
    # UVs: one texture tile per 0.9 m, grain along X. Legs get vertical grain.
    uvl = me.uv_layers.new(name="UVMap").data
    S = 0.9
    for poly in me.polygons:
        n = poly.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        cz = sum(me.vertices[i].co.z for i in poly.vertices) / len(poly.vertices)
        is_leg = cz < -0.2 or (ax != 2 and min(me.vertices[i].co.z for i in poly.vertices) < -0.3)
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            if ax == 2:
                u, v = co.x / S + 0.5, co.y / S + 0.5
            elif ax == 0:
                u, v = co.y / S, co.z / S
            else:
                u, v = co.x / S, co.z / S
            if is_leg and ax != 2:
                u, v = v, u
            uvl[li].uv = (u, v)
    for p in me.polygons:
        p.use_smooth = False
    return ob


# --------------------------------------------------------------------------------------------
# cameras + previews
# --------------------------------------------------------------------------------------------
def add_camera(name, spec):
    cd = bpy.data.cameras.new(name)
    cd.sensor_fit = "VERTICAL"
    cd.sensor_height = 24.0
    cd.lens = 12.0 / math.tan(math.radians(spec["fov"]) / 2)
    cd.clip_start = 0.02
    cd.clip_end = 50
    ob = bpy.data.objects.new("Cam_" + name, cd)
    bpy.context.scene.collection.objects.link(ob)
    p, t = gl2bl(spec["pos"]), gl2bl(spec["target"])
    ob.location = p
    ob.rotation_euler = (t - p).to_track_quat("-Z", "Y").to_euler()
    return ob


def render_preview(sc, cam, res, path, samples):
    sc.camera = cam
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    sc.cycles.samples = samples
    sc.render.image_settings.file_format = "PNG"
    sc.render.filepath = path
    t = time.time()
    bpy.ops.render.render(write_still=True)
    log(f"preview {os.path.basename(path)} {res[0]}x{res[1]} in {time.time() - t:.1f}s")


# --------------------------------------------------------------------------------------------
# bake
# --------------------------------------------------------------------------------------------
def prepare_background(sc, table):
    """Copy every background object, convert/apply, join into one mesh with a lightmap UV."""
    bake_c = coll("Export")
    srcs = [o for o in AUTH.objects if o.type in ("MESH", "CURVE") and o is not table]
    copies = []
    for o in srcs:
        c = o.copy()
        c.data = o.data.copy()
        bake_c.objects.link(c)
        copies.append(c)
        o.hide_render = True
        o.hide_set(True)
    bpy.ops.object.select_all(action="DESELECT")
    for c in copies:
        c.select_set(True)
    bpy.context.view_layer.objects.active = copies[0]
    bpy.ops.object.convert(target="MESH")
    copies = [o for o in bpy.context.selected_objects]
    for c in copies:
        w = float(c.get("lm_weight", 1.0))
        me = c.data
        if "UVMap" not in me.uv_layers:
            me.uv_layers.new(name="UVMap")
        if "Lightmap" not in me.uv_layers:
            me.uv_layers.new(name="Lightmap")
        for u in [u for u in me.uv_layers if u.name not in ("UVMap", "Lightmap")]:
            me.uv_layers.remove(u)
        nf = len(me.polygons)
        if "lm_custom" not in me.attributes:
            me.attributes.new("lm_custom", "INT", "FACE")
        if c.get("lm_from_uvmap"):
            src = np.empty(len(me.loops) * 2, dtype=np.float32)
            me.uv_layers["UVMap"].data.foreach_get("uv", src)
            me.uv_layers["Lightmap"].data.foreach_set("uv", src)
            me.attributes["lm_custom"].data.foreach_set("value", [1] * nf)
        a = me.attributes.new("lm_w", "FLOAT", "FACE")
        a.data.foreach_set("value", [w] * nf)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.context.view_layer.objects.active = copies[0]
    bpy.ops.object.join()
    bg = bpy.context.view_layer.objects.active
    bg.name = "Background"
    bg.data.name = "Background"
    me = bg.data
    me.calc_loop_triangles()
    log(f"Background joined: {len(me.polygons)} faces, {len(me.loop_triangles)} tris, {len(me.materials)} materials")
    return bg


def lightmap_uv(bg, atlas_px, margin_px=4):
    """Lightmap UVs: models keep their own UVs, lathes keep their unrolled strip, everything else
    gets Smart UV Project; then all islands get uniform texel density x per-object weight, packed."""
    me = bg.data
    me.uv_layers.active = me.uv_layers["Lightmap"]
    me.uv_layers["UVMap"].active_render = True
    custom = np.empty(len(me.polygons), dtype=np.int32)
    me.attributes["lm_custom"].data.foreach_get("value", custom)
    me.polygons.foreach_set("select", (custom == 0).tolist())
    bpy.ops.object.select_all(action="DESELECT")
    bg.select_set(True)
    bpy.context.view_layer.objects.active = bg
    bpy.context.scene.tool_settings.use_uv_select_sync = True
    bpy.ops.object.mode_set(mode="EDIT")
    t = time.time()
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), margin_method="SCALED", island_margin=0.0, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
    log(f"smart_project on {(custom == 0).sum()} faces ({(custom != 0).sum()} keep custom UVs) {time.time() - t:.1f}s")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.average_islands_scale()
    bpy.ops.object.mode_set(mode="OBJECT")
    # mode switches rebuild mesh data: always re-fetch layers after them
    me = bg.data
    lm = me.uv_layers["Lightmap"]
    n = len(me.loops)
    uv = np.empty(n * 2, dtype=np.float32)
    lm.data.foreach_get("uv", uv)
    uv = uv.reshape(-1, 2)
    fw = np.empty(len(me.polygons), dtype=np.float32)
    me.attributes["lm_w"].data.foreach_get("value", fw)
    loop_total = np.empty(len(me.polygons), dtype=np.int32)
    me.polygons.foreach_get("loop_total", loop_total)
    loop_face = np.repeat(np.arange(len(me.polygons)), loop_total)
    uv = uv * fw[loop_face][:, None]
    uv -= uv.min(0)
    uv /= uv.max() * 1.0001
    lm.data.foreach_set("uv", uv.ravel())
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    t = time.time()
    bpy.ops.uv.pack_islands(udim_source="CLOSEST_UDIM", rotate=True, rotate_method="ANY", scale=True, merge_overlap=False, margin_method="FRACTION", margin=margin_px / atlas_px, shape_method="CONCAVE")
    log(f"pack_islands {time.time() - t:.1f}s")
    bpy.ops.mesh.select_all(action="DESELECT")
    bpy.ops.uv.select_overlap(extend=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    me = bg.data
    overl = sum(p.select for p in me.polygons)
    log(f"faces with overlapping lightmap UVs: {overl}")
    lm = me.uv_layers["Lightmap"]
    lm.data.foreach_get("uv", uv.ravel())
    me.calc_loop_triangles()
    tri = np.array([t.loops[:] for t in me.loop_triangles])
    tri_face = np.array([t.polygon_index for t in me.loop_triangles])
    co = np.empty(len(me.vertices) * 3, dtype=np.float32)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    lv = np.empty(n, dtype=np.int32)
    me.loops.foreach_get("vertex_index", lv)
    p3 = co[lv[tri]]
    a3 = 0.5 * np.linalg.norm(np.cross(p3[:, 1] - p3[:, 0], p3[:, 2] - p3[:, 0]), axis=1)
    p2 = uv[tri]
    a2 = 0.5 * np.abs((p2[:, 1, 0] - p2[:, 0, 0]) * (p2[:, 2, 1] - p2[:, 0, 1]) - (p2[:, 2, 0] - p2[:, 0, 0]) * (p2[:, 1, 1] - p2[:, 0, 1]))
    w1 = np.isclose(fw[tri_face], 1.0)
    dens = math.sqrt(a2[w1].sum() / max(a3[w1].sum(), 1e-9)) * atlas_px
    log(f"lightmap: {dens:.0f} texels/m at weight 1.0 ({1000 / dens:.1f} mm/texel), UV coverage {a2.sum() * 100:.1f}%, range {uv.min():.3f}..{uv.max():.3f}")
    return lm


def new_float_image(name, size):
    if name in bpy.data.images:
        bpy.data.images.remove(bpy.data.images[name])
    return bpy.data.images.new(name, size, size, alpha=False, float_buffer=True)


def set_bake_target(bg, img):
    for m in bg.data.materials:
        nt = m.node_tree
        node = nt.nodes.get("__bake_target") or nt.nodes.new("ShaderNodeTexImage")
        node.name = "__bake_target"
        node.image = img
        node.interpolation = "Closest"
        for n in nt.nodes:
            n.select = False
        node.select = True
        nt.nodes.active = node


def ensure_explicit_uv(materials):
    """Make every image texture sample UVMap explicitly (imported glTF materials rely on the
    render-active UV map); baking runs with Lightmap as the active UV layer."""
    for m in materials:
        if not m or not m.node_tree:
            continue
        nt = m.node_tree
        for n in list(nt.nodes):
            if n.type == "TEX_IMAGE" and n.name != "__bake_target" and not n.inputs[0].is_linked:
                uvn = nt.nodes.new("ShaderNodeUVMap")
                uvn.uv_map = "UVMap"
                nt.links.new(uvn.outputs[0], n.inputs[0])
            if n.type == "NORMAL_MAP" and not n.uv_map:
                n.uv_map = "UVMap"


def bake_pass(sc, bg, img, type_, samples, margin, pass_filter=None, **kw):
    set_bake_target(bg, img)
    sc.cycles.samples = samples
    sc.render.bake.margin = margin
    sc.render.bake.margin_type = "EXTEND"
    bpy.ops.object.select_all(action="DESELECT")
    bg.select_set(True)
    bpy.context.view_layer.objects.active = bg
    t = time.time()
    args = dict(type=type_, margin=margin, margin_type="EXTEND", use_clear=True, uv_layer="Lightmap", target="IMAGE_TEXTURES")
    if pass_filter is not None:
        args["pass_filter"] = pass_filter
    args.update(kw)
    bpy.ops.object.bake(**args)
    log(f"bake {type_} {sorted(pass_filter) if pass_filter else ''} {img.size[0]}px @{samples}spp in {time.time() - t:.1f}s")


def img_np(img):
    w, h = img.size
    a = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(h, w, 4)


def denoise(sc, beauty, albedo, normal, size):
    """OIDN via the compositor (no Render Layers node, so nothing is rendered)."""
    ng = bpy.data.node_groups.new("BakeDenoise", "CompositorNodeTree")
    sc.compositing_node_group = ng
    ng.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
    i_b = ng.nodes.new("CompositorNodeImage")
    i_b.image = beauty
    i_a = ng.nodes.new("CompositorNodeImage")
    i_a.image = albedo
    i_n = ng.nodes.new("CompositorNodeImage")
    i_n.image = normal
    dn = ng.nodes.new("CompositorNodeDenoise")
    for s in dn.inputs:
        if s.name == "HDR" and hasattr(s, "default_value"):
            s.default_value = True
    for prop, val in (("use_hdr", True), ("prefilter", "ACCURATE"), ("quality", "HIGH")):
        if hasattr(dn, prop):
            setattr(dn, prop, val)
    for s in dn.inputs:
        for name, cands in (("Prefilter", ("Accurate", "ACCURATE")), ("Quality", ("High", "HIGH"))):
            if s.name == name and hasattr(s, "default_value"):
                for c in cands:
                    try:
                        s.default_value = c
                        break
                    except Exception:
                        pass
    go = ng.nodes.new("NodeGroupOutput")
    ng.links.new(i_b.outputs[0], dn.inputs["Image"])
    ng.links.new(i_a.outputs[0], dn.inputs["Albedo"])
    ng.links.new(i_n.outputs[0], dn.inputs["Normal"])
    ng.links.new(dn.outputs[0], go.inputs[0])
    prev = (sc.render.engine, sc.render.resolution_x, sc.render.resolution_y, sc.camera)
    sc.render.engine = "BLENDER_WORKBENCH"
    sc.render.resolution_x = sc.render.resolution_y = size
    sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = "OPEN_EXR"
    sc.render.image_settings.color_depth = "32"
    out = os.path.join(BAKE_DIR, "atlas_denoised.exr")
    sc.render.filepath = out
    t = time.time()
    bpy.ops.render.render(write_still=True)
    log(f"denoise {time.time() - t:.1f}s")
    sc.render.engine, sc.render.resolution_x, sc.render.resolution_y, sc.camera = prev
    sc.compositing_node_group = None
    res = bpy.data.images.load(out)
    return img_np(res)


def srgb_encode(lin):
    lin = np.clip(lin, 0.0, 1.0)
    return np.where(lin <= 0.0031308, lin * 12.92, 1.055 * np.power(lin, 1 / 2.4) - 0.055)


def bake_all(sc, bg, atlas, samples):
    os.makedirs(BAKE_DIR, exist_ok=True)
    ensure_explicit_uv(bg.data.materials)
    margin = 16 if atlas >= 2048 else 8
    combined = new_float_image("bake_combined", atlas)
    bake_pass(sc, bg, combined, "COMBINED", samples, margin, pass_filter={"EMIT", "DIRECT", "INDIRECT", "DIFFUSE", "GLOSSY", "TRANSMISSION"})
    combined.filepath_raw = os.path.join(BAKE_DIR, "atlas_combined.exr")
    combined.file_format = "OPEN_EXR"
    combined.save()
    albedo = new_float_image("bake_albedo", atlas)
    bake_pass(sc, bg, albedo, "DIFFUSE", 8, margin, pass_filter={"COLOR"})
    normal = new_float_image("bake_normal", atlas)
    bake_pass(sc, bg, normal, "NORMAL", 8, margin, normal_space="OBJECT")
    # OIDN wants normals in [-1, 1]
    npx = img_np(normal)
    npx[..., :3] = npx[..., :3] * 2.0 - 1.0
    normal.pixels.foreach_set(npx.ravel())
    # emissive texels have no diffuse albedo: give OIDN their colour so it keeps their edges crisp
    alb = img_np(albedo)
    comb = img_np(combined)
    dark = alb[..., :3].max(-1) < 0.002
    alb[dark, :3] = np.clip(comb[dark, :3], 0, 1)
    albedo.pixels.foreach_set(alb.ravel())
    dn = denoise(sc, combined, albedo, normal, atlas)
    rgb = srgb_encode(dn[..., :3])
    out = np.concatenate([rgb, np.ones(rgb.shape[:2] + (1,), np.float32)], -1)
    final = bpy.data.images.new("dive-bar_atlas", atlas, atlas, alpha=False)
    final.pixels.foreach_set(out.astype(np.float32).ravel())
    path = os.path.join(BAKE_DIR, "dive-bar_atlas.png")  # also embedded in the raw GLB
    final.filepath_raw = path
    final.file_format = "PNG"
    final.save()
    log("atlas written", path, "mean", float(rgb.mean()))
    bpy.data.images.remove(final)
    img = bpy.data.images.load(path)
    img.name = "dive-bar_atlas"
    return img


def bake_table_ao(sc, table, size=512, samples=128):
    """AO-only texture for the table (legs, apron, underside) on its own UV set -> glTF occlusionTexture
    (TEXCOORD_1). The top surface stays ~white, so the app's realtime lighting is untouched there."""
    me = table.data
    if "AO" not in me.uv_layers:
        ao_uv = me.uv_layers.new(name="AO")
    me.uv_layers.active = me.uv_layers["AO"]
    me.uv_layers["UVMap"].active_render = True
    bpy.ops.object.select_all(action="DESELECT")
    table.select_set(True)
    bpy.context.view_layer.objects.active = table
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.0, scale_to_bounds=False)
    bpy.ops.uv.pack_islands(udim_source="CLOSEST_UDIM", rotate=True, scale=True, margin_method="FRACTION", margin=4 / size, shape_method="CONCAVE")
    bpy.ops.object.mode_set(mode="OBJECT")
    img = bpy.data.images.new("Table_AO", size, size, alpha=False, float_buffer=True)
    m = table.data.materials[0]
    nt = m.node_tree
    tex_node = nt.nodes.new("ShaderNodeTexImage")
    tex_node.image = img
    for n in nt.nodes:
        n.select = False
    tex_node.select = True
    nt.nodes.active = tex_node
    sc.world.light_settings.distance = 0.35
    sc.cycles.samples = samples
    t = time.time()
    bpy.ops.object.bake(type="AO", margin=8, margin_type="EXTEND", use_clear=True, uv_layer="AO", target="IMAGE_TEXTURES")
    log(f"table AO bake {size}px in {time.time() - t:.1f}s")
    a = img_np(img)
    ao = np.clip(a[..., 0], 0, 1) ** 0.8  # soften slightly: it multiplies indirect light only in three.js
    out = np.stack([ao, ao, ao, np.ones_like(ao)], -1)
    final = bpy.data.images.new("Table_AO", size, size, alpha=False)
    final.colorspace_settings.name = "Non-Color"
    final.pixels.foreach_set(out.astype(np.float32).ravel())
    final.filepath_raw = os.path.join(BAKE_DIR, "Table_AO.png")
    final.file_format = "PNG"
    final.save()
    bpy.data.images.remove(img)
    tex_node.image = final
    # glTF Material Output group: the exporter reads its "Occlusion" input
    grp = bpy.data.node_groups.get("glTF Material Output")
    if grp is None:
        grp = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
        grp.interface.new_socket("Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
    gn = nt.nodes.new("ShaderNodeGroup")
    gn.node_tree = grp
    uvn = nt.nodes.new("ShaderNodeUVMap")
    uvn.uv_map = "AO"
    nt.links.new(uvn.outputs[0], tex_node.inputs[0])
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(tex_node.outputs[0], sep.inputs[0])
    nt.links.new(sep.outputs[0], gn.inputs["Occlusion"])
    me.uv_layers.active = me.uv_layers["UVMap"]
    return final


def make_export_material(bg, atlas_img):
    m, nt, out = new_material("DiveBar_Baked")
    uvn = nt.nodes.new("ShaderNodeUVMap")
    uvn.uv_map = "Lightmap"
    ti = nt.nodes.new("ShaderNodeTexImage")
    ti.image = atlas_img
    ti.interpolation = "Linear"
    nt.links.new(uvn.outputs[0], ti.inputs[0])
    bgs = nt.nodes.new("ShaderNodeBackground")
    nt.links.new(ti.outputs[0], bgs.inputs["Color"])
    nt.links.new(bgs.outputs[0], out.inputs[0])
    m.use_backface_culling = True
    me = bg.data
    me.materials.clear()
    me.materials.append(m)
    for p in me.polygons:
        p.material_index = 0
    me.uv_layers.remove(me.uv_layers["UVMap"])
    me.uv_layers["Lightmap"].active = True
    me.uv_layers["Lightmap"].active_render = True
    for name in ("lm_w", "lm_custom"):
        if name in me.attributes:
            me.attributes.remove(me.attributes[name])
    # imported models carry vertex colours; GLTFLoader would multiply the atlas by them
    for ca in list(me.color_attributes):
        me.color_attributes.remove(ca)
    return m


def export_glb(bg, table, path):
    for k in list(bg.keys()):
        del bg[k]
    bg["keyLight"] = {
        "type": "spot",
        "position": [round(KEY_LIGHT_POS.x, 4), round(KEY_LIGHT_POS.z, 4), round(-KEY_LIGHT_POS.y, 4)],
        "target": [0.0, 0.0, 0.0],
        "colorTemperatureK": KEY_LIGHT_K,
        "blenderWatts": KEY_LIGHT_W,
        "angleDeg": 59.0,
        "penumbra": 0.55,
        # three.js SpotLight equivalent (physical units, decay 2). Measured in Cycles: P watts give
        # radiant intensity P/(4*pi); 2700 K is linear RGB (1.931, 0.802, 0.191) at unit luminance,
        # i.e. colour #ffac59 (sRGB) at intensity P/(4*pi) * 1.931.
        "three": {"color": "#ffac59", "intensity": round(KEY_LIGHT_W / (4 * math.pi) * 1.931, 2), "angle": round(math.radians(59.0), 4), "penumbra": 0.55, "decay": 2},
    }
    bg["bakedLighting"] = "linear radiance, sRGB-encoded; render unlit with tone mapping on"
    for k in list(table.keys()):
        del table[k]
    bpy.ops.object.select_all(action="DESELECT")
    bg.select_set(True)
    table.select_set(True)
    bpy.context.view_layer.objects.active = bg
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_extras=True,
        export_lights=False,
        export_cameras=False,
        export_animations=False,
        **({"export_vertex_color": "NONE"} if "export_vertex_color" in bpy.ops.export_scene.gltf.get_rna_type().properties.keys() else {}),
    )
    log("exported", path, f"{os.path.getsize(path) / 1e6:.2f} MB")


# --------------------------------------------------------------------------------------------
def build_scene():
    global AUTH
    rng = random.Random(7)
    AUTH = coll("Authoring")
    M = build_materials()
    build_room(M)
    build_counter(M)
    build_back_bar(M, rng)
    build_neon(M)
    build_lamp(M)
    build_counter_props(M, rng)
    chair = import_model("plastic_monobloc_chair_01")
    crate = import_model("plastic_crate_02")
    tv = import_model("Television_01")
    stool = import_model("painted_wooden_stool")
    tint_imported(chair, (0.95, 0.9, 0.82), value=0.72)  # aged cream plastic, keeps the table brightest
    # decimate the crate (5.8k tris) - it's baked, the silhouette is what matters
    dec = crate.modifiers.new("dec", "DECIMATE")
    dec.ratio = 0.45
    bpy.context.scene.collection.objects.link(crate)
    bpy.context.view_layer.objects.active = crate
    bpy.ops.object.modifier_apply(modifier="dec")
    bpy.context.scene.collection.objects.unlink(crate)
    # green bottles variant for one crate
    gm = bottle_mesh(M, "beer_crate").copy()
    gm.name = "Bottle_beer_crate_green_m"
    gm.materials[0] = M["glass_green"]
    gm.materials[2] = M["cap_silver"]
    BOTTLES["beer_crate_green_m"] = gm
    build_crates(M, rng, crate)
    build_chiller(M, rng)
    build_videoke(M, tv, rng)
    build_chairs(M, chair, stool, rng)
    for p in (chair, crate, tv, stool):
        bpy.data.objects.remove(p)
    table = build_table(M)
    cams = {k: add_camera(k, v) for k, v in CAMERAS.items()}
    return M, table, cams


def tri_count(objs):
    dg = bpy.context.evaluated_depsgraph_get()
    n = 0
    for o in objs:
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        me.calc_loop_triangles()
        n += len(me.loop_triangles)
        ev.to_mesh_clear()
    return n


def main():
    opts = parse_args()
    log("options", opts)
    sys.path.insert(0, HERE)
    import fetch_assets

    fetch_assets.fetch_all()
    sc = reset_scene()
    setup_cycles(sc, opts["preview_samples"])
    M, table, cams = build_scene()
    objs = [o for o in AUTH.objects if o.type in ("MESH", "CURVE")]
    log(f"scene built: {len(objs)} objects, ~{tri_count(objs)} tris (table {tri_count([table])})")
    os.makedirs(opts["preview_dir"], exist_ok=True)

    if opts["stage"] == "design":
        for k in ("portrait", "landscape", "seated", "overview"):
            render_preview(sc, cams[k], CAMERAS[k]["res"], os.path.join(opts["preview_dir"], f"design_{k}.png"), opts["preview_samples"])
        bpy.context.preferences.filepaths.save_version = 0
        bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH, compress=True, relative_remap=True)
        log("saved", BLEND_PATH)
        return

    # ---- bake ----
    bg = prepare_background(sc, table)
    lightmap_uv(bg, opts["atlas"])
    atlas_img = bake_all(sc, bg, opts["atlas"], opts["samples"])
    make_export_material(bg, atlas_img)
    bake_table_ao(sc, table)
    # authoring copies stay hidden from render; export collection holds Background + Table
    coll("Export").objects.link(table)
    os.makedirs(EXPORT_DIR, exist_ok=True)
    export_glb(bg, table, os.path.join(EXPORT_DIR, "dive-bar.raw.glb"))
    os.makedirs(PUBLIC_DIR, exist_ok=True)
    shutil.copyfile(os.path.join(DL, "hdris", "warm_bar_1k.hdr"), os.path.join(PUBLIC_DIR, "env.hdr"))
    log("env.hdr", os.path.getsize(os.path.join(PUBLIC_DIR, "env.hdr")), "bytes")
    # save: authoring visible, export collection hidden in viewport
    for o in AUTH.objects:
        o.hide_render = False
        o.hide_set(False)
    lc = bpy.context.view_layer.layer_collection.children.get("Export")
    if lc:
        lc.hide_viewport = True
    bg.hide_render = True
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH, compress=True, relative_remap=True)
    log("saved", BLEND_PATH)


if __name__ == "__main__":
    main()
