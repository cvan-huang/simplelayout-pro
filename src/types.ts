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

export interface PlanePresetConfig {
  plane1: PlaneConfig;
  plane2: PlaneConfig;
  planeOrder: '1-over-2' | '2-over-1';
  planeSeed: number;
}

export interface LayoutState {
  activeTab: AppTab;
  mainEnText: string;
  mainZhText: string;
  mainMixedText: string;
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
  dotPreset:
    | 'preset1'
    | 'preset2'
    | 'preset3'
    | 'preset4'
    | 'preset5'
    | 'random';
  dotCount: number;
  dotSpread: number;
  dotSideSpread: number;
  dotX: number;
  dotY: number;
  dotRotation: number;
  dotSeed: number;
  dotPreset1Count: number;
  dotPreset1Spread: number;
  dotPreset1SideSpread: number;
  dotPreset1X: number;
  dotPreset1Y: number;
  dotPreset1Rotation: number;
  dotPreset1Seed: number;
  dotPreset2Count: number;
  dotPreset2Spread: number;
  dotPreset2SideSpread: number;
  dotPreset2X: number;
  dotPreset2Y: number;
  dotPreset2Rotation: number;
  dotPreset2Seed: number;
  dotPreset3Count: number;
  dotPreset3Spread: number;
  dotPreset3SideSpread: number;
  dotPreset3X: number;
  dotPreset3Y: number;
  dotPreset3Rotation: number;
  dotPreset3Seed: number;
  dotPreset4Count: number;
  dotPreset4Spread: number;
  dotPreset4SideSpread: number;
  dotPreset4X: number;
  dotPreset4Y: number;
  dotPreset4Rotation: number;
  dotPreset4Seed: number;
  dotPreset5Count: number;
  dotPreset5Spread: number;
  dotPreset5SideSpread: number;
  dotPreset5X: number;
  dotPreset5Y: number;
  dotPreset5Rotation: number;
  dotPreset5Seed: number;
  linePreset: 'preset1' | 'preset2' | 'preset3' | 'random';
  lineThickness: number;
  lineColors: string[];
  lineLengthContrast: number;
  lineCount: number;
  lineSeed: number;
  lineX: number;
  lineY: number;
  linePreset1Count: number;
  linePreset1Thickness: number;
  linePreset1LengthContrast: number;
  linePreset1Seed: number;
  linePreset1X: number;
  linePreset1Y: number;
  linePreset2Count: number;
  linePreset2Thickness: number;
  linePreset2LengthContrast: number;
  linePreset2Seed: number;
  linePreset2X: number;
  linePreset2Y: number;
  linePreset3Count: number;
  linePreset3Thickness: number;
  linePreset3LengthContrast: number;
  linePreset3Seed: number;
  linePreset3X: number;
  linePreset3Y: number;
  planeShape: 'square' | 'circle' | 'triangle' | 'random';
  plane1: PlaneConfig;
  plane2: PlaneConfig;
  planeOrder: '1-over-2' | '2-over-1';
  planeSeed: number;
  squarePlanePreset: 'preset1' | 'preset2' | 'preset3' | 'random';
  squarePlanePresets: PlanePresetConfig[];
  circlePlanePreset: 'preset1' | 'preset2' | 'preset3' | 'random';
  circlePlanePresets: PlanePresetConfig[];
  trianglePlanePreset: 'preset1' | 'preset2' | 'preset3' | 'random';
  trianglePlanePresets: PlanePresetConfig[];
  randomPlanePreset: 'preset1' | 'preset2' | 'preset3' | 'random';
  randomPlanePresets: PlanePresetConfig[];
  uploadedSvgs: UploadedSvg[];
}

