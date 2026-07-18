import * as React from "react"

import { cn } from "@/lib/utils"

type PullToRefreshProps = React.ComponentProps<"div"> & {
  onRefresh: () => Promise<void>
  threshold?: number
}

const DEFAULT_THRESHOLD = 44
const ACTIVATION_DISTANCE = 4
const PULL_RESISTANCE = 0.58
const MAX_OVERSHOOT = 28
const RUBBER_BAND_DISTANCE = 50

function getPullDistance(rawDistance: number, threshold: number) {
  const triggerDistance = threshold / PULL_RESISTANCE

  if (rawDistance <= triggerDistance) {
    return rawDistance * PULL_RESISTANCE
  }

  const overshoot = rawDistance - triggerDistance
  const rubberBand =
    (1 - Math.exp(-overshoot / RUBBER_BAND_DISTANCE)) * MAX_OVERSHOOT

  return Math.min(threshold + rubberBand, threshold + MAX_OVERSHOOT)
}

function PullRefreshRing({
  progress,
  refreshing,
}: {
  progress: number
  refreshing: boolean
}) {
  const easedProgress = Math.pow(Math.min(progress, 1), 1.75)
  const pathProgress = Math.max(0.12, 1 - easedProgress * 0.88)

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 32 32"
      className={cn(
        "size-6 text-primary",
        refreshing && "animate-spin motion-reduce:animate-none",
      )}
    >
      <circle
        cx="16"
        cy="16"
        r="10.75"
        fill="none"
        strokeWidth={refreshing ? 6 : 5.25}
        className="stroke-primary/20"
      />
      {refreshing ? (
        <circle
          cx="16"
          cy="16"
          r="10.75"
          fill="none"
          pathLength={1}
          strokeWidth="4.7"
          strokeLinecap="round"
          strokeDasharray="0.72 1"
          transform="rotate(-90 16 16)"
          className="stroke-primary"
        />
      ) : (
        <>
          <path
            d="M16 5.25A10.75 10.75 0 0 1 16 26.75"
            fill="none"
            pathLength={1}
            strokeWidth="4.7"
            strokeLinecap="round"
            strokeDasharray={`${pathProgress} 1`}
            className="stroke-primary"
          />
          <path
            d="M16 5.25A10.75 10.75 0 0 0 16 26.75"
            fill="none"
            pathLength={1}
            strokeWidth="4.7"
            strokeLinecap="round"
            strokeDasharray={`${pathProgress} 1`}
            className="stroke-primary"
          />
        </>
      )}
    </svg>
  )
}

