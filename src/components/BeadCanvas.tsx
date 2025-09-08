'use client';
import React, { useRef, useState } from 'react';
import { BEADS, BeadKey, PX_PER_MM, GUIDE_DIAMETERS_MM } from '@/lib/beads';
import { useDesign, computeDesignDiameterMM, Bead, Ring } from '@/store/useDesign';

type Props = { widthPx?: number; heightPx?: number };

export default function BeadCanvas({ widthPx = 500, heightPx = 500 }: Props) {
  const {
    beads, rings, activeRing, errorMessage, centerBead,
    addRing, removeRing, setRingRadius, setRingDiv,
    moveBeadSafe, removeBead, setCenterBead,
  } = useDesign();
  const { previewMode, setPreviewMode } = useDesign();

  const [dragId, setDragId] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const centerX = widthPx / 2;
  const centerY = heightPx / 2;

  const designDia = computeDesignDiameterMM(beads, centerBead);

  const px2mm = (px: number) => px / PX_PER_MM;
  const deg = (rad: number) => (rad * 180) / Math.PI;

  const onPointerDown = (e: React.PointerEvent, id: string) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setDragId(id);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragId || !svgRef.current) return;
    const pt = svgRef.current.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const ctm = svgRef.current.getScreenCTM(); if (!ctm) return;
    const loc = pt.matrixTransform(ctm.inverse());
    const dxPx = loc.x - centerX;
    const dyPx = loc.y - centerY;
    const xmm = px2mm(dxPx);
    const ymm = px2mm(dyPx);

    const rmm = Math.hypot(xmm, ymm);
    let thetadeg = (deg(Math.atan2(ymm, xmm)) + 360) % 360;

    const state = useDesign.getState();
    const bead = state.beads.find(b => b.id === dragId);
    const ringIdx = bead?.ring ?? state.activeRing;
    const ring = state.rings[ringIdx];

    // グリッド分割がある場合は角度スナップ
    if (ring?.div && ring.div > 0) {
      const step = 360 / ring.div;
      thetadeg = Math.round(thetadeg / step) * step;
    }

    moveBeadSafe(dragId, rmm, ((thetadeg % 360) + 360) % 360, ringIdx);
  };

  const onPointerUp = () => setDragId(null);

  const exportSVG = () => {
    if (!svgRef.current) return;

    // 書き出し用にクローンして正規化
    const clone = svgRef.current.cloneNode(true) as SVGSVGElement;

    // 全ビーズを濃く／枠は黒
    clone.querySelectorAll<SVGGElement>('g').forEach(el => { el.style.opacity = '1'; });
    clone.querySelectorAll<SVGElement>('[stroke]').forEach(el => {
      if (el.getAttribute('stroke') === '#bbb') el.setAttribute('stroke', '#333');
    });

    const data = new XMLSerializer().serializeToString(clone);
    const blob = new Blob([data], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'design.svg'; a.click();
    URL.revokeObjectURL(url);
  };

  const tangentRotation = (theta: number) => (theta + 90) % 360;

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ fontSize: 14 }}>
        設計直径：<b>{designDia.toFixed(1)} mm</b>
      </div>

      {/* エラー表示 */}
      {errorMessage && (
        <div style={{ padding: '6px 10px', border: '1px solid #fecaca', background: '#fee2e2', color: '#7f1d1d', borderRadius: 6 }}>
          {errorMessage}
        </div>
      )}

      {/* 上部操作列（横並び） */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <button onClick={exportSVG}>SVG書き出し</button>
        <button
          onClick={() => setPreviewMode(!previewMode)}
          className="px-3 py-1 border rounded bg-white hover:bg-gray-100"
        >
          {previewMode ? 'プレビュー解除' : 'プレビュー'}
        </button>
      </div>

      {/* 中心ビーズ選択 */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <strong>中心ビーズ:</strong>
        <select
          value={centerBead ?? ''}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
            setCenterBead(e.target.value ? (e.target.value as BeadKey) : null)
          }
          className="border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-400"
        >
          <option value="">（なし）</option>
          {Object.keys(BEADS).map((k) => (
            <option key={k} value={k}>
              {BEADS[k as BeadKey].label}
            </option>
          ))}
        </select>
        {centerBead && (
          <button
            onClick={() => setCenterBead(null)}
            className="ml-2 px-2 py-1 border border-gray-300 rounded bg-white hover:bg-gray-100"
          >
            解除
          </button>
        )}
      </div>

      {/* リング管理 */}
      <div style={{ display: 'grid', gap: 8 }}>
        {rings.map((r, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              gap: 12,
              alignItems: 'center',
              flexWrap: 'wrap',
              opacity: i === activeRing ? 1 : 0.6
            }}
          >
            <strong>リング#{i + 1}</strong>

            <label>半径(mm):
              <input
                type="number"
                step={0.1}
                value={r.radius.toFixed(1)}
                onChange={(e) => {
                  const raw = Number(e.target.value);
                  const rounded = Math.round(raw * 10) / 10;
                  setRingRadius(i, Math.max(0, rounded));
                }}
                className="w-20 border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-400 ml-2"
              />
            </label>

            <label>グリッド分割:
              <input
                type="number"
                min={0}
                step={1}
                value={r.div}
                onChange={(e) => setRingDiv(i, Math.max(0, Number(e.target.value)))}
                className="w-20 border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-400 ml-2"
              />
            </label>

            {/* 「使う」と「削除」を横並びでまとめる */}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => useDesign.getState().setActiveRing(i)} disabled={activeRing === i}>
                {activeRing === i ? '使用中' : '使う'}
              </button>
              <button onClick={() => removeRing(i)} disabled={rings.length <= 1}>削除</button>
            </div>
          </div>
        ))}

        <div>
          <button onClick={() => addRing()}>+ リング追加</button>
        </div>
        <span style={{ marginLeft: 8 }}>ビーズはドラッグして移動、ダブルクリックで削除できます。</span>
      </div>

      <CanvasSVG
        widthPx={widthPx}
        heightPx={heightPx}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        svgRef={svgRef}
        centerX={centerX}
        centerY={centerY}
        rings={rings}
        activeRing={activeRing}
        beads={beads}
        centerBead={centerBead}
        previewMode={previewMode}
        rotationFn={tangentRotation}
        onPointerDown={onPointerDown}
        removeBead={removeBead}
      />

      {/* 追加ボタン */}
      <div className="flex flex-col sm:flex-row flex-wrap gap-3">
        {Object.entries(BEADS).map(([k, v]) => (
          <AddButton key={k} beadKey={k as BeadKey} label={v.label} />
        ))}
      </div>

      <small>
        グリッド（リング分割 or スナップ）に沿って追加・移動。<br />
        中心ビーズを置くと、内側リングは自動的に<strong>当たらない半径</strong>以下に絞れなくなります。
      </small>
    </div>
  );
}

