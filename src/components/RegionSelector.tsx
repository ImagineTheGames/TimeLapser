import { useState, useRef, useCallback, useEffect } from 'react';
import './RegionSelector.css';

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface RegionSelectorProps {
  /** Display bounds in screen coordinates (used as the selection canvas) */
  displayBounds: Bounds;
  /** Current region in screen coordinates; null = no selection */
  region: { x: number; y: number; width: number; height: number } | null;
  onRegionChange: (region: { x: number; y: number; width: number; height: number }) => void;
}

/**
 * Converts region from screen coords to local (display-relative) coords for the given display.
 */
function screenToLocal(
  region: { x: number; y: number; width: number; height: number },
  display: Bounds
): { x: number; y: number; width: number; height: number } {
  return {
    x: region.x - display.x,
    y: region.y - display.y,
    width: region.width,
    height: region.height,
  };
}

/**
 * Clamps a local rect to the display bounds.
 */
function clampToDisplay(
  r: { x: number; y: number; width: number; height: number },
  display: Bounds
): { x: number; y: number; width: number; height: number } {
  let { x, y, width, height } = r;
  x = Math.max(0, Math.min(display.width - 1, x));
  y = Math.max(0, Math.min(display.height - 1, y));
  width = Math.max(1, Math.min(display.width - x, width));
  height = Math.max(1, Math.min(display.height - y, height));
  return { x, y, width, height };
}

export default function RegionSelector({
  displayBounds,
  region,
  onRegionChange,
}: RegionSelectorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const currentRef = useRef<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [start, setStart] = useState<{ x: number; y: number } | null>(null);
  const [current, setCurrent] = useState<{ x: number; y: number } | null>(null);

  const localRegion =
    region &&
    region.x >= displayBounds.x &&
    region.y >= displayBounds.y &&
    region.x + region.width <= displayBounds.x + displayBounds.width &&
    region.y + region.height <= displayBounds.y + displayBounds.height
      ? screenToLocal(region, displayBounds)
      : null;

  const widgetW = 320;
  const widgetH = Math.round((widgetW / displayBounds.width) * displayBounds.height);
  const scaleX = displayBounds.width / widgetW;
  const scaleY = displayBounds.height / widgetH;

  const widgetToLocal = useCallback(
    (wx: number, wy: number) => ({
      x: (wx / widgetW) * displayBounds.width,
      y: (wy / widgetH) * displayBounds.height,
    }),
    [displayBounds.width, displayBounds.height, widgetW, widgetH]
  );

  const localToScreen = useCallback(
    (lx: number, ly: number, lw: number, lh: number) => ({
      x: Math.round(displayBounds.x + lx),
      y: Math.round(displayBounds.y + ly),
      width: Math.round(lw),
      height: Math.round(lh),
    }),
    [displayBounds]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const wx = e.clientX - rect.left;
      const wy = e.clientY - rect.top;
      if (wx < 0 || wy < 0 || wx > widgetW || wy > widgetH) return;
      const pt = widgetToLocal(wx, wy);
      startRef.current = pt;
      currentRef.current = pt;
      setStart(pt);
      setCurrent(pt);
      setDragging(true);
    },
    [widgetToLocal]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!dragging || !containerRef.current || !startRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const wx = Math.max(0, Math.min(widgetW, e.clientX - rect.left));
      const wy = Math.max(0, Math.min(widgetH, e.clientY - rect.top));
      const pt = widgetToLocal(wx, wy);
      currentRef.current = pt;
      setCurrent(pt);
    },
    [dragging, widgetToLocal]
  );

  const commitDrag = useCallback(
    (startPt: { x: number; y: number }, currentPt: { x: number; y: number }) => {
      const lx = Math.min(startPt.x, currentPt.x);
      const ly = Math.min(startPt.y, currentPt.y);
      const lw = Math.abs(currentPt.x - startPt.x);
      const lh = Math.abs(currentPt.y - startPt.y);
      if (lw >= 1 && lh >= 1) {
        const clamped = clampToDisplay({ x: lx, y: ly, width: lw, height: lh }, displayBounds);
        onRegionChange(localToScreen(clamped.x, clamped.y, clamped.width, clamped.height));
      }
      setDragging(false);
      setStart(null);
      setCurrent(null);
    },
    [displayBounds, onRegionChange, localToScreen]
  );

  const handleMouseUp = useCallback(() => {
    if (!dragging || !start || !current) {
      setDragging(false);
      setStart(null);
      setCurrent(null);
      return;
    }
    commitDrag(start, current);
  }, [dragging, start, current, commitDrag]);

  const handleMouseLeave = useCallback(() => {
    if (dragging && start && current) commitDrag(start, current);
  }, [dragging, start, current, commitDrag]);

  useEffect(() => {
    if (!dragging) return;
    const onWindowMouseUp = () => {
      const s = startRef.current;
      const c = currentRef.current;
      startRef.current = null;
      currentRef.current = null;
      if (s && c) commitDrag(s, c);
      else {
        setDragging(false);
        setStart(null);
        setCurrent(null);
      }
    };
    window.addEventListener('mouseup', onWindowMouseUp);
    return () => window.removeEventListener('mouseup', onWindowMouseUp);
  }, [dragging, commitDrag]);

  let showRect: { x: number; y: number; width: number; height: number } | null = null;
  if (dragging && start && current) {
    const lx = Math.min(start.x, current.x);
    const ly = Math.min(start.y, current.y);
    const lw = Math.max(1, Math.abs(current.x - start.x));
    const lh = Math.max(1, Math.abs(current.y - start.y));
    showRect = {
      x: (lx / displayBounds.width) * widgetW,
      y: (ly / displayBounds.height) * widgetH,
      width: (lw / displayBounds.width) * widgetW,
      height: (lh / displayBounds.height) * widgetH,
    };
  } else if (localRegion && localRegion.width >= 1 && localRegion.height >= 1) {
    showRect = {
      x: (localRegion.x / displayBounds.width) * widgetW,
      y: (localRegion.y / displayBounds.height) * widgetH,
      width: (localRegion.width / displayBounds.width) * widgetW,
      height: (localRegion.height / displayBounds.height) * widgetH,
    };
  }

  return (
    <div className="region-selector">
      <p className="region-selector__hint">Click and drag on the screen preview to select the capture area.</p>
      <div
        ref={containerRef}
        className="region-selector__canvas"
        style={{
          width: widgetW,
          height: widgetH,
          maxWidth: '100%',
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        role="img"
        aria-label="Screen region selector"
      >
        <div className="region-selector__screen" />
        {showRect && (
          <div
            className="region-selector__selection"
            style={{
              left: showRect.x,
              top: showRect.y,
              width: showRect.width,
              height: showRect.height,
            }}
          />
        )}
      </div>
      {region && (
        <p className="region-selector__values">
          {region.x}, {region.y}, {region.width}×{region.height}
        </p>
      )}
    </div>
  );
}
