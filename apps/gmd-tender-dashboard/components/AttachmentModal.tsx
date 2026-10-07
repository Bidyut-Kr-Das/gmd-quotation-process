"use client";
import React from "react";
import { X, FolderOpen, Eye, Download, ExternalLink } from "lucide-react";
import { FileIcon } from "@/lib/file-icons";
import "./AttachmentModal.css";

interface AttachmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  files: Record<string, string>[];
  authToken?: string;
}

function parseTags(file: Record<string, string>): string[] {
  if (Array.isArray(file.tags)) return file.tags as unknown as string[];
  if (typeof file.tags === "string") {
    try { return JSON.parse(file.tags); } catch { return []; }
  }
  return [];
}

function getDriveFallbackName(url: string): string {
  const m = url.match(/[?&]id=([a-zA-Z0-9_-]+)/) || url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (m) return `drive_document_${m[1].slice(0, 8)}`;
  return "online_document";
}

export const AttachmentModal: React.FC<AttachmentModalProps> = ({
  isOpen,
  onClose,
  files,
  authToken = "Bearer MOCK_TOKEN_GMDALUI_SECURE_AUTH_SCOPE",
}) => {
  if (!isOpen) return null;

  return (
    <div className="attachment-modal-overlay" onClick={onClose}>
      <div
        className="attachment-modal-container"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="attachment-modal-header">
          <h3>Tender Files</h3>
          <button
            className="attachment-modal-close-btn"
            onClick={onClose}
            aria-label="Close modal"
            style={{ display: "inline-flex", alignItems: "center" }}
          >
            <X size={16} />
          </button>
        </header>
        <div className="attachment-modal-body">
          {files.length === 0 && (
            <div className="attachment-empty-state">
              <span
                className="empty-icon"
                style={{ display: "inline-flex", alignItems: "center" }}
              >
                <FolderOpen size={24} />
              </span>
              <p>No documents found.</p>
            </div>
          )}
          {files.length > 0 && (
            <ul className="file-list">
              {files.map((file, idx) => {
                const extension = file.extension || "";
                const rawName = file.name || file.filename || "Unknown";
                const baseName = rawName.toLowerCase() === "view" || rawName.toLowerCase() === "view.pdf" ? getDriveFallbackName(file.url || file.source || "") : rawName;
                const filename = baseName.endsWith(extension) ? baseName : baseName + extension;
                const tags = parseTags(file);
                const isHttpUrl = file.url?.startsWith("http") || file.source?.startsWith("http");
                const isNetworkFile = (tags.includes("networkFiles") || (!!file.source && file.source !== "SHEET_SYNC" && file.source !== "MANUAL_UPLOAD")) && !isHttpUrl;
                const normalizedExt = extension.replace(/^\./, "").toLowerCase();

                return (
                  <li key={file.id || idx} className="file-item">
                    <div
                      className="file-icon"
                      title={extension}
                      style={{ display: "inline-flex", alignItems: "center" }}
                    >
                      <FileIcon extension={extension} size={18} />
                    </div>
                    <div className="file-info-group">
                      <span className="file-name" title={filename}>
                        {filename}
                      </span>
                      {tags.length > 0 && (
                        <div className="file-tags">
                          {tags.map(tag => (
                            <span key={tag} className={`file-tag file-tag--${tag}`}>{tag}</span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="file-actions">
                      {isNetworkFile && normalizedExt === "pdf" && (
                        <button
                          className="file-action-btn view-btn"
                          onClick={() =>
                            window.open(
                              `/api/executive-files/view/${file.source}?auth=${encodeURIComponent(authToken)}`,
                              "_blank",
                            )
                          }
                          title="Preview PDF inline"
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "4px",
                          }}
                        >
                          <Eye size={14} /> Preview
                        </button>
                      )}
                      {isNetworkFile && (
                        <button
                          className="file-action-btn download-btn"
                          onClick={() =>
                            window.open(
                              `/api/executive-files/download/${file.source}?auth=${encodeURIComponent(authToken)}`,
                              "_blank",
                            )
                          }
                          title="Download file"
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "4px",
                          }}
                        >
                          <Download size={14} /> Download
                        </button>
                      )}
                      {!isNetworkFile && isHttpUrl && (
                        <button
                          className="file-action-btn open-btn"
                          onClick={() => window.open(file.url || file.source, "_blank")}
                          title="Open in new tab"
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "4px",
                          }}
                        >
                          <ExternalLink size={14} /> Open
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <footer className="attachment-modal-footer">
          <button className="footer-close-btn" onClick={onClose}>
            Close
          </button>
        </footer>
      </div>
    </div>
  );
};
