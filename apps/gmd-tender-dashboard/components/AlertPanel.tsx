"use client";
import React from "react";
import { Check, AlertTriangle } from "lucide-react";
import "./AlertPanel.css";

interface AlertsData {
  reverseAuctionIn7DCount: number;
  emdExpiringIn15DCount: number;
  bidValidityExpiredCount: number;
  underEvalGreater90DCount: number;
  loiReceivedPoPendingValueRs: number;
}

interface AlertPanelProps {
  alerts: AlertsData;
}

export const AlertPanel: React.FC<AlertPanelProps> = ({ alerts }) => {
  const formatCurrencyCr = (value: number): string => {
    const crores = value / 10000000;
    return `\u20B9${crores.toFixed(1)} Cr`;
  };

  const hasAlerts =
    alerts.reverseAuctionIn7DCount > 0 ||
    alerts.emdExpiringIn15DCount > 0 ||
    alerts.bidValidityExpiredCount > 0 ||
    alerts.underEvalGreater90DCount > 0 ||
    alerts.loiReceivedPoPendingValueRs > 0;

  // if (!hasAlerts) {
  //   return (
  //     <div className="alert-panel-container">
  //       <span className="alert-action-badge" style={{ backgroundColor: "#137333", animation: "none" }}>
  //         <Check size={14} /> No Actions
  //       </span>
  //       <span className="alert-pill" style={{ fontSize: "11px", opacity: 0.8 }}>
  //         All tender metrics and deadlines are currently up to date.
  //       </span>
  //     </div>
  //   );
  // }

  return (
    <div className="alert-panel-container">
      <span className="alert-action-badge" style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}><AlertTriangle size={14} /> Action Required</span>
      {alerts.reverseAuctionIn7DCount > 0 && (
        <div className="alert-pill ra" title="Active reverse auctions scheduled within the next 7 days">
          <span className="alert-dot" />
          <span>Reverse Auction in 7D: </span>
          <span className="alert-pill-val">{String(alerts.reverseAuctionIn7DCount).padStart(2, "0")} Cases</span>
        </div>
      )}
      {alerts.emdExpiringIn15DCount > 0 && (
        <div className="alert-pill emd" title="Tender EMD deposits expiring within the next 15 days">
          <span className="alert-dot" />
          <span>EMD Expiring 15D: </span>
          <span className="alert-pill-val">{String(alerts.emdExpiringIn15DCount).padStart(2, "0")} Cases</span>
        </div>
      )}
      {alerts.bidValidityExpiredCount > 0 && (
        <div className="alert-pill expired" title="Tenders whose bid validity period has expired">
          <span className="alert-dot" />
          <span>Bid Validity Expired: </span>
          <span className="alert-pill-val">{String(alerts.bidValidityExpiredCount).padStart(2, "0")} Cases</span>
        </div>
      )}
      {alerts.underEvalGreater90DCount > 0 && (
        <div className="alert-pill overdue" title="Tenders under evaluation for more than 90 days">
          <span className="alert-dot" />
          <span>Under Eval &gt; 90D: </span>
          <span className="alert-pill-val">{String(alerts.underEvalGreater90DCount).padStart(2, "0")} Cases</span>
        </div>
      )}
      {alerts.loiReceivedPoPendingValueRs > 0 && (
        <div className="alert-pill loi-pending" title="Tenders won (LOI received) but final Purchase Order is pending">
          <span className="alert-dot" />
          <span>LOI Received (PO Pending): </span>
          <span className="alert-pill-val">{formatCurrencyCr(alerts.loiReceivedPoPendingValueRs)}</span>
        </div>
      )}
    </div>
  );
};
