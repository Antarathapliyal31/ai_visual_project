from pathlib import Path
import numpy as np
import trimesh

out_path = Path(__file__).resolve().parents[1] / 'harness' / 'assets' / 'human-female.glb'
out_path.parent.mkdir(parents=True, exist_ok=True)

scene = trimesh.Scene()


def add_box(center, size, color):
    mesh = trimesh.creation.box(extents=size)
    mesh.apply_translation(center)
    mesh.visual.face_colors = np.tile(color, (len(mesh.faces), 1))
    return mesh


def add_sphere(center, radius, color):
    mesh = trimesh.creation.icosphere(subdivisions=2, radius=radius)
    mesh.apply_translation(center)
    mesh.visual.face_colors = np.tile(color, (len(mesh.faces), 1))
    return mesh


def add_capsule(center, radius, height, color):
    mesh = trimesh.creation.capsule(radius=radius, height=height)
    mesh.apply_translation(center)
    mesh.visual.face_colors = np.tile(color, (len(mesh.faces), 1))
    return mesh

skin = np.array([0xe7, 0xc2, 0x92], dtype=np.uint8)
hair = np.array([0x36, 0x24, 0x1f], dtype=np.uint8)
pajama = np.array([0x8a, 0xa8, 0xe5], dtype=np.uint8)
pajama_dark = np.array([0x67, 0x7d, 0xc9], dtype=np.uint8)
shoe = np.array([0x4b, 0x39, 0x2f], dtype=np.uint8)

scene.add_geometry(add_sphere((0.0, 1.65, 0.0), 0.16, skin))
scene.add_geometry(add_sphere((0.0, 1.72, 0.0), 0.16, hair))
scene.add_geometry(add_box((0.0, 1.18, 0.0), (0.62, 0.74, 0.34), pajama))
scene.add_geometry(add_box((0.0, 0.62, 0.0), (0.52, 0.52, 0.26), pajama_dark))

# arms
scene.add_geometry(add_box((-0.35, 1.18, 0.00), (0.18, 0.62, 0.18), skin))
scene.add_geometry(add_box((0.35, 1.18, 0.00), (0.18, 0.62, 0.18), skin))
# legs
scene.add_geometry(add_box((-0.12, 0.44, 0.0), (0.18, 0.72, 0.18), skin))
scene.add_geometry(add_box((0.12, 0.44, 0.0), (0.18, 0.72, 0.18), skin))
# feet
scene.add_geometry(add_box((-0.12, 0.06, 0.08), (0.20, 0.12, 0.26), shoe))
scene.add_geometry(add_box((0.12, 0.06, 0.08), (0.20, 0.12, 0.26), shoe))

# hair cap
scene.add_geometry(add_sphere((0.0, 1.80, 0.0), 0.17, hair))
scene.add_geometry(add_box((0.0, 1.90, 0.0), (0.46, 0.10, 0.48), hair))

# simple face features
scene.add_geometry(add_sphere((-0.05, 1.69, 0.12), 0.025, np.array([0x08, 0x08, 0x08], dtype=np.uint8)))
scene.add_geometry(add_sphere((0.05, 1.69, 0.12), 0.025, np.array([0x08, 0x08, 0x08], dtype=np.uint8)))
scene.add_geometry(add_box((0.0, 1.58, 0.14), (0.08, 0.02, 0.02), np.array([0x9d, 0x42, 0x38], dtype=np.uint8)))

# slight style for a sleeping pose with arms folded on lap
scene.add_geometry(add_box((-0.18, 1.0, 0.20), (0.32, 0.22, 0.18), skin))
scene.add_geometry(add_box((0.18, 1.0, -0.20), (0.32, 0.22, 0.18), skin))

scene.apply_translation([0.0, -0.8, 0.0])
scene.export(out_path, file_type='glb')
print(f'Wrote {out_path} ({out_path.stat().st_size} bytes)')
