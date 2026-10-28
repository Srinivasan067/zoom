'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import BackgroundPicker from './background-picker'
import { useMeetingDisplayName } from './meeting-display-name'
import styles from './page.module.scss'
import { useZoomMeeting } from './use-zoom-meeting'
import { createExternalJoinLink, createMeeting, meetingSchema, type Meeting } from './zoom-api'

type SearchParams = {
  get(name: string): string | null
}

// Same shareable-link flow as the Webex page: the meeting lives in the page URL.
function meetingFromSearch(params: SearchParams): Meeting | null {
  if (!params.get('id') && !params.get('webLink')) {
    return null
  }

  const parsed = meetingSchema.safeParse({
    id: params.get('id') ?? '',
    meetingNumber: params.get('meetingNumber') ?? params.get('id') ?? '',
    webLink: params.get('webLink') ?? '',
    password: params.get('password') ?? '',
    hostKey: params.get('hostKey') ?? '',
  })

  return parsed.success ? parsed.data : null
}

function formatMeetingNumber(value: string) {
  return value.replace(/^(\d{3})(\d{3,4})(\d{4})$/, '$1 $2 $3')
}

export default function ZoomMeetingsPage() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const hasMeetingParams = Boolean(searchParams.get('id') || searchParams.get('webLink'))
  const meeting = meetingFromSearch(searchParams)
  const linkError = hasMeetingParams && !meeting ? 'This meeting link is not valid' : ''

  const profileName = useMeetingDisplayName()
  const [displayName, setDisplayName] = useState(profileName)
  const [copiedMeetingId, setCopiedMeetingId] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  const [externalError, setExternalError] = useState('')
  const [openingExternal, setOpeningExternal] = useState(false)
  const [backgroundOpen, setBackgroundOpen] = useState(false)

  const {
    status,
    error,
    notice,
    audioConnected,
    audioMuted,
    videoOn,
    sharing,
    remoteSharing,
    participantCount,
    waitingCount,
    isHost,
    leaving,
    background,
    backgroundBusy,
    join,
    leave,
    toggleAudio,
    changeBackground,
    zoomRootRef,
  } = useZoomMeeting(meeting)

  const visibleError = createError || externalError || (meeting ? error : linkError)
  const busy = creating || status === 'joining'
  const copied = Boolean(meeting && copiedMeetingId === meeting.id)
  const inCall = status === 'joined' || status === 'joining'

  const createNewMeeting = async () => {
    try {
      setCreating(true)
      setCreateError('')

      const start = new Date(Date.now() + 5 * 60 * 1000)
      const end = new Date(Date.now() + 65 * 60 * 1000)

      const created = await createMeeting({
        title: 'GPC POC Meeting',
        start: start.toISOString(),
        end: end.toISOString(),
      })

      const params = new URLSearchParams({
        id: created.id,
        meetingNumber: created.meetingNumber,
        webLink: created.webLink,
        password: created.password,
        hostKey: created.hostKey,
      })
      router.replace(`${pathname}?${params.toString()}`, { scroll: false })
      setCopiedMeetingId('')
    } catch (cause) {
      setCreateError(cause instanceof Error ? cause.message : 'Could not create the meeting')
    } finally {
      setCreating(false)
    }
  }

  // Webex used a GET redirect route; here the backend returns the Zoom join URL and
  // we open it. The tab is opened synchronously so the popup blocker allows it.
  const joinExternally = async () => {
    if (!meeting) {
      return
    }
    setExternalError('')
    setOpeningExternal(true)
    const tab = window.open('about:blank', '_blank')
    try {
      const joinLink = await createExternalJoinLink(meeting.id, displayName)
      if (tab) {
        tab.opener = null
        tab.location.href = joinLink
      } else {
        window.location.href = joinLink
      }
    } catch (cause) {
      tab?.close()
      setExternalError(cause instanceof Error ? cause.message : 'Could not open the meeting in Zoom')
    } finally {
      setOpeningExternal(false)
    }
  }

  return (
    <div className={styles.container}>
      <section className={styles.panel}>
        <header className={styles.intro}>
          <p className={styles.eyebrow}>Peer Community</p>
          <h1 className={styles.title}>Video meeting</h1>
          {displayName.trim() ? <p className={styles.lede}>Hi, {displayName.trim()}</p> : null}
          <p className={styles.lede}>
            Create a meeting, then copy the page link. Each person opens that link and joins in this page.
          </p>
        </header>

        {meeting ? null : (
          <div>
            <button className={styles.primary} onClick={createNewMeeting} disabled={busy} type="button">
              {creating ? 'Creating meeting' : 'Create meeting'}
            </button>
          </div>
        )}

        {visibleError ? (
          <p className={styles.error} role="alert">
            {visibleError}
          </p>
        ) : null}

        {meeting?.webLink ? (
          <div className={styles.workspace}>
            <aside className={styles.details}>
              <h2 className={styles.detailsTitle}>Meeting details</h2>
              <dl className={styles.facts}>
                <div>
                  <dt>Meeting ID</dt>
                  <dd>{formatMeetingNumber(meeting.meetingNumber)}</dd>
                </div>
                {meeting.password ? (
                  <div>
                    <dt>Passcode</dt>
                    <dd>{meeting.password}</dd>
                  </div>
                ) : null}
                {status === 'joined' ? (
                  <div>
                    <dt>In meeting</dt>
                    <dd>
                      {participantCount} {participantCount === 1 ? 'person' : 'people'}
                      {isHost ? ' · you are host' : ''}
                      {isHost && waitingCount > 0 ? ` · ${waitingCount} waiting` : ''}
                    </dd>
                  </div>
                ) : null}
              </dl>

              <div className={styles.share}>
                <button
                  className={styles.secondary}
                  type="button"
                  onClick={async () => {
                    await navigator.clipboard.writeText(window.location.href)
                    setCopiedMeetingId(meeting.id)
                  }}
                >
                  {copied ? 'Copied' : 'Copy link'}
                </button>
              </div>

              {status === 'joined' ? null : (
                <label className={styles.nameField}>
                  <span className={styles.nameLabel}>Your name</span>
                  <input
                    className={styles.nameInput}
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    maxLength={128}
                    autoComplete="name"
                  />
                </label>
              )}

              <div className={styles.actions}>
                {status === 'joined' ? null : (
                  <button
                    className={styles.primary}
                    onClick={() => join(displayName)}
                    disabled={busy || displayName.trim() === ''}
                    type="button"
                  >
                    {status === 'joining' ? 'Starting meeting' : 'Start meeting'}
                  </button>
                )}
                <button className={styles.secondary} onClick={joinExternally} disabled={openingExternal} type="button">
                  {openingExternal ? 'Opening Zoom' : 'Join Externally'}
                </button>
              </div>

              <button className={styles.secondary} onClick={createNewMeeting} disabled={busy || inCall} type="button">
                {creating ? 'Creating meeting' : 'New meeting'}
              </button>
            </aside>

            <div className={styles.stage}>
              {inCall ? null : <p className={styles.stageHint}>The meeting opens in this panel.</p>}
              {sharing ? <span className={styles.shareLabel}>You&apos;re sharing</span> : null}
              {!sharing && remoteSharing ? <span className={styles.shareLabel}>Shared screen</span> : null}

              {/* The Zoom SDK renders video, screen share and its own toolbar here. */}
              <div ref={zoomRootRef} className={styles.zoomRoot} />

              {status === 'joined' && backgroundOpen ? (
                <BackgroundPicker selected={background} busy={backgroundBusy} onChange={changeBackground} />
              ) : null}

              {status === 'joined' ? (
                <div className={styles.controls} role="toolbar" aria-label="Meeting controls">
                  <button
                    className={styles.control}
                    type="button"
                    aria-pressed={audioMuted}
                    disabled={leaving}
                    onClick={toggleAudio}
                    title={audioConnected ? undefined : 'Join audio from the Zoom toolbar first'}
                  >
                    {!audioConnected ? 'No audio' : audioMuted ? 'Unmute' : 'Mute'}
                  </button>
                  <span className={styles.controlStatus} title="Use the camera button in the Zoom toolbar">
                    {videoOn ? 'Video on' : 'Video off'}
                  </span>
                  <button
                    className={styles.control}
                    type="button"
                    aria-expanded={backgroundOpen}
                    disabled={leaving}
                    onClick={() => setBackgroundOpen((open) => !open)}
                  >
                    Background
                  </button>
                  <button className={styles.controlLeave} type="button" disabled={leaving} onClick={leave}>
                    Stop
                  </button>
                </div>
              ) : null}
            </div>

            {notice ? (
              <p className={styles.notice} role="status">
                {notice}
              </p>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  )
}
