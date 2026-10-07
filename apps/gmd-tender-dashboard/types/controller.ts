export interface FileResponse {
  fileId: string;
  filename: string;
  extension: string;
  size: number;
  lastModified: number;
  relativePath: string;
}

export interface DocketFilesResponse {
  docketNo: string;
  folderPath: string;
  files: FileResponse[];
}

export interface SupplyBillFilesResponse {
  saleBillNumber: string;
  folderPath?: string;
  files: FileResponse[];
}

export interface FolderDetailsResponse {
  docketNo: string;
  folderFound: boolean;
  folderPath: string | null;
  folderName: string | null;
  matchedAt: string | null;
}

export interface AuthConfig {
  encryptionKey: string;
  encryptionIv: string;
}

export interface TenderUpdateBody {
  tenderUpdateStatus: string;
  nextAction?: string | null;
  reverseAuctionApplicable?: boolean;
}

export interface DiffUpdateBody {
  diffPercentFromL1?: number | null;
  diffPercentFromL2?: number | null;
}