export const initialLayoutState: LayoutState = {
  activeTab: 'typography',
  mainEnText: "PARTNER\nONE GROUP",
  mainZhText: "游学计划",
  mainMixedText: "PARTNER\nONE GROUP\n游学计划",
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
  dotPreset: 'preset1',
  dotCount: 48,
  dotSpread: 14,
  dotSideSpread: 300,
  dotX: 0,
  dotY: -120,
  dotRotation: 0,
  dotSeed: 7382,
  dotPreset1Count: 48,
  dotPreset1Spread: 14,
  dotPreset1SideSpread: 300,
  dotPreset1X: 0,
  dotPreset1Y: -120,
  dotPreset1Rotation: 0,
  dotPreset1Seed: 7382,
  dotPreset2Count: 30,
  dotPreset2Spread: 80,
  dotPreset2SideSpread: 300,
  dotPreset2X: 80,
  dotPreset2Y: -30,
  dotPreset2Rotation: 150,
  dotPreset2Seed: 19204,
  dotPreset3Count: 50,
  dotPreset3Spread: 160,
  dotPreset3SideSpread: 300,
  dotPreset3X: -120,
  dotPreset3Y: 60,
  dotPreset3Rotation: 280,
  dotPreset3Seed: 54917,
  dotPreset4Count: 40,
  dotPreset4Spread: 60,
  dotPreset4SideSpread: 300,
  dotPreset4X: 0,
  dotPreset4Y: -40,
  dotPreset4Rotation: 0,
  dotPreset4Seed: 44444,
  dotPreset5Count: 70,
  dotPreset5Spread: 25,
  dotPreset5SideSpread: 300,
  dotPreset5X: 0,
  dotPreset5Y: 0,
  dotPreset5Rotation: 0,
  dotPreset5Seed: 55555,
  linePreset: 'preset1',
  lineThickness: 50,
  lineColors: ['#9e76ff'],
  lineLengthContrast: 0.3,
  lineCount: 3,
  lineSeed: 12345,
  lineX: 0,
  lineY: 0,
  linePreset1Count: 3,
  linePreset1Thickness: 50,
  linePreset1LengthContrast: 0.3,
  linePreset1Seed: 12345,
  linePreset1X: 0,
  linePreset1Y: 0,
  linePreset2Count: 4,
  linePreset2Thickness: 30,
  linePreset2LengthContrast: 0.2,
  linePreset2Seed: 67890,
  linePreset2X: 0,
  linePreset2Y: 0,
  linePreset3Count: 5,
  linePreset3Thickness: 60,
  linePreset3LengthContrast: 0.1,
  linePreset3Seed: 11223,
  linePreset3X: 0,
  linePreset3Y: 0,
  planeShape: 'random',
  plane1: { type: 'square', width: 1200, height: 800, radius: 400, sides: 3, angle: 15, x: 30, y: 20, color: '#9e76ff' },
  plane2: { type: 'circle', width: 1000, height: 1000, radius: 500, sides: 3, angle: -10, x: 60, y: 50, color: '#ffdf7a' },
  planeOrder: '1-over-2',
  planeSeed: 1,
  squarePlanePreset: 'preset1',
  squarePlanePresets: [
    { plane1: { type: 'square', width: 1400, height: 600, radius: 400, sides: 3, angle: 8, x: 35, y: 20, color: '#9e76ff' }, plane2: { type: 'square', width: 700, height: 800, radius: 400, sides: 3, angle: -12, x: 62, y: 65, color: '#ffdf7a' }, planeOrder: '1-over-2', planeSeed: 1 },
    { plane1: { type: 'square', width: 900, height: 900, radius: 400, sides: 3, angle: 15, x: 15, y: 15, color: '#985946' }, plane2: { type: 'square', width: 800, height: 500, radius: 400, sides: 3, angle: -5, x: 70, y: 70, color: '#9e76ff' }, planeOrder: '2-over-1', planeSeed: 1 },
    { plane1: { type: 'square', width: 1800, height: 350, radius: 400, sides: 3, angle: -3, x: 20, y: 30, color: '#9e76ff' }, plane2: { type: 'square', width: 1600, height: 300, radius: 400, sides: 3, angle: 3, x: 25, y: 65, color: '#ffdf7a' }, planeOrder: '1-over-2', planeSeed: 1 },
  ],
  circlePlanePreset: 'preset1',
  circlePlanePresets: [
    { plane1: { type: 'circle', width: 1000, height: 1000, radius: 400, sides: 3, angle: 0, x: 30, y: 50, color: '#9e76ff' }, plane2: { type: 'circle', width: 600, height: 600, radius: 300, sides: 3, angle: 0, x: 68, y: 30, color: '#ffdf7a' }, planeOrder: '1-over-2', planeSeed: 1 },
    { plane1: { type: 'circle', width: 1400, height: 700, radius: 400, sides: 3, angle: 15, x: 25, y: 35, color: '#985946' }, plane2: { type: 'circle', width: 1000, height: 500, radius: 400, sides: 3, angle: -10, x: 55, y: 65, color: '#9e76ff' }, planeOrder: '2-over-1', planeSeed: 1 },
    { plane1: { type: 'circle', width: 900, height: 900, radius: 400, sides: 3, angle: 0, x: 38, y: 45, color: '#9e76ff' }, plane2: { type: 'circle', width: 750, height: 750, radius: 400, sides: 3, angle: 0, x: 55, y: 55, color: '#ffdf7a' }, planeOrder: '1-over-2', planeSeed: 1 },
  ],
  trianglePlanePreset: 'preset1',
  trianglePlanePresets: [
    { plane1: { type: 'triangle', width: 1000, height: 800, radius: 450, sides: 3, angle: 20, x: 28, y: 30, color: '#9e76ff' }, plane2: { type: 'triangle', width: 1000, height: 800, radius: 380, sides: 6, angle: 0, x: 65, y: 65, color: '#ffdf7a' }, planeOrder: '1-over-2', planeSeed: 1 },
    { plane1: { type: 'triangle', width: 1000, height: 800, radius: 500, sides: 5, angle: 10, x: 20, y: 40, color: '#985946' }, plane2: { type: 'triangle', width: 1000, height: 800, radius: 320, sides: 5, angle: -15, x: 70, y: 55, color: '#9e76ff' }, planeOrder: '2-over-1', planeSeed: 1 },
    { plane1: { type: 'triangle', width: 1000, height: 800, radius: 520, sides: 8, angle: 0, x: 25, y: 50, color: '#9e76ff' }, plane2: { type: 'triangle', width: 1000, height: 800, radius: 380, sides: 10, angle: 5, x: 65, y: 45, color: '#ffdf7a' }, planeOrder: '1-over-2', planeSeed: 1 },
  ],
  randomPlanePreset: 'preset1',
  randomPlanePresets: [
    { plane1: { type: 'square', width: 1200, height: 800, radius: 400, sides: 3, angle: 15, x: 30, y: 20, color: '#9e76ff' }, plane2: { type: 'circle', width: 1000, height: 1000, radius: 500, sides: 3, angle: -10, x: 60, y: 50, color: '#ffdf7a' }, planeOrder: '1-over-2', planeSeed: 111 },
    { plane1: { type: 'square', width: 1200, height: 800, radius: 400, sides: 3, angle: 15, x: 30, y: 20, color: '#985946' }, plane2: { type: 'circle', width: 1000, height: 1000, radius: 500, sides: 3, angle: -10, x: 60, y: 50, color: '#9e76ff' }, planeOrder: '1-over-2', planeSeed: 2222 },
    { plane1: { type: 'square', width: 1200, height: 800, radius: 400, sides: 3, angle: 15, x: 30, y: 20, color: '#9e76ff' }, plane2: { type: 'circle', width: 1000, height: 1000, radius: 500, sides: 3, angle: -10, x: 60, y: 50, color: '#ffdf7a' }, planeOrder: '2-over-1', planeSeed: 33333 },
  ],
  uploadedSvgs: [],
};

