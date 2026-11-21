import type { Attachment } from 'server/attachments'
import { api } from './api.ts'

export type { Attachment }

const THUMB_EDGE = 480

export const fileUrl = (a: Pick<Attachment, 'id'>) => `/api/attachments/${a.id}`
export const thumbUrl = (a: Pick<Attachment, 'id'>) => `/api/attachments/${a.id}/thumb`

/** Shown as a picture: it has a thumbnail, or the browser can draw the file itself. */
export const isVisual = (a: Attachment) => a.thumb || (a.type.startsWith('image/') && a.type !== 'image/svg+xml')
/** The picture to show for a visual attachment: its thumbnail, else the file itself. */
export const previewUrl = (a: Attachment) => (a.thumb ? thumbUrl(a) : fileUrl(a))
export const isVideo = (a: Attachment) => a.type.startsWith('video/')

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

interface Thumb {
  blob: Blob | null
  width: number
  height: number
}

function drawThumb(source: CanvasImageSource, width: number, height: number): Promise<Blob | null> {
  const scale = Math.min(1, THUMB_EDGE / Math.max(width, height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  canvas.getContext('2d')!.drawImage(source, 0, 0, canvas.width, canvas.height)
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8))
}

function videoFrame(file: File): Promise<Thumb | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    const done = (thumb: Thumb | null) => {
      clearTimeout(timer)
      URL.revokeObjectURL(url)
      resolve(thumb)
    }
    const timer = setTimeout(() => done(null), 8000)
    video.muted = true
    video.playsInline = true
    video.preload = 'auto'
    video.addEventListener('loadeddata', () => {
      video.currentTime = Math.min(0.5, video.duration / 2 || 0)
    })
    video.addEventListener('seeked', () => {
      const { videoWidth: width, videoHeight: height } = video
      void drawThumb(video, width, height).then((blob) => done({ blob, width, height }))
    })
    video.addEventListener('error', () => done(null))
    video.src = url
  })
}

/** A small JPEG of a picture or a video's first moments and its pixel size, read here so the server needs no image tools; null when the browser cannot read the file. */
export async function thumbnailOf(file: File): Promise<Thumb | null> {
  try {
    if (file.type.startsWith('video/')) return await videoFrame(file)
    if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') return null
    const bitmap = await createImageBitmap(file)
    const thumb = { blob: await drawThumb(bitmap, bitmap.width, bitmap.height), width: bitmap.width, height: bitmap.height }
    bitmap.close()
    return thumb
  } catch {
    return null
  }
}

export async function upload(file: File): Promise<Attachment> {
  const thumb = await thumbnailOf(file)
  const res = await api.attachments.$post({
    form: {
      file,
      ...(thumb?.blob ? { thumb: new File([thumb.blob], 'thumb.jpg', { type: 'image/jpeg' }) } : {}),
      ...(thumb ? { width: String(thumb.width), height: String(thumb.height) } : {}),
    },
  })
  if (!res.ok) throw new Error(String(res.status))
  return res.json()
}
