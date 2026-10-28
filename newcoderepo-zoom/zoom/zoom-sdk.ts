'use client'

// Zoom Meeting SDK for Web 6.10.0 — Component View, loaded from Zoom's CDN.
//
// Why CDN and not `npm install @zoom/meetingsdk`: the npm package pins
// react@18.3.1 as an exact peer dependency and breaks under React 19. The CDN
// build renders its UI with Zoom's own React 18 runtime, so it works next to the
// app's React 19. Nothing is downloaded until the user joins a meeting.

export const ZOOM_SDK_VERSION = '6.10.0'

const ZOOM_CDN = `https://source.zoom.us/${ZOOM_SDK_VERSION}`
const ZOOM_SCRIPTS = [
  `${ZOOM_CDN}/lib/vendor/react.min.js`,
  `${ZOOM_CDN}/lib/vendor/react-dom.min.js`,
  `${ZOOM_CDN}/zoom-meeting-embedded-${ZOOM_SDK_VERSION}.min.js`,
]
const UMD_GLOBAL = '@zoom/meetingsdk'

// ---- minimal typings for the Component View API used here -------------------

export type ZoomFailure = { type?: string; reason?: string; errorCode?: number; errorMessage?: string }

export type ZoomParticipant = {
  userId: number
  userName: string
  audio: string // '' = not joined to audio
  muted: boolean
  video: boolean
  sharerOn: boolean
  isHost: boolean
  isCoHost: boolean
  isHold: boolean
}

export type ZoomVbImage = { id: string; fileName: string; displayName: string; url: string }

export type ZoomVideoOptions = {
  isResizable?: boolean
  popper?: { disableDraggable?: boolean }
  viewSizes?: { default?: { width: number; height: number } }
  defaultViewType?: 'gallery' | 'speaker' | 'ribbon'
}

export type ZoomClient = {
  init(options: {
    zoomAppRoot: HTMLElement
    language?: string
    patchJsMedia?: boolean
    leaveOnPageUnload?: boolean
    enforceVirtualBackground?: boolean
    customize?: { video?: ZoomVideoOptions }
  }): Promise<unknown>
  join(options: { signature: string; meetingNumber: string; password?: string; userName: string }): Promise<unknown>
  leaveMeeting(): Promise<unknown>
  getCurrentUser(): ZoomParticipant | null
  getAttendeeslist(): ZoomParticipant[]
  isHost(): boolean
  mute(mute: boolean, userId?: number): Promise<unknown>
  claimHostWithHostKey(hostKey: string): Promise<unknown>
  updateVideoOptions(options: ZoomVideoOptions): void
  getVirtualBackgroundStatus(): { id: string; isVbOn: boolean; isLock: boolean; vbList: ZoomVbImage[] }
  updateVirtualBackgroundList(list: ZoomVbImage[]): Promise<unknown>
  setVirtualBackground(id: string): Promise<unknown>
  on(event: string, listener: (payload: never) => void): void
  off(event: string, listener: (payload: never) => void): void
}

export type ZoomSdk = {
  createClient(): ZoomClient
  destroyClient(): void
}

// ---- loader -------------------------------------------------------------------------

let loading: Promise<ZoomSdk> | null = null

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[data-zoom-sdk="${src}"]`)
    if (existing?.dataset['loaded'] === 'true') {
      resolve()
      return
    }
    const script = existing ?? document.createElement('script')
    script.addEventListener('load', () => {
      script.dataset['loaded'] = 'true'
      resolve()
    })
    script.addEventListener('error', () => reject(new Error('Could not load the Zoom meeting SDK')))
    if (!existing) {
      script.src = src
      script.async = false
      script.crossOrigin = 'anonymous'
      script.dataset['zoomSdk'] = src
      document.head.appendChild(script)
    }
  })
}

export function loadZoomSdk(): Promise<ZoomSdk> {
  if (loading) {
    return loading
  }
  loading = (async () => {
    for (const src of ZOOM_SCRIPTS) {
      await loadScript(src)
    }
    const exported = (window as unknown as Record<string, { default?: ZoomSdk } & Partial<ZoomSdk>>)[UMD_GLOBAL]
    const sdk = (exported?.default ?? exported) as ZoomSdk | undefined
    if (!sdk || typeof sdk.createClient !== 'function') {
      throw new Error('Could not load the Zoom meeting SDK')
    }
    return sdk
  })()
  loading.catch(() => {
    loading = null
  })
  return loading
}

/** Turns SDK rejections ({ type, reason } / { errorCode, reason }) into a message. */
export function zoomErrorMessage(cause: unknown, fallback: string) {
  if (cause instanceof Error) {
    return cause.message
  }
  if (cause && typeof cause === 'object') {
    const failure = cause as ZoomFailure
    return failure.reason || failure.errorMessage || failure.type || fallback
  }
  return typeof cause === 'string' && cause ? cause : fallback
}
