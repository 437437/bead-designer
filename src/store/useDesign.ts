import { create } from 'zustand';
import { BeadKey, BEADS, WORKAREA_DIAMETER_MM } from '@/lib/beads';

export type Bead = {
  id: string;
  type: BeadKey;
  r: number;         // mm
  theta: number;     // deg [0..360)
  ring?: number;     // 所属リングindex（undefinedなら自由）
};

export type Ring = {
  radius: number;    // mm
  div: number;       // 放射グリッド分割数（0ならグリッドなし）※setRingDivで1以上に正規化
};

type State = {
  beads: Bead[];
  rings: Ring[];
  activeRing: number;
  errorMessage: string | null;

  // 中心ビーズ（なければ null）
  centerBead: BeadKey | null;

  previewMode: boolean;  

  // 追加・更新・削除
  addBead: (type: BeadKey) => void;
  updateBead: (id: string, patch: Partial<Bead>) => void;
  moveBeadSafe: (id: string, r: number, theta: number, ringIndex?: number) => boolean;
  removeBead: (id: string) => void;
  reset: () => void;

  // リング
  addRing: (radius?: number) => void;
  removeRing: (index: number) => void;
  setRingRadius: (index: number, radius: number) => void;
  setRingDiv: (index: number, div: number) => void;
  setActiveRing: (index: number) => void;
  setPreviewMode: (on: boolean) => void;

  // 中心ビーズ制御
  setCenterBead: (type: BeadKey | null) => void;

  // 内部/ユーティリティ
  setError: (msg: string | null) => void;
  canPlaceOnRing: (ringIdx: number, r: number, theta: number, type: BeadKey, ignoreId?: string) => boolean;
};

const LS_KEY = 'bead-designer-v7';
const CLEARANCE_MM = 0.2;

function clamp(val: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, val));
}

/* ========= 角度ユーティリティ（グリッド保持） ========= */
function normDeg(d: number) {
  const x = d % 360;
  return x < 0 ? x + 360 : x;
}
function snapTheta(theta: number, div?: number) {
  if (!div || div <= 0) return normDeg(theta);
  const step = 360 / div;
  const k = Math.round(normDeg(theta) / step);
  return normDeg(k * step);
}

/* ========= 幾何ヘルパー ========= */
// 接線方向（円周方向）の必要幅 [mm]（最小半径の近似計算にのみ使用）
function tangentialSpan(type: BeadKey): number {
  const spec = BEADS[type];
  switch (spec.shape) {
    case 'circle':  return spec.dia; // 円は直径
    case 'diamond': return spec.dia; // 菱形の接線方向フラット幅はdia
    default:        return spec.len; // 矩形/竹は長辺が接線方向
  }
}

// 半径方向半幅（中心ビーズ干渉チェック用）
function radialHalfSpan(type: BeadKey): number {
  return BEADS[type].dia / 2;
}

// 中心ビーズの外接円半径（安全側）
function centerCircumRadius(type: BeadKey | null): number {
  if (!type) return 0;
  const spec = BEADS[type];
  switch (spec.shape) {
    case 'circle':  return spec.dia / 2;
    case 'diamond': return spec.len / 2; // 対角が直径
    default: {
      const hw = spec.len / 2, hh = spec.dia / 2;
      return Math.hypot(hw, hh);
    }
  }
}

/* ========= “ゲーム的”図形ヒットボックス & SAT ========= */
type Vec = { x: number, y: number };
type HitCircle = { kind: 'circle', c: Vec, R: number };
type HitPoly   = { kind: 'poly', pts: Vec[] };

function deg2rad(d: number) { return d * Math.PI / 180; }
function polarToXY(r: number, thetaDeg: number): Vec {
  const th = deg2rad(thetaDeg);
  return { x: r * Math.cos(th), y: r * Math.sin(th) };
}
function add(a: Vec, b: Vec): Vec { return { x: a.x + b.x, y: a.y + b.y }; }
function sub(a: Vec, b: Vec): Vec { return { x: a.x - b.x, y: a.y - b.y }; }
function dot(a: Vec, b: Vec): number { return a.x * b.x + a.y * b.y; }
function mul(a: Vec, s: number): Vec { return { x: a.x * s, y: a.y * s }; }
function len2(a: Vec): number { return a.x*a.x + a.y*a.y; }
function norm(a: Vec): Vec { const L = Math.hypot(a.x, a.y) || 1; return { x: a.x/L, y: a.y/L }; }
function basisTR(thetaDeg: number): { t: Vec, r: Vec } {
  const th = deg2rad(thetaDeg);
  return { r: { x: Math.cos(th), y: Math.sin(th) }, t: { x: -Math.sin(th), y: Math.cos(th) } };
}

