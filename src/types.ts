export type GraphicType = 'dot' | 'line' | 'plane' | 'svg';
export type AppTab = 'typography' | 'graphic' | 'output';

export interface UploadedSvg {
  id: string;
  content: string;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  flipH: boolean;
  flipV: boolean;
}

export interface PlaneConfig {
  type: 'square' | 'circle' | 'triangle';
  width: number;
  height: number;
  radius: number;
  sides: number;
  angle: number;
  x: number;
  y: number;
  color: string;
}

export interface LayoutState {
  activeTab: AppTab;
  mainEnText: string;
  mainZhText: string;
  sub1Text: string;
  sub2Text: string;
  mainEnSize: number;
  mainEnWeight: number;
  mainEnLineHeight: number;
  mainZhSize: number;
  mainZhWeight: number;
  mainZhLineHeight: number;
  sub1Weight: number;
  sub1Size: number;
  sub2Weight: number;
  sub2Size: number;
  titleGap: number;
  showGuides: boolean;
  showMainEn: boolean;
  showMainZh: boolean;
  isSizeLinked: boolean;
  logoSvg: string | null;
  bgColor: '#ffffff' | '#dfd9ff';
  graphicType: GraphicType;
  dotShape: 'circle' | 'triangle' | 'square' | 'random';
  dotColors: string[];
  dotTrend: 'single' | 'random';
  dotCount: number;
  dotSpread: number;
  dotX: number;
  dotY: number;
  dotRotation: number;
  dotSeed: number;
  lineThickness: number;
  lineColors: string[];
  lineLengthContrast: number;
  lineCount: number;
  lineSeed: number;
  planeShape: 'square' | 'circle' | 'triangle' | 'random';
  plane1: PlaneConfig;
  plane2: PlaneConfig;
  planeOrder: '1-over-2' | '2-over-1';
  planeSeed: number;
  uploadedSvgs: UploadedSvg[];
}

export const initialLayoutState: LayoutState = {
  activeTab: 'typography',
  mainEnText: "PARTNER\nONE GROUP",
  mainZhText: "游学计划",
  sub1Text: "2026.01.23(OCT)",
  sub2Text: "代理商游学团\nONE GROUP STRATEGY",
  mainEnSize: 200,
  mainEnWeight: 600,
  mainEnLineHeight: 0.85,
  // 中英文同时显示时字号联动：中文≈英文×(130/165)
  mainZhSize: 158,
  mainZhWeight: 700,
  mainZhLineHeight: 1.05,
  sub1Weight: 700,
  sub1Size: 85,
  sub2Weight: 700,
  sub2Size: 45,
  titleGap: 14,
  showGuides: true,
  showMainEn: true,
  showMainZh: true,
  isSizeLinked: true,
  logoSvg: null,
  bgColor: "#ffffff",
  graphicType: 'dot',
  dotShape: 'circle',
  dotColors: ['#9e76ff'],
  dotTrend: 'single',
  dotCount: 25,
  dotSpread: 15,
  dotX: 0,
  dotY: 0,
  dotRotation: 0,
  dotSeed: 1,
  lineThickness: 40,
  lineColors: ['#9e76ff'],
  lineLengthContrast: 0.5,
  lineCount: 3,
  lineSeed: 1,
  planeShape: 'random',
  plane1: { type: 'square', width: 1200, height: 800, radius: 400, sides: 3, angle: 15, x: 30, y: 20, color: '#915afd' },
  plane2: { type: 'circle', width: 1000, height: 1000, radius: 500, sides: 3, angle: -10, x: 60, y: 50, color: '#f03cfc' },
  planeOrder: '1-over-2',
  planeSeed: 1,
  uploadedSvgs: [],
};

