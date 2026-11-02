/* [INPUT]: Apple Studio Display official front/side dimensions and measured stand profile.
 * [OUTPUT]: Named procedural display/stand geometry in millimeters, +Y up and +Z front.
 * [POS]: Optional website hardware model; no Apple image, logo or user data is embedded.
 * [PROTOCOL]: Keep settings/AGENTS.md and the reconstruction evidence in sync. */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export const displayDimensions = {
  width: 623,
  height: 362,
  depth: 31,
  totalHeight: 478,
  screenWidth: 597.7,
  screenHeight: 336.2,
  standWidth: 152,
  standDepth: 168,
} as const;

// Independent, low-amplitude micrograin fields; the reference is clean anodized metal.
function aluminumGrain() {
  const size = 1024;
  const roughness = new Uint8Array(size * size * 4);
  const normal = new Uint8Array(size * size * 4);
  let seed = 3821;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < roughness.length; i += 4) {
    const value = 244 + Math.round(random() * 11);
    roughness.set([value, value, value, 255], i);
    normal.set([127 + Math.round(random() * 2), 127 + Math.round(random() * 2), 255, 255], i);
  }
  const texture = (data: Uint8Array) => {
    const map = new THREE.DataTexture(data, size, size);
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.minFilter = THREE.LinearMipmapLinearFilter;
    map.magFilter = THREE.LinearFilter;
    map.generateMipmaps = true;
    map.needsUpdate = true;
    return map;
  };
  return { roughness: texture(roughness), normal: texture(normal) };
}

