// PLACE-1157 review: the renderer (patched, patches/minecraft-renderer@0.1.99.patch) applies only the newest skin request.
// An older request — a custom skin, the default Steve skin, or a Native username lookup — that finishes late never
// overwrites a newer choice; and an offline player with no skin for their name gets the default body back.
import { describe, expect, it, vi } from 'vitest'

vi.mock('../node_modules/.pnpm/@tweenjs+tween.js@20.0.3/node_modules/@tweenjs/tween.js/dist/tween.cjs.js', () => ({ Tween: class {}, Group: class {}, Easing: {}, update: () => {} }))
vi.mock('../node_modules/minecraft-renderer/src/three/entity/objModels.js', () => ({}))
// the module reads a little DOM at import time; a stub is enough, no canvas is drawn here
vi.stubGlobal('document', { createElement: () => ({ getContext: () => ({}) }) })
const images = new Map<string, (v: unknown) => void>()
const names = new Map<string, (v: string | undefined) => void>()
vi.mock('../node_modules/minecraft-renderer/src/lib/utils/skins', () => ({
  stevePngUrl: 'steve.png',
  loadSkinFromUsername: (name: string) => new Promise(resolve => names.set(name, resolve)),
  loadSkinImage: (url: string) => new Promise(resolve => images.set(url, resolve)),
}))

const canvas = (tag: string) => ({ canvas: { width: 64, height: 64, tag }, image: undefined })
const tick = () => new Promise(r => setTimeout(r, 0))

async function renderer () {
  const { Entities } = await import('minecraft-renderer/src/three/entities')
  const body = { skin: { map: undefined as any, modelType: '', isCustom: false }, ears: { map: null, visible: false }, cape: { visible: false, map: null }, elytra: { map: null }, backEquipment: null }
  const self: any = Object.assign(Object.create(Entities.prototype), {
    currentSkinUrls: {}, skinRequests: {}, loadedSkinEntityIds: new Set(), uuidPerSkinUrlsCache: {},
    getPlayerObject: () => body, isCanvasBlank: () => true, onSkinUpdate: undefined,
    worldRenderer: { worldRendererConfig: { renderEars: false } }, loadAndApplyCape: async () => {},
  })
  const shown = () => body.skin.map?.image?.tag ?? body.skin.map?.source?.data?.tag
  const ask = (url: string | true) => self.updatePlayerSkin(1, 'Steve123', undefined, url)
  return { ask, shown }
}

describe('a skin request that finishes late never wins over a newer one', () => {
  it('Carried, then Generic; Carried lands last', async () => {
    const { ask, shown } = await renderer()
    await ask('carried.png'); await ask('generic.png')
    images.get('generic.png')!(canvas('generic')); await tick()
    images.get('carried.png')!(canvas('carried')); await tick()
    expect(shown()).toBe('generic')
  })

  it('the default Steve skin, then Generic; Steve lands last', async () => {
    const { ask, shown } = await renderer()
    await ask('steve.png'); await ask('generic.png')
    images.get('generic.png')!(canvas('generic')); await tick()
    images.get('steve.png')!(canvas('steve')); await tick()
    expect(shown()).toBe('generic')
  })

  it('a Native username lookup, then Generic; the lookup answers last', async () => {
    const { ask, shown } = await renderer()
    const native = ask(true); await tick()
    await ask('generic.png')
    images.get('generic.png')!(canvas('generic')); await tick()
    names.get('Steve123')!('mojang.png'); await native; await tick()
    expect(images.has('mojang.png')).toBe(false) // the stale lookup never even started a load
    expect(shown()).toBe('generic')
  })

  it('the same skin asked twice while it loads still lands', async () => {
    const { ask, shown } = await renderer()
    await ask('carried2.png'); await ask('carried2.png')
    images.get('carried2.png')!(canvas('carried2')); await tick()
    expect(shown()).toBe('carried2')
  })

  it('Native for an offline player with no skin for their name: the default body, not the last one shown', async () => {
    const { ask, shown } = await renderer()
    await ask('generic2.png'); images.get('generic2.png')!(canvas('generic2')); await tick()
    const native = ask(true); await tick()
    names.get('Steve123')!(undefined); await native; await tick()
    images.get('steve.png')!(canvas('steve')); await tick()
    expect(shown()).toBe('steve')
  })
})
