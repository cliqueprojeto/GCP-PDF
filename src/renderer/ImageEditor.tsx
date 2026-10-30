import React, { useEffect, useRef, useState } from "react";
import { RotateCcw, RotateCw, FlipHorizontal2, FlipVertical2, Crop, Eraser, Undo2, Check } from "lucide-react";
import { Modal } from "./Dialogs";

interface Adjust { rotate: number; flipX: boolean; flipY: boolean; brightness: number; contrast: number; saturation: number; filter: "none" | "grayscale" | "sepia" | "invert"; opacity: number; whiteToAlpha: boolean; crop: { x: number; y: number; width: number; height: number } | null }
const START: Adjust = { rotate: 0, flipX: false, flipY: false, brightness: 100, contrast: 100, saturation: 100, filter: "none", opacity: 100, whiteToAlpha: false, crop: null };
const FILTERS: [Adjust["filter"], string][] = [["none", "Original"], ["grayscale", "Preto e branco"], ["sepia", "Sépia"], ["invert", "Negativo"]];

/** Renders the image with every adjustment; the crop is in the source image's pixels. */
function render(image: HTMLImageElement, a: Adjust, maxSide = Infinity): HTMLCanvasElement {
  const crop = a.crop ?? { x: 0, y: 0, width: image.naturalWidth, height: image.naturalHeight };
  const scale = Math.min(1, maxSide / Math.max(crop.width, crop.height)), w = Math.max(1, Math.round(crop.width * scale)), h = Math.max(1, Math.round(crop.height * scale));
  const turned = a.rotate % 180 !== 0, canvas = document.createElement("canvas");
  canvas.width = turned ? h : w; canvas.height = turned ? w : h;
  const ctx = canvas.getContext("2d")!;
  ctx.filter = `brightness(${a.brightness}%) contrast(${a.contrast}%) saturate(${a.saturation}%)${a.filter === "none" ? "" : ` ${a.filter}(100%)`}`;
  ctx.globalAlpha = a.opacity / 100;
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((a.rotate * Math.PI) / 180);
  ctx.scale(a.flipX ? -1 : 1, a.flipY ? -1 : 1);
  ctx.drawImage(image, crop.x, crop.y, crop.width, crop.height, -w / 2, -h / 2, w, h);
  if (a.whiteToAlpha) {
    // Logos and signatures scanned on white paper: near-white becomes transparent, with a soft edge.
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height), px = data.data;
    for (let i = 0; i < px.length; i += 4) { const light = Math.min(px[i]!, px[i + 1]!, px[i + 2]!); if (light > 235) px[i + 3] = 0; else if (light > 200) px[i + 3] = Math.round(px[i + 3]! * (235 - light) / 35); }
    ctx.putImageData(data, 0, 0);
  }
  return canvas;
}

