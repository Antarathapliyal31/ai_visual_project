// Public API of the physics layer (Workstream B). Import from here.
export { createPhysicsWorld } from './world.js';
export { createMaterialTable, pairKey } from './materials.js';
export { buildProp, registerBreakable, isBreakable, stackHeights, PROP_KINDS, REST_GAP } from './props.js';
export { WarmGSSolver } from './solver.js';
export { spawnSliceScene, SLICE_LAYOUT } from './sliceScene.js';
export { spawnRoomScene } from './roomScene.js';
export { physicsDebugData, registerPhysicsDebug } from './overlay.js';
