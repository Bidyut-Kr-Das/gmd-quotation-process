import { File, FileSpreadsheet, FileText, FileImage } from "lucide-react";

export const FileIcon = ({ extension, size = 16 }: { extension: string; size?: number }) => {
  const normalized = extension.toLowerCase();
  if (normalized === ".pdf") return <FileText size={size} />;
  if ([".xlsx", ".xls", ".csv"].includes(normalized)) return <FileSpreadsheet size={size} />;
  if ([".docx", ".doc"].includes(normalized)) return <FileText size={size} />;
  if ([".png", ".jpg", ".jpeg", ".gif"].includes(normalized)) return <FileImage size={size} />;
  return <File size={size} />;
};
