import { createGesture, type Gesture } from '@ionic/core/components'
import { computed, onBeforeUnmount, onMounted, ref, type Ref } from 'vue'

/** Only a swipe within this many degrees of horizontal turns the day; anything steeper stays a scroll. */
const MAX_ANGLE = 30
/** Pixels the finger travels before the direction is judged, once. */
const THRESHOLD = 10
/** Swipes starting this close to a side are left to the browser's back and forward gestures. */
const EDGE = 30
const DURATION = 220
/** Ionic's swipe-back rule: past half the width, or a flick faster than this (px/ms) the way the finger went. */
const FLICK = 0.2

/** iOS-style rubber band: the further past the end, the less it moves. */
const rubber = (dx: number, width: number) => Math.sign(dx) * (1 - 1 / ((Math.abs(dx) * 0.55) / width + 1)) * width

/**
 * Swiping the pane right goes back a day and left goes forward. The pane follows the finger; on release past half its
 * width or on a flick, the day changes at once and the new day slides in from where the neighbouring page would sit.
 * A new swipe can start mid-slide, so days can be flipped as fast as the finger goes. Vertical scrolling is never
 * taken over.
 */
export function useDaySwipe(pane: Ref<HTMLElement | null>, options: { canGoForward: () => boolean; go: (step: -1 | 1) => Promise<unknown> }) {
  const offset = ref(0)
  const animated = ref(false)
  let tracking = false
  let width = 0
  /** Where the pane sat when the finger caught it. */
  let base = 0
  /** Bumped by every slide and every catch, so a finished slide only settles if nothing has happened since. */
  let generation = 0
  let gesture: Gesture | null = null

  function slideTo(x: number) {
    const mine = ++generation
    animated.value = true
    offset.value = x
    setTimeout(() => {
      if (mine === generation) animated.value = false
    }, DURATION)
  }

  /** The pane's position this frame, mid-slide included. */
  const shown = () => new DOMMatrixReadOnly(getComputedStyle(pane.value!).transform).m41

  async function land(step: -1 | 1, released: number) {
    const mine = ++generation
    await options.go(step)
    if (mine !== generation) return
    // The new day starts where it would have been as the page next to the one the finger let go of.
    animated.value = false
    offset.value = released + step * width
    requestAnimationFrame(() => requestAnimationFrame(() => mine === generation && slideTo(0)))
  }

  onMounted(() => {
    gesture = createGesture({
      el: pane.value!,
      gestureName: 'day-swipe',
      direction: 'x',
      maxAngle: MAX_ANGLE,
      threshold: THRESHOLD,
      passive: false,
      canStart: (d) => d.startX > EDGE && d.startX < window.innerWidth - EDGE,
      onStart: (d) => {
        // Once the browser has begun scrolling, the gesture belongs to it.
        tracking = d.event.cancelable
        if (!tracking) return
        width = pane.value!.clientWidth
        base = animated.value ? shown() : offset.value
        generation++
        animated.value = false
        offset.value = base
      },
      onMove: (d) => {
        if (!tracking) return
        if (d.event.cancelable) d.event.preventDefault()
        const x = base + d.deltaX
        offset.value = x < 0 && !options.canGoForward() ? rubber(x, width) : x
      },
      onEnd: (d) => {
        if (!tracking) return
        tracking = false
        const x = base + d.deltaX
        const step = x > 0 ? -1 : 1
        const far = Math.abs(x) > width / 2
        const flick = Math.abs(d.velocityX) > FLICK && Math.sign(d.velocityX) === Math.sign(x) && Math.abs(d.deltaX) > 24
        if ((far || flick) && (step === -1 || options.canGoForward())) land(step, offset.value)
        else slideTo(0)
      },
    })
    gesture.enable()
  })
  onBeforeUnmount(() => gesture?.destroy())

  const style = computed(() => ({
    transform: offset.value ? `translate3d(${offset.value}px, 0, 0)` : undefined,
    transition: animated.value ? `transform ${DURATION}ms cubic-bezier(0.32, 0.72, 0, 1)` : undefined,
  }))
  return { style }
}
