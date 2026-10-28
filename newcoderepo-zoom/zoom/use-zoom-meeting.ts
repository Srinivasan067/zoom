'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createGuestToken, type Meeting } from './zoom-api'
import {
  loadZoomSdk,
  zoomErrorMessage,
  type ZoomClient,
  type ZoomParticipant,
  type ZoomSdk,
  type ZoomVbImage,
} from './zoom-sdk'

// Zoom counterpart of useWebexMeeting. Differences forced by the Zoom SDK
// (Component View): the SDK renders the video grid and its own toolbar inside
// `zoomRootRef`; camera on/off, screen share start/stop and "Join Audio" are
// done from that toolbar (no programmatic API). Mute, background, host claim
// and leave are driven from this hook.

export type MeetingStatus = 'idle' | 'joining' | 'joined'

export type VirtualBackground = { id: string; imageUrl?: string }

const SDK_EVENTS = ['user-added', 'user-updated', 'user-removed', 'peer-share-state-change'] as const

export function useZoomMeeting(meeting: Meeting | null) {
  const zoomRootRef = useRef<HTMLDivElement>(null)
  const sdkRef = useRef<ZoomSdk | null>(null)
  const clientRef = useRef<ZoomClient | null>(null)
  const listenersRef = useRef<Array<[string, (payload: never) => void]>>([])
  const vbImagesRef = useRef<ZoomVbImage[]>([])

  const [status, setStatus] = useState<MeetingStatus>('idle')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [self, setSelf] = useState<ZoomParticipant | null>(null)
  const [participants, setParticipants] = useState<ZoomParticipant[]>([])
  const [isHost, setIsHost] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [background, setBackground] = useState('none')
  const [backgroundBusy, setBackgroundBusy] = useState(false)

  const refresh = useCallback(() => {
    const client = clientRef.current
    if (!client) {
      return
    }
    try {
      setSelf(client.getCurrentUser())
      setParticipants(client.getAttendeeslist())
      setIsHost(Boolean(client.isHost()))
    } catch {
      // The SDK throws while it is tearing down; nothing to refresh then.
    }
  }, [])

  const cleanup = useCallback(() => {
    const client = clientRef.current
    if (client) {
      for (const [event, listener] of listenersRef.current) {
        try {
          client.off(event, listener)
        } catch {
          // client already gone
        }
      }
    }
    listenersRef.current = []
    try {
      if (client) {
        sdkRef.current?.destroyClient()
      }
    } catch {
      // destroying an un-joined client can throw
    }
    clientRef.current = null
    vbImagesRef.current = []
    setSelf(null)
    setParticipants([])
    setIsHost(false)
    setBackground('none')
  }, [])

  const join = useCallback(
    async (displayName: string) => {
      const root = zoomRootRef.current
      const name = displayName.trim()
      if (!meeting || !root || !name || clientRef.current) {
        return
      }

      setStatus('joining')
      setError('')
      setNotice('')
      try {
        const signature = await createGuestToken(meeting.meetingNumber, name)
        const sdk = await loadZoomSdk()
        sdkRef.current = sdk

        const client = sdk.createClient()
        clientRef.current = client
        const { width, height } = root.getBoundingClientRect()

        await client.init({
          zoomAppRoot: root,
          language: 'en-US',
          patchJsMedia: true,
          leaveOnPageUnload: true,
          // Virtual backgrounds without SharedArrayBuffer (no COOP/COEP headers) are opt-in.
          enforceVirtualBackground: typeof window !== 'undefined' && !window.crossOriginIsolated,
          customize: {
            video: {
              isResizable: false,
              popper: { disableDraggable: true },
              viewSizes: { default: { width: Math.max(320, Math.floor(width)), height: Math.max(240, Math.floor(height)) } },
              defaultViewType: 'gallery',
            },
          },
        })

        const onConnection = (payload: { state?: string }) => {
          if (payload?.state === 'Closed' || payload?.state === 'Fail') {
            cleanup()
            setStatus('idle')
            if (payload.state === 'Fail') {
              setError('The meeting connection failed')
            }
          }
        }
        client.on('connection-change', onConnection as (payload: never) => void)
        listenersRef.current.push(['connection-change', onConnection as (payload: never) => void])
        for (const event of SDK_EVENTS) {
          client.on(event, refresh)
          listenersRef.current.push([event, refresh])
        }

        await client.join({
          signature,
          meetingNumber: meeting.meetingNumber,
          password: meeting.password,
          userName: name,
        })
        setStatus('joined')
        refresh()

        // Webex assigned MODERATOR with the hostKey; Zoom's equivalent is claiming host.
        if (meeting.hostKey && !client.isHost()) {
          try {
            await client.claimHostWithHostKey(meeting.hostKey)
          } catch (cause) {
            setNotice(`Joined as a participant (host not claimed: ${zoomErrorMessage(cause, 'host key rejected')})`)
          }
          refresh()
        }
      } catch (cause) {
        cleanup()
        setStatus('idle')
        setError(zoomErrorMessage(cause, 'Could not start the meeting'))
      }
    },
    [meeting, refresh, cleanup]
  )

  const leave = useCallback(async () => {
    const client = clientRef.current
    if (!client) {
      return
    }
    setLeaving(true)
    try {
      await client.leaveMeeting()
    } catch {
      // Leaving must always succeed locally.
    } finally {
      cleanup()
      setLeaving(false)
      setStatus('idle')
    }
  }, [cleanup])

  const toggleAudio = useCallback(async () => {
    const client = clientRef.current
    const current = client?.getCurrentUser()
    if (!client || !current) {
      return
    }
    if (!current.audio) {
      setNotice('Click "Join Audio" in the Zoom toolbar first, then mute/unmute here.')
      return
    }
    try {
      await client.mute(!current.muted)
      setNotice('')
    } catch (cause) {
      setNotice(zoomErrorMessage(cause, 'Could not change the microphone'))
    }
    refresh()
  }, [refresh])

  const changeBackground = useCallback(
    async (next: VirtualBackground) => {
      const client = clientRef.current
      if (!client) {
        return
      }
      setBackgroundBusy(true)
      setNotice('')
      try {
        if (next.id === 'none') {
          await client.setVirtualBackground('')
        } else if (next.id === 'blur') {
          await client.setVirtualBackground('blur')
        } else if (next.imageUrl) {
          // Zoom can only set images that are in its VB list, and the list cannot
          // change while an image/blur is applied, so clear first when needed.
          if (!vbImagesRef.current.some((image) => image.id === next.id && image.url === next.imageUrl)) {
            if (client.getVirtualBackgroundStatus().isVbOn) {
              await client.setVirtualBackground('')
            }
            const others = vbImagesRef.current.filter((image) => image.id !== next.id)
            const list = [...others, { id: next.id, fileName: `${next.id}.jpg`, displayName: next.id, url: next.imageUrl }]
            await client.updateVirtualBackgroundList(list)
            vbImagesRef.current = list
          }
          await client.setVirtualBackground(next.id)
        }
        setBackground(next.id)
      } catch (cause) {
        setNotice(`Background: ${zoomErrorMessage(cause, 'not supported on this device')}. Start your camera first.`)
      } finally {
        setBackgroundBusy(false)
      }
    },
    []
  )

  // Keep the SDK video area sized to its container.
  useEffect(() => {
    const root = zoomRootRef.current
    if (status !== 'joined' || !root || typeof ResizeObserver === 'undefined') {
      return
    }
    const observer = new ResizeObserver(([entry]) => {
      const rect = entry?.contentRect
      if (rect && rect.width > 0 && rect.height > 0) {
        clientRef.current?.updateVideoOptions({
          viewSizes: { default: { width: Math.floor(rect.width), height: Math.floor(rect.height) } },
        })
      }
    })
    observer.observe(root)
    return () => observer.disconnect()
  }, [status])

  // Leave + clean up when the page unmounts (route change).
  useEffect(
    () => () => {
      const client = clientRef.current
      if (client) {
        client.leaveMeeting().catch(() => undefined)
      }
      cleanup()
    },
    [cleanup]
  )

  const remoteSharing = participants.some((participant) => participant.sharerOn && participant.userId !== self?.userId)

  return {
    status,
    error,
    notice,
    audioConnected: Boolean(self?.audio),
    audioMuted: self ? self.muted || !self.audio : true,
    videoOn: Boolean(self?.video),
    sharing: Boolean(self?.sharerOn),
    remoteSharing,
    participantCount: participants.filter((participant) => !participant.isHold).length,
    waitingCount: participants.filter((participant) => participant.isHold).length,
    isHost,
    leaving,
    background,
    backgroundBusy,
    join,
    leave,
    toggleAudio,
    changeBackground,
    zoomRootRef,
  }
}
