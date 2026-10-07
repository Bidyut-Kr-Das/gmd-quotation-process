"use client";
import React, { useState, useEffect } from "react";
import { ShieldCheck, AlertTriangle, CheckCircle } from "lucide-react";
import "./FolderMonitorWidget.css";

interface UnmatchedRecord {
  docketNo: number;
  tenderNo: string;
  client: string;
}

export const FolderMonitorWidget: React.FC = () => {
  const [unmatched, setUnmatched] = useState<UnmatchedRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchUnmatched = async () => {
      try {
        const response = await fetch("/api/monitor/unmatched");
        if (!response.ok) throw new Error("Failed to load audit monitoring data.");
        const resData = await response.json();
        setUnmatched(resData.data || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "An unexpected audit error occurred.");
      } finally { setLoading(false); }
    };
    fetchUnmatched();
  }, []);

  return (
    <div className="monitor-widget-card">
      <header className="monitor-widget-header">
        <div className="title-group">
          <span className="monitor-icon" style={{ display: "inline-flex", alignItems: "center" }}><ShieldCheck size={18} /></span>
          <h4>Folder Audit Discrepancies</h4>
        </div>
        {!loading && unmatched.length > 0 && <span className="discrepancy-badge">{unmatched.length} Gaps</span>}
      </header>
      <div className="monitor-widget-body">
        {loading && (
          <div className="monitor-loading">
            <span className="pulse-dot"></span>
            <span>Auditing folder structures...</span>
          </div>
        )}
        {error && (
          <div className="monitor-error">
            <span className="error-icon" style={{ display: "inline-flex", alignItems: "center" }}><AlertTriangle size={24} /></span>
            <p>{error}</p>
          </div>
        )}
        {!loading && !error && unmatched.length === 0 && (
          <div className="monitor-success">
            <span className="success-icon" style={{ display: "inline-flex", alignItems: "center" }}><CheckCircle size={24} /></span>
            <p>All Google Sheet dockets successfully matched with server directories.</p>
          </div>
        )}
        {!loading && !error && unmatched.length > 0 && (
          <div className="monitor-list-container">
            <p className="monitor-meta">The following tender records have docket numbers in the sheet but lack a physical server directory.</p>
            <ul className="monitor-list">
              {unmatched.map(item => (
                <li key={item.docketNo} className="monitor-item">
                  <div className="monitor-item-docket">
                    <span className="lbl">Docket:</span>
                    <span className="val">#{item.docketNo}</span>
                  </div>
                  <div className="monitor-item-details">
                    <div className="val-client" title={item.client}>{item.client}</div>
                    <div className="val-tender" title={item.tenderNo}>Ref: {item.tenderNo}</div>
                  </div>
                  <div className="monitor-item-status">
                    <span className="missing-label">No Folder</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
};
