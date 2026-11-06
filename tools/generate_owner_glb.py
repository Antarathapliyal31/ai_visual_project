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


def add_sphere(center, radius, color, subdivisions=2):
    mesh = trimesh.creation.icosphere(subdivisions=subdivisions, radius=radius)
    mesh.apply_translation(center)
    mesh.visual.face_colors = np.tile(color, (len(mesh.faces), 1))
    return mesh


def add_capsule(center, radius, height, color, axis='y'):
    mesh = trimesh.creation.capsule(radius=radius, height=height)
    if axis == 'x':
        mesh.apply_transform(trimesh.transformations.rotation_matrix(np.pi / 2, [0, 0, 1]))
    elif axis == 'z':
        mesh.apply_transform(trimesh.transformations.rotation_matrix(np.pi / 2, [1, 0, 0]))
    mesh.apply_translation(center)
    mesh.visual.face_colors = np.tile(color, (len(mesh.faces), 1))
    return mesh


def add_ellipsoid(center, radii, color, subdivisions=2):
    mesh = trimesh.creation.icosphere(subdivisions=subdivisions, radius=1.0)
    mesh.vertices *= np.array(radii)
    mesh.apply_translation(center)
    mesh.visual.face_colors = np.tile(color, (len(mesh.faces), 1))
    return mesh


skin = np.array([0xe7, 0xc2, 0x92], dtype=np.uint8)
hair = np.array([0x36, 0x24, 0x1f], dtype=np.uint8)
shirt = np.array([0x8a, 0xa8, 0xe5], dtype=np.uint8)
shirt_dark = np.array([0x67, 0x7d, 0xc9], dtype=np.uint8)
pants = np.array([0x5d, 0x7b, 0xc9], dtype=np.uint8)
shoes = np.array([0x88, 0x73, 0x62], dtype=np.uint8)
black = np.array([0x10, 0x10, 0x10], dtype=np.uint8)
rose = np.array([0x9d, 0x42, 0x38], dtype=np.uint8)

# Body laid on its back, head toward the west side (negative X), feet toward the east side (positive X).
# This keeps the scene readable as a real sleeping pose on the bed without turning the character sideways.
shoulders = add_capsule((0.25, 0.0, 0.0), 0.11, 0.62, skin, axis='x')
torso = add_capsule((0.0, 0.0, 0.0), 0.17, 0.82, shirt, axis='x')
waist = add_ellipsoid((0.48, -0.02, 0.0), (0.22, 0.18, 0.18), shirt_dark, subdivisions=2)
neck = add_capsule((-0.62, 0.02, 0.0), 0.06, 0.16, skin, axis='x')
head = add_ellipsoid((-0.92, 0.06, 0.0), (0.20, 0.23, 0.22), skin, subdivisions=3)

# Hair and face
hair_cap = add_ellipsoid((-0.92, 0.16, 0.0), (0.22, 0.18, 0.22), hair, subdivisions=3)
hair_back = add_box((-1.02, 0.18, 0.0), (0.18, 0.08, 0.28), hair)
left_ear = add_sphere((-0.98, 0.04, 0.17), 0.04, skin, subdivisions=1)
right_ear = add_sphere((-0.98, 0.04, -0.17), 0.04, skin, subdivisions=1)
left_eye = add_sphere((-0.86, 0.08, 0.09), 0.024, black, subdivisions=1)
right_eye = add_sphere((-0.86, 0.08, -0.09), 0.024, black, subdivisions=1)
nose = add_capsule((-0.78, -0.02, 0.0), 0.018, 0.09, rose, axis='z')
mouth = add_box((-0.72, -0.12, 0.0), (0.12, 0.02, 0.02), rose)

# Arms and hands relaxed by the sides.
left_arm = add_capsule((0.18, 0.08, 0.42), 0.07, 0.46, skin, axis='x')
right_arm = add_capsule((0.18, 0.08, -0.42), 0.07, 0.46, skin, axis='x')
left_hand = add_ellipsoid((0.34, 0.02, 0.63), (0.08, 0.06, 0.09), skin, subdivisions=2)
right_hand = add_ellipsoid((0.34, 0.02, -0.63), (0.08, 0.06, 0.09), skin, subdivisions=2)

# Legs and feet extended toward the foot of the bed.
left_thigh = add_capsule((0.78, -0.56, 0.14), 0.09, 0.58, pants, axis='x')
right_thigh = add_capsule((0.78, -0.56, -0.14), 0.09, 0.58, pants, axis='x')
left_shin = add_capsule((1.34, -0.72, 0.14), 0.08, 0.52, pants, axis='x')
right_shin = add_capsule((1.34, -0.72, -0.14), 0.08, 0.52, pants, axis='x')
left_foot = add_ellipsoid((1.74, -0.86, 0.22), (0.12, 0.07, 0.22), shoes, subdivisions=2)
right_foot = add_ellipsoid((1.74, -0.86, -0.22), (0.12, 0.07, 0.22), shoes, subdivisions=2)

# Pajama shirt in a soft blue with a darker waist.
shirt_lapel = add_box((0.08, 0.12, 0.0), (0.18, 0.12, 0.30), shirt_dark)

for mesh in [
    shoulders, torso, waist, neck, head, hair_cap, hair_back, left_ear, right_ear,
    left_eye, right_eye, nose, mouth, left_arm, right_arm, left_hand, right_hand,
    left_thigh, right_thigh, left_shin, right_shin, left_foot, right_foot,
    shirt_lapel,
]:
    scene.add_geometry(mesh)

scene.apply_translation([0.0, 0.05, 0.0])
scene.export(out_path, file_type='glb')
print(f'Wrote {out_path} ({out_path.stat().st_size} bytes)')
