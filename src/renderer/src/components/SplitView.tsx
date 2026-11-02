import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useApp } from '../context'

const MIN_PANE = 360
const DIVIDER = 7

/**
 * Two scrolling panes with a draggable divider. Each pane keeps at least 360px.
 * Double-click the divider for 50/50; arrow keys nudge it. The split is saved in settings.
 */
export function SplitView({ left, right, rightRef }: { left: ReactNode; right: ReactNode; rightRef?: React.Ref<HTMLElement> }) {
  const { settings, saveSettings } = useApp()
  const [percent, setPercent] = useState(settings.splitPercent)
  const [dragging, setDragging] = useState(false)
  const splitRef = useRef<HTMLDivElement>(null)
  const percentRef = useRef(percent)
  percentRef.current = percent

  const clamp = (p: number) => {
    const width = (splitRef.current?.clientWidth ?? 1200) - DIVIDER
    const lo = Math.min(50, (MIN_PANE / width) * 100)
    return Math.round(Math.min(100 - lo, Math.max(lo, p)) * 10) / 10
  }
  const persist = (p: number) => {
    if (p !== settings.splitPercent) void saveSettings({ splitPercent: p })
  }

  useEffect(() => {
    const onResize = () => setPercent((p) => clamp(p))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  return (
    <div className="split" ref={splitRef} style={{ '--left': `${percent}%` } as React.CSSProperties}>
      <section className="pane left">{left}</section>
      <div
        className={`divider ${dragging ? 'drag' : ''}`}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panes"
        aria-valuenow={Math.round(percent)}
        tabIndex={0}
        title="Drag to resize · double-click for 50/50"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          setDragging(true)
          document.body.classList.add('resizing')
        }}
        onPointerMove={(e) => {
          if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
          const rect = splitRef.current!.getBoundingClientRect()
          setPercent(clamp(((e.clientX - rect.left) / (rect.width - DIVIDER)) * 100))
        }}
        onPointerUp={(e) => {
          e.currentTarget.releasePointerCapture(e.pointerId)
          setDragging(false)
          document.body.classList.remove('resizing')
          persist(percentRef.current)
        }}
        onDoubleClick={() => {
          setPercent(50)
          persist(50)
        }}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
          e.preventDefault()
          e.stopPropagation()
          const next = clamp(percent + (e.key === 'ArrowLeft' ? -2 : 2))
          setPercent(next)
          persist(next)
        }}
      />
      <section className="pane right" ref={rightRef}>
        {right}
      </section>
    </div>
  )
}
