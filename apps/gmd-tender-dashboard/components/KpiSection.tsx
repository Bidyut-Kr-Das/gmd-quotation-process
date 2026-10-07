"use client";
import React from "react";
import "./KpiSection.css";

export interface KpiSectionProps {
  totalSubmittedTenders: number;
  totalSubmittedValueRs: number;
  wonTendersCount: number;
  winPercentage: number;
  underEvaluationCount: number;
  loiReceivedMtdRs: number;
  reverseAuctionsCount: number;
  emdExposureRs: number;
  avgDiffPercentFromL1: number | null;
  avgDiffPercentFromL2: number | null;
}

export const KpiSection: React.FC<KpiSectionProps> = ({
  totalSubmittedTenders, totalSubmittedValueRs, wonTendersCount, winPercentage,
  underEvaluationCount, loiReceivedMtdRs, reverseAuctionsCount, emdExposureRs,
  avgDiffPercentFromL1, avgDiffPercentFromL2
}) => {
  const formatCount = (value: number): string => new Intl.NumberFormat("en-IN").format(value);
  const formatCurrency = (value: number): string => {
    const crores = value / 10000000;
    if (crores >= 0.1) return `\u20B9${crores.toFixed(1)}Cr`;
    const lakhs = value / 100000;
    if (lakhs >= 1) return `\u20B9${lakhs.toFixed(1)} Lakh`;
    return `\u20B9${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(value)}`;
  };
  const formatVariance = (value: number | null): string => {
    if (value === null) return "-";
    const percent = value * 100;
    const prefix = percent > 0 ? "+" : "";
    return `${prefix}${percent.toFixed(1)}%`;
  };

  return (
    <div className="kpi-grid-container">
      <div className="kpi-card theme-blue">
        <h3 className="kpi-title">Submitted Tenders</h3>
        <p className="kpi-value">{formatCount(totalSubmittedTenders)}</p>
        <div className="kpi-trend neutral">Primary Dataset</div>
      </div>
      <div className="kpi-card theme-blue">
        <h3 className="kpi-title">Submitted Value</h3>
        <p className="kpi-value">{formatCurrency(totalSubmittedValueRs)}</p>
        <div className="kpi-trend">Est. Project Budget</div>
      </div>
      <div className="kpi-card theme-green">
        <h3 className="kpi-title">Won Tenders</h3>
        <p className="kpi-value">{formatCount(wonTendersCount)}</p>
        <div className="kpi-trend positive">LOI / PO Issued</div>
      </div>
      <div className="kpi-card theme-green">
        <h3 className="kpi-title">Win % (Count)</h3>
        <p className="kpi-value">{winPercentage.toFixed(1)}%</p>
        <div className="kpi-trend positive">Tenders Won / Total</div>
      </div>
      <div className="kpi-card theme-blue">
        <h3 className="kpi-title">LOI Received (MTD)</h3>
        <p className="kpi-value">{formatCurrency(loiReceivedMtdRs)}</p>
        <div className="kpi-trend">Current Calendar Month</div>
      </div>
      <div className="kpi-card theme-orange">
        <h3 className="kpi-title">Under Eval</h3>
        <p className="kpi-value">{formatCount(underEvaluationCount)}</p>
        <div className="kpi-trend">Pending Client Decision</div>
      </div>
      <div className="kpi-card theme-purple">
        <h3 className="kpi-title">Reverse Auctions</h3>
        <p className="kpi-value">{formatCount(reverseAuctionsCount)}</p>
        <div className="kpi-trend">RA Applicable Cases</div>
      </div>
      <div className="kpi-card theme-red">
        <h3 className="kpi-title">EMD Exposure</h3>
        <p className="kpi-value">{formatCurrency(emdExposureRs)}</p>
        <div className="kpi-trend negative">Active / Locked Deposits</div>
      </div>
      <div className="kpi-card theme-gray">
        <h3 className="kpi-title">Avg. Diff L1 (%)</h3>
        <p className="kpi-value">{formatVariance(avgDiffPercentFromL1)}</p>
        <div className={`kpi-trend ${(avgDiffPercentFromL1 || 0) <= 0 ? "positive" : "negative"}`}>Variance from Lowest Bid</div>
      </div>
      <div className="kpi-card theme-gray">
        <h3 className="kpi-title">Avg. Diff L2 (%)</h3>
        <p className="kpi-value">{formatVariance(avgDiffPercentFromL2)}</p>
        <div className="kpi-trend">Variance from 2nd Bid</div>
      </div>
    </div>
  );
};
