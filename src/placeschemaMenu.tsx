/**
 * PlaceSchema in-game menu (PLACE-1115), to the universal contract (open-place docs/three-calls.md
 * "The in-game menu", PLACE-1031): the same tiers, content and avatar switch as the WoC reference and the
 * Fabric client mod. The Paper plugin feeds it on its existing channels (PLACE-1032):
 *   openplace:menu_tier (full|partial|off), openplace:account (linked key or ""),
 *   openplace:items ([label, state]...), openplace:skin (url, model); we send openplace:menu when it opens.
 */
import { proxy, useSnapshot } from 'valtio'
import { getThreeJsRendererMethods } from 'minecraft-renderer/src/three/threeJsMethods'
import { activeModalStack, hideModal, miscUiState, showModal } from './globalState'
import { useIsModalActive } from './react/utilsApp'
// The PlaceSchema mark (open-place assets/shared/logo-white.png), shipped with the client as the contract asks.
import logoUrl from './placeschema-logo.png'

export type MenuTier = 'full' | 'partial' | 'off'
export type AvatarChoice = 'native' | 'carried' | 'generic'

export const placeschemaMenu = proxy({
  tier: 'off' as MenuTier, // nothing shows until the server says (a server without the plugin stays off)
  holder: '',
  items: [] as Array<{ label: string, state: string }>,
  skin: { url: '', model: 'classic' },
  avatar: 'native' as AvatarChoice,
})

const MODAL = 'placeschema-menu'
const avatarKey = () => `placeschema-avatar:${placeschemaMenu.holder || 'unlinked'}`
const landingKey = () => `placeschema-avatar-landing:${placeschemaMenu.holder || 'unlinked'}`
const isChoice = (c: unknown): c is AvatarChoice => c === 'native' || c === 'carried' || c === 'generic'

// PLACE-1157: tell the server the body shown now, so a portal hop carries it to the next place
let sendAvatar: ((choice: AvatarChoice) => void) | undefined
export const onAvatarSend = (fn: (choice: AvatarChoice) => void) => {
  sendAvatar = fn
  fn(placeschemaMenu.avatar)
}

/** A new connection starts with nothing from the last server: no tier, account, items, skin, choice or sender. */
export const resetPlaceSchemaMenu = () => {
  Object.assign(placeschemaMenu, { tier: 'off', holder: '', items: [], skin: { url: '', model: 'classic' }, avatar: 'native' })
  sendAvatar = undefined
}

export const setMenuTier = (t: string) => {
  placeschemaMenu.tier = t === 'full' || t === 'partial' ? t : 'off'
  applyAvatar() // turning the menu off puts the player's own body back
}

export const setAccount = (holder: string) => {
  placeschemaMenu.holder = /^[\da-f]{64}$/.test(holder) ? holder : ''
  try {
    const saved = localStorage.getItem(avatarKey()) as AvatarChoice | null
    placeschemaMenu.avatar = saved === 'carried' || saved === 'generic' ? saved : 'native'
  } catch { placeschemaMenu.avatar = 'native' }
  applyAvatar()
  sendAvatar?.(placeschemaMenu.avatar)
}

export const setSkin = (url: string, model: string) => {
  placeschemaMenu.skin = { url: url.startsWith('https://') ? url : '', model: model === 'slim' ? 'slim' : 'classic' }
  applyAvatar()
}

let generic: string | undefined
/** The generic black-and-white body as a 64x64 skin: pale faces, a dark hairline on every face (WoC's genericSkin). */
const genericSkin = () => {
  if (generic) return generic
  const c = document.createElement('canvas')
  c.width = 64
  c.height = 64
  const g = c.getContext('2d')!
  const faces: Array<[number, number, number, number]> = []
  const box = (u: number, v: number, w: number, h: number, d: number) => faces.push(
    [u + d, v, w, d], [u + d + w, v, w, d],
    [u, v + d, d, h], [u + d, v + d, w, h], [u + d + w, v + d, d, h], [u + 2 * d + w, v + d, w, h],
  )
  box(0, 0, 8, 8, 8); box(16, 16, 8, 12, 4); box(40, 16, 4, 12, 4); box(32, 48, 4, 12, 4); box(0, 16, 4, 12, 4); box(16, 48, 4, 12, 4)
  for (const [x, y, w, h] of faces) {
    g.fillStyle = '#1a1a1a'
    g.fillRect(x, y, w, h)
    g.fillStyle = '#ececec'
    g.fillRect(x + 1, y + 1, Math.max(0, w - 2), Math.max(0, h - 2))
  }
  generic = c.toDataURL('image/png')
  return generic
}

