"""Re-import an exported dive-bar GLB into a fresh scene and render the in-app camera views.

    scripts/blender-run.sh assets-src/blender/verify_glb.py <glb> <out_dir> [prefix] [samples] [extra]

Renders the two contract views (portrait 9:19.5 and landscape 16:9); pass "extra" as the fifth
argument to also render an upright seated view of the whole room.

Proves the export is self-contained: the Background renders only from its baked unlit atlas
(the importer maps KHR_materials_unlit to camera-only emission, so it neither lights nor shadows
anything), and the Table is lit only by one spot light at the pendant bulb (2700 K), plus the
shipped env.hdr at low strength for reflections, like the app's mid/high tiers.
"""

import math
import os
import sys

import bpy
from mathutils import Vector

CAMERAS = {
    "portrait": dict(pos=(0, 0.95, 0.85), target=(0, 0, -0.05), fov=50, res=(277, 600)),
    "landscape": dict(pos=(0, 1.0, 1.1), target=(0, 0, -0.05), fov=50, res=(1067, 600)),
}
EXTRA = {"seated": dict(pos=(0, 0.45, 1.05), target=(0, 0.25, -1.5), fov=60, res=(1067, 600))}


def gl2bl(v):
    x, y, z = v
    return Vector((x, -z, y))


def main():
    glb, out_dir = sys.argv[1], sys.argv[2]
    prefix = sys.argv[3] if len(sys.argv) > 3 else "verify"
    samples = int(sys.argv[4]) if len(sys.argv) > 4 else 64
    cams = dict(CAMERAS, **(EXTRA if len(sys.argv) > 5 and sys.argv[5] == "extra" else {}))
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    bpy.ops.import_scene.gltf(filepath=glb)

    print(f"[verify] {os.path.basename(glb)}: {os.path.getsize(glb) / 1e6:.2f} MB")
    roots = [o for o in sc.objects if o.parent is None]
    print("[verify] top-level nodes:", [o.name for o in roots])
    total = 0
    for o in sc.objects:
        if o.type != "MESH":
            continue
        me = o.data
        me.calc_loop_triangles()
        total += len(me.loop_triangles)
        mats = [m.name for m in me.materials]
        imgs = sorted({f"{n.image.name} {n.image.size[0]}x{n.image.size[1]}" for m in me.materials if m for n in m.node_tree.nodes if n.type == "TEX_IMAGE" and n.image})
        print(f"[verify] {o.name}: {len(me.loop_triangles)} tris, materials {mats}, uv {[u.name for u in me.uv_layers]}, textures {imgs}")
        if o.keys():
            print(f"[verify]   extras: { {k: (o[k].to_dict() if hasattr(o[k], 'to_dict') else o[k]) for k in o.keys()} }")
    print("[verify] total tris:", total)

    bg = bpy.data.objects.get("Background")
    key = bg.get("keyLight") if bg else None
    pos = Vector(key["position"]) if key else Vector((0, 0.744, 0))
    world = bpy.data.worlds.new("World")
    sc.world = world
    world.use_nodes = True
    nt = world.node_tree
    bgn = next(n for n in nt.nodes if n.type == "BACKGROUND")
    hdr = os.path.join(os.path.dirname(glb), "env.hdr")
    if os.path.exists(hdr):
        env = nt.nodes.new("ShaderNodeTexEnvironment")
        env.image = bpy.data.images.load(hdr)
        nt.links.new(env.outputs[0], bgn.inputs["Color"])
        bgn.inputs["Strength"].default_value = 0.25
    else:
        bgn.inputs["Strength"].default_value = 0.0

    ld = bpy.data.lights.new("TableKey", "SPOT")
    ld.energy = float(key["blenderWatts"]) if key else 45.0
    ld.use_temperature = True
    ld.temperature = float(key["colorTemperatureK"]) if key else 2700
    ld.spot_size = math.radians(118)
    ld.spot_blend = 0.55
    ld.shadow_soft_size = 0.035
    lo = bpy.data.objects.new("TableKey", ld)
    sc.collection.objects.link(lo)
    lo.location = gl2bl(pos)

    sc.render.engine = "CYCLES"
    prefs = bpy.context.preferences.addons["cycles"].preferences
    for kind in ("OPTIX", "CUDA"):
        try:
            prefs.compute_device_type = kind
            prefs.get_devices()
            if any(d.type == kind for d in prefs.devices):
                for d in prefs.devices:
                    d.use = d.type == kind
                sc.cycles.device = "GPU"
                break
        except TypeError:
            pass
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    sc.view_settings.view_transform = "AgX"
    sc.view_settings.look = "None"
    os.makedirs(out_dir, exist_ok=True)
    for name, spec in cams.items():
        cd = bpy.data.cameras.new(name)
        cd.sensor_fit = "VERTICAL"
        cd.sensor_height = 24.0
        cd.lens = 12.0 / math.tan(math.radians(spec["fov"]) / 2)
        cd.clip_start = 0.02
        cam = bpy.data.objects.new("Cam_" + name, cd)
        sc.collection.objects.link(cam)
        p, t = gl2bl(spec["pos"]), gl2bl(spec["target"])
        cam.location = p
        cam.rotation_euler = (t - p).to_track_quat("-Z", "Y").to_euler()
        sc.camera = cam
        sc.render.resolution_x, sc.render.resolution_y = spec["res"]
        sc.render.resolution_percentage = 100
        sc.render.image_settings.file_format = "PNG"
        sc.render.filepath = os.path.join(out_dir, f"{prefix}_{name}.png")
        bpy.ops.render.render(write_still=True)
        print("[verify] wrote", sc.render.filepath)


main()