function makeHitbox(type: BeadKey, center: Vec, thetaDeg: number): HitCircle | HitPoly {
  const spec = BEADS[type];
  const pad = CLEARANCE_MM / 2;
  const { t, r } = basisTR(thetaDeg);

  switch (spec.shape) {
    case 'circle': {
      const R = spec.dia / 2 + pad;
      return { kind: 'circle', c: center, R };
    }
    case 'rect':
    case 'tube': {
      const hx = spec.len / 2 + pad; // 接線方向半長
      const hy = spec.dia / 2 + pad; // 半径方向半厚
      const p1 = add(center, add(mul(t, +hx), mul(r, +hy)));
      const p2 = add(center, add(mul(t, -hx), mul(r, +hy)));
      const p3 = add(center, add(mul(t, -hx), mul(r, -hy)));
      const p4 = add(center, add(mul(t, +hx), mul(r, -hy)));
      return { kind: 'poly', pts: [p1,p2,p3,p4] };
    }
    case 'diamond': {
      const h = spec.dia / 2 + pad; // t̂/r̂ 方向に菱形
      const pR = add(center, mul(r, +h));
      const pT = add(center, mul(t, +h));
      const pL = add(center, mul(r, -h));
      const pB = add(center, mul(t, -h));
      return { kind: 'poly', pts: [pR, pT, pL, pB] };
    }
    default: {
      const hw = spec.len/2, hh = spec.dia/2;
      const R0 = Math.hypot(hw, hh) + pad;
      return { kind: 'circle', c: center, R: R0 };
    }
  }
}
function projectPoly(axis: Vec, pts: Vec[]) {
  let mn = Infinity, mx = -Infinity;
  for (const p of pts) {
    const v = dot(axis, p);
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }
  return { min: mn, max: mx };
}
function overlap1D(a: {min:number,max:number}, b: {min:number,max:number}) {
  return !(a.max < b.min || b.max < a.min);
}
function edgesNormals(pts: Vec[]): Vec[] {
  const N: Vec[] = [];
  for (let i=0; i<pts.length; i++) {
    const a = pts[i], b = pts[(i+1)%pts.length];
    const e = sub(b, a);
    N.push(norm({ x: -e.y, y: e.x }));
  }
  return N;
}
function circleCircleColl(a: HitCircle, b: HitCircle): boolean {
  const d2 = len2(sub(a.c, b.c));
  const R = a.R + b.R;
  return d2 <= R*R;
}
function circlePolyColl(circ: HitCircle, poly: HitPoly): boolean {
  const normals = edgesNormals(poly.pts);
  for (const n of normals) {
    const projP = projectPoly(n, poly.pts);
    const centerOn = dot(n, circ.c);
    const projC = { min: centerOn - circ.R, max: centerOn + circ.R };
    if (!overlap1D(projP, projC)) return false;
  }
  // 円心→最近頂点の軸もチェック
  let closest: Vec | null = null;
  let best = Infinity;
  for (const v of poly.pts) {
    const d2 = len2(sub(v, circ.c));
    if (d2 < best) { best = d2; closest = v; }
  }
  if (closest) {
    const axis = norm(sub(closest, circ.c));
    const projP = projectPoly(axis, poly.pts);
    const centerOn = dot(axis, circ.c);
    const projC = { min: centerOn - circ.R, max: centerOn + circ.R };
    if (!overlap1D(projP, projC)) return false;
  }
  return true;
}
function polyPolyColl(a: HitPoly, b: HitPoly): boolean {
  const normals = [...edgesNormals(a.pts), ...edgesNormals(b.pts)];
  for (const n of normals) {
    const pa = projectPoly(n, a.pts);
    const pb = projectPoly(n, b.pts);
    if (!overlap1D(pa, pb)) return false;
  }
  return true;
}
function hitOverlap(A: HitCircle|HitPoly, B: HitCircle|HitPoly): boolean {
  if (A.kind === 'circle' && B.kind === 'circle') return circleCircleColl(A,B);
  if (A.kind === 'circle' && B.kind === 'poly')   return circlePolyColl(A,B);
  if (A.kind === 'poly'   && B.kind === 'circle') return circlePolyColl(B,A);
  return polyPolyColl(A as HitPoly, B as HitPoly);
}

