import { EpcTenderRecord, CurrentStatus } from "@/types/tender";

function isRecordStatusActive(status: string): boolean {
  if (!status) return false;
  const lower = status.toLowerCase();
  if (
    lower.includes("awarded") || 
    lower.includes("won") || 
    lower.includes("po received") || 
    lower.includes("loi received") ||
    lower.includes("not in our favour") || 
    lower.includes("lost") || 
    lower.includes("rejected") ||
    lower.includes("not participated") ||
    lower.includes("cancelled") ||
    lower.includes("canceled") ||
    lower.includes("preparation") || 
    lower.includes("prep")
  ) {
    return false; // Inactive (Won, Lost, Cancelled, In Preparation)
  }
  return true; // Active (Submitted, Under Evaluation, RA Pending, etc.)
}

export interface DashboardMetrics {
  totalSubmittedTenders: number;
  totalSubmittedValueRs: number;
  wonTendersCount: number;
  winPercentage: number;
  loiReceivedMtdRs: number;
  reverseAuctionsCount: number;
  emdExposureRs: number;
  avgDiffPercentFromL1: number | null;
  avgDiffPercentFromL2: number | null;
}

export interface MonthlyTrendData {
  monthLabel: string; // E.g., "JAN", "FEB"
  monthIndex: number; // 0-11
  year: number;
  count: number;
  valueRs: number;
}

export interface StatusDistribution {
  won: number;
  lost: number;
  eval: number;
  prep: number;
}

export interface AlertsData {
  reverseAuctionIn7DCount: number;
  emdExpiringIn15DCount: number;
  bidValidityExpiredCount: number;
  underEvalGreater90DCount: number;
  loiReceivedPoPendingValueRs: number;
}

export class TenderCalculations {
  private rawRecords: EpcTenderRecord[];
  private today: Date;

  /**
   * @param records The list of raw EpcTenderRecords fetched from the sheet.
   * @param referenceDate Optional reference date representing "Today". Defaults to system current time.
   */
  constructor(records: EpcTenderRecord[], referenceDate?: Date) {
    this.rawRecords = records;
    this.today = referenceDate || new Date();
  }

  /**
   * Filters the raw records to only include the primary dataset:
   * - Tender Submitted Date exists
   * - Tender Submitted Date >= 01-Jan-2026
   * - Tender Submitted Date <= Today
   */
  public getPrimaryDataset(): EpcTenderRecord[] {
    return this.rawRecords;
  }

  /**
   * Calculates high-level KPI metrics for the primary dataset.
   */
  public calculateMetrics(dataset: EpcTenderRecord[]): DashboardMetrics {
    const totalSubmittedTenders = dataset.length;
    
    let totalSubmittedValueRs = 0;
    let wonTendersCount = 0;
    let loiReceivedMtdRs = 0;
    let reverseAuctionsCount = 0;
    let emdExposureRs = 0;

    let sumDiffL1 = 0;
    let countDiffL1 = 0;
    let sumDiffL2 = 0;
    let countDiffL2 = 0;

    const currentMonth = this.today.getMonth();
    const currentYear = this.today.getFullYear();

    for (const record of dataset) {
      // 1. Sum Submitted Value
      if (record.estimatedCostRs !== null) {
        totalSubmittedValueRs += record.estimatedCostRs;
      }

      // 2. Count Won Tenders
      const isWon = record.currentStatus === CurrentStatus.WON;
      if (isWon) {
        wonTendersCount++;
        
        // 3. Sum LOI Received MTD (Won tenders with deadline in the current month & year)
        if (record.lastDateOfSubmission) {
          const deadlineDate = new Date(record.lastDateOfSubmission);
          if (deadlineDate.getMonth() === currentMonth && deadlineDate.getFullYear() === currentYear) {
            if (record.estimatedCostRs !== null) {
              loiReceivedMtdRs += record.estimatedCostRs;
            }
          }
        }
      }

      // 4. Count Reverse Auctions
      if (record.reverseAuctionApplicable) {
        reverseAuctionsCount++;
      }

      // 5. Calculate EMD Exposure (Sum EMD for active/pending statuses)
      const isActiveStatus = isRecordStatusActive(record.currentStatus);

      if (isActiveStatus && record.emdAmountRs !== null) {
        emdExposureRs += record.emdAmountRs;
      }

      // 6. Accumulate L1 / L2 differences
      if (record.diffPercentFromL1 !== null) {
        sumDiffL1 += record.diffPercentFromL1;
        countDiffL1++;
      }
      if (record.diffPercentFromL2 !== null) {
        sumDiffL2 += record.diffPercentFromL2;
        countDiffL2++;
      }
    }

    // Win Percentage
    const winPercentage = totalSubmittedTenders > 0 
      ? (wonTendersCount / totalSubmittedTenders) * 100 
      : 0;

    // Averages
    const avgDiffPercentFromL1 = countDiffL1 > 0 ? sumDiffL1 / countDiffL1 : null;
    const avgDiffPercentFromL2 = countDiffL2 > 0 ? sumDiffL2 / countDiffL2 : null;

    return {
      totalSubmittedTenders,
      totalSubmittedValueRs,
      wonTendersCount,
      winPercentage,
      loiReceivedMtdRs,
      reverseAuctionsCount,
      emdExposureRs,
      avgDiffPercentFromL1,
      avgDiffPercentFromL2
    };
  }

