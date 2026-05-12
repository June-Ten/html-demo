import * as THREE from 'three'
import { geoMercator } from 'd3-geo'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'

let scene, camera, renderer
let composer
let controls
let container
let debugFrameGroup

export function initMap() {
  container = document.getElementById('three-container')
  if (!container) return

  createScene()
  loadChinaMap()
    .then(() => animate())
    .catch((err) => {
      console.error(err)
      animate()
    })
  window.addEventListener('resize', onResize)
}

function onResize() {
  if (!container || !camera || !renderer) return
  const w = container.clientWidth
  const h = container.clientHeight
  if (w === 0 || h === 0) return
  camera.aspect = w / h
  camera.updateProjectionMatrix()
  renderer.setSize(w, h)
  if (composer) {
    composer.setPixelRatio(renderer.getPixelRatio())
    composer.setSize(w, h)
  }
}

function createScene() {
  const w = container.clientWidth || window.innerWidth
  const h = container.clientHeight || window.innerHeight

  scene = new THREE.Scene()
  scene.background = new THREE.Color(0x030910)

  scene.add(new THREE.AmbientLight(0x8ab4ff, 0.22))
  const dirLight = new THREE.DirectionalLight(0xe8f4ff, 0.72)
  dirLight.position.set(28, 36, 42)
  scene.add(dirLight)
  const fill = new THREE.DirectionalLight(0x4a7cff, 0.28)
  fill.position.set(-24, -12, 18)
  scene.add(fill)
  const rim = new THREE.DirectionalLight(0x00c8ff, 0.18)
  rim.position.set(0, 40, -20)
  scene.add(rim)

  camera = new THREE.PerspectiveCamera(75, w / h, 0.1, 1000)
  camera.up.set(0, 1, 0)
  // 略偏南、带俯角：挤出沿 +Z，侧壁可见；屏幕向上仍为北 (+Y)
  camera.position.set(0, -34, 32)
  camera.lookAt(0, 0, 0)
  const pr = Math.min(window.devicePixelRatio, 2)
  renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(pr)
  renderer.setSize(w, h)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 0.78
  container.appendChild(renderer.domElement)

  composer = new EffectComposer(renderer)
  composer.setPixelRatio(pr)
  composer.setSize(w, h)
  composer.addPass(new RenderPass(scene, camera))
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.55, 0.4, 0.22)
  composer.addPass(bloomPass)
  composer.addPass(new OutputPass())

  controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.minDistance = 8
  controls.maxDistance = 200
}

/** GeoJSON Polygon / MultiPolygon 的每个面（外环 + 洞） */
function forEachPolygon(geometry, fn) {
  if (!geometry?.coordinates) return
  if (geometry.type === 'Polygon') {
    fn(geometry.coordinates)
  } else if (geometry.type === 'MultiPolygon') {
    for (const polygon of geometry.coordinates) fn(polygon)
  }
}

function signedArea2(pts) {
  let s = 0
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]
    const q = pts[(i + 1) % pts.length]
    s += p.x * q.y - q.x * p.y
  }
  return s * 0.5
}

function ringToVector2s(ring, toXY) {
  const raw = ring.map((c) => toXY(c[0], c[1]))
  if (raw.length < 3) return null
  let pts = raw
  if (pts[0].distanceTo(pts[pts.length - 1]) < 1e-8) pts = pts.slice(0, -1)
  if (pts.length < 3) return null
  return pts
}

function polygonToShape(rings, toXY) {
  const outer = ringToVector2s(rings[0], toXY)
  if (!outer) return null
  if (signedArea2(outer) < 0) outer.reverse()

  const shape = new THREE.Shape(outer)
  for (let i = 1; i < rings.length; i++) {
    const hole = ringToVector2s(rings[i], toXY)
    if (!hole) continue
    if (signedArea2(hole) > 0) hole.reverse()
    shape.holes.push(new THREE.Path(hole))
  }
  return shape
}

function addDebugFrame(mapExtent) {
  if (debugFrameGroup) scene.remove(debugFrameGroup)
  debugFrameGroup = new THREE.Group()
  debugFrameGroup.name = 'debug-frame'

  const axisLen = mapExtent * 0.35
  debugFrameGroup.add(new THREE.AxesHelper(axisLen))
  const divisions = Math.max(10, Math.round(mapExtent / 2))
  const grid = new THREE.GridHelper(mapExtent, divisions, 0x1f4060, 0x0f2238)
  grid.rotation.x = -Math.PI / 2
  debugFrameGroup.add(grid)

  scene.add(debugFrameGroup)
}

async function loadChinaMap() {
  const res = await fetch('/100000_full.json')
  if (!res.ok) throw new Error(`加载地图数据失败: ${res.status}`)
  const data = await res.json()

  const mapExtent = 42
  const projection = geoMercator().fitExtent(
    [
      [0, 0],
      [mapExtent, mapExtent],
    ],
    data
  )

  const cx = mapExtent / 2
  const cy = mapExtent / 2

  function lngLatToVector2(lng, lat) {
    const p = projection([lng, lat])
    if (!p) return new THREE.Vector2(0, 0)
    const [px, py] = p
    return new THREE.Vector2(px - cx, -(py - cy))
  }

  const extrudeDepth = mapExtent * 0.022
  const extrudeSettings = {
    depth: extrudeDepth,
    bevelEnabled: false,
  }

  const mapMaterial = new THREE.MeshStandardMaterial({
    color: 0x1a6f8f,
    emissive: 0x0a3a52,
    emissiveIntensity: 0.55,
    metalness: 0.18,
    roughness: 0.36,
    side: THREE.DoubleSide,
    flatShading: false,
  })

  const borderMaterial = new THREE.LineBasicMaterial({
    color: 0xb8fbff,
    transparent: true,
    opacity: 0.95,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  })

  const group = new THREE.Group()
  group.name = 'china-map'

  for (const feature of data.features) {
    const geom = feature.geometry
    if (!geom) continue

    forEachPolygon(geom, (rings) => {
      const shape = polygonToShape(rings, lngLatToVector2)
      if (!shape) return
      try {
        const geo = new THREE.ExtrudeGeometry(shape, extrudeSettings)
        const mesh = new THREE.Mesh(geo, mapMaterial)
        mesh.renderOrder = 0

        const topZ = extrudeDepth + 0.008
        for (let ri = 0; ri < rings.length; ri++) {
          const pts2 = ringToVector2s(rings[ri], lngLatToVector2)
          if (!pts2) continue
          const pts3 = pts2.map((p) => new THREE.Vector3(p.x, p.y, topZ))
          const lineGeom = new THREE.BufferGeometry().setFromPoints(pts3)
          const line = new THREE.LineLoop(lineGeom, borderMaterial)
          line.renderOrder = 2
          mesh.add(line)
        }

        group.add(mesh)
      } catch {
        /* 退化环等跳过 */
      }
    })
  }

  group.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(group)
  const center = new THREE.Vector3()
  box.getCenter(center)
  group.position.sub(center)

  addDebugFrame(mapExtent)
  scene.add(group)
}

function animate() {
  requestAnimationFrame(animate)
  controls.update()
  composer.render()
}

initMap()
