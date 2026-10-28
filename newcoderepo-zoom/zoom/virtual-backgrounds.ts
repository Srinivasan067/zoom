'use client'

type GradientBackground = {
  id: string
  label: string
  stops: [string, string, string]
}

export const gradientBackgrounds: GradientBackground[] = [
  { id: 'navy', label: 'Navy', stops: ['#001834', '#002856', '#0052d6'] },
  { id: 'sunrise', label: 'Sunrise', stops: ['#3b1c5a', '#c2416b', '#f6a95c'] },
  { id: 'meadow', label: 'Meadow', stops: ['#0b3d2e', '#1f7a5a', '#a6d9b8'] },
]

const width = 1280
const height = 720

// Draws a soft, studio-style backdrop so presets need no hosted image assets.
// Zoom fetches the image from this URL when it is added to its background list.
export function renderGradientBackground({ stops }: GradientBackground) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) {
    return ''
  }

  const base = context.createLinearGradient(0, 0, width, height)
  base.addColorStop(0, stops[0])
  base.addColorStop(0.55, stops[1])
  base.addColorStop(1, stops[2])
  context.fillStyle = base
  context.fillRect(0, 0, width, height)

  const glow = context.createRadialGradient(width * 0.75, height * 0.2, 0, width * 0.75, height * 0.2, width * 0.6)
  glow.addColorStop(0, 'rgb(255 255 255 / 28%)')
  glow.addColorStop(1, 'rgb(255 255 255 / 0%)')
  context.fillStyle = glow
  context.fillRect(0, 0, width, height)

  return canvas.toDataURL('image/jpeg', 0.9)
}

export function gradientPreview({ stops }: GradientBackground) {
  return `linear-gradient(135deg, ${stops[0]}, ${stops[1]} 55%, ${stops[2]})`
}
