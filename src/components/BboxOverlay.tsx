import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, RefObject } from 'react'
import { PLATFORM_ACCENTS, PLATFORM_LABELS } from '../constants'
import type { ClothingItem } from '../types'

type BboxOverlayProps = {
  imageRef: RefObject<HTMLImageElement | null>
  items: ClothingItem[]
}

type ImageBox = {
  left: number
  top: number
  width: number
  height: number
}

type CardLayout = {
  item: ClothingItem
  cardLeft: number
  cardTop: number
  leaderLine?: {
    left: number
    top: number
    width: number
    angle: number
  }
}

const CARD_WIDTH = 192
const CARD_HEIGHT = 196
const CARD_OFFSET = 8
const STACK_GAP = 10
const MAX_FLOATING_ITEMS = 6

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

const getCheapestPrice = (item: ClothingItem) =>
  Math.min(...item.platforms.map((deal) => deal.estimatedPricePhp))

const getOverlapRatio = (
  first: { left: number; top: number; width: number; height: number },
  second: { left: number; top: number; width: number; height: number },
) => {
  const overlapWidth = Math.max(
    0,
    Math.min(first.left + first.width, second.left + second.width) -
      Math.max(first.left, second.left),
  )
  const overlapHeight = Math.max(
    0,
    Math.min(first.top + first.height, second.top + second.height) -
      Math.max(first.top, second.top),
  )
  const overlapArea = overlapWidth * overlapHeight
  const smallestArea = Math.min(first.width * first.height, second.width * second.height)

  return smallestArea > 0 ? overlapArea / smallestArea : 0
}

const buildLeaderLine = (
  bboxCenter: { x: number; y: number },
  cardCenter: { x: number; y: number },
) => {
  const deltaX = cardCenter.x - bboxCenter.x
  const deltaY = cardCenter.y - bboxCenter.y

  return {
    left: bboxCenter.x,
    top: bboxCenter.y,
    width: Math.hypot(deltaX, deltaY),
    angle: Math.atan2(deltaY, deltaX) * (180 / Math.PI),
  }
}

