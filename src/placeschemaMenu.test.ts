import { beforeEach, expect, it, vi } from 'vitest'

vi.mock('minecraft-renderer/src/three/threeJsMethods', () => ({ getThreeJsRendererMethods: () => undefined }))
vi.mock('./globalState', () => ({ activeModalStack: [], hideModal: vi.fn(), miscUiState: {}, showModal: vi.fn() }))
vi.mock('./react/utilsApp', () => ({ useIsModalActive: () => false }))
vi.mock('./placeschema-logo.png', () => ({ default: 'logo.png' }))

const store = new Map<string, string>()
beforeEach(() => {
  store.clear()
  vi.stubGlobal('bot', undefined)
  vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) })
})

it('wears an arriving avatar choice once per landing, and tells the server what is shown (PLACE-1157)', async () => {
  const m = await import('./placeschemaMenu')
  const sent: string[] = []
  m.setAccount('ab'.repeat(32))
  m.onAvatarSend((c) => sent.push(c))
  expect(sent).toEqual(['native']) // registered: the current choice goes out at once
  const landing = 'cd'.repeat(16)
  m.onArrivedAvatar('generic', landing)
  expect(m.placeschemaMenu.avatar).toBe('generic')
  expect(sent.at(-1)).toBe('generic')
  m.chooseAvatar('native') // the player changes it here
  m.onArrivedAvatar('generic', landing) // the same landing on the next join: the choice made here stands
  expect(m.placeschemaMenu.avatar).toBe('native')
  m.onArrivedAvatar('dragon', 'ef'.repeat(16)) // unknown word
  m.onArrivedAvatar('carried', 'not-a-landing')
  expect(m.placeschemaMenu.avatar).toBe('native')
  m.onArrivedAvatar('carried', 'ef'.repeat(16)) // a new landing
  expect(m.placeschemaMenu.avatar).toBe('carried')
})
