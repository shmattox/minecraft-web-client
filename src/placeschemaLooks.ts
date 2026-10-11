/**
 * PlaceSchema carried-item looks (PLACE-1013): the browser twin of the PlaceSchema Fabric client mod.
 * The server pins one sidecar origin (`openplace:origin`) and sends `openplace:look` (grant, mesh URL, sha256)
 * for items this player carries. We fetch only from that origin under /media/, check the hash and the caps,
 * and draw the model in place of the stand-in for any stack tagged with that grant (`openplace:grant`).
 * Rules mirror the mod's Limits.java.
 */
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

export const MAX_BYTES = 2 * 1024 * 1024
export const MAX_VERTS = 65_536
const MAX_MODELS = 16
const HEX64 = /^[\da-f]{64}$/

/** "https://host[:port]" for an http(s) URL without credentials, else undefined. */
export const originOf = (url: string): string | undefined => {
  try {
    const u = new URL(url)
    if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.username || u.password) return undefined
    return u.origin
  } catch { return undefined }
}

/** A mesh URL is fetched only from the pinned origin, under /media/, with no traversal and no query. */
export const meshUrlAllowed = (url: string, pinned: string | undefined): boolean => {
  if (!pinned || originOf(url) !== pinned) return false
  const u = new URL(url)
  const path = u.pathname
  return path.startsWith('/media/') && !path.includes('..') && !/%2e/i.test(url) && !u.search
}

/** The grant id a Paper server stored on the stack (PersistentDataContainer `openplace:grant`). */
export const grantOf = (item: any): string | undefined => {
  const nbt = item?.nbt
  const pbv = nbt?.value?.PublicBukkitValues?.value ?? nbt?.PublicBukkitValues
  const g = pbv?.['openplace:grant']
  const v = typeof g === 'string' ? g : g?.value
  return typeof v === 'string' && HEX64.test(v) ? v : undefined
}

let pinnedOrigin: string | undefined
const models = new Map<string, THREE.Object3D>()
const started = new Set<string>()

/** Pin the server's sidecar origin once per session; a re-declaration is ignored. */
export const pinOrigin = (origin: string) => {
  if (pinnedOrigin) return
  if (originOf(`${origin}/`) !== origin) { console.warn('[placeschema] origin refused: malformed'); return }
  pinnedOrigin = origin
}

export const resetLooks = () => {
  pinnedOrigin = undefined
  models.clear()
  started.clear()
}

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')

/** Centre the model and fit its longest side to one block, the mod's fit. */
const normalize = (scene: THREE.Object3D): THREE.Object3D => {
  const box = new THREE.Box3().setFromObject(scene)
  const size = box.getSize(new THREE.Vector3())
  const longest = Math.max(size.x, size.y, size.z)
  const centre = box.getCenter(new THREE.Vector3())
  const fit = new THREE.Group()
  scene.position.sub(centre)
  fit.add(scene)
  if (longest > 0) fit.scale.setScalar(1 / longest)
  return fit
}

const countVerts = (scene: THREE.Object3D) => {
  let n = 0
  scene.traverse(o => { const g = (o as THREE.Mesh).geometry; if (g?.attributes?.position) n += g.attributes.position.count })
  return n
}

/** Handle one `openplace:look`. A refused or failed look leaves the stand-in. */
export const onLook = async (grant: string, url: string, sha: string) => {
  if (!HEX64.test(grant) || !HEX64.test(sha) || !meshUrlAllowed(url, pinnedOrigin)) {
    console.warn('[placeschema] look refused: malformed or not from the pinned origin', pinnedOrigin)
    return
  }
  if (started.has(grant)) return
  started.add(grant)
  try {
    const r = await fetch(url, { redirect: 'error', credentials: 'omit' })
    if (!r.ok) throw new Error(`mesh answered ${r.status}`)
    const bytes = await r.arrayBuffer()
    if (bytes.byteLength > MAX_BYTES) throw new Error(`mesh over ${MAX_BYTES} bytes`)
    const got = hex(await crypto.subtle.digest('SHA-256', bytes))
    if (got !== sha) throw new Error(`sha256 mismatch: ${got}`)
    const gltf = await new GLTFLoader().parseAsync(bytes, '')
    if (countVerts(gltf.scene) > MAX_VERTS) throw new Error('mesh too big')
    if (models.size >= MAX_MODELS) models.delete(models.keys().next().value!)
    models.set(grant, normalize(gltf.scene))
    console.debug('[placeschema] look loaded', grant)
  } catch (e) {
    started.delete(grant) // a later look message may retry
    console.warn('[placeschema]', grant, 'stays a stand-in:', String(e))
  }
}

/** The renderer hook (patches/minecraft-renderer): our model for a stack whose grant has a loaded look. */
const itemModel = (item: any) => {
  const grant = grantOf(item)
  const model = grant ? models.get(grant) : undefined
  if (!model) return undefined
  return {
    modelName: `placeschema:${grant}`,
    make (scale: number) {
      const g = new THREE.Group()
      g.add(model.clone(true))
      g.scale.setScalar(scale)
      return g
    }
  }
}

export const installLooks = () => { (globalThis as any).placeschemaItemModel = itemModel }