export function BboxOverlay({ imageRef, items }: BboxOverlayProps) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const [imageBox, setImageBox] = useState<ImageBox | null>(null)
  const [expandedCardId, setExpandedCardId] = useState<string | null>(null)

  useEffect(() => {
    const image = imageRef.current
    const overlay = overlayRef.current

    if (!image || !overlay) {
      return
    }

    let frameId = 0
    const updateImageBox = () => {
      cancelAnimationFrame(frameId)
      frameId = requestAnimationFrame(() => {
        const imageRect = image.getBoundingClientRect()
        const overlayRect = overlay.getBoundingClientRect()

        setImageBox({
          left: imageRect.left - overlayRect.left,
          top: imageRect.top - overlayRect.top,
          width: imageRect.width,
          height: imageRect.height,
        })
      })
    }

    updateImageBox()
    image.addEventListener('load', updateImageBox)
    window.addEventListener('resize', updateImageBox)

    const resizeObserver =
      'ResizeObserver' in window ? new ResizeObserver(updateImageBox) : null
    resizeObserver?.observe(image)

    return () => {
      cancelAnimationFrame(frameId)
      image.removeEventListener('load', updateImageBox)
      window.removeEventListener('resize', updateImageBox)
      resizeObserver?.disconnect()
    }
  }, [imageRef, items])

  useEffect(() => {
    const collapseOnOutsideTap = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null

      if (!target?.closest('.floating-card')) {
        setExpandedCardId(null)
      }
    }

    document.addEventListener('pointerdown', collapseOnOutsideTap, true)

    return () => document.removeEventListener('pointerdown', collapseOnOutsideTap, true)
  }, [])

  const visibleItems = useMemo(
    () =>
      [...items]
        .sort((first, second) => second.confidence - first.confidence)
        .slice(0, MAX_FLOATING_ITEMS),
    [items],
  )

  const layouts = useMemo<CardLayout[]>(() => {
    if (!imageBox) {
      return []
    }

    const placedCards: Array<{
      left: number
      top: number
      width: number
      height: number
    }> = []
    const imageRight = imageBox.left + imageBox.width
    const imageBottom = imageBox.top + imageBox.height

    return visibleItems.map((item) => {
      const [ymin, xmin, ymax, xmax] = item.bbox
      const bboxLeft = imageBox.left + (xmin / 1000) * imageBox.width
      const bboxTop = imageBox.top + (ymin / 1000) * imageBox.height
      const bboxWidth = ((xmax - xmin) / 1000) * imageBox.width
      const bboxHeight = ((ymax - ymin) / 1000) * imageBox.height
      const bboxCenter = {
        x: bboxLeft + bboxWidth / 2,
        y: bboxTop + bboxHeight / 2,
      }

      const preferredLeft =
        bboxLeft + bboxWidth + CARD_OFFSET + CARD_WIDTH > imageRight
          ? bboxLeft - CARD_WIDTH - CARD_OFFSET
          : bboxLeft + bboxWidth + CARD_OFFSET
      const preferredTop =
        bboxTop + CARD_OFFSET + CARD_HEIGHT > imageBottom
          ? bboxTop + bboxHeight - CARD_HEIGHT - CARD_OFFSET
          : bboxTop + CARD_OFFSET

      const cardLeft = clamp(preferredLeft, imageBox.left, imageRight - CARD_WIDTH)
      let cardTop = clamp(preferredTop, imageBox.top, imageBottom - CARD_HEIGHT)
      let wasDisplaced = false

      for (const placedCard of placedCards) {
        const overlapRatio = getOverlapRatio(
          { left: cardLeft, top: cardTop, width: CARD_WIDTH, height: CARD_HEIGHT },
          placedCard,
        )

        if (overlapRatio > 0.25) {
          cardTop = clamp(
            placedCard.top + CARD_HEIGHT + STACK_GAP,
            imageBox.top,
            imageBottom - CARD_HEIGHT,
          )
          wasDisplaced = true
        }
      }

      const cardRect = {
        left: cardLeft,
        top: cardTop,
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
      }
      placedCards.push(cardRect)

      return {
        item,
        cardLeft,
        cardTop,
        leaderLine: wasDisplaced
          ? buildLeaderLine(bboxCenter, {
              x: cardLeft + CARD_WIDTH / 2,
              y: cardTop + CARD_HEIGHT / 2,
            })
          : undefined,
      }
    })
  }, [imageBox, visibleItems])

  const toggleCard = (itemId: string) => {
    setExpandedCardId((currentId) => (currentId === itemId ? null : itemId))
  }

  const handleCardKeyDown = (
    event: KeyboardEvent<HTMLDivElement>,
    itemId: string,
  ) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      event.stopPropagation()
      toggleCard(itemId)
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      setExpandedCardId(null)
    }
  }

  return (
    <div ref={overlayRef} className="bbox-overlay" aria-label="Detected clothing items">
      {layouts.map(({ item, cardLeft, cardTop, leaderLine }) => {
        const isExpanded = expandedCardId === item.id

        return (
          <div key={item.id} className="floating-card-group">
            {leaderLine && (
              <span
                className="floating-card-leader"
                aria-hidden="true"
                style={
                  {
                    '--leader-left': `${leaderLine.left}px`,
                    '--leader-top': `${leaderLine.top}px`,
                    '--leader-width': `${leaderLine.width}px`,
                    '--leader-angle': `${leaderLine.angle}deg`,
                  } as CSSProperties
                }
              />
            )}
            <div
              role="button"
              tabIndex={0}
              aria-expanded={isExpanded}
              className={`floating-card ${isExpanded ? 'is-expanded' : ''}`}
              style={
                {
                  '--card-left': `${cardLeft}px`,
                  '--card-top': `${cardTop}px`,
                  '--platform-accent': PLATFORM_ACCENTS[item.bestPlatform],
                } as CSSProperties
              }
              onClick={(event) => {
                event.stopPropagation()
                toggleCard(item.id)
              }}
              onKeyDown={(event) => handleCardKeyDown(event, item.id)}
            >
              <span className="floating-card-name">{item.itemName}</span>
              <span className="floating-card-price">
                ₱{getCheapestPrice(item).toLocaleString('en-PH')}
              </span>
              <div className="floating-card-expanded">
                <span className="floating-card-meta">
                  {item.category} · {item.color} · {item.style} · {item.materialHint}
                </span>
                <span className="floating-platform-pill">
                  {PLATFORM_LABELS[item.bestPlatform]}
                </span>
                <p className="floating-best-reason">{item.bestBuyReason}</p>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
