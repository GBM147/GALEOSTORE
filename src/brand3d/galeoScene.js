import {
  ACESFilmicToneMapping, BoxGeometry, CircleGeometry, Color, CylinderGeometry, DirectionalLight, Group, Mesh, MeshBasicMaterial, MeshPhysicalMaterial,
  OctahedronGeometry, PerspectiveCamera, PMREMGenerator, Scene, SRGBColorSpace, TextureLoader, TorusGeometry, WebGLRenderer
} from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js'
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js'
import fontData from './cinzel-galeo.typeface.json'

// The GALEO mark in 3D: a gold medallion with the lion and rooster artwork on
// black enamel, and the name in extruded gold Cinzel letters underneath. The
// same scene renders the image files and the animated medallion of the site.

const RADIUS = 1
const THICKNESS = 0.18
const GOLD = 0xd8ae5a

function goldMaterial(roughness = 0.3) {
  return new MeshPhysicalMaterial({ color: GOLD, metalness: 1, roughness, clearcoat: 0.35, clearcoatRoughness: 0.2 })
}

function medallion(emblem) {
  const group = new Group()
  const body = new CylinderGeometry(RADIUS, RADIUS, THICKNESS, 160, 1)
  body.rotateX(Math.PI / 2)
  group.add(new Mesh(body, goldMaterial(0.34)))

  // The artwork keeps its original colors at every angle (no lighting on it);
  // the depth comes from the gold rim, the thickness and the letters.
  const face = new Mesh(new CircleGeometry(RADIUS * 0.93, 160), new MeshBasicMaterial({ map: emblem, toneMapped: false }))
  face.position.z = THICKNESS / 2 + 0.004
  group.add(face)

  // Raised bevelled rims on both sides and a fine inner line.
  for (const side of [1, -1]) {
    const rim = new Mesh(new TorusGeometry(RADIUS * 0.965, 0.058, 40, 220), goldMaterial(0.22))
    rim.position.z = side * THICKNESS / 2
    group.add(rim)
  }
  const line = new Mesh(new TorusGeometry(RADIUS * 0.905, 0.011, 16, 220), goldMaterial(0.25))
  line.position.z = THICKNESS / 2 + 0.006
  group.add(line)

  // Back: brushed gold with a raised G.
  const font = new FontLoader().parse(fontData)
  const letter = new TextGeometry('G', { font, size: 0.95, depth: 0.05, curveSegments: 10, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.01, bevelSegments: 3 })
  letter.computeBoundingBox()
  const box = letter.boundingBox
  letter.translate(-(box.max.x + box.min.x) / 2, -(box.max.y + box.min.y) / 2, 0)
  const back = new Mesh(letter, goldMaterial(0.2))
  back.rotation.y = Math.PI
  back.position.z = -THICKNESS / 2 - 0.01
  group.add(back)
  return group
}

function wordmark() {
  const font = new FontLoader().parse(fontData)
  const group = new Group()
  const material = goldMaterial(0.24)
  const size = 0.42, tracking = 0.07
  let x = 0
  for (const char of 'GALEO') {
    const geometry = new TextGeometry(char, { font, size, depth: 0.11, curveSegments: 14, bevelEnabled: true, bevelThickness: 0.022, bevelSize: 0.012, bevelSegments: 4 })
    const mesh = new Mesh(geometry, material)
    mesh.position.x = x
    group.add(mesh)
    x += fontData.glyphs[char].ha / fontData.resolution * size + tracking
  }
  const width = x - tracking
  group.children.forEach(mesh => { mesh.position.x -= width / 2 })

  // Ornament: two fine bars and a small diamond, as in the original artwork.
  const bar = new BoxGeometry(width * 0.44, 0.014, 0.02)
  for (const side of [-1, 1]) {
    const mesh = new Mesh(bar, material)
    mesh.position.set(side * width * 0.27, -0.2, 0.05)
    group.add(mesh)
  }
  const diamond = new Mesh(new OctahedronGeometry(0.075, 0), material)
  diamond.scale.set(0.8, 1.25, 0.5)
  diamond.position.set(0, -0.2, 0.05)
  group.add(diamond)
  return { group, width }
}

export async function createGaleoScene(canvas, { width, height, pixelRatio = 1, background = null, includeName = true, preserveDrawingBuffer = false, emblemUrl = '/images/galeo-emblem.webp' } = {}) {
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: background === null, preserveDrawingBuffer, powerPreference: 'high-performance' })
  renderer.setPixelRatio(pixelRatio)
  renderer.setSize(width, height, false)
  renderer.outputColorSpace = SRGBColorSpace
  renderer.toneMapping = ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05
  if (background === null) renderer.setClearColor(0x000000, 0)
  else renderer.setClearColor(new Color(background), 1)

  const scene = new Scene()
  const pmrem = new PMREMGenerator(renderer)
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.03).texture
  pmrem.dispose()

  const key = new DirectionalLight(0xffe6b8, 2.6)
  key.position.set(-2.5, 3, 4)
  const rim = new DirectionalLight(0xfff1d6, 3.2)
  rim.position.set(3, 1.5, -3)
  const fill = new DirectionalLight(0xb9c7ff, 0.5)
  fill.position.set(2, -2, 3)
  scene.add(key, rim, fill)

  const emblem = await new TextureLoader().loadAsync(emblemUrl)
  emblem.colorSpace = SRGBColorSpace
  emblem.anisotropy = renderer.capabilities.getMaxAnisotropy()

  const mark = new Group()
  const coin = medallion(emblem)
  mark.add(coin)
  if (includeName) {
    const { group } = wordmark()
    group.position.y = -RADIUS - 0.62
    mark.add(group)
    mark.position.y = 0.42
  }
  scene.add(mark)

  const camera = new PerspectiveCamera(28, width / height, 0.1, 50)
  const frame = includeName ? 7.6 : 5.2
  camera.position.set(0, 0, frame)
  camera.lookAt(0, 0, 0)

  return {
    renderer, scene, camera, mark, coin,
    // Turns the mark: y left/right, x up/down (radians).
    setPose({ x = 0, y = 0 } = {}) { mark.rotation.set(x, y, 0) },
    setSize(nextWidth, nextHeight) {
      renderer.setSize(nextWidth, nextHeight, false)
      camera.aspect = nextWidth / nextHeight
      camera.updateProjectionMatrix()
    },
    render() { renderer.render(scene, camera) },
    dispose() {
      scene.traverse(object => {
        object.geometry?.dispose()
        object.material?.map?.dispose()
        object.material?.dispose()
      })
      scene.environment?.dispose()
      renderer.dispose()
    }
  }
}
