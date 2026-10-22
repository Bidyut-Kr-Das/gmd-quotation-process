export interface MaterialPattern {
  key: string;
  patterns: RegExp[];
}

export interface MaterialMatch {
  key: string;
  pattern: RegExp;
  normalized: string;
}

export interface RawMaterialsMap {
  [materialKey: string]: string | null;
}

export interface CostingItem {
  qty: string | null;
  rawMaterials: RawMaterialsMap;
}

export interface CostingAnalysisResult {
  items: CostingItem[];
  materialsFound: string[];
  sheetName: string | null;
}

export interface ColumnMap {
  qtyCol: number;
  materialCols: Map<string, number>;
}

export interface HeaderRowInfo {
  headerRowIdx: number;
  mergeDepth: number;
  headers: (string | null)[];
}
