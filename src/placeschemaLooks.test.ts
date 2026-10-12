import { describe, expect, it } from 'vitest'
import { externalUris, grantOf, meshUrlAllowed } from './placeschemaLooks'

const pin = 'https://mc-sidecar.placeschema.com'
const g = 'a'.repeat(64)

describe('meshUrlAllowed (mirrors Limits.java)', () => {
  it('allows /media/ on the pinned origin', () => {
    expect(meshUrlAllowed(`${pin}/media/abc.glb`, pin)).toBe(true)
  })
  it('refuses other origins, other paths, traversal, queries and no pin', () => {
    expect(meshUrlAllowed('https://evil.example/media/abc.glb', pin)).toBe(false)
    expect(meshUrlAllowed(`${pin}/looks/abc.glb`, pin)).toBe(false)
    expect(meshUrlAllowed(`${pin}/media/%2e%2e/admin`, pin)).toBe(false)
    expect(meshUrlAllowed(`${pin}/media/abc.glb?x=1`, pin)).toBe(false)
    expect(meshUrlAllowed('https://u:p@mc-sidecar.placeschema.com/media/a.glb', pin)).toBe(false)
    expect(meshUrlAllowed(`${pin}/media/abc.glb`, undefined)).toBe(false)
  })
})

describe('grantOf', () => {
  it('reads PublicBukkitValues openplace:grant from raw and simplified NBT', () => {
    expect(grantOf({ nbt: { type: 'compound', value: { PublicBukkitValues: { type: 'compound', value: { 'openplace:grant': { type: 'string', value: g } } } } } })).toBe(g)
    expect(grantOf({ nbt: { PublicBukkitValues: { 'openplace:grant': g } } })).toBe(g)
  })
  it('ignores items without a well-formed grant', () => {
    expect(grantOf({})).toBeUndefined()
    expect(grantOf({ nbt: { PublicBukkitValues: { 'openplace:grant': 'nope' } } })).toBeUndefined()
  })
})

const glb = (json: object) => {
  const text = new TextEncoder().encode(JSON.stringify(json).padEnd(Math.ceil(JSON.stringify(json).length / 4) * 4, ' '))
  const out = new ArrayBuffer(20 + text.length), v = new DataView(out)
  v.setUint32(0, 0x46_54_6C_67, true); v.setUint32(4, 2, true); v.setUint32(8, out.byteLength, true)
  v.setUint32(12, text.length, true); v.setUint32(16, 0x4E_4F_53_4A, true)
  new Uint8Array(out, 20).set(text)
  return out
}

describe('PLACE-1157 review: a look names no external resource', () => {
  it('accepts a GLB whose buffer is its own binary chunk', () => {
    expect(externalUris(glb({ asset: { version: '2.0' }, buffers: [{ byteLength: 4 }] }))).toBe(false)
  })
  it('refuses a buffer or image with an outside uri, and anything that is not a GLB', () => {
    expect(externalUris(glb({ asset: { version: '2.0' }, buffers: [{ byteLength: 4, uri: 'https://elsewhere.example/b.bin' }] }))).toBe(true)
    expect(externalUris(glb({ asset: { version: '2.0' }, images: [{ uri: 'textures/skin.png' }] }))).toBe(true)
    expect(externalUris(glb({ asset: { version: '2.0' }, images: [{ uri: 'data:image/png;base64,AA' }] }))).toBe(false) // inside the hash
    expect(externalUris(new ArrayBuffer(8))).toBe(true)
    // a harmless first JSON chunk, then one naming an outside buffer: three.js would read the second
    const first = glb({ asset: { version: '2.0' } }), second = glb({ asset: { version: '2.0' }, buffers: [{ byteLength: 4, uri: 'https://elsewhere.example/b.bin' }] })
    const both = new Uint8Array(first.byteLength + second.byteLength - 12)
    both.set(new Uint8Array(first)); both.set(new Uint8Array(second, 12), first.byteLength)
    expect(externalUris(both.buffer)).toBe(true)
  })
})
