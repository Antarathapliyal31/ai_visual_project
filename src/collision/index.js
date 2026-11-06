// Public API of the collision layer (Workstream A). Import from here.
export { UniformGridBroadphase } from './gridBroadphase.js';
export { createRaycaster, rayVsAABB, rayVsBox } from './raycast.js';
export { createSweptGuard } from './sweptGuard.js';
export { createFracture } from './fracture.js';
export { hidingSpotAt, lineOfSight, HIDING_VOLUMES } from './hiding.js';
export {
  buildStaticGeometry, makeStaticBox, isSolidStatic, STATIC_BOXES, OCCLUDERS, SURFACES, ROOM,
} from './staticGeometry.js';
export { collisionDebugData, registerCollisionDebug, narrowPairCount } from './overlay.js';