function CanvasSVG(props: {
  widthPx: number; heightPx: number;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: () => void;
  svgRef: React.RefObject<SVGSVGElement | null>;
  centerX: number; centerY: number;
  rings: Ring[]; activeRing: number;
  beads: Bead[];
  centerBead: BeadKey | null;
  previewMode: boolean;
  rotationFn: (theta: number) => number;
  onPointerDown: (e: React.PointerEvent, id: string) => void;
  removeBead: (id: string) => void;
}) {
  const { widthPx, heightPx, svgRef, onPointerMove, onPointerUp,
          centerX, centerY, rings, activeRing, beads, centerBead, previewMode, rotationFn, onPointerDown, removeBead } = props;

  return (
    <svg
      ref={svgRef}
      width={widthPx}
      height={heightPx}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      style={{ background: 'white', border: '1px solid #eee', borderRadius: 8, touchAction: 'none' }}
    >
      {/* ガイド円 */}
      {GUIDE_DIAMETERS_MM.map((d, i) => (
        <circle key={i} cx={centerX} cy={centerY} r={(PX_PER_MM * d) / 2}
                fill="none" stroke="#79c" strokeDasharray="6 6" />
      ))}

      {/* リング円 */}
      {rings.map((rg, i) => (
        <circle key={i} cx={centerX} cy={centerY} r={PX_PER_MM * rg.radius}
                fill="none"
                stroke={previewMode || i===activeRing ? '#c9e' : '#e5e7eb'}
                strokeDasharray="2 4" />
      ))}

      {/* 放射グリッド：アクティブリングのみ */}
      {(() => {
        const rg = rings[activeRing];
        if (!rg || rg.div <= 0) return null;
        const lines: any[] = [];
        for (let k = 0; k < rg.div; k++) {
          const angle = (360 / rg.div) * k;
          const x = centerX + PX_PER_MM * (rg.radius * Math.cos((angle*Math.PI)/180));
          const y = centerY + PX_PER_MM * (rg.radius * Math.sin((angle*Math.PI)/180));
          lines.push(<line key={k} x1={centerX} y1={centerY} x2={x} y2={y} stroke="#eee" />);
        }
        return <g>{lines}</g>;
      })()}

      {/* 中心ビーズ */}
      {centerBead && (() => {
        const spec = BEADS[centerBead];
        const w = PX_PER_MM * spec.len;
        const h = PX_PER_MM * spec.dia;
        return (
          <g transform={`translate(${centerX} ${centerY})`}>
            {spec.shape === 'circle'  && <circle r={(PX_PER_MM*spec.dia)/2} fill="#fff" stroke="#333" />}
            {spec.shape === 'rect'    && <rect x={-w/2} y={-h/2} width={w} height={h} rx={3} ry={3} fill="#fff" stroke="#333" />}
            {spec.shape === 'tube'    && <rect x={-w/2} y={-h/2} width={w} height={h}               fill="#fff" stroke="#333" />}
            {spec.shape === 'diamond' && (() => {
              const side = spec.len / Math.sqrt(2);
              const s = PX_PER_MM * side;
              return (
                <g transform="rotate(45)">
                  <rect x={-s/2} y={-s/2} width={s} height={s} fill="#fff" stroke="#333" />
                </g>
              );
            })()}
          </g>
        );
      })()}

      {/* 周縁ビーズ */}
      {beads.map(b => {
        const spec = BEADS[b.type];
        const w = PX_PER_MM * spec.len;
        const h = PX_PER_MM * spec.dia;
        const x = centerX + PX_PER_MM * (b.r * Math.cos((b.theta*Math.PI)/180));
        const y = centerY + PX_PER_MM * (b.r * Math.sin((b.theta*Math.PI)/180));
        const rot = rotationFn(b.theta);
        const dim = !(previewMode || b.ring === activeRing);

        return (
          <g key={b.id}
            transform={`translate(${x} ${y}) rotate(${rot})`}
            onPointerDown={(e)=>onPointerDown(e, b.id)}
            onDoubleClick={()=>removeBead(b.id)}
            style={{ cursor:'grab', opacity: dim ? .35 : 1 }}>
            {spec.shape === 'circle'  && <circle r={(PX_PER_MM*spec.dia)/2} fill="#fff" stroke={dim?'#bbb':'#333'} />}
            {spec.shape === 'rect'    && <rect x={-w/2} y={-h/2} width={w} height={h} rx={3} ry={3} fill="#fff" stroke={dim?'#bbb':'#333'} />}
            {spec.shape === 'tube'    && <rect x={-w/2} y={-h/2} width={w} height={h}               fill="#fff" stroke={dim?'#bbb':'#333'} />}
            {spec.shape === 'diamond' && (() => {
              const side = spec.len / Math.sqrt(2);
              const s = PX_PER_MM * side;
              return (
                <g transform="rotate(45)">
                  <rect x={-s/2} y={-s/2} width={s} height={s} fill="#fff" stroke={dim?'#bbb':'#333'} />
                </g>
              );
            })()}
          </g>
        );
      })}
    </svg>
  );
}

