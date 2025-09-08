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
  div: number;       // 放射グリッド分割数（0ならグリッドなし）
};

type State = {
  beads: Bead[];
  rings: Ring[];
  activeRing: number;
  errorMessage: string | null;

  // 追加：中心ビーズ（なければ null）
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

// 中心ビーズの「外接円半径」（接触安全側で採用）
function centerCircumRadius(type: BeadKey | null): number {
  if (!type) return 0;
  const spec = BEADS[type];

  switch (spec.shape) {
    case 'circle':
      // 丸 → 半径そのまま
      return spec.dia / 2;

    case 'diamond':
      // ダイヤ → 対角 len がそのまま外接円の直径
      return spec.len / 2;

    case 'rect':
    case 'tube':
    default:
      // 矩形や竹 → 対角の外接円
      const hw = spec.len / 2, hh = spec.dia / 2;
      return Math.sqrt(hw * hw + hh * hh);
  }
}

// リング半径の最小許容（隣接ビーズ間＋中心ビーズとの干渉を回避）
function minAllowedRadiusForRing(
  ringIndex: number,
  beads: Bead[],
  centerType: BeadKey | null,
  div?: number   // ← 追加
): number {
  const onRing = beads.filter(b => b.ring === ringIndex);
  let rMin = 0;

  // --- 分割グリッドを考慮する場合 ---
  if (div && div > 0 && onRing.length > 0) {
    const step = 360 / div;
    for (let i = 0; i < onRing.length; i++) {
      const b = onRing[i];
      const spec = BEADS[b.type];
      // グリッド1区画に収まるために必要な半径
      const neededArc = spec.len + CLEARANCE_MM;
      const deltaRad = (Math.PI / 180) * step;
      const rReq = neededArc / deltaRad;
      if (rReq > rMin) rMin = rReq;
    }
  }

  // --- 今ある角度差に基づく制約（div=0や既存配置時） ---
  if ((!div || div <= 0) && onRing.length > 1) {
    const sorted = [...onRing].sort((a, b) => a.theta - b.theta);
    for (let k = 0; k < sorted.length; k++) {
      const a = sorted[k];
      const b = sorted[(k + 1) % sorted.length];
      const deltaDeg = (b.theta - a.theta + 360) % 360 || 360;
      const deltaRad = (Math.PI / 180) * deltaDeg;
      const lenA = BEADS[a.type].len;
      const lenB = BEADS[b.type].len;
      const neededArc = lenA / 2 + lenB / 2 + CLEARANCE_MM;
      const rReq = neededArc / deltaRad;
      if (rReq > rMin) rMin = rReq;
    }
  }

  // --- 中心ビーズとの干渉 ---
  if (centerType) {
    const cR = centerCircumRadius(centerType);
    for (const b of onRing) {
      const dia = BEADS[b.type].dia;
      const rReq = cR + CLEARANCE_MM + dia / 2;
      if (rReq > rMin) rMin = rReq;
    }
  }

  return rMin;
}

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
      persist(ns); return ns;
    }),

    // 角度衝突チェック（同一リング内）＋中心ビーズとの半径方向チェック
    canPlaceOnRing: (ringIdx, r, theta, type, ignoreId) => {
      const { beads, centerBead } = get();
      const onRing = beads.filter(b => b.ring === ringIdx && b.id !== ignoreId);

      // 中心ビーズとの半径方向の衝突
      if (centerBead) {
        const cR = centerCircumRadius(centerBead);
        const dia = BEADS[type].dia;
        if ((r - dia / 2) < (cR + CLEARANCE_MM)) return false;
      }

      if (onRing.length === 0) return true;

      const lenNew = BEADS[type].len;
      for (const b of onRing) {
        const lenB = BEADS[b.type].len;
        const requiredDeg = ((lenNew / 2 + lenB / 2 + CLEARANCE_MM) / r) * (180 / Math.PI);
        const diff = Math.abs(((theta - b.theta + 540) % 360) - 180); // 0..180
        if (diff < requiredDeg) return false;
      }
      return true;
    },

    addBead: (type) => set((s) => {
        const ringIdx = s.activeRing;
        const ring = s.rings[ringIdx];
        if (!ring) return s;

        const r = ring.radius; // ★必ずリング半径

        // グリッド有効時：枠を超えて追加しない
        if (ring.div && ring.div > 0) {
            const onRing = s.beads.filter(b => b.ring === ringIdx);
            if (onRing.length >= ring.div) {
            get().setError(`このリングは ${ring.div} 個までです`);
            return s;
            }
            const step = 360 / ring.div;
            for (let k = 0; k < ring.div; k++) {
            const theta = (k * step) % 360;
            if (get().canPlaceOnRing(ringIdx, r, theta, type)) {
                const b: Bead = { id: crypto.randomUUID(), type, r, theta, ring: ringIdx };
                const ns = { ...s, beads: [...s.beads, b] };
                persist(ns); return ns;
            }
            }
            get().setError('配置できるグリッドがありません（重なります）');
            return s;
        }

        // グリッドなし時（div=0）：隙間に配置
        const tryWidestGapMid = (): number | null => {
            const onRing = s.beads.filter(b => b.ring === ringIdx);
            if (onRing.length === 0) return get().canPlaceOnRing(ringIdx, r, 0, type) ? 0 : null;
            const sorted = [...onRing].sort((a,b)=>a.theta - b.theta);
            let bestGap = -1, bestStart = 0;
            for (let i=0;i<sorted.length;i++){
            const cur = sorted[i].theta;
            const nxt = sorted[(i+1)%sorted.length].theta;
            const gap = (nxt - cur + 360) % 360 || 360;
            if (gap > bestGap) { bestGap = gap; bestStart = cur; }
            }
            const theta = (bestStart + bestGap/2) % 360;
            return get().canPlaceOnRing(ringIdx, r, theta, type) ? theta : null;
        };

        const theta = tryWidestGapMid();
        if (theta == null) {
            get().setError('配置できる場所がありません');
            return s;
        }

        const b: Bead = { id: crypto.randomUUID(), type, r, theta, ring: ringIdx };
        const ns = { ...s, beads: [...s.beads, b] };
        persist(ns); return ns;
    }),

    updateBead: (id, patch) => set((s) => {
      const beads = s.beads.map(b => b.id === id ? { ...b, ...patch } : b);
      const ns = { ...s, beads }; persist(ns); return ns;
    }),

    moveBeadSafe: (id, r, theta, ringIndex) => {
        const s = get();
        const bead = s.beads.find(b => b.id === id);
        if (!bead) return false;

        const ringIdx = ringIndex ?? bead.ring ?? s.activeRing;
        const ring = s.rings[ringIdx];

        // ★リングがあれば強制的に半径を上書き
        const rFinal = ring ? ring.radius : r;

        const can = s.canPlaceOnRing(ringIdx, rFinal, theta, bead.type, id);
        if (!can) { s.setError('その位置には置けません（重なります）'); return false; }

        set((st) => {
            const beads = st.beads.map(b => b.id === id ? { ...b, r: rFinal, theta, ring: ringIdx } : b);
            const ns = { ...st, beads }; persist(ns); return ns;
        });
        return true;
    },

    removeBead: (id) => set((s) => {
      const ns = { ...s, beads: s.beads.filter(b => b.id !== id) }; persist(ns); return ns;
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

        // 確認ダイアログ
        if (typeof window !== 'undefined') {
            const ok = window.confirm(`リング #${index+1} と、その上のビーズを削除します。よろしいですか？`);
            if (!ok) return s;
        }

        // リング削除
        const rings = s.rings.filter((_, i) => i !== index);

        // 紐づいていたビーズも削除
        const beads = s.beads.filter(b => b.ring !== index);

        // activeRingを調整
        const activeRing = Math.min(s.activeRing, rings.length - 1);

        const ns = { ...s, rings, beads, activeRing };
        persist(ns);
        return ns;
    }),

    setRingRadius: (index, radius) => set((s) => {
        const ring = s.rings[index];
        if (!ring) return s;

        // ★ 分割数に応じて最小半径を再計算
        const rReqMin = minAllowedRadiusForRing(index, s.beads, s.centerBead, ring.div);
        const rFinal = clamp(Math.max(radius, rReqMin), 0, WORKAREA_DIAMETER_MM / 2);

        const rings = s.rings.map((rg,i)=> i===index ? { ...rg, radius:rFinal } : rg);
        const beads = s.beads.map(b => b.ring===index ? { ...b, r:rFinal } : b);
        const ns = { ...s, rings, beads };
        persist(ns);
        return ns;
    }),


    setRingDiv: (index, div) => set((s) => {
        const d = Math.max(1, Math.floor(div)); // ★ 0は禁止
        const ring = s.rings[index];
        if (!ring) return s;

        const step = 360 / d;
        const onRing = s.beads.filter(b => b.ring === index);
        if (onRing.length === 0) {
            // ビーズがない場合はそのまま変更
            const rings = s.rings.map((rg,i)=> i===index ? { ...rg, div:d } : rg);
            const ns = { ...s, rings };
            persist(ns);
            return ns;
        }

        // 角度順にソート
        const sorted = [...onRing].sort((a,b)=>a.theta - b.theta);

        // 新しい位置候補
        const snapped: { id: string; theta: number }[] = [];

        if (d < ring.div) {
            // ★ 減らした場合：角度順に i*step へ再配置
            for (let i=0; i<sorted.length; i++) {
            const theta = (i * step) % 360;
            snapped.push({ id: sorted[i].id, theta });
            }
        } else if (d > ring.div) {
            // ★ 増やした場合：順番を維持して等間隔に配置
            for (let i=0; i<sorted.length; i++) {
            const theta = (i * step) % 360;
            snapped.push({ id: sorted[i].id, theta });
            }
        }

        // 衝突チェック
        const ok = snapped.every(sn => {
            const bead = onRing.find(b=>b.id===sn.id)!;
            return get().canPlaceOnRing(index, ring.radius, sn.theta, bead.type, bead.id);
        });
        if (!ok) {
            get().setError("その分割数ではビーズが収まりません");
            return s;
        }

        // 反映
        const rings = s.rings.map((rg,i)=> i===index ? { ...rg, div:d } : rg);
        const beads = s.beads.map(b => {
            const sn = snapped.find(sn=>sn.id===b.id);
            return sn ? { ...b, theta: sn.theta } : b;
        });
        const ns = { ...s, rings, beads };
        persist(ns);
        return ns;
    }),

    setActiveRing: (index) => set((s) => {
      const ns = { ...s, activeRing: clamp(index, 0, s.rings.length - 1) };
      persist(ns); return ns;
    }),

    setPreviewMode: (on) => set((s) => {
        const ns = { ...s, previewMode: on, activeRing: s.activeRing }; // activeRingはそのまま保持
        persist(ns); return ns;
    }),
  };
});

// 外形直径（中心ビーズも考慮）
export function computeDesignDiameterMM(beads: Bead[], centerType?: BeadKey | null): number {
  let maxR = 0;
  for (const b of beads) {
    const spec = BEADS[b.type];
    const hw = spec.len / 2, hh = spec.dia / 2;
    const rRect = Math.sqrt(hw*hw + hh*hh);
    maxR = Math.max(maxR, b.r + rRect);
  }
  if (centerType) {
    const c = centerCircumRadius(centerType);
    maxR = Math.max(maxR, c);
  }
  return maxR * 2;
}