export function createStudioDisplayModel() {
  const root = new THREE.Group();
  root.name = 'studio-display';
  const display = new THREE.Group();
  display.name = 'display';
  root.add(display);
  const stand = new THREE.Group();
  stand.name = 'stand-assembly';
  root.add(stand);
  const parts: Record<string, THREE.Mesh> = {};
  const grain = aluminumGrain();
  const silver = new THREE.MeshPhysicalMaterial({
    color: 0xd5d6d8,
    metalness: 1,
    roughness: 0.34,
    roughnessMap: grain.roughness,
    normalMap: grain.normal,
    normalScale: new THREE.Vector2(0.015, 0.015),
  });
  const black = new THREE.MeshPhysicalMaterial({
    color: 0x030303,
    roughness: 0.68,
    metalness: 0,
    envMapIntensity: 0.025,
    specularIntensity: 0.01,
  });
  function part(
    id: string,
    parent: THREE.Group,
    size: [number, number, number],
    position: [number, number, number],
    material: THREE.Material,
  ) {
    const mesh = new THREE.Mesh(
      new RoundedBoxGeometry(...size, 3, Math.min(0.7, size[2] / 3, size[1] / 3)),
      material,
    );
    mesh.name = id;
    mesh.position.set(...position);
    parent.add(mesh);
    parts[id] = mesh;
    return mesh;
  }
  part('housing', display, [623, 362, 31], [0, 297, -15.5], silver);
  part('bezel', display, [620, 359, 1], [0, 297, 0.4], black);
  const screen = part(
    'screen',
    display,
    [597.7, 336.2, 0.1],
    [0, 297, 1],
    new THREE.MeshBasicMaterial({ color: 0xf4f4f5 }),
  );
  screen.userData.explodeWithParent = true;
  const plate = new THREE.Shape();
  plate.moveTo(-75.3, 0);
  plate.lineTo(75.3, 0);
  plate.lineTo(75.3, 207.1);
  plate.lineTo(-75.3, 207.1);
  plate.closePath();
  const hole = new THREE.Path();
  hole.absarc(0, 123.7, 22, 0, Math.PI * 2, true);
  plate.holes.push(hole);
  const stem = new THREE.Mesh(
    new THREE.ExtrudeGeometry(plate, {
      depth: 3.6,
      bevelEnabled: true,
      bevelThickness: 0.7,
      bevelSize: 0.7,
      bevelSegments: 3,
      curveSegments: 48,
    }),
    silver,
  );
  stem.name = 'stand';
  stem.position.set(0, 4.5, -87);
  stem.rotation.x = (14 * Math.PI) / 180;
  stand.add(stem);
  parts.stand = stem;
  const hinge = new THREE.Mesh(new THREE.CylinderGeometry(10, 10, 152, 48), silver);
  hinge.name = 'hinge';
  hinge.rotation.z = Math.PI / 2;
  hinge.position.set(0, 206, -40);
  stand.add(hinge);
  parts.hinge = hinge;
  const lens = new THREE.Mesh(new THREE.SphereGeometry(1.6, 16, 8), black);
  lens.name = 'camera';
  lens.position.set(0, 471, 0.9);
  lens.scale.z = 0.25;
  display.add(lens);
  parts.camera = lens;
  part('foot', stand, [152, 5, 168], [0, 2.5, -26], silver);
  const heelShape = new THREE.Shape();
  heelShape.moveTo(97, 4.6);
  heelShape.lineTo(81, 4.6);
  heelShape.lineTo(80, 16);
  heelShape.lineTo(84.4, 16);
  heelShape.quadraticCurveTo(87, 5, 97, 5);
  heelShape.closePath();
  const heelGeo = new THREE.ExtrudeGeometry(heelShape, {
    depth: 152,
    bevelEnabled: false,
    curveSegments: 16,
  });
  heelGeo.rotateY(Math.PI / 2);
  heelGeo.translate(-76, 0, 0);
  const heel = new THREE.Mesh(heelGeo, silver);
  heel.name = 'stand-heel';
  heel.userData.explodeWithParent = true;
  stand.add(heel);
  parts['stand-heel'] = heel;
  part('rubber', stand, [18, 1, 160], [-64, 0.4, -26], black);
  const pad = part('rubber-right', stand, [18, 1, 160], [64, 0.4, -26], black);
  pad.userData.explodeWithParent = true;

  const nodes: Record<string, THREE.Object3D> = { root, display, 'stand-assembly': stand };
  const sockets: Record<string, THREE.Object3D> = {};
  const rest = new Map<THREE.Object3D, THREE.Vector3>();
  root.updateMatrixWorld(true);
  const colliders: Record<string, { type: 'box'; size: number[]; center: number[] }> = {};
  for (const [id, mesh] of Object.entries(parts)) {
    const pivot = new THREE.Group();
    pivot.name = `${id}-pivot`;
    pivot.position.copy(mesh.position);
    pivot.quaternion.copy(mesh.quaternion);
    pivot.scale.copy(mesh.scale);
    mesh.parent!.add(pivot);
    pivot.add(mesh);
    mesh.position.set(0, 0, 0);
    mesh.quaternion.identity();
    mesh.scale.set(1, 1, 1);
    const socket = new THREE.Object3D();
    socket.name = `${id}-contact`;
    pivot.add(socket);
    sockets[id] = socket;
    nodes[id] = pivot;
    rest.set(pivot, pivot.position.clone());
    mesh.userData.partId = id;
    root.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(mesh);
    colliders[id] = {
      type: 'box',
      size: bounds.getSize(new THREE.Vector3()).toArray(),
      center: bounds.getCenter(new THREE.Vector3()).toArray(),
    };
  }
  const seam = new THREE.Object3D();
  seam.name = 'display-hinge';
  seam.position.set(0, 206, -40);
  root.add(seam);
  sockets['display-hinge'] = seam;
  const setExploded = (amount: number) => {
    for (const [id, mesh] of Object.entries(parts)) {
      const pivot = nodes[id],
        origin = rest.get(pivot)!;
      pivot.position.copy(origin);
      const pair: Record<string, string> = {
        screen: 'housing',
        'stand-heel': 'stand',
        'rubber-right': 'rubber',
      };
      const direction = rest.get(nodes[pair[id] ?? id])!;
      pivot.position.add(
        new THREE.Vector3(direction.x, direction.y - 239, direction.z)
          .normalize()
          .multiplyScalar(amount * 60),
      );
    }
    root.updateMatrixWorld(true);
  };
  const pickPart = (raycaster: THREE.Raycaster) =>
    raycaster.intersectObjects(Object.values(parts), false)[0]?.object.userData.partId as
      string | undefined;
  root.userData.sculptRuntime = {
    nodes,
    meshes: parts,
    sockets,
    colliders,
    destructionGroups: {
      display: ['housing', 'bezel', 'camera', 'screen'],
      stand: ['stand', 'foot', 'hinge', 'stand-heel', 'rubber', 'rubber-right'],
    },
    setExploded,
    pickPart,
  };
  return {
    root,
    display,
    stand,
    parts,
    setExploded,
    pickPart,
    dispose() {
      const geometries = new Set<THREE.BufferGeometry>();
      const materials = new Set<THREE.Material>();
      const textures = new Set<THREE.Texture>();
      root.traverse((node) => {
        if (!(node instanceof THREE.Mesh)) return;
        geometries.add(node.geometry);
        for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
          materials.add(material);
          for (const value of Object.values(material))
            if (value instanceof THREE.Texture) textures.add(value);
        }
      });
      geometries.forEach((item) => item.dispose());
      materials.forEach((item) => item.dispose());
      textures.forEach((item) => item.dispose());
    },
  };
}
