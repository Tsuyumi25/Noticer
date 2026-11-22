import { computed, onMounted, onUnmounted, ref } from 'vue'

const DAMPING = 0.6
/** Pixels the finger travels before the pull is judged: down pulls the sheet, sideways belongs to whatever swipes. */
const AXIS_THRESHOLD = 10
let open = 0

interface SheetDragOptions {
  /** A pull far or fast enough asks to close; the sheet decides whether to leave. */
  onRequestClose: () => void
  /** Return false to keep this touch from pulling the sheet. */
  canDrag?: (e: TouchEvent) => boolean
  instant?: boolean
}

/** A full-screen sheet that slides in, follows a downward pull, and slides away when asked to leave. */
export function useSheetDrag({ onRequestClose, canDrag, instant = false }: SheetDragOptions) {
  const sheet = ref<HTMLElement | null>(null)
  /** How far the sheet is pushed below full screen, in px; 0 means full screen. */
  const offset = ref(instant ? 0 : window.innerHeight)
  const animated = ref(true)
  const leaving = ref(false)

  // Full screen has square corners; they round only while the sheet is off its resting place.
  const sheetStyle = computed(() => {
    const radius = `${Math.min(16, offset.value / 5)}px`
    return { transform: `translateY(${offset.value}px)`, borderTopLeftRadius: radius, borderTopRightRadius: radius }
  })
  const backdrop = computed(() => 0.4 * Math.max(0, 1 - offset.value / window.innerHeight))

  function leave() {
    animated.value = true
    leaving.value = true
    offset.value = window.innerHeight
  }

  /** Springs back to full screen, e.g. before asking whether to discard. */
  function settle() {
    animated.value = true
    offset.value = 0
  }

  const isLeaveEnd = (e: TransitionEvent) => leaving.value && e.target === sheet.value && e.propertyName === 'transform'

  let dragging = false
  let judged = false
  let startX = 0
  let startY = 0
  let startTime = 0

  /** A pull only drags the sheet when nothing under the finger is scrolled down. */
  function atTop(target: EventTarget | null): boolean {
    for (let el = target as HTMLElement | null; el && el !== sheet.value; el = el.parentElement) {
      if (el.scrollTop > 0) return false
    }
    return true
  }

  function onTouchStart(e: TouchEvent) {
    const touch = e.touches[0]
    if (leaving.value || !touch || e.touches.length > 1) return
    dragging = (canDrag?.(e) ?? true) && atTop(e.target)
    judged = false
    startX = touch.clientX
    startY = touch.clientY
    startTime = e.timeStamp
  }

  function onTouchMove(e: TouchEvent) {
    const touch = e.touches[0]
    if (!dragging || !touch) return
    const dy = touch.clientY - startY
    if (!judged) {
      const dx = touch.clientX - startX
      if (Math.max(Math.abs(dx), Math.abs(dy)) < AXIS_THRESHOLD) return
      judged = true
      if (Math.abs(dx) > Math.abs(dy)) return void (dragging = false)
    }
    if (dy <= 0) {
      // Pushing up scrolls the content instead.
      if (offset.value === 0) dragging = false
      else offset.value = 0
      return
    }
    e.preventDefault()
    animated.value = false
    offset.value = dy * DAMPING
  }

  function onTouchEnd(e: TouchEvent) {
    if (!dragging) return
    dragging = false
    animated.value = true
    const dy = offset.value / DAMPING
    const velocity = dy / (e.timeStamp - startTime)
    if (e.type === 'touchend' && (dy > 200 || (velocity > 0.5 && dy > 50))) onRequestClose()
    else offset.value = 0
  }

  onMounted(() => {
    if (open++ === 0) document.documentElement.style.overflow = 'hidden'
    // Paint the off-screen position first so the slide-in animates.
    if (!instant) requestAnimationFrame(() => requestAnimationFrame(() => (offset.value = 0)))
  })
  onUnmounted(() => {
    if (--open === 0) document.documentElement.style.overflow = ''
  })

  return { sheet, sheetStyle, backdrop, animated, leaving, leave, settle, isLeaveEnd, onTouchStart, onTouchMove, onTouchEnd }
}
