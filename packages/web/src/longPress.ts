import type { Directive } from 'vue'

const HOLD_MS = 450
/** A finger that drifts further than this is scrolling, not holding. */
const SLOP_PX = 8

interface Press {
  run: () => void
  timer: number | undefined
  x: number
  y: number
  fired: boolean
  detach: () => void
}

const presses = new WeakMap<HTMLElement, Press>()

/** Calls the bound function after a held press; the tap that would follow it is swallowed. */
export const vLongPress: Directive<HTMLElement, () => void> = {
  mounted(el, binding) {
    const press: Press = { run: binding.value, timer: undefined, x: 0, y: 0, fired: false, detach: () => {} }
    const cancel = () => {
      clearTimeout(press.timer)
      press.timer = undefined
      el.classList.remove('pressing')
    }
    const down = (e: PointerEvent) => {
      if (!e.isPrimary || e.button !== 0) return
      press.fired = false
      press.x = e.clientX
      press.y = e.clientY
      el.classList.add('pressing')
      press.timer = window.setTimeout(() => {
        cancel()
        press.fired = true
        navigator.vibrate?.(10)
        press.run()
      }, HOLD_MS)
    }
    const move = (e: PointerEvent) => {
      if (press.timer !== undefined && Math.hypot(e.clientX - press.x, e.clientY - press.y) > SLOP_PX) cancel()
    }
    const click = (e: MouseEvent) => {
      if (!press.fired) return
      press.fired = false
      e.preventDefault()
      e.stopImmediatePropagation()
    }
    const menu = (e: Event) => e.preventDefault()
    const ends = ['pointerup', 'pointercancel', 'pointerleave'] as const

    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    for (const type of ends) el.addEventListener(type, cancel)
    el.addEventListener('click', click, true)
    el.addEventListener('contextmenu', menu)
    el.dataset.longPress = ''
    press.detach = () => {
      cancel()
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      for (const type of ends) el.removeEventListener(type, cancel)
      el.removeEventListener('click', click, true)
      el.removeEventListener('contextmenu', menu)
    }
    presses.set(el, press)
  },
  updated(el, binding) {
    const press = presses.get(el)
    if (press) press.run = binding.value
  },
  unmounted(el) {
    presses.get(el)?.detach()
    presses.delete(el)
  },
}
