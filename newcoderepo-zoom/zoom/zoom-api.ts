'use client'

import { z } from 'zod'

// Same convention as the Webex page (`/peer-community/nextapi/video/webex/...`).
// The nextapi proxy forwards to pulse-server `/api/v1/video/zoom/...`.
// Set NEXT_PUBLIC_ZOOM_API_BASE to call another base (e.g. pulse-server directly).
const defaultApiBase = '/peer-community/nextapi/video/zoom'

export const zoomApiBase = (process.env.NEXT_PUBLIC_ZOOM_API_BASE || defaultApiBase).replace(/\/+$/, '')

const maxUrlLength = 2048

function isZoomHttps(value: string) {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }

  const host = url.hostname.toLowerCase()
  return (
    url.protocol === 'https:' &&
    (host === 'zoom.us' || host.endsWith('.zoom.us') || host === 'zoomgov.com' || host.endsWith('.zoomgov.com'))
  )
}

const zoomUrl = z.string().trim().max(maxUrlLength).refine(isZoomHttps, 'Meeting link must be an https Zoom URL')

// Zoom meeting IDs are 9–11 digits; id and meetingNumber carry the same value.
const meetingNumber = z
  .string()
  .trim()
  .regex(/^\d{9,11}$/)

export const meetingSchema = z.object({
  id: meetingNumber,
  meetingNumber,
  webLink: zoomUrl,
  password: z.string().max(128).default(''),
  // Host key of the Zoom host user. Empty when the backend could not read it.
  hostKey: z
    .string()
    .trim()
    .max(32)
    .regex(/^[A-Za-z0-9]*$/)
    .default(''),
})

export type Meeting = z.infer<typeof meetingSchema>

const apiErrorSchema = z.object({
  error: z.string().trim().min(1).max(300),
})

const meetingResponseSchema = z.object({ data: meetingSchema })
const guestTokenResponseSchema = z.object({ data: z.object({ signature: z.string().min(1) }) })
const joinResponseSchema = z.object({ data: z.object({ joinLink: zoomUrl }) })

async function readError(response: Response, fallback: string) {
  const payload = await response.json().catch(() => null)
  const parsed = apiErrorSchema.safeParse(payload)
  return parsed.success ? parsed.data.error : fallback
}

async function post<T>(path: string, body: unknown, schema: z.ZodType<T>, fallback: string): Promise<T> {
  const response = await fetch(`${zoomApiBase}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    throw new Error(await readError(response, fallback))
  }

  const parsed = schema.safeParse(await response.json().catch(() => null))
  if (!parsed.success) {
    throw new Error(fallback)
  }
  return parsed.data
}

/** POST /meeting -> { data: { id, meetingNumber, webLink, password, hostKey } } */
export async function createMeeting(input: { title: string; start: string; end: string }): Promise<Meeting> {
  const result = await post('/meeting', input, meetingResponseSchema, 'Could not create the meeting')
  return result.data
}

/** POST /guest-token -> { data: { signature } } (Zoom Meeting SDK JWT for this meeting) */
export async function createGuestToken(meetingNumber: string, displayName: string): Promise<string> {
  const result = await post(
    '/guest-token',
    { meetingNumber, displayName },
    guestTokenResponseSchema,
    'Could not start the meeting'
  )
  return result.data.signature
}

/** POST /join -> { data: { joinLink } } (Zoom join URL for the Zoom app / web client) */
export async function createExternalJoinLink(meetingId: string, displayName: string): Promise<string> {
  const result = await post(
    '/join',
    { meetingId, displayName: displayName.trim().slice(0, 128) },
    joinResponseSchema,
    'Could not open the meeting in Zoom'
  )
  return result.data.joinLink
}