/* ========= “厳密” 最小半径（二分探索、角度は現状固定） ========= */
function isFeasibleRadius(r: number, ringIndex: number, beads: Bead[], centerType: BeadKey | null): boolean {
  const onRing = beads.filter(b => b.ring === ringIndex);
  // センターの外接円で半径方向ガード
  if (centerType) {
    const cR = centerCircumRadius(centerType);
    for (const b of onRing) {
      if ((r - radialHalfSpan(b.type)) < (cR + CLEARANCE_MM)) return false;
    }
  }
  // 図形同士の SAT
  const boxes = onRing.map(b => {
    const c = polarToXY(r, b.theta);
    return makeHitbox(b.type, c, b.theta);
  });
  for (let i=0;i<boxes.length;i++) {
    for (let j=i+1;j<boxes.length;j++) {
      if (hitOverlap(boxes[i], boxes[j])) return false;
    }
  }
  return true;
}
function exactMinAllowedRadiusForRing(
  ringIndex: number,
  beads: Bead[],
  centerType: BeadKey | null,
  currentRadius: number
): number {
  const onRing = beads.filter(b => b.ring === ringIndex);
  if (onRing.length === 0) return 0;

  // 下限：センター干渉を解く最小
  let lo = 0;
  if (centerType) {
    const cR = centerCircumRadius(centerType);
    for (const b of onRing) {
      lo = Math.max(lo, cR + CLEARANCE_MM + radialHalfSpan(b.type));
    }
  }

  // 実現可能な上限を用意
  const CAP = WORKAREA_DIAMETER_MM / 2;
  let hi = Math.max(currentRadius, lo);
  if (!isFeasibleRadius(hi, ringIndex, beads, centerType)) {
    let step = Math.max(1, hi * 0.1);
    while (hi < CAP && !isFeasibleRadius(hi, ringIndex, beads, centerType)) {
      hi = Math.min(CAP, hi + step);
      step *= 2;
    }
    if (!isFeasibleRadius(hi, ringIndex, beads, centerType)) return CAP;
  }

  // 二分探索（r↑で可→単調）
  for (let it=0; it<40; it++) {
    const mid = (lo + hi) / 2;
    if (isFeasibleRadius(mid, ringIndex, beads, centerType)) hi = mid;
    else lo = mid;
  }
  return hi;
}

/* ========= 近似の“最小半径” (保険)  ========= */
/* NOTE: 半径の正規化は exactMin を使用するが、手動 setRingRadius 入力の
   初期クランプや div 変更時の保険としても使う */
function minAllowedRadiusForRing(
  ringIndex: number,
  beads: Bead[],
  centerType: BeadKey | null,
  div?: number
): number {
  const onRing = beads.filter(b => b.ring === ringIndex);
  let rMin = 0;

  if (onRing.length > 1) {
    const sorted = [...onRing].sort((a, b) => a.theta - b.theta);
    for (let k = 0; k < sorted.length; k++) {
      const A = sorted[k];
      const B = sorted[(k + 1) % sorted.length];
      const deltaDeg = (B.theta - A.theta + 360) % 360 || 360;
      const need = (tangentialSpan(A.type) / 2) + (tangentialSpan(B.type) / 2) + CLEARANCE_MM;
      const dRad = (Math.PI / 180) * deltaDeg;
      const s = Math.sin(dRad / 2);
      if (s > 0) rMin = Math.max(rMin, need / (2 * s));
    }
  }

  if (div && div > 0 && onRing.length > 0) {
    const step = 360 / div;
    if (div > 1) {
      const s = Math.sin((Math.PI / 180) * step / 2);
      for (const b of onRing) rMin = Math.max(rMin, (tangentialSpan(b.type) + CLEARANCE_MM) / (2 * s));
      for (let i=0;i<onRing.length;i++) {
        for (let j=i+1;j<onRing.length;j++) {
          const need = (tangentialSpan(onRing[i].type)/2) + (tangentialSpan(onRing[j].type)/2) + CLEARANCE_MM;
          rMin = Math.max(rMin, need / (2 * s));
        }
      }
    }
  }

  if (centerType) {
    const cR = centerCircumRadius(centerType);
    for (const b of onRing) rMin = Math.max(rMin, cR + CLEARANCE_MM + radialHalfSpan(b.type));
  }

  return rMin;
}

