import PhotoSwipe, { type SlideData } from 'photoswipe'
import 'photoswipe/style.css'
import { fileSize, fileUrl, isVideo, thumbUrl, type Attachment } from './attachments.ts'
import { t } from './i18n/index.ts'

const escape = (text: string) => text.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`)

function fileSlide(a: Attachment): SlideData {
  return {
    html: `<div class="pswp-file">
      <p class="pswp-file__name">${escape(a.name)}</p>
      <p class="pswp-file__size">${fileSize(a.size)}</p>
      <a class="pswp-file__download" href="${fileUrl(a)}" download="${escape(a.name)}">${escape(t('attach.download'))}</a>
    </div>`,
  }
}

function naturalSize(src: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => resolve(null)
    img.src = src
  })
}

async function slideOf(a: Attachment): Promise<SlideData> {
  if (isVideo(a)) {
    const poster = a.thumb ? ` poster="${thumbUrl(a)}"` : ''
    return { html: `<div class="pswp-video"><video src="${fileUrl(a)}"${poster} controls playsinline preload="metadata"></video></div>` }
  }
  if (!a.type.startsWith('image/') || a.type === 'image/svg+xml') return fileSlide(a)
  // A picture without a known size is measured here; one the browser cannot draw is offered as a file.
  const size = a.width && a.height ? { width: a.width, height: a.height } : await naturalSize(fileUrl(a))
  if (!size) return fileSlide(a)
  return { src: fileUrl(a), ...size, ...(a.thumb ? { msrc: thumbUrl(a) } : {}), alt: a.name }
}

interface ViewerOptions {
  /** Offers a button that closes the viewer and shows the current attachment's entry in the journal. */
  showInJournal?: (index: number) => void
}

/** Opens attachments over the whole screen, at `index`: swipe between them, pinch to zoom, drag down to close. */
export async function openViewer(attachments: Attachment[], index: number, { showInJournal }: ViewerOptions = {}) {
  const pswp = new PhotoSwipe({
    dataSource: await Promise.all(attachments.map(slideOf)),
    index,
    bgOpacity: 1,
    closeOnVerticalDrag: true,
    pinchToClose: true,
    showHideAnimationType: 'fade',
    errorMsg: t('attach.unreadable'),
    closeTitle: t('common.close'),
    zoomTitle: t('attach.zoom'),
    arrowPrevTitle: t('attach.previous'),
    arrowNextTitle: t('attach.next'),
  })
  // The video's own controls take the touch instead of the swipe.
  pswp.addFilter('preventPointerEvent', (prevent, e) => (e.target instanceof Element && e.target.closest('video') ? false : prevent))
  pswp.on('uiRegister', () => {
    if (showInJournal) {
      pswp.ui?.registerElement({
        name: 'journal',
        appendTo: 'root',
        isButton: true,
        html: escape(t('attach.showInJournal')),
        onClick: (_, __, viewer) => {
          const at = viewer.currIndex
          viewer.close()
          showInJournal(at)
        },
      })
    }
    pswp.ui?.registerElement({
      name: 'download',
      order: 8,
      isButton: true,
      tagName: 'a',
      ariaLabel: t('attach.download'),
      title: t('attach.download'),
      html: {
        isCustomSVG: true,
        inner: '<path d="M16 6v14m-6-6 6 6 6-6M8 25h16" id="pswp__icn-download" fill="none" stroke="currentColor" stroke-width="2"/>',
        outlineID: 'pswp__icn-download',
      },
      onInit: (el, viewer) => {
        const update = () => {
          const a = attachments[viewer.currIndex]
          if (!a) return
          el.setAttribute('href', fileUrl(a))
          el.setAttribute('download', a.name)
        }
        viewer.on('change', update)
        update()
      },
    })
  })
  // Leaving a video stops it.
  pswp.on('change', () => {
    const current = pswp.currSlide?.holderElement
    for (const video of pswp.element?.querySelectorAll('video') ?? []) if (!current?.contains(video)) video.pause()
  })
  pswp.init()
}