export function ImageEditor({ src, onClose, onApply }: { src: string; onClose: () => void; onApply: (dataUrl: string, aspect: number) => void }) {
  const [image, setImage] = useState<HTMLImageElement | null>(null), [a, setA] = useState<Adjust>(START), [cropping, setCropping] = useState(false);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const stage = useRef<HTMLDivElement>(null), preview = useRef<HTMLCanvasElement>(null);
  useEffect(() => { const img = new Image(); img.onload = () => setImage(img); img.src = src; }, [src]);
  useEffect(() => {
    if (!image || !preview.current) return;
    // While cropping, show the uncropped, unrotated image so the rectangle maps to source pixels.
    const shown = render(image, cropping ? { ...a, crop: null, rotate: 0, flipX: false, flipY: false } : a, 900), c = preview.current;
    c.width = shown.width; c.height = shown.height; c.getContext("2d")!.drawImage(shown, 0, 0);
  }, [image, a, cropping]);
  const set = (patch: Partial<Adjust>) => setA((old) => ({ ...old, ...patch }));
  const point = (e: React.PointerEvent) => { const r = preview.current!.getBoundingClientRect(); return { x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) }; };
  function finishCrop() {
    if (image && drag) {
      const x = Math.min(drag.x0, drag.x1), y = Math.min(drag.y0, drag.y1), w = Math.abs(drag.x1 - drag.x0), h = Math.abs(drag.y1 - drag.y0);
      if (w > 0.02 && h > 0.02) set({ crop: { x: x * image.naturalWidth, y: y * image.naturalHeight, width: w * image.naturalWidth, height: h * image.naturalHeight } });
    }
    setDrag(null); setCropping(false);
  }
  const box = drag && { left: `${Math.min(drag.x0, drag.x1) * 100}%`, top: `${Math.min(drag.y0, drag.y1) * 100}%`, width: `${Math.abs(drag.x1 - drag.x0) * 100}%`, height: `${Math.abs(drag.y1 - drag.y0) * 100}%` };
  const slider = (label: string, key: "brightness" | "contrast" | "saturation" | "opacity", min: number, max: number) => (
    <label className="field">{label} · {a[key]}%<input type="range" min={min} max={max} value={a[key]} onChange={(e) => set({ [key]: Number(e.target.value) } as Partial<Adjust>)} /></label>
  );
  return (
    <Modal title="Editar imagem" description="Os ajustes geram uma nova imagem no PDF; desfaça com Ctrl+Z." onClose={onClose} wide>
      <div className="image-editor">
        <div className="image-stage checker" ref={stage}>
          <div className="image-frame" onPointerDown={(e) => { if (!cropping) return; e.currentTarget.setPointerCapture(e.pointerId); const p = point(e); setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y }); }} onPointerMove={(e) => { if (drag) { const p = point(e); setDrag({ ...drag, x1: p.x, y1: p.y }); } }} onPointerUp={() => cropping && drag && finishCrop()} style={{ cursor: cropping ? "crosshair" : "default" }}>
            <canvas ref={preview} />
            {box && <div className="crop-box" style={box} />}
          </div>
          {cropping && <p className="image-hint">Arraste sobre a imagem para escolher a área a manter.</p>}
        </div>
        <aside className="image-tools">
          <div className="image-actions">
            <button className="icon-button" title="Girar à esquerda" onClick={() => set({ rotate: (a.rotate + 270) % 360 })}><RotateCcw size={16} /></button>
            <button className="icon-button" title="Girar à direita" onClick={() => set({ rotate: (a.rotate + 90) % 360 })}><RotateCw size={16} /></button>
            <button className="icon-button" title="Espelhar na horizontal" onClick={() => set({ flipX: !a.flipX })}><FlipHorizontal2 size={16} /></button>
            <button className="icon-button" title="Espelhar na vertical" onClick={() => set({ flipY: !a.flipY })}><FlipVertical2 size={16} /></button>
            <button className={`icon-button ${cropping ? "active" : ""}`} title="Recortar" onClick={() => { setCropping(!cropping); setDrag(null); }}><Crop size={16} /></button>
            <button className={`icon-button ${a.whiteToAlpha ? "active" : ""}`} title="Remover fundo branco" onClick={() => set({ whiteToAlpha: !a.whiteToAlpha })}><Eraser size={16} /></button>
            <button className="icon-button" title="Restaurar original" onClick={() => { setA(START); setCropping(false); }}><Undo2 size={16} /></button>
          </div>
          <div className="segmented small">{FILTERS.map(([value, label]) => <button key={value} className={a.filter === value ? "selected" : ""} onClick={() => set({ filter: value })}>{label}</button>)}</div>
          {slider("Brilho", "brightness", 20, 200)}
          {slider("Contraste", "contrast", 20, 200)}
          {slider("Saturação", "saturation", 0, 200)}
          {slider("Opacidade", "opacity", 10, 100)}
          {a.crop && <button className="text-button" onClick={() => set({ crop: null })}>Desfazer recorte</button>}
        </aside>
      </div>
      <div className="modal-footer">
        <button className="button secondary" onClick={onClose}>Cancelar</button>
        <button className="button primary" disabled={!image} onClick={() => { if (!image) return; const out = render(image, a, 4000); onApply(out.toDataURL("image/png"), out.width / out.height); }}><Check size={15} /> Aplicar à imagem</button>
      </div>
    </Modal>
  );
}
