'use client'

import clsx from 'clsx'
import { useEffect, useRef, useState } from 'react'
import styles from './page.module.scss'
import type { VirtualBackground } from './use-zoom-meeting'
import { gradientBackgrounds, gradientPreview, renderGradientBackground } from './virtual-backgrounds'

const uploadId = 'upload'
const maxUploadBytes = 10 * 1024 * 1024

type BackgroundPickerProps = {
  selected: string
  busy: boolean
  onChange: (background: VirtualBackground) => void
}

const BackgroundPicker = ({ selected, busy, onChange }: BackgroundPickerProps) => {
  const [uploadUrl, setUploadUrl] = useState('')
  const [uploadError, setUploadError] = useState('')
  const imageUrls = useRef(new Map<string, string>())
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(
    () => () => {
      if (uploadUrl) {
        URL.revokeObjectURL(uploadUrl)
      }
    },
    [uploadUrl]
  )

  const chooseGradient = (preset: (typeof gradientBackgrounds)[number]) => {
    let imageUrl = imageUrls.current.get(preset.id)
    if (!imageUrl) {
      imageUrl = renderGradientBackground(preset)
      imageUrls.current.set(preset.id, imageUrl)
    }
    onChange({ id: preset.id, imageUrl })
  }

  const chooseUpload = (file: File | undefined) => {
    setUploadError('')
    if (!file) {
      return
    }
    if (!file.type.startsWith('image/') || file.size > maxUploadBytes) {
      setUploadError('Choose an image under 10 MB')
      return
    }

    const imageUrl = URL.createObjectURL(file)
    setUploadUrl(imageUrl)
    onChange({ id: uploadId, imageUrl })
  }

  const option = (id: string) => clsx(styles.backgroundOption, selected === id && styles.backgroundOptionSelected)

  return (
    <div className={styles.backgroundPanel} role="group" aria-label="Virtual background">
      <p className={styles.backgroundTitle}>Background</p>
      <div className={styles.backgroundOptions}>
        <button
          className={option('none')}
          type="button"
          aria-pressed={selected === 'none'}
          disabled={busy}
          onClick={() => onChange({ id: 'none' })}
        >
          None
        </button>
        <button
          className={clsx(option('blur'), styles.backgroundBlur)}
          type="button"
          aria-pressed={selected === 'blur'}
          disabled={busy}
          onClick={() => onChange({ id: 'blur' })}
        >
          Blur
        </button>
        {gradientBackgrounds.map((preset) => (
          <button
            key={preset.id}
            className={option(preset.id)}
            style={{ backgroundImage: gradientPreview(preset) }}
            type="button"
            aria-pressed={selected === preset.id}
            disabled={busy}
            onClick={() => chooseGradient(preset)}
          >
            {preset.label}
          </button>
        ))}
        <button
          className={option(uploadId)}
          style={uploadUrl ? { backgroundImage: `url(${uploadUrl})` } : undefined}
          type="button"
          aria-pressed={selected === uploadId}
          disabled={busy}
          onClick={() => fileInput.current?.click()}
        >
          {uploadUrl ? 'Your image' : 'Upload'}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          hidden
          onChange={(event) => {
            chooseUpload(event.target.files?.[0])
            event.target.value = ''
          }}
        />
      </div>
      <p className={styles.backgroundHint}>Start your camera in the Zoom toolbar to see the background.</p>
      {busy ? <p className={styles.backgroundHint}>Applying background</p> : null}
      {uploadError ? <p className={styles.backgroundHint}>{uploadError}</p> : null}
    </div>
  )
}

export default BackgroundPicker