/** The player's own Mojang skin, through the box's https pass-through like every other skin. */
const nativeSkin = () => {
  const url = (bot?.player as any)?.skinData?.url as string | undefined
  const proxyBase = miscUiState.appConfig?.skinTexturesProxy
  return url && proxyBase ? url.replace(/^https?:\/\/textures\.minecraft\.net\//, proxyBase) : url
}

const nativeCape = () => {
  const url = (bot?.player as any)?.skinData?.capeUrl as string | undefined
  const proxyBase = miscUiState.appConfig?.skinTexturesProxy
  return url && proxyBase ? url.replace(/^https?:\/\/textures\.minecraft\.net\//, proxyBase) : url
}

/** Put the chosen body on the local player, live. A carried choice without a carried skin falls back to native. */
export const applyAvatar = () => {
  if (!bot?.entity) return
  const { skin, tier } = placeschemaMenu
  const avatar = tier === 'off' ? 'native' : placeschemaMenu.avatar // no PlaceSchema menu here: the player's own body
  const custom = avatar === 'generic' || (avatar === 'carried' && !!skin.url)
  const url = avatar === 'generic' ? genericSkin() : custom ? skin.url : nativeSkin()
  // The renderer caches a skin per uuid and `true` reuses it, so a custom body passes no uuid: Native then finds
  // the player's own skin (cached, or looked up by name) rather than the last custom one.
  // the player's own cape stays on their own body (entities.ts would have passed it); a custom body has none
  const cape = custom ? undefined : nativeCape()
  void getThreeJsRendererMethods()?.updatePlayerSkin(bot.entity.id, bot.username, custom ? undefined : bot.player?.uuid, url ?? true, cape)
  if (appViewer?.playerState?.reactive) appViewer.playerState.reactive.playerSkin = url
}

export const chooseAvatar = (choice: AvatarChoice) => {
  placeschemaMenu.avatar = choice
  try { localStorage.setItem(avatarKey(), choice) } catch {}
  applyAvatar()
  sendAvatar?.(choice)
}

/** PLACE-1157: the choice made where the player left from, worn once per landing and kept as this game's own. */
export const onArrivedAvatar = (choice: unknown, landing: unknown) => {
  if (!isChoice(choice) || typeof landing !== 'string' || !/^[\da-f]{32}$/.test(landing)) return
  try {
    if (localStorage.getItem(landingKey()) === landing) return // already worn: a choice made here since stands
    localStorage.setItem(landingKey(), landing)
  } catch {}
  chooseAvatar(choice)
}

let requestItems: (() => void) | undefined
export const onMenuOpenRequest = (fn: () => void) => { requestItems = fn }

export const openPlaceSchemaMenu = () => {
  requestItems?.()
  showModal({ reactType: MODAL })
}

const hairline = '1px solid rgba(255,255,255,0.35)'
const panel: React.CSSProperties = { background: 'rgba(0,0,0,0.88)', border: hairline, color: '#f2f2f2', fontFamily: 'inherit' }
const buttonStyle = (active = false): React.CSSProperties => ({
  background: active ? '#f2f2f2' : 'transparent', color: active ? '#000' : '#f2f2f2', border: hairline,
  padding: '4px 8px', cursor: 'pointer', font: 'inherit', fontSize: 8,
})

/** Full tier: the PlaceSchema mark top-left and the hamburger top-right. */
export const PlaceSchemaHud = () => {
  const { tier, holder } = useSnapshot(placeschemaMenu)
  const anyMenuOpen = useSnapshot(activeModalStack).length > 0 // the pause and other screens own the corners
  if (tier !== 'full' || !holder || anyMenuOpen) return null
  return <>
    <img src={logoUrl} alt='PlaceSchema' style={{ position: 'fixed', top: 6, left: 6, height: 22, pointerEvents: 'none', zIndex: 20 }} />
    <button
      type='button'
      aria-label='PlaceSchema menu'
      onClick={openPlaceSchemaMenu}
      style={{ ...panel, position: 'fixed', top: 40, right: 6, width: 26, height: 22, padding: 0, cursor: 'pointer', zIndex: 20, display: 'grid', placeItems: 'center' }}
    >
      <svg xmlns='http://www.w3.org/2000/svg' width='14' height='10' viewBox='0 0 14 10' fill='none' stroke='#f2f2f2' strokeWidth='1.5'>
        <path d='M0 2h14M0 8h14' />
      </svg>
    </button>
  </>
}

/** The menu: account, carried items, avatar switch. */
export const PlaceSchemaMenuModal = () => {
  const snap = useSnapshot(placeschemaMenu)
  const open = useIsModalActive(MODAL) // also registers the screen, so the client's unknown-screen page stays away
  if (!open) return null
  const short = snap.holder ? `${snap.holder.slice(0, 8)}…${snap.holder.slice(-4)}` : ''
  return <div style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', zIndex: 30 }} onClick={() => hideModal()}>
    <div style={{ ...panel, width: 260, maxWidth: '90vw', maxHeight: '80vh', overflow: 'auto', padding: 10, fontSize: 9 }} onClick={e => e.stopPropagation()}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <img src={logoUrl} alt='' style={{ height: 16 }} />
        <span style={{ fontSize: 10 }}>PlaceSchema</span>
      </div>
      <div style={{ borderTop: hairline, paddingTop: 6, marginBottom: 8 }}>
        <div style={{ opacity: 0.6, marginBottom: 3 }}>Account</div>
        {snap.holder ? <div>Linked · {short}</div> : <div>Not linked. Use the [Link your account] link in chat.</div>}
      </div>
      <div style={{ borderTop: hairline, paddingTop: 6, marginBottom: 8 }}>
        <div style={{ opacity: 0.6, marginBottom: 3 }}>Carried items</div>
        {snap.items.length ? snap.items.map((it, i) => <div key={i}>{it.label || 'Item'} <span style={{ opacity: 0.6 }}>· {it.state}</span></div>) : <div style={{ opacity: 0.6 }}>None</div>}
      </div>
      <div style={{ borderTop: hairline, paddingTop: 6 }}>
        <div style={{ opacity: 0.6, marginBottom: 4 }}>Avatar</div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button type='button' style={buttonStyle(snap.avatar === 'native')} onClick={() => chooseAvatar('native')}>Native</button>
          <button type='button' style={{ ...buttonStyle(snap.avatar === 'carried'), opacity: snap.skin.url ? 1 : 0.4 }} disabled={!snap.skin.url} onClick={() => chooseAvatar('carried')}>Carried skin</button>
          <button type='button' style={buttonStyle(snap.avatar === 'generic')} onClick={() => chooseAvatar('generic')}>Generic</button>
        </div>
      </div>
    </div>
  </div>
}