function PullToRefresh({
  className,
  children,
  onRefresh,
  threshold = DEFAULT_THRESHOLD,
  onTouchStart,
  onTouchMove,
  onTouchEnd,
  onTouchCancel,
  onScroll,
  ...props
}: PullToRefreshProps) {
  const startY = React.useRef(0)
  const startX = React.useRef(0)
  const gestureStartY = React.useRef(0)
  const gestureStartX = React.useRef(0)
  const lastY = React.useRef(0)
  const pulling = React.useRef(false)
  const scrollPulling = React.useRef(false)
  const touchActive = React.useRef(false)
  const distanceRef = React.useRef(0)
  const refreshingRef = React.useRef(false)
  const [distance, setDistance] = React.useState(0)
  const [dragging, setDragging] = React.useState(false)
  const [refreshing, setRefreshing] = React.useState(false)

  const setPullDistance = React.useCallback((value: number) => {
    distanceRef.current = value
    setDistance(value)
  }, [])

  const startRefresh = React.useCallback(async () => {
    if (refreshingRef.current) return

    try {
      refreshingRef.current = true
      setRefreshing(true)
      setPullDistance(threshold)
      await onRefresh()
    } finally {
      refreshingRef.current = false
      setRefreshing(false)
      setPullDistance(0)
    }
  }, [onRefresh, setPullDistance, threshold])

  const finishPull = React.useCallback(async () => {
    if ((!pulling.current && !scrollPulling.current) || refreshingRef.current) {
      return
    }

    pulling.current = false
    scrollPulling.current = false
    setDragging(false)

    if (distanceRef.current < threshold) {
      setPullDistance(0)
      return
    }

    await startRefresh()
  }, [setPullDistance, startRefresh, threshold])

  const handleTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    onTouchStart?.(event)
    if (event.defaultPrevented) return

    const touch = event.touches.item(0)
    if (!touch || refreshingRef.current) return

    touchActive.current = true
    startY.current = touch.clientY
    startX.current = touch.clientX
    gestureStartY.current = touch.clientY
    gestureStartX.current = touch.clientX
    lastY.current = touch.clientY
    pulling.current = event.currentTarget.scrollTop <= 0
    scrollPulling.current = false
    setDragging(pulling.current)
  }

  const handleTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    onTouchMove?.(event)
    const touch = event.touches.item(0)
    if (!touch || refreshingRef.current || event.defaultPrevented) return

    const target = event.currentTarget
    const scrollTop = target.scrollTop
    const moveDelta = touch.clientY - lastY.current
    const gestureDiff = touch.clientY - gestureStartY.current
    const gestureHorizontalDiff = touch.clientX - gestureStartX.current

    if (!pulling.current) {
      if (
        scrollTop <= 0 &&
        moveDelta > 0 &&
        Math.abs(gestureHorizontalDiff) <= Math.abs(gestureDiff)
      ) {
        startY.current = lastY.current
        startX.current = touch.clientX
        pulling.current = true
        scrollPulling.current = false
        setDragging(true)
      } else {
        lastY.current = touch.clientY
        return
      }
    }

    if (scrollTop > 0) {
      pulling.current = false
      setDragging(false)
      setPullDistance(0)
      lastY.current = touch.clientY
      return
    }

    const diff = touch.clientY - startY.current
    const horizontalDiff = touch.clientX - startX.current

    if (Math.abs(horizontalDiff) > Math.abs(diff) && Math.abs(horizontalDiff) > 8) {
      pulling.current = false
      setDragging(false)
      setPullDistance(0)
      lastY.current = touch.clientY
      return
    }

    if (diff <= ACTIVATION_DISTANCE) {
      setPullDistance(0)
      lastY.current = touch.clientY
      return
    }

    if (event.cancelable) {
      event.preventDefault()
    }

    setPullDistance(getPullDistance(diff - ACTIVATION_DISTANCE, threshold))
    lastY.current = touch.clientY
  }

  const handleTouchEnd = (event: React.TouchEvent<HTMLDivElement>) => {
    onTouchEnd?.(event)
    touchActive.current = false
    if (!event.defaultPrevented) {
      void finishPull()
    }
  }

  const handleTouchCancel = (event: React.TouchEvent<HTMLDivElement>) => {
    onTouchCancel?.(event)
    touchActive.current = false
    if (!event.defaultPrevented) {
      pulling.current = false
      scrollPulling.current = false
      setDragging(false)
      setPullDistance(0)
    }
  }

  const handleScroll = (event: React.UIEvent<HTMLDivElement>) => {
    onScroll?.(event)
    if (event.defaultPrevented || pulling.current || refreshingRef.current) return

    const scrollTop = event.currentTarget.scrollTop

    if (scrollTop < -ACTIVATION_DISTANCE) {
      const nextDistance = getPullDistance(
        Math.abs(scrollTop) - ACTIVATION_DISTANCE,
        threshold,
      )

      scrollPulling.current = true
      setDragging(touchActive.current)
      setPullDistance(nextDistance)

      if (!touchActive.current && nextDistance >= threshold) {
        void finishPull()
      }

      return
    }

    if (scrollPulling.current && scrollTop >= 0) {
      void finishPull()
    }
  }

  const progress = refreshing ? 1 : Math.min(distance / threshold, 1)
  const ready = distance >= threshold
  const visible = distance > 0 || refreshing
  const label = refreshing
    ? "正在刷新"
    : ready
      ? "松开刷新"
      : "下拉刷新"

  return (
    <div
      data-slot="pull-to-refresh"
      className={cn(
        "flex-1 min-h-0 touch-pan-y overflow-y-auto overscroll-y-contain [-webkit-overflow-scrolling:touch]",
        className,
      )}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchCancel}
      onScroll={handleScroll}
      {...props}
    >
      <div
        data-slot="pull-to-refresh-indicator"
        aria-live="polite"
        className={cn(
          "flex shrink-0 items-end justify-center overflow-hidden",
          dragging
            ? "transition-none"
            : "transition-[height] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
        )}
        style={{ height: distance }}
      >
        <div
          className={cn(
            "mb-2 grid size-8 place-items-center text-primary transition-[opacity,transform] duration-200 ease-out will-change-transform",
          )}
          style={{
            opacity: visible ? 1 : 0,
            transform: `translateY(${Math.max(
              0,
              10 - distance * 0.22,
            )}px) scale(${0.88 + progress * 0.12})`,
          }}
        >
          <PullRefreshRing progress={progress} refreshing={refreshing} />
          <span className="sr-only">{label}</span>
        </div>
      </div>

      {children}
    </div>
  )
}

export { PullToRefresh }
