import { describe, expect, it } from 'vitest'
import { placeschemaPortalTarget } from './placeschemaPortal'

const allowed = ['https://hub.placeschema.com', 'https://woc-sidecar.placeschema.com']

describe('placeschemaPortalTarget', () => {
  it('allows an https ticket on an allowlisted origin', () => {
    expect(placeschemaPortalTarget('https://hub.placeschema.com/arrive#t=abc', allowed)).toBe('https://hub.placeschema.com/arrive#t=abc')
  })
  it('refuses other origins, http, credentials, junk and an empty list', () => {
    expect(placeschemaPortalTarget('https://evil.example/arrive', allowed)).toBeUndefined()
    expect(placeschemaPortalTarget('https://hub.placeschema.com.evil.example/', allowed)).toBeUndefined()
    expect(placeschemaPortalTarget('http://hub.placeschema.com/arrive', allowed)).toBeUndefined()
    expect(placeschemaPortalTarget('https://u:p@hub.placeschema.com/', allowed)).toBeUndefined()
    expect(placeschemaPortalTarget('javascript:alert(1)', allowed)).toBeUndefined()
    expect(placeschemaPortalTarget('not a url', allowed)).toBeUndefined()
    expect(placeschemaPortalTarget(42, allowed)).toBeUndefined()
    expect(placeschemaPortalTarget('https://hub.placeschema.com/', undefined)).toBeUndefined()
  })
})
