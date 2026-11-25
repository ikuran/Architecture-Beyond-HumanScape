// Maps `import ... from 'three'` to the global THREE (r128) that the Manhattan scene uses,
// so the hand-tracking modules and the city scene share one renderer and one THREE build.
const T = window.THREE;
export default T;
export const {
  Color, DynamicDrawUsage, InstancedMesh, Matrix4, MeshBasicMaterial, Object3D, Quaternion,
  SphereGeometry, Vector3, Camera, CanvasTexture, Mesh, PlaneGeometry, MathUtils, Group,
} = T;
export const SRGBColorSpace = T.SRGBColorSpace;