/* ========= Zustand ========= */
export const useDesign = create<State>((set, get) => {
  let initial: Partial<State> | null = null;
  if (typeof window !== 'undefined') {
    try { initial = JSON.parse(localStorage.getItem(LS_KEY) || ''); } catch {}
  }
  const persist = (s: State) => {
    if (typeof window !== 'undefined') localStorage.setItem(LS_KEY, JSON.stringify(s));
  };

  const base: State = {
    beads: [],
    rings: [{ radius: 8, div: 12 }],
    activeRing: 0,
    errorMessage: null,

    centerBead: null,
    previewMode: false,

    addBead: () => {},
    updateBead: () => {},
    moveBeadSafe: () => false,
    removeBead: () => {},
    reset: () => {},
    
    addRing: () => {},
    removeRing: () => {},
    setRingRadius: () => {},
    setRingDiv: () => {},
    setActiveRing: () => {},
    setPreviewMode: () => {},

    setCenterBead: () => {},

    setError: () => {},
    canPlaceOnRing: () => true,
  };

  const init = { ...base, ...initial };

  return {
    ...init,

    setError: (msg) => set((s) => {
      const ns = { ...s, errorMessage: msg };
      if (msg) setTimeout(() => { useDesign.getState().setError(null); }, 1500);
      persist(ns); return ns;
    }),

    setCenterBead: (type) => set((s) => {
      const ns = { ...s, centerBead: type };
      persist(ns);
      // センタ変更は全リングの最小半径に影響
      setTimeout(() => { for (let i=0;i<ns.rings.length;i++) normalizeRingRadius(i); }, 0);
      return ns;
    }),

    // ★ SAT を使った図形ベースの当たり判定（div>0なら角度スナップ必須）
    canPlaceOnRing: (ringIdx, r, theta, type, ignoreId) => {
      const { beads, centerBead, rings } = get();
      const ring = rings[ringIdx];
      if (!ring) return false;

      const rUse = ring.radius ?? r;
      const thetaUse = snapTheta(theta, ring.div);

      // 中心ビーズ（外接円）との半径方向ガード
      if (centerBead) {
        const cR = centerCircumRadius(centerBead);
        if ((rUse - radialHalfSpan(type)) < (cR + CLEARANCE_MM)) return false;
      }

      // 自分のヒットボックス
      const selfC = polarToXY(rUse, thetaUse);
      const selfHB = makeHitbox(type, selfC, thetaUse);

      // 同一リングの既存と衝突しないか
      for (const b of beads) {
        if (b.ring !== ringIdx || b.id === ignoreId) continue;
        const otherTheta = snapTheta(b.theta, ring.div); // 念のためスナップ
        const otherC = polarToXY(rUse, otherTheta);
        const otherHB = makeHitbox(b.type, otherC, otherTheta);
        if (hitOverlap(selfHB, otherHB)) return false;
      }
      return true;
    },

    addBead: (type) => set((s) => {
      const ringIdx = s.activeRing;
      const ring = s.rings[ringIdx];
      if (!ring) return s;

      const r = ring.radius;

      // グリッド有効：空きスロットへ
      if (ring.div && ring.div > 0) {
        const onRing = s.beads.filter(b => b.ring === ringIdx);
        if (onRing.length >= ring.div) {
          get().setError(`このリングは ${ring.div} 個までです`);
          return s;
        }
        const step = 360 / ring.div;
        for (let k = 0; k < ring.div; k++) {
          const theta = k * step;
          if (get().canPlaceOnRing(ringIdx, r, theta, type)) {
            const b: Bead = { id: crypto.randomUUID(), type, r, theta: snapTheta(theta, ring.div), ring: ringIdx };
            const ns = { ...s, beads: [...s.beads, b] };
            persist(ns);
            setTimeout(() => { normalizeRingRadius(ringIdx); }, 0);
            return ns;
          }
        }
        get().setError('配置できるグリッドがありません（重なります）');
        return s;
      }

      // グリッドなし：最広隙間の中央へ（角度自由）
      const onRing = s.beads.filter(b => b.ring === ringIdx);
      const theta = (() => {
        if (onRing.length === 0) return 0;
        const sorted = [...onRing].sort((a,b)=>a.theta - b.theta);
        let bestGap = -1, bestStart = 0;
        for (let i=0;i<sorted.length;i++){
          const cur = sorted[i].theta;
          const nxt = sorted[(i+1)%sorted.length].theta;
          const gap = (nxt - cur + 360) % 360 || 360;
          if (gap > bestGap) { bestGap = gap; bestStart = cur; }
        }
        return normDeg(bestStart + bestGap/2);
      })();

      if (!get().canPlaceOnRing(ringIdx, r, theta, type)) {
        get().setError('配置できる場所がありません');
        return s;
      }

      const b: Bead = { id: crypto.randomUUID(), type, r, theta, ring: ringIdx };
      const ns = { ...s, beads: [...s.beads, b] };
      persist(ns);
      setTimeout(() => { normalizeRingRadius(ringIdx); }, 0);
      return ns;
    }),

    updateBead: (id, patch) => set((s) => {
      const before = s.beads.find(b => b.id === id);
      let ringIdx = before?.ring;
      const beads = s.beads.map(b => {
        if (b.id !== id) return b;
        const ring = (typeof b.ring === 'number') ? s.rings[b.ring] : undefined;
        const thetaPatched = (patch.theta !== undefined && ring) ? snapTheta(patch.theta, ring.div) : patch.theta;
        return { ...b, ...patch, ...(thetaPatched !== undefined ? { theta: thetaPatched } : {}) };
      });
      const ns = { ...s, beads };
      persist(ns);
      if (typeof ringIdx === 'number') setTimeout(() => { normalizeRingRadius(ringIdx!); }, 0);
      return ns;
    }),

    moveBeadSafe: (id, r, theta, ringIndex) => {
      const s = get();
      const bead = s.beads.find(b => b.id === id);
      if (!bead) return false;

      const ringIdx = ringIndex ?? bead.ring ?? s.activeRing;
      const ring = s.rings[ringIdx];
      const rFinal = ring ? ring.radius : r;
      const thetaSnap = snapTheta(theta, ring?.div);

      const can = s.canPlaceOnRing(ringIdx, rFinal, thetaSnap, bead.type, id);
      if (!can) { s.setError('その位置には置けません（重なります）'); return false; }

      set((st) => {
        const beads = st.beads.map(b => b.id === id ? { ...b, r: rFinal, theta: thetaSnap, ring: ringIdx } : b);
        const ns = { ...st, beads }; persist(ns); return ns;
      });
      return true;
    },

    removeBead: (id) => set((s) => {
      const victim = s.beads.find(b => b.id === id);
      const ns = { ...s, beads: s.beads.filter(b => b.id !== id) };
      persist(ns);
      if (typeof victim?.ring === 'number') setTimeout(() => { normalizeRingRadius(victim.ring!); }, 0);
      return ns;
    }),

    reset: () => set((s) => {
      const ns = { ...s, beads: [] }; persist(ns); return ns;
    }),

    addRing: (radius) => set((s) => {
      const last = s.rings[s.rings.length - 1]?.radius ?? 8;
      const r = clamp(typeof radius === 'number' ? radius : last + 2, 0, WORKAREA_DIAMETER_MM / 2);
      const ns = { ...s, rings: [...s.rings, { radius: r, div: 12 }], activeRing: s.rings.length };
      persist(ns); return ns;
    }),

    removeRing: (index) => set((s) => {
      if (s.rings.length <= 1) return s;

      if (typeof window !== 'undefined') {
        const ok = window.confirm(`リング #${index+1} と、その上のビーズを削除します。よろしいですか？`);
        if (!ok) return s;
      }

      // リング配列から削除
      const rings = s.rings.filter((_, i) => i !== index);

      // ビーズ：該当リングは削除・後続は詰める
      const beads = s.beads
        .filter(b => b.ring !== index)
        .map(b => (typeof b.ring === 'number' && b.ring > index) ? { ...b, ring: b.ring - 1 } : b);

      // activeRing を調整
      let activeRing = s.activeRing;
      if (activeRing > index) activeRing -= 1;
      activeRing = clamp(activeRing, 0, rings.length - 1);

      const ns = { ...s, rings, beads, activeRing };
      if (typeof window !== 'undefined') localStorage.setItem(LS_KEY, JSON.stringify(ns));

      // 全リング正規化（次フレーム）
      setTimeout(() => { for (let i=0;i<rings.length;i++) normalizeRingRadius(i); }, 0);
      return ns;
    }),

    setRingRadius: (index, radius) => set((s) => {
        const ring = s.rings[index];
        if (!ring) return s;

        // 現在角度（＝グリッドにスナップ済み）を固定して、
        // SATで衝突しない半径の最小値を二分探索で求める
        const exactMin = exactMinAllowedRadiusForRing(index, s.beads, s.centerBead, Math.max(radius, ring.radius));
        const rFinal = clamp(Math.max(radius, exactMin), 0, WORKAREA_DIAMETER_MM / 2);

        const rings = s.rings.map((rg,i)=> i===index ? { ...rg, radius:rFinal } : rg);
        const beads = s.beads.map(b => b.ring===index ? { ...b, r:rFinal } : b);
        const ns = { ...s, rings, beads };
        persist(ns);
        return ns;
    }),

    setRingDiv: (index, div) => set((s) => {
        const ring = s.rings[index];
        if (!ring) return s;

        const oldDiv = Math.max(1, Math.floor(ring.div));
        const newDiv = Math.max(1, Math.floor(div));
        if (newDiv === oldDiv) return s;

        const onRing = s.beads.filter(b => b.ring === index).sort((a,b)=>a.theta - b.theta);

        // --- 収容チェック（ビーズ数 > newDiv は即NG）
        if (onRing.length > newDiv) {
            get().setError(`この分割数ではビーズが収まりません（ビーズ数が多すぎます）`);
            return s;
        }

        // --- 減らす場合は「今が満杯」なら拒否
        if (newDiv < oldDiv && onRing.length === oldDiv) {
            get().setError(`空きグリッドがないため、分割数を減らせません`);
            return s;
        }

        // 角度の再割当て（順番維持・先頭から詰める）
        const stepNew = 360 / newDiv;
        const snapped: { id: string; theta: number }[] = [];
        for (let i = 0; i < onRing.length; i++) {
            const theta = (i * stepNew) % 360;
            snapped.push({ id: onRing[i].id, theta });
        }

        // SAT で検証（衝突なし＆グリッド内）
        const ok = snapped.every(sn => {
            const bead = onRing.find(b => b.id === sn.id)!;
            return get().canPlaceOnRing(index, ring.radius, sn.theta, bead.type, bead.id);
        });
        if (!ok) {
            get().setError(`その分割数ではビーズが収まりません`);
            return s;
        }

        // 反映（theta は必ず新グリッドにスナップ済み）
        const rings = s.rings.map((rg,i)=> i===index ? { ...rg, div: newDiv } : rg);
        const beads = s.beads.map(b => {
            const sn = snapped.find(sn=>sn.id===b.id);
            return sn ? { ...b, theta: sn.theta } : b;
        });

        const ns = { ...s, rings, beads };
        // 保存 & 最小半径を“ギリまで”正規化
        if (typeof window !== 'undefined') localStorage.setItem(LS_KEY, JSON.stringify(ns));
        setTimeout(() => { normalizeRingRadius(index); }, 0);

        return ns;
    }),

    setActiveRing: (index) => set((s) => {
      const ns = { ...s, activeRing: clamp(index, 0, s.rings.length - 1) };
      persist(ns); return ns;
    }),

    setPreviewMode: (on) => set((s) => {
      const ns = { ...s, previewMode: on, activeRing: s.activeRing };
      persist(ns); return ns;
    }),
  };
});

