import ogImage from '@/public/img/og-white-bg.png'
import ProfileClient from '@/services/profile'
import { getBaseMetaData } from '@/util/next'
import type { Metadata } from 'next'
import { Suspense, type ReactNode } from 'react'
import styles from './layout.module.scss'
import { MeetingDisplayName } from './meeting-display-name'

const maxGuestNameLength = 128

function guestName(profile: { displayname?: unknown } | null | undefined) {
  const name = profile?.displayname
  if (typeof name !== 'string') {
    return ''
  }

  return name.trim().slice(0, maxGuestNameLength)
}

export const dynamic = 'force-dynamic'

// Adjust url/canonicalUrl if this folder is placed somewhere other than app/zoom.
export const metadata: Metadata = getBaseMetaData({
  url: '/peer-community/zoom',
  isSeo: true,
  image: ogImage,
  canonicalUrl: '/peer-community/zoom',
  title: 'Zoom Meeting POC | Gartner Peer Community',
  description: 'Zoom video Proof of Concept page for Gartner Peer Community.',
})

export default async function ZoomMeetingsLayout({ children }: { children: ReactNode }) {
  let displayName = ''
  try {
    displayName = guestName(await ProfileClient.getProfile())
  } catch {
    displayName = ''
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <p className={styles.wordmark}>Gartner</p>
          <p className={styles.product}>Peer Community</p>
        </div>
      </header>
      <main className={styles.main}>
        <Suspense fallback={null}>
          <MeetingDisplayName name={displayName}>{children}</MeetingDisplayName>
        </Suspense>
      </main>
    </div>
  )
}