function AddButton({ beadKey, label }: { beadKey: BeadKey; label: string }) {
  const add = useDesign(s => s.addBead);
  const spec = BEADS[beadKey];

  // 実寸比を使う（ボタン内プレビューも正しい寸法感）
  const w = PX_PER_MM * spec.len;
  const h = PX_PER_MM * spec.dia;

  // キャンバス枠は固定（見切れ防止）
  const THUMB_W = 124, THUMB_H = 60;

  const shape = (() => {
    if (spec.shape === 'circle')
      return <circle cx={0} cy={0} r={(PX_PER_MM * spec.dia) / 2} fill="#fff" stroke="#333" />;
    if (spec.shape === 'rect')
      return <rect x={-w/2} y={-h/2} width={w} height={h} rx={4} ry={4} fill="#fff" stroke="#333" />;
    if (spec.shape === 'tube')
      return <rect x={-w/2} y={-h/2} width={w} height={h} fill="#fff" stroke="#333" />;
    // diamond
    const side = spec.len / Math.sqrt(2);
    const s = PX_PER_MM * side;
    return (
      <g transform="rotate(45)">
        <rect x={-s/2} y={-s/2} width={s} height={s} fill="#fff" stroke="#333" />
      </g>
    );
  })();

  return (
    <button
      onClick={() => add(beadKey)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 10px',
        border: '1px solid #ddd',
        borderRadius: 8,
        background: '#fafafa',
        cursor: 'pointer',
      }}
      title={label}
    >
      <svg
        width={THUMB_W}
        height={THUMB_H}
        viewBox={`${-THUMB_W/2} ${-THUMB_H/2} ${THUMB_W} ${THUMB_H}`}
        aria-hidden
      >
        {shape}
      </svg>
      <span style={{ whiteSpace: 'nowrap' }}>{label}</span>
    </button>
  );
}
