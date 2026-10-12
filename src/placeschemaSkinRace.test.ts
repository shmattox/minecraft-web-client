// PLACE-1157 review: the renderer (patched, patches/minecraft-renderer@0.1.99.patch) must not let a skin that finishes
// loading late overwrite a newer choice. Carried is asked for, then Generic; Carried's image arrives last.
import { describe, expect, it, vi } from 'vitest'

vi.mock('../node_modules/.pnpm/@tweenjs+tween.js@20.0.3/node_modules/@tweenjs/tween.js/dist/tween.cjs.js', () => ({ Tween: class {}, Group: class {}, Easing: {}, update: () => {} }))
vi.mock('../node_modules/minecraft-renderer/src/three/entity/objModels.js', () => ({}))
// the module reads a little DOM at import time; a stub is enough, no canvas is drawn here
vi.stubGlobal('document', { createElement: () => ({ getContext: () => ({}) }) })
const pending = new Map<string, (v: unknown) => void>()
vi.mock('../node_modules/minecraft-renderer/src/lib/utils/skins', () => ({
  stevePngUrl: 'steve.png',
  loadSkinFromUsername: async () => undefined,
  loadSkinImage: (url: string) => new Promise(resolve => pending.set(url, resolve)),
}))

describe('a late skin image never wins over a newer choice', () => {
  it('Carried then Generic: Generic stays on the body', async () => {
    const { Entities } = await import('minecraft-renderer/src/three/entities')
    const body = { skin: { map: undefined as unknown, modelType: '', isCustom: false }, ears: { map: null, visible: false } }
    const self: any = { currentSkinUrls: {} as Record<string, string>, getPlayerObject: () => body, isCanvasBlank: () => true, onSkinUpdate: undefined }
    const apply = (url: string) => {
      self.currentSkinUrls['1'] = url // what updatePlayerSkin records before it starts the load
      return (Entities.prototype as any).loadAndApplySkin.call(self, 1, url, false)
    }
    const canvas = (tag: string) => ({ canvas: { width: 64, height: 64, tag }, image: undefined })
    const carried = apply('carried.png')
    const generic = apply('generic.png')
    pending.get('generic.png')!(canvas('generic'))
    await generic
    pending.get('carried.png')!(canvas('carried')) // the late one
    await carried
    expect((body.skin.map as any)?.image?.tag ?? (body.skin.map as any)?.source?.data?.tag).toBe('generic')
  })
})