  /**
   * Generates the monthly trend dataset from January 2026 to the current month.
   */
  public generateMonthlyTrend(dataset: EpcTenderRecord[]): { trend: MonthlyTrendData[]; averageCountPerMonth: number } {
    const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
    const trend: MonthlyTrendData[] = [];
    
    const startYear = 2026;
    const currentYear = this.today.getFullYear();
    const currentMonth = this.today.getMonth();

    // Generate monthly slots from Jan 2026 to current month/year
    for (let year = startYear; year <= currentYear; year++) {
      const endMonth = year === currentYear ? currentMonth : 11;
      for (let month = 0; month <= endMonth; month++) {
        trend.push({
          monthLabel: months[month],
          monthIndex: month,
          year,
          count: 0,
          valueRs: 0
        });
      }
    }

    // Populate counts and values
    for (const record of dataset) {
      if (!record.lastDateOfSubmission) continue;
      const deadlineDate = new Date(record.lastDateOfSubmission);
      const subMonth = deadlineDate.getMonth();
      const subYear = deadlineDate.getFullYear();

      const slot = trend.find(t => t.monthIndex === subMonth && t.year === subYear);
      if (slot) {
        slot.count++;
        if (record.estimatedCostRs !== null) {
          slot.valueRs += record.estimatedCostRs;
        }
      }
    }

    // Calculate monthly average count
    const totalMonths = trend.length;
    const totalCount = trend.reduce((sum, t) => sum + t.count, 0);
    const averageCountPerMonth = totalMonths > 0 ? Math.round(totalCount / totalMonths) : 0;

    return {
      trend,
      averageCountPerMonth
    };
  }

  /**
   * Generates the status distribution dataset for the donut chart.
   * Statuses are grouped as:
   * - won: WON
   * - lost: LOST | CANCELLED
   * - eval: SUBMITTED | UNDER_EVALUATION | RA_PENDING
   * - prep: IN_PREPARATION
   */
  public generateStatusDistribution(dataset: EpcTenderRecord[]): StatusDistribution {
    let won = 0;
    let lost = 0;
    let evaluation = 0;
    let prep = 0;

    for (const record of dataset) {
      switch (record.currentStatus) {
        case CurrentStatus.WON:
          won++;
          break;
        case CurrentStatus.LOST:
        case CurrentStatus.CANCELLED:
          lost++;
          break;
        case CurrentStatus.SUBMITTED:
        case CurrentStatus.UNDER_EVALUATION:
        case CurrentStatus.RA_PENDING:
          evaluation++;
          break;
        case CurrentStatus.IN_PREPARATION:
          prep++;
          break;
      }
    }

    return {
      won,
      lost,
      eval: evaluation,
      prep
    };
  }

  /**
   * Generates critical action alerts based on deadlines, validities, and statuses.
   */
  public generateAlerts(dataset: EpcTenderRecord[]): AlertsData {
    let reverseAuctionIn7DCount = 0;
    let emdExpiringIn15DCount = 0;
    let bidValidityExpiredCount = 0;
    let underEvalGreater90DCount = 0;
    let loiReceivedPoPendingValueRs = 0;

    const MS_IN_DAY = 24 * 60 * 60 * 1000;
    const todayMs = this.today.getTime();

    // Alert thresholds
    const sevenDaysLaterMs = todayMs + 7 * MS_IN_DAY;
    const fifteenDaysLaterMs = todayMs + 15 * MS_IN_DAY;
    const ninetyDaysAgoMs = todayMs - 90 * MS_IN_DAY;

    for (const record of dataset) {
      // 1. Reverse Auction in 7 Days
      if (record.reverseAuctionApplicable && record.reverseAuctionDate) {
        const raMs = new Date(record.reverseAuctionDate).getTime();
        // Event is in the future and within 7 days
        if (raMs >= todayMs && raMs <= sevenDaysLaterMs) {
          reverseAuctionIn7DCount++;
        }
      }

      // 2. EMD Expiring in 15 Days
      if (record.emdValidity) {
        const emdMs = new Date(record.emdValidity).getTime();
        // Expiration is in the future and within 15 days
        if (emdMs >= todayMs && emdMs <= fifteenDaysLaterMs) {
          emdExpiringIn15DCount++;
        }
      }

      // 3. Bid Validity Expired
      if (record.bidValidityExpired) {
        bidValidityExpiredCount++;
      }

      // 4. Under Evaluation > 90 Days (Status is active, but submitted > 90 days ago)
      const isActiveStatus = isRecordStatusActive(record.currentStatus);

      if (isActiveStatus && record.lastDateOfSubmission) {
        const deadlineMs = new Date(record.lastDateOfSubmission).getTime();
        if (deadlineMs < ninetyDaysAgoMs) {
          underEvalGreater90DCount++;
        }
      }

      // 5. LOI Received (PO Pending)
      // Status is WON (LOI Received) but PO Number/Date is not yet issued (is null/empty or does not contain "PO")
      const lowerStatus = record.currentStatus.toLowerCase();
      const isWon = lowerStatus.includes("awarded") || lowerStatus.includes("won");
      const isPoPending = !record.loiPoNoAndDate || 
        record.loiPoNoAndDate.trim() === "" || 
        record.loiPoNoAndDate.trim() === "-" ||
        !record.loiPoNoAndDate.toUpperCase().includes("PO");

      if (isWon && isPoPending && record.estimatedCostRs !== null) {
        loiReceivedPoPendingValueRs += record.estimatedCostRs;
      }
    }

    return {
      reverseAuctionIn7DCount,
      emdExpiringIn15DCount,
      bidValidityExpiredCount,
      underEvalGreater90DCount,
      loiReceivedPoPendingValueRs
    };
  }
}
