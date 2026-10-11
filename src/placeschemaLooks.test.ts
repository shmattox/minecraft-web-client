import { describe, expect, it } from 'vitest'
import { grantOf, meshUrlAllowed } from './placeschemaLooks'

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
