import { useRef, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { RotateCcw } from "lucide-react";

interface SignatureCanvasProps {
  onSignatureChange: (dataUrl: string | null) => void;
  label: string;
  /**
   * Bereits geleistete Unterschrift, die beim Einhängen gezeichnet wird — aus dem
   * Entwurf oder nach einem Wechsel zwischen Handy- und Desktopansicht. Wirkt nur
   * beim Mount; zum Leeren wird die Komponente über `key` neu eingehängt.
   */
  initialValue?: string | null;
}

// Fixed logical drawing space. The canvas is rendered at LOGICAL_W×LOGICAL_H
// CSS-pixel coordinates, scaled up by devicePixelRatio for sharp Retina output.
// getPos always maps from current CSS rect to this fixed logical space so the
// coordinates are correct regardless of when the element was laid out.
const LOGICAL_W = 600;
const LOGICAL_H = 200;

export const SignatureCanvas = ({ onSignatureChange, label, initialValue }: SignatureCanvasProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawingRef = useRef(false);
  const [hasSignature, setHasSignature] = useState(!!initialValue);
  const anfangswertRef = useRef(initialValue);
  // Stable ref so event listeners never need re-registration when the prop changes
  const onSignatureChangeRef = useRef(onSignatureChange);
  useEffect(() => {
    onSignatureChangeRef.current = onSignatureChange;
  }, [onSignatureChange]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Physical canvas resolution = logical × DPR for sharp Retina/iPad output
    const dpr = window.devicePixelRatio || 1;
    canvas.width  = LOGICAL_W * dpr;
    canvas.height = LOGICAL_H * dpr;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Scale the context so all draw calls use logical CSS-pixel coordinates
    ctx.scale(dpr, dpr);
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.fillStyle = "#000000";

    // Gespeicherte Unterschrift zurückholen. Sie wurde mit derselben Auflösung
    // exportiert; ins logische Format gezeichnet füllt sie das Feld wieder ganz.
    if (anfangswertRef.current) {
      const bild = new Image();
      bild.onload = () => ctx.drawImage(bild, 0, 0, LOGICAL_W, LOGICAL_H);
      bild.src = anfangswertRef.current;
    }

    // Map a mouse/touch event to logical canvas coordinates.
    // We always recompute the scale from the current CSS rect so the result is
    // correct even if the canvas was resized (e.g. dialog open animation) after
    // the useEffect ran.
    const getPos = (e: MouseEvent | TouchEvent): { x: number; y: number } => {
      const r = canvas.getBoundingClientRect();
      const scaleX = LOGICAL_W / r.width;
      const scaleY = LOGICAL_H / r.height;

      if (window.TouchEvent && e instanceof TouchEvent) {
        const touch = e.touches[0] ?? e.changedTouches[0];
        if (!touch) return { x: 0, y: 0 };
        return {
          x: (touch.clientX - r.left) * scaleX,
          y: (touch.clientY - r.top)  * scaleY,
        };
      }
      const me = e as MouseEvent;
      return {
        x: (me.clientX - r.left) * scaleX,
        y: (me.clientY - r.top)  * scaleY,
      };
    };

    const startDrawing = (e: MouseEvent | TouchEvent) => {
      e.preventDefault(); // stop page scroll — requires passive: false
      isDrawingRef.current = true;
      const pos = getPos(e);
      ctx.beginPath();
      ctx.moveTo(pos.x, pos.y);
      // Draw a dot so a single tap/click is visible as a signature
      ctx.arc(pos.x, pos.y, 1, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(pos.x, pos.y);
      setHasSignature(true);
    };

    const draw = (e: MouseEvent | TouchEvent) => {
      if (!isDrawingRef.current) return;
      e.preventDefault();
      const pos = getPos(e);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
      setHasSignature(true);
    };

    const stopDrawing = () => {
      if (!isDrawingRef.current) return;
      isDrawingRef.current = false;
      onSignatureChangeRef.current(canvas.toDataURL("image/png"));
    };

    // Use native listeners with { passive: false } so e.preventDefault() is
    // honoured on iOS Safari (React synthetic events are passive by default)
    canvas.addEventListener("mousedown",  startDrawing, { passive: false });
    canvas.addEventListener("mousemove",  draw,         { passive: false });
    canvas.addEventListener("mouseup",    stopDrawing);
    canvas.addEventListener("mouseleave", stopDrawing);
    canvas.addEventListener("touchstart", startDrawing, { passive: false });
    canvas.addEventListener("touchmove",  draw,         { passive: false });
    canvas.addEventListener("touchend",   stopDrawing);
    canvas.addEventListener("touchcancel",stopDrawing);

    return () => {
      canvas.removeEventListener("mousedown",  startDrawing);
      canvas.removeEventListener("mousemove",  draw);
      canvas.removeEventListener("mouseup",    stopDrawing);
      canvas.removeEventListener("mouseleave", stopDrawing);
      canvas.removeEventListener("touchstart", startDrawing);
      canvas.removeEventListener("touchmove",  draw);
      canvas.removeEventListener("touchend",   stopDrawing);
      canvas.removeEventListener("touchcancel",stopDrawing);
    };
  }, []); // Empty deps — canvas DOM node is stable, callback via ref

  const clearSignature = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx || !canvas) return;
    // Clear in logical coordinate space (ctx is already scaled by DPR)
    ctx.clearRect(0, 0, LOGICAL_W, LOGICAL_H);
    setHasSignature(false);
    onSignatureChangeRef.current(null);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-700">{label}</span>
        {hasSignature && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={clearSignature}
            className="h-8 text-xs"
          >
            <RotateCcw className="h-3 w-3 mr-1" />
            Neu
          </Button>
        )}
      </div>
      <div className="relative border-2 border-dashed border-gray-300 rounded-lg bg-white overflow-hidden">
        <canvas
          ref={canvasRef}
          className="w-full h-[160px] cursor-crosshair"
          style={{ touchAction: "none" }}
        />
        {!hasSignature && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-gray-400 text-sm">Hier unterschreiben</span>
          </div>
        )}
      </div>
    </div>
  );
};
