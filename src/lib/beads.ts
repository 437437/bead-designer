export type BeadKey =
  | 'marusho'
  | 'marudai'
  | 'marutokudai'
  | 'marutokutokudai'
  | 'ichibutake'
  | 'nibutake'
  | 'sanbutake'
  | 'yonbutake'
  | 'gobutake'
  | 'diamond5'
  | 'pearl5';

/** 丸: len=dia、竹: len=長さ(長辺), dia=直径(短辺) [mm] */
export const BEADS: Record<BeadKey, { len: number; dia: number; label: string; shape: 'circle'|'rect'|'diamond'|'tube' }> = {
  marusho: { len: 2.1, dia: 2.1, label: '丸小 (φ2.1)', shape: 'rect' },
  marudai: { len: 3.0, dia: 3.0, label: '丸大 (φ3.0)', shape: 'rect' },
  marutokudai: { len: 4.0, dia: 4.0, label: '丸特大 (φ4.0)', shape: 'rect' },
  marutokutokudai: { len: 6.0, dia: 6.0, label: '丸特特大 (φ6.0)', shape: 'rect' },

  ichibutake: { len: 3.0, dia: 1.5, label: '一分竹', shape: 'tube' },
  nibutake:   { len: 6.0, dia: 1.7, label: '二分竹', shape: 'tube' },
  sanbutake:  { len: 9.0, dia: 2.0, label: '三分竹', shape: 'tube' },
  yonbutake:  { len: 12.0, dia: 2.0, label: '四分竹', shape: 'tube' },
  gobutake:   { len: 15.0, dia: 2.0, label: '五分竹', shape: 'tube' },

  diamond5: { len: 5.0, dia: 5.0, label: 'ダイヤ (5.0)', shape: 'diamond' },
  pearl5:   { len: 5.0, dia: 5.0, label: 'パール (φ5.0)', shape: 'circle' },
};

export const PX_PER_MM = 8;
export const GUIDE_DIAMETERS_MM = [20, 40, 60];
export const WORKAREA_DIAMETER_MM = Math.max(...GUIDE_DIAMETERS_MM);