/* ========= リング半径の自動正規化（exactMin で“ギリまで詰める”） ========= */
function normalizeRingRadius(index: number) {
  const { rings, beads, centerBead } = useDesign.getState();
  const ring = rings[index];
  if (!ring) return;

  const exactMin = exactMinAllowedRadiusForRing(index, beads, centerBead, ring.radius);
  const rFinal = clamp(Math.max(ring.radius, exactMin), 0, WORKAREA_DIAMETER_MM / 2);

  if (rFinal !== ring.radius) {
    useDesign.setState((s) => {
      const rings = s.rings.map((rg,i)=> i===index ? { ...rg, radius: rFinal } : rg);
      const beads = s.beads.map(b => b.ring===index ? { ...b, r: rFinal } : b);
      return { ...s, rings, beads };
    });
    if (typeof window !== 'undefined') {
      try {
        const ns = useDesign.getState() as unknown as State;
        localStorage.setItem(LS_KEY, JSON.stringify(ns));
      } catch {}
    }
  }
}

/* ========= 外形直径（中心ビーズも考慮） ========= */
export function computeDesignDiameterMM(beads: Bead[], centerType?: BeadKey | null): number {
  let maxR = 0;
  for (const b of beads) {
    const spec = BEADS[b.type];
    let rShape = (spec.shape === 'diamond') ? (spec.len / 2) : Math.hypot(spec.len/2, spec.dia/2);
    maxR = Math.max(maxR, b.r + rShape);
  }
  if (centerType) maxR = Math.max(maxR, centerCircumRadius(centerType));
  return maxR * 2;
}
