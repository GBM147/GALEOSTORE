import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Sparkles } from '@react-three/drei'
import * as THREE from 'three'

const LOGO_URL = 'https://res.cloudinary.com/ovbsocaw/image/upload/v1791245015/galeo-store/branding/galeo-logo-photo.webp'

function useLogoTexture() {
  const [texture, setTexture] = useState(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let disposed = false
    const loader = new THREE.TextureLoader()
    loader.setCrossOrigin('anonymous')
    loader.load(
      LOGO_URL,
      (loaded) => {
        if (disposed) return
        loaded.colorSpace = THREE.SRGBColorSpace
        loaded.anisotropy = 4
        loaded.minFilter = THREE.LinearMipmapLinearFilter
        loaded.magFilter = THREE.LinearFilter
        setTexture(loaded)
      },
      undefined,
      () => {
        if (!disposed) setError(true)
      }
    )

    return () => {
      disposed = true
      if (texture) texture.dispose()
    }
  }, [])

  return { texture, error }
}

function Emblem() {
  const group = useRef()
  const inner = useRef()
  const { texture } = useLogoTexture()
  const target = useRef({ x: 0, y: 0 })
  const angle = useRef(0)

  useEffect(() => {
    const move = (event) => {
      target.current.x = ((event.clientX / window.innerWidth) - 0.5) * 0.32
      target.current.y = ((event.clientY / window.innerHeight) - 0.5) * 0.22
    }
    window.addEventListener('pointermove', move, { passive: true })
    return () => window.removeEventListener('pointermove', move)
  }, [])

  useFrame((state, delta) => {
    if (!group.current) return
    angle.current += delta
    group.current.rotation.y = THREE.MathUtils.lerp(group.current.rotation.y, target.current.x, 0.045)
    group.current.rotation.x = THREE.MathUtils.lerp(group.current.rotation.x, -target.current.y, 0.045)
    group.current.position.y = Math.sin(angle.current * 0.58) * 0.045
    if (inner.current) {
      inner.current.rotation.z = Math.sin(angle.current * 0.32) * 0.012
    }
  })

  const logoRatio = texture?.image?.width && texture?.image?.height
    ? texture.image.width / texture.image.height
    : 0.78

  const planeHeight = 3.75
  const planeWidth = planeHeight * logoRatio

  return (
    <group ref={group}>
      <mesh position={[0, 0, -0.16]} rotation={[0, 0, 0]}>
        <cylinderGeometry args={[1.94, 1.94, 0.18, 96, 1, false]} />
        <meshStandardMaterial color="#6d451c" metalness={0.95} roughness={0.26} />
      </mesh>

      <mesh position={[0, 0, -0.05]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[2.02, 0.105, 18, 96]} />
        <meshStandardMaterial color="#d3a557" metalness={1} roughness={0.17} emissive="#5b3714" emissiveIntensity={0.16} />
      </mesh>

      <mesh position={[0, 0, 0.04]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[1.83, 0.027, 12, 96]} />
        <meshStandardMaterial color="#6c471d" metalness={0.98} roughness={0.2} />
      </mesh>

      <mesh ref={inner} position={[0, 0, 0.10]}>
        <planeGeometry args={[planeWidth, planeHeight]} />
        <meshBasicMaterial map={texture || null} transparent={!texture} opacity={texture ? 1 : 0} />
      </mesh>

      <mesh position={[0, -2.32, -0.02]}>
        <boxGeometry args={[2.1, 0.09, 0.08]} />
        <meshStandardMaterial color="#b78339" metalness={0.96} roughness={0.23} />
      </mesh>
      <mesh position={[0, -2.38, 0.02]} rotation={[0, 0, Math.PI / 4]}>
        <boxGeometry args={[0.22, 0.22, 0.08]} />
        <meshStandardMaterial color="#c79547" metalness={0.96} roughness={0.2} />
      </mesh>
      <mesh position={[0, -2.38, 0.02]} rotation={[0, 0, -Math.PI / 4]}>
        <boxGeometry args={[0.22, 0.22, 0.08]} />
        <meshStandardMaterial color="#a66d25" metalness={0.96} roughness={0.2} />
      </mesh>
    </group>
  )
}

