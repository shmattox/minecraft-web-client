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

/** A vanilla item sprite is a 1x1 square drawn corner to corner; a sword's blade spans about this much of it. */
const VANILLA_ITEM_LENGTH = 1.35
/** Where the vanilla iron sword's grip sits in the sprite (x = px/16 - 0.5, y = -(py/16 - 0.5)), and its grip-to-tip length. */
const VANILLA_GRIP = new THREE.Vector3(-0.28, -0.28, 0)
const VANILLA_GRIP_TO_TIP = 0.98

/**
 * Fit the model where the renderer expects a vanilla item. A +Y-up item (the held convention the sidecar
 * normalizes to: blade up, grip at the origin) keeps its grip at the vanilla sword's grip, is scaled to the
 * vanilla grip-to-tip length and tipped 45 degrees like the sprite it replaces, so the hand holds it in first
 * and third person alike. Anything else is centred at vanilla sword length. Materials become unlit
 * (MeshBasicMaterial with the same colour and texture): the world has no environment map, so metallic PBR
 * materials render black.
 */
const normalize = (scene: THREE.Object3D): THREE.Object3D => {
  scene.traverse(o => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    const unlit = (m: THREE.Material) => {
      const s = m as THREE.MeshStandardMaterial
      return new THREE.MeshBasicMaterial({ color: s.color, map: s.map ?? null, transparent: s.transparent, opacity: s.opacity, alphaTest: s.alphaTest, side: s.side })
    }
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(unlit) : unlit(mesh.material)
  })
  const box = new THREE.Box3().setFromObject(scene)
  const size = box.getSize(new THREE.Vector3())
  const longest = Math.max(size.x, size.y, size.z)
  const fit = new THREE.Group()
  fit.add(scene)
  if (size.y === longest && box.max.y > 0) {
    fit.scale.setScalar(VANILLA_GRIP_TO_TIP / box.max.y)
    fit.rotation.z = -Math.PI / 4
    fit.position.copy(VANILLA_GRIP)
    return fit
  }
  scene.position.sub(box.getCenter(new THREE.Vector3()))
  if (longest > 0) fit.scale.setScalar(VANILLA_ITEM_LENGTH / longest)
  return fit
}

/** True when a GLB's JSON gives any buffer or image a `uri` outside the file (a `data:` URI is inside the hash). Unreadable = refuse. */
export const externalUris = (bytes: ArrayBuffer): boolean => {
  try {
    const view = new DataView(bytes)
    if (view.getUint32(0, true) !== 0x46_54_6C_67) return true // 'glTF'
    const length = view.getUint32(12, true)
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, length)))
    return [...(json.buffers ?? []), ...(json.images ?? [])].some((x: any) => x?.uri !== undefined && !(typeof x.uri === 'string' && x.uri.startsWith('data:')))
  } catch { return true }
}

const countVerts = (scene: THREE.Object3D) => {
  let n = 0
  scene.traverse(o => { const g = (o as THREE.Mesh).geometry; if (g?.attributes?.position) n += g.attributes.position.count })
  return n
}

/**
 * A body builds its third-person held item when its equipment changes, so a look that finishes loading later
 * (the usual case on join) would leave the stand-in in every hand but our first-person one. Rebuild the held
 * items of every body, ours included, now that this look exists.
 */
const redrawHeld = () => {
  const entities = (globalThis as any).world?.entities
  if (typeof entities?.updateEntityEquipment !== 'function') return
  for (const e of [entities.playerEntity, ...Object.values(entities.entities ?? {})] as any[]) {
    if (e?.originalEntity?.equipment) entities.updateEntityEquipment(e, e.originalEntity)
  }
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
    // the hash covers only this file: a buffer or image it names by URI would load unchecked, from anywhere
    if (externalUris(bytes)) throw new Error('mesh names an external resource')
    const gltf = await new GLTFLoader().parseAsync(bytes, '')
    if (countVerts(gltf.scene) > MAX_VERTS) throw new Error('mesh too big')
    if (models.size >= MAX_MODELS) {
      const evicted = models.keys().next().value!
      models.delete(evicted)
      started.delete(evicted) // a later look for it may load it again
    }
    models.set(grant, normalize(gltf.scene))
    console.debug('[placeschema] look loaded', grant)
    redrawHeld()
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

