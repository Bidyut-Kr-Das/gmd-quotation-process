"use client";
import React, { useState, useEffect, useMemo } from "react";
import { X, AlertTriangle, FolderOpen, Eye, Download } from "lucide-react";
import { FileIcon } from "@/lib/file-icons";
import "./SupplyAttachmentModal.css";

interface FileRecord {
  fileId: string;
  filename: string;
  extension: string;
  size: number;
  lastModified: number;
  relativePath: string;
  source?: "local" | "url";
  url?: string;
}

interface SupplyAttachmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  saleBillNumber: string;
  attachmentUrl?: string | null;
  authToken?: string;
}

function getGoogleDriveDownloadUrl(url: string): string {
  const match = url.match(/[?&]id=([a-zA-Z0-9_-]+)/) || url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (match) {
    return `https://docs.google.com/uc?export=download&id=${match[1]}`;
  }
  return url;
}

function getFilenameFromUrl(url: string): string {
  const match = url.match(/[?&]id=([a-zA-Z0-9_-]+)/) || url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (match) {
    return `drive_document_${match[1].slice(0, 8)}`;
  }
  try {
    const pathname = new URL(url).pathname;
    const segments = pathname.split("/").filter(Boolean);
    if (segments.length > 0) return decodeURIComponent(segments[segments.length - 1]);
  } catch {}
  return "online_document";
}

function getExtensionFromUrl(url: string): string {
  const filename = getFilenameFromUrl(url);
  const dot = filename.lastIndexOf(".");
  if (dot !== -1) return filename.slice(dot);
  const match = url.match(/[?&]id=([a-zA-Z0-9_-]+)/) || url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (match) return ".pdf";
  return "";
}

export const SupplyAttachmentModal: React.FC<SupplyAttachmentModalProps> = ({
  isOpen,
  onClose,
  saleBillNumber,
  attachmentUrl,
  authToken = "Bearer MOCK_TOKEN_GMDALUI_SECURE_AUTH_SCOPE",
}) => {
  const [localFiles, setLocalFiles] = useState<FileRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [driveNames, setDriveNames] = useState<Record<string, string | null>>({});

  useEffect(() => {
    if (!isOpen || !saleBillNumber) return;
    const fetchFiles = async () => {
      setLoading(true);
      setError(null);
      setLocalFiles([]);
      try {
        const response = await fetch(
          `/api/supply-history/${encodeURIComponent(saleBillNumber)}/files`,
          {
            headers: { Authorization: authToken },
          },
        );
        if (!response.ok) {
          const errText = await response.text();
          throw new Error(errText || "Failed to load supply bill files.");
        }
        const data = await response.json();
        setLocalFiles(data.files || []);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "An unexpected error occurred.",
        );
      } finally {
        setLoading(false);
      }
    };
    fetchFiles();
  }, [isOpen, saleBillNumber, authToken]);

  const urlFiles = useMemo<FileRecord[]>(() => {
    if (!attachmentUrl) return [];
    console.log("[SupplyAttachmentModal] attachmentUrl raw:", attachmentUrl);
    const urls = attachmentUrl
      .split(",")
      .map((u) => u.trim())
      .filter(Boolean);
    console.log("[SupplyAttachmentModal] Parsed URLs:", urls);
    return urls.map((u) => ({
      fileId: "",
      filename: driveNames[u] || getFilenameFromUrl(u),
      extension: getExtensionFromUrl(u),
      size: 0,
      lastModified: 0,
      relativePath: "",
      source: "url" as const,
      url: u,
    }));
  }, [attachmentUrl, driveNames]);

  useEffect(() => {
    if (!attachmentUrl) return;
    const urls = attachmentUrl
      .split(",")
      .map((u) => u.trim())
      .filter(Boolean);
    if (urls.length === 0) return;
    console.log("[SupplyAttachmentModal] Resolving drive names for:", urls);
    fetch("/api/resolve-drive-names", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ urls }),
    })
      .then((r) => r.json())
      .then(({ names }) => {
        console.log("[SupplyAttachmentModal] Resolved drive names:", names);
        setDriveNames(names || {});
      })
      .catch(() => {});
  }, [attachmentUrl]);

  const allFiles = useMemo(() => {
    const local = localFiles.map((f) => ({ ...f, source: "local" as const }));
    return [...local, ...urlFiles];
  }, [localFiles, urlFiles]);

  if (!isOpen) return null;

  const formatSize = (bytes: number): string => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const handleDownload = (file: FileRecord) => {
    if (file.source === "url") {
      window.open(getGoogleDriveDownloadUrl(file.url!), "_blank");
    } else {
      window.open(
        `/api/executive-files/download/${file.fileId}?auth=${encodeURIComponent(authToken)}`,
        "_blank",
      );
    }
  };
  const handlePreview = (file: FileRecord) => {
    if (file.source === "url") {
      window.open(file.url!, "_blank");
    } else {
      window.open(
        `/api/executive-files/view/${file.fileId}?auth=${encodeURIComponent(authToken)}`,
        "_blank",
      );
    }
  };

  return (
    <div className="attachment-modal-overlay" onClick={onClose}>
      <div
        className="attachment-modal-container"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="attachment-modal-header">
          <h3>Documents for Sale Bill #{saleBillNumber}</h3>
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
          {loading && (
            <div className="skeleton-container">
              {[1, 2, 3].map((i) => (
                <div key={i} className="skeleton-row">
                  <div className="skeleton-icon"></div>
                  <div className="skeleton-text-group">
                    <div className="skeleton-title"></div>
                    <div className="skeleton-subtitle"></div>
                  </div>
                  <div className="skeleton-btn"></div>
                  <div className="skeleton-btn"></div>
                </div>
              ))}
            </div>
          )}
          {error && (
            <div className="attachment-error-state">
              <span
                className="error-icon"
                style={{ display: "inline-flex", alignItems: "center" }}
              >
                <AlertTriangle size={24} />
              </span>
              <p className="error-message">{error}</p>
            </div>
          )}
          {!loading && !error && allFiles.length === 0 && (
            <div className="attachment-empty-state">
              <span
                className="empty-icon"
                style={{ display: "inline-flex", alignItems: "center" }}
              >
                <FolderOpen size={24} />
              </span>
              <p>No documents found for this Sale Bill folder.</p>
            </div>
          )}
          {!loading && !error && allFiles.length > 0 && (
            <ul className="file-list">
              {allFiles.map((file, idx) => (
                <li key={file.source === "url" ? `url-${idx}` : file.fileId} className="file-item">
                  <div
                    className="file-icon"
                    title={file.extension}
                    style={{ display: "inline-flex", alignItems: "center" }}
                  >
                    <FileIcon extension={file.extension} size={18} />
                  </div>
                  <div className="file-info-group">
                    <span className="file-name" title={file.filename}>
                      {file.filename}
                      {file.source === "url" && (
                        <span className="file-source-badge">Online</span>
                      )}
                    </span>
                    <span className="file-meta">
                      {file.source === "url"
                        ? "Online document"
                        : `${formatSize(file.size)} • ${new Date(file.lastModified).toLocaleDateString()}`}
                    </span>
                  </div>
                  <div className="file-actions">
                    {file.extension.toLowerCase() === ".pdf" && (
                      <button
                        className="file-action-btn view-btn"
                        onClick={() => handlePreview(file)}
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
                    <button
                      className="file-action-btn download-btn"
                      onClick={() => handleDownload(file)}
                      title="Download file"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "4px",
                      }}
                    >
                      <Download size={14} /> Download
                    </button>
                  </div>
                </li>
              ))}
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