function CameraRig() {
  useFrame((state) => {
    state.camera.position.z = THREE.MathUtils.lerp(state.camera.position.z, 5.0, 0.025)
  })
  return null
}

function Scene() {
  const stars = useMemo(() => Array.from({ length: 90 }, (_, index) => ({
    key: index,
    x: ((index * 73) % 200 - 100) / 22,
    y: ((index * 41) % 160 - 80) / 20,
    z: -1.5 - ((index * 29) % 110) / 25
  })), [])

  return (
    <>
      <color attach="background" args={['#030303']} />
      <fog attach="fog" args={['#030303', 5.5, 12]} />
      <ambientLight intensity={0.8} color="#fff2d0" />
      <spotLight position={[2.8, 3.8, 5]} angle={0.48} penumbra={0.7} intensity={15} color="#f1c77a" />
      <spotLight position={[-3.5, 1, 2]} angle={0.55} penumbra={0.8} intensity={9} color="#f7ead0" />
      <pointLight position={[0, -1.8, 2]} intensity={4.5} color="#8c2b20" />
      <Sparkles count={90} scale={[8, 6, 7]} size={1.2} speed={0.22} opacity={0.34} color="#d9b16a" />
      {stars.map((star) => (
        <mesh key={star.key} position={[star.x, star.y, star.z]}>
          <sphereGeometry args={[0.007, 5, 5]} />
          <meshBasicMaterial color="#d8b36b" transparent opacity={0.38} />
        </mesh>
      ))}
      <Emblem />
      <CameraRig />
    </>
  )
}

export default function GaleoOpening({ onEnter }) {
  const reduced = useMemo(() => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches, [])
  const [closing, setClosing] = useState(false)
  const [webgl, setWebgl] = useState(true)
  const timer = useRef(null)

  useEffect(() => {
    try {
      const canvas = document.createElement('canvas')
      setWebgl(Boolean(canvas.getContext('webgl') || canvas.getContext('experimental-webgl')))
    } catch {
      setWebgl(false)
    }
  }, [])

  const close = () => {
    if (closing) return
    setClosing(true)
    window.clearTimeout(timer.current)
    window.setTimeout(onEnter, 760)
  }

  useEffect(() => {
    const wheel = () => close()
    const touch = () => close()
    window.addEventListener('wheel', wheel, { passive: true, once: true })
    window.addEventListener('touchstart', touch, { passive: true, once: true })
    return () => {
      window.removeEventListener('wheel', wheel)
      window.removeEventListener('touchstart', touch)
    }
  }, [closing])

  useEffect(() => {
    if (reduced) return undefined
    timer.current = window.setTimeout(close, 6200)
    return () => window.clearTimeout(timer.current)
  }, [reduced])

  return (
    <div className={'galeo-opening' + (closing ? ' is-closing' : '')} role="dialog" aria-label="Abertura GALEO">
      <div className="galeo-opening-backdrop" />
      <div className="galeo-opening-noise" />
      <div className="galeo-opening-content">
        <div className="galeo-opening-topline">
          <span>GALEO / 001</span>
          <span>São Paulo / BR</span>
        </div>

        <div className="galeo-opening-scene">
          {webgl && !reduced ? (
            <Canvas
              dpr={[1, 1.35]}
              gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
              camera={{ position: [0, 0, 5], fov: 36 }}
              frameloop="always"
            >
              <Scene />
            </Canvas>
          ) : (
            <div className="galeo-opening-static">
              <img src={LOGO_URL} alt="GALEO" />
            </div>
          )}
        </div>

        <div className="galeo-opening-copy">
          <span>THE MULTIBRAND EXPERIENCE</span>
          <h1>Presença <em>em movimento.</em></h1>
          <p>Marcas, peças e identidade em uma experiência feita para não ficar parada.</p>
        </div>

        <button className="galeo-opening-enter" type="button" onClick={close}>
          <span>Entrar na loja</span>
          <b>↗</b>
        </button>

        <div className="galeo-opening-bottom">
          <span>SCROLL / ENTER</span>
          <span>2026</span>
        </div>
      </div>
    </div>
  )
}
