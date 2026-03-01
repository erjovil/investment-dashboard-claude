// This is your Investment Dashboard!
// It's the same one you've been building, just modified to work outside Claude

/**
 * ✅ LIVE API VERSION ✅
 * 
 * This version uses real-time data from Financial Modeling Prep API
 * 
 * Features:
 * - Real-time stock data for any ticker
 * - Live financial statements
 * - Current market prices
 * - Up-to-date company information
 */

import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Upload, TrendingUp, DollarSign, Percent, Calendar, Search, BarChart3, Calculator, PieChart, Info, AlertCircle, Edit } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Area, AreaChart, BarChart, Bar } from 'recharts';
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';

// ==================== QUALITY SCORES & METRICS ====================

/**
 * Calculate Piotroski F-Score (0-9)
 */
function calculatePiotroskiF(financials) {
  if (!financials || !financials.balance || !financials.income || !financials.cashFlow) {
    return null;
  }
  
  let score = 0;
  const current = financials.income[0];
  const prior = financials.income[1];
  const currentBS = financials.balance[0];
  const priorBS = financials.balance[1];
  const currentCF = financials.cashFlow[0];
  
  if (!current || !prior || !currentBS || !priorBS || !currentCF) return null;
  
  // PROFITABILITY (4 points)
  if (current.netIncome > 0) score++;
  if (currentCF.operatingCashFlow > 0) score++;
  if (currentCF.operatingCashFlow > current.netIncome) score++;
  
  const currentROA = current.netIncome / currentBS.totalAssets;
  const priorROA = prior.netIncome / priorBS.totalAssets;
  if (currentROA > priorROA) score++;
  
  // LEVERAGE/LIQUIDITY (3 points)
  if (currentBS.totalDebt < priorBS.totalDebt) score++;
  
  const currentRatio = currentBS.totalCurrentAssets / currentBS.totalCurrentLiabilities;
  const priorCurrentRatio = priorBS.totalCurrentAssets / priorBS.totalCurrentLiabilities;
  if (currentRatio > priorCurrentRatio) score++;
  if (currentBS.commonStock <= priorBS.commonStock) score++;
  
  // OPERATING EFFICIENCY (2 points)
  const currentGM = current.grossProfit / current.revenue;
  const priorGM = prior.grossProfit / prior.revenue;
  if (currentGM > priorGM) score++;
  
  const currentAT = current.revenue / currentBS.totalAssets;
  const priorAT = prior.revenue / priorBS.totalAssets;
  if (currentAT > priorAT) score++;
  
  return score;
}

/**
 * Calculate Altman Z-Score
 */
function calculateAltmanZ(financials) {
  if (!financials?.balance?.[0] || !financials?.income?.[0]) return null;
  
  const bs = financials.balance[0];
  const inc = financials.income[0];
  
  const workingCapital = bs.totalCurrentAssets - bs.totalCurrentLiabilities;
  const totalAssets = bs.totalAssets;
  const retainedEarnings = bs.retainedEarnings || 0;
  const ebit = inc.ebitda || inc.operatingIncome || 0;
  const marketCap = bs.totalStockholdersEquity * 1.5;
  const totalLiabilities = bs.totalLiabilities;
  const sales = inc.revenue;
  
  const A = workingCapital / totalAssets;
  const B = retainedEarnings / totalAssets;
  const C = ebit / totalAssets;
  const D = marketCap / totalLiabilities;
  const E = sales / totalAssets;
  
  return 1.2 * A + 1.4 * B + 3.3 * C + 0.6 * D + 1.0 * E;
}

/**
 * Calculate Beneish M-Score (simplified)
 */
function calculateBeneishM(financials) {
  if (!financials?.balance || !financials?.income || 
      financials.balance.length < 2 || financials.income.length < 2) {
    return null;
  }
  
  const current = financials.income[0];
  const prior = financials.income[1];
  const currentBS = financials.balance[0];
  const priorBS = financials.balance[1];
  
  if (!current || !prior || !currentBS || !priorBS) return null;
  
  const currentDSR = (currentBS.accountReceivables || 0) / current.revenue;
  const priorDSR = (priorBS.accountReceivables || 0) / prior.revenue;
  const DSRI = priorDSR > 0 ? currentDSR / priorDSR : 1;
  
  const currentGM = current.grossProfit / current.revenue;
  const priorGM = prior.grossProfit / prior.revenue;
  const GMI = currentGM > 0 ? priorGM / currentGM : 1;
  
  const currentAQ = 1 - (currentBS.totalCurrentAssets + (currentBS.propertyPlantEquipmentNet || 0)) / currentBS.totalAssets;
  const priorAQ = 1 - (priorBS.totalCurrentAssets + (priorBS.propertyPlantEquipmentNet || 0)) / priorBS.totalAssets;
  const AQI = priorAQ > 0 ? currentAQ / priorAQ : 1;
  
  const SGI = prior.revenue > 0 ? current.revenue / prior.revenue : 1;
  
  const currentAccruals = current.netIncome - (financials.cashFlow[0]?.operatingCashFlow || 0);
  const TATA = currentBS.totalAssets > 0 ? currentAccruals / currentBS.totalAssets : 0;
  
  return -4.84 + 0.92*DSRI + 0.528*GMI + 0.404*AQI + 0.892*SGI + 4.679*TATA;
}

/**
 * Calculate CQVS (Composite Quality Value Score) 0-100
 */
function calculateCQVS(piotroskiF, altmanZ, beneishM, financials) {
  let score = 0;
  let weights = 0;
  
  if (piotroskiF !== null) {
    score += (piotroskiF / 9) * 100 * 0.4;
    weights += 0.4;
  }
  
  if (altmanZ !== null) {
    const altmanNormalized = Math.min(100, Math.max(0, (altmanZ / 5) * 100));
    score += altmanNormalized * 0.3;
    weights += 0.3;
  }
  
  if (beneishM !== null) {
    const beneishNormalized = Math.min(100, Math.max(0, (-beneishM - 1.78) * 25));
    score += beneishNormalized * 0.2;
    weights += 0.2;
  }
  
  if (financials?.income?.[0] && financials?.balance?.[0]) {
    const inc = financials.income[0];
    const bs = financials.balance[0];
    const roe = bs.totalStockholdersEquity > 0 ? inc.netIncome / bs.totalStockholdersEquity : 0;
    const profitMargin = inc.revenue > 0 ? inc.netIncome / inc.revenue : 0;
    const profitScore = Math.min(100, (roe * 100 * 0.5) + (profitMargin * 100 * 0.5));
    score += profitScore * 0.1;
    weights += 0.1;
  }
  
  return weights > 0 ? score / weights : 0;
}

function getCQVSLabel(cqvs) {
  if (cqvs >= 90) return 'Elite';
  if (cqvs >= 75) return 'Strong';
  if (cqvs >= 60) return 'Good';
  if (cqvs >= 40) return 'Moderate';
  return 'Weak';
}

/**
 * Metric explanations for info bubbles
 */
const METRIC_EXPLANATIONS = {
  piotroskiF: {
    title: "Piotroski F-Score",
    description: "Measures financial strength on a 0-9 scale across profitability, leverage, and efficiency.",
    interpretation: "8-9: Strong fundamentals | 5-7: Moderate | 0-4: Weak"
  },
  altmanZ: {
    title: "Altman Z-Score",
    description: "Predicts bankruptcy risk. Higher is safer.",
    interpretation: ">2.99: Safe | 1.81-2.99: Grey zone | <1.81: Distress"
  },
  beneishM: {
    title: "Beneish M-Score",
    description: "Detects earnings manipulation. Lower is better (less likely to manipulate).",
    interpretation: ">-1.78: Likely manipulator | <-1.78: Unlikely manipulator"
  },
  cqvs: {
    title: "Composite Quality Value Score (CQVS)",
    description: "Our proprietary composite score combining Piotroski, Altman, and Beneish metrics.",
    interpretation: "90-100: Elite | 75-89: Strong | 60-74: Good | 40-59: Moderate | 0-39: Weak"
  },
  roe: {
    title: "Return on Equity (ROE)",
    description: "How much profit generated per dollar of shareholder equity. Warren Buffett's favorite.",
    interpretation: ">20%: Excellent | 15-20%: Good | <10%: Poor"
  },
  roa: {
    title: "Return on Assets (ROA)",
    description: "How efficiently assets generate profit.",
    interpretation: ">10%: Excellent | 5-10%: Good | <5%: Poor"
  },
  debtToEquity: {
    title: "Debt-to-Equity Ratio",
    description: "Measures financial leverage - how much debt vs shareholder equity.",
    interpretation: "<0.5: Conservative | 0.5-1.5: Moderate | >1.5: High leverage"
  },
  currentRatio: {
    title: "Current Ratio",
    description: "Can the company pay short-term debts? Current assets vs current liabilities.",
    interpretation: ">2: Very liquid | 1-2: Adequate | <1: Liquidity risk"
  },
  profitMargin: {
    title: "Net Profit Margin",
    description: "What % of revenue becomes profit. Higher is better.",
    interpretation: ">20%: Excellent | 10-20%: Good | <5%: Poor"
  },
  operatingMargin: {
    title: "Operating Margin",
    description: "Profit margin before interest and taxes. Measures operational efficiency.",
    interpretation: ">20%: Excellent | 10-20%: Good | <5%: Poor"
  }
};

/**
 * InfoBubble Component
 */
const InfoBubble = ({ metricKey }) => {
  const [isOpen, setIsOpen] = useState(false);
  const info = METRIC_EXPLANATIONS[metricKey];
  
  if (!info) return null;
  
  return (
    <div style={{ position: 'relative', display: 'inline-block', marginLeft: '6px' }}>
      <Info 
        size={16} 
        style={{ 
          cursor: 'pointer', 
          color: '#3b82f6',
          opacity: 0.7
        }}
        onMouseEnter={() => setIsOpen(true)}
        onMouseLeave={() => setIsOpen(false)}
      />
      
      {isOpen && (
        <div style={{
          position: 'absolute',
          zIndex: 1000,
          top: '20px',
          left: '-150px',
          width: '320px',
          backgroundColor: '#1e293b',
          color: 'white',
          padding: '12px',
          borderRadius: '8px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          fontSize: '13px',
          lineHeight: '1.5'
        }}>
          <div style={{ fontWeight: '600', marginBottom: '6px', fontSize: '14px' }}>
            {info.title}
          </div>
          
          <div style={{ marginBottom: '8px', opacity: 0.9 }}>
            {info.description}
          </div>
          
          <div style={{ 
            backgroundColor: 'rgba(59, 130, 246, 0.2)', 
            padding: '6px 8px', 
            borderRadius: '4px',
            fontSize: '12px'
          }}>
            <strong>How to read:</strong> {info.interpretation}
          </div>
        </div>
      )}
    </div>
  );
};

// ==================== CONSTANTS ====================
// Backend API URL - change this when you deploy!
const BACKEND_API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001';

// ==================== DISCLAIMER COMPONENTS ====================

const FooterDisclaimer = () => (
  <div style={{
    backgroundColor: '#2C3E50',
    color: '#ECF0F1',
    padding: '12px 20px',
    fontSize: '12px',
    textAlign: 'center',
    borderTop: '3px solid #E74C3C',
    marginTop: '2rem'
  }}>
    <strong>⚠️ NOT FINANCIAL ADVICE</strong> - This tool provides AI-generated educational content only. 
    AI can make mistakes. Always verify information and consult a qualified financial advisor before making investment decisions.
  </div>
);

const AIAnalysisDisclaimer = () => (
  <div style={{
    backgroundColor: '#E8F4FD',
    border: '1px solid #90CAF9',
    borderRadius: '6px',
    padding: '12px 16px',
    marginBottom: '16px',
    fontSize: '13px'
  }}>
    <div style={{ display: 'flex', gap: '10px', alignItems: 'start' }}>
      <span style={{ fontSize: '18px' }}>🤖</span>
      <div>
        <strong>AI-Generated Analysis</strong>
        <p style={{ margin: '4px 0 0 0' }}>
          This analysis is generated by AI based on the market outlook you uploaded. While we strive for accuracy, 
          AI can misinterpret data or make errors.
        </p>
        <p style={{ margin: '8px 0 0 0', fontSize: '12px', fontWeight: '600', color: '#1565C0' }}>
          ⚠️ Page citations may not be 100% accurate. Always verify recommendations by reading the full PDF yourself 
          before making investment decisions. Consult a financial advisor for personalized advice.
        </p>
      </div>
    </div>
  </div>
);

const MainDisclaimer = () => (
  <div style={{
    backgroundColor: '#FFF3CD',
    border: '2px solid #FFE69C',
    borderRadius: '8px',
    padding: '16px',
    margin: '20px 0',
    fontSize: '14px',
    lineHeight: '1.6'
  }}>
    <div style={{ display: 'flex', alignItems: 'start', gap: '12px' }}>
      <span style={{ fontSize: '24px', flexShrink: 0 }}>⚠️</span>
      <div>
        <h3 style={{ margin: '0 0 8px 0', fontSize: '16px', fontWeight: '600' }}>
          IMPORTANT DISCLAIMER
        </h3>
        <p style={{ margin: '0 0 8px 0' }}>
          This tool provides AI-generated analysis for <strong>informational and educational purposes only</strong>. 
          It is <strong>NOT financial advice</strong>, investment recommendations, or a substitute for professional financial planning.
        </p>
        <ul style={{ margin: '8px 0', paddingLeft: '20px', fontSize: '13px' }}>
          <li><strong>AI can make mistakes</strong> - Always verify information independently</li>
          <li>Past performance does not guarantee future results</li>
          <li>All investments involve risk, including potential loss of principal</li>
          <li>Consult a qualified financial advisor before making investment decisions</li>
          <li>This tool does not consider your personal financial situation, goals, or risk tolerance</li>
        </ul>
        <p style={{ margin: '8px 0 0 0', fontSize: '12px', fontStyle: 'italic' }}>
          By using this tool, you acknowledge that you understand these limitations and will not rely solely 
          on AI-generated recommendations for investment decisions.
        </p>
      </div>
    </div>
  </div>
);

const UploadHelpText = ({ type = 'pdf' }) => {
  const config = {
    pdf: {
      icon: '📎',
      title: 'Upload Market Outlook PDF',
      maxSize: '15MB',
      format: 'PDF',
      examples: 'JPMorgan LTCMA, Goldman Sachs Outlook, Morgan Stanley Year Ahead, etc.'
    },
    csv: {
      icon: '📊',
      title: 'Upload Portfolio File',
      maxSize: '5MB',
      format: 'CSV, XLS, or XLSX',
      examples: 'Required columns: Ticker, Value (or Shares + Price)'
    }
  };

  const { icon, title, maxSize, format, examples } = config[type];

  return (
    <div style={{
      fontSize: '13px',
      color: '#666',
      marginTop: '8px',
      padding: '8px',
      backgroundColor: '#F8F9FA',
      borderRadius: '4px'
    }}>
      <div style={{ fontWeight: '500', marginBottom: '4px' }}>
        {icon} {title}
      </div>
      <div style={{ fontSize: '12px' }}>
        • Maximum file size: <strong>{maxSize}</strong><br />
        • Supported format: <strong>{format}</strong><br />
        • {examples}
      </div>
    </div>
  );
};

const ErrorMessage = ({ type, customMessage }) => {
  const errors = {
    FILE_TOO_LARGE: {
      icon: '❌',
      title: 'File Too Large',
      message: 'Your PDF exceeds the 15MB size limit.',
      solutions: [
        'Compress your PDF using a free tool like smallpdf.com',
        'Upload a different, smaller outlook document',
        'Contact support if this is a critical document'
      ]
    },
    WRONG_FILE_TYPE_PDF: {
      icon: '❌',
      title: 'Unsupported File Type',
      message: 'Please upload a PDF file for market outlook analysis.',
      solutions: [
        'Supported format: PDF only',
        'Common sources: JPMorgan LTCMA, Goldman Sachs Outlook, Morgan Stanley Year Ahead'
      ]
    },
    WRONG_FILE_TYPE_CSV: {
      icon: '❌',
      title: 'Unsupported File Type',
      message: 'Please upload a supported spreadsheet file for portfolio analysis.',
      solutions: [
        'Supported formats: CSV, XLS, XLSX',
        'Excel: Save directly as .xlsx or .xls, or File → Save As → CSV',
        'Google Sheets: File → Download → Microsoft Excel (.xlsx) or CSV'
      ]
    },
    PDF_PARSE_ERROR: {
      icon: '❌',
      title: 'Unable to Read PDF',
      message: 'This PDF cannot be analyzed.',
      solutions: [
        'The file may be password-protected, corrupted, or in an unsupported format',
        'Try downloading the PDF again from the source',
        'Upload a different outlook document'
      ]
    },
    RATE_LIMIT: {
      icon: '⏳',
      title: 'Too Many Requests',
      message: "You've made several requests in quick succession.",
      solutions: [
        'Please wait 5 minutes and try again',
        'This limit ensures fair access for all users'
      ]
    },
    API_ERROR: {
      icon: '🔧',
      title: 'Service Temporarily Unavailable',
      message: 'Our AI analysis service is experiencing issues.',
      solutions: [
        'This is usually temporary - please wait a few minutes',
        'Try again in 5-10 minutes',
        'Your data is safe - nothing has been lost'
      ]
    },
    NETWORK_ERROR: {
      icon: '🌐',
      title: 'Connection Error',
      message: 'Unable to connect to our servers.',
      solutions: [
        'Check your internet connection',
        'Try refreshing the page',
        'If problem persists, contact support'
      ]
    }
  };

  const error = errors[type] || {
    icon: '⚠️',
    title: 'Error',
    message: customMessage || 'An unexpected error occurred.',
    solutions: ['Please try again or contact support if the issue persists.']
  };

  return (
    <div style={{
      backgroundColor: '#F8D7DA',
      border: '1px solid #F5C6CB',
      borderRadius: '8px',
      padding: '16px',
      margin: '16px 0'
    }}>
      <div style={{ display: 'flex', gap: '12px', alignItems: 'start' }}>
        <span style={{ fontSize: '24px' }}>{error.icon}</span>
        <div style={{ flex: 1 }}>
          <h4 style={{ margin: '0 0 8px 0', color: '#721C24' }}>{error.title}</h4>
          <p style={{ margin: '0 0 12px 0', color: '#721C24' }}>{error.message}</p>
          {error.solutions && (
            <div style={{ fontSize: '14px', color: '#721C24' }}>
              <strong>Solutions:</strong>
              <ul style={{ margin: '4px 0 0 0', paddingLeft: '20px' }}>
                {error.solutions.map((solution, i) => (
                  <li key={i} style={{ marginBottom: '4px' }}>{solution}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ==================== END DISCLAIMER COMPONENTS ====================


// Long-Term Capital Market Assumptions (JPM 2026)
// ==================== HELPER FUNCTIONS ====================
const formatAssetClassName = (name) => {
  return name.replace(/_/g, ' ');
};

const formatAssetClassForDisplay = (name) => {
  return name.replace(/_/g, ' ').toUpperCase();
};

// ==================== LTCMA DATA ====================
const LTCMA = {
  // CASH
  'CASH': { return: 2.70, volatility: 0.70 },
  'UK_CASH': { return: 2.70, volatility: 0.70 },
  
  // GOVERNMENT BONDS
  'US_AGGREGATE_BONDS': { return: 4.50, volatility: 4.61 },
  'EURO_AGGREGATE_BONDS': { return: 4.00, volatility: 4.10 },
  'US_INV_GRADE_CORPORATE_BONDS': { return: 4.90, volatility: 5.16 },
  'EURO_INV_GRADE_CORPORATE_BONDS': { return: 4.50, volatility: 4.61 },
  'UK_INV_GRADE_CORPORATE_BONDS': { return: 5.30, volatility: 6.52 },
  'US_HIGH_YIELD_BONDS': { return: 5.80, volatility: 9.17 },
  'EURO_HIGH_YIELD_BONDS': { return: 5.80, volatility: 6.19 },
  'GLOBAL_CREDIT': { return: 4.70, volatility: 4.85 },
  'US_LEVERAGED_LOANS': { return: 6.30, volatility: 6.58 },
  'EURO_GOVERNMENT_BONDS': { return: 3.90, volatility: 4.04 },
  'UK_GILTS': { return: 4.70, volatility: 9.69 },
  'UK_INFLATION_LINKED_BONDS': { return: 5.50, volatility: 6.12 },
  'WORLD_GOVERNMENT_BONDS': { return: 4.00, volatility: 4.04 },
  'WORLD_GOVERNMENT_BONDS_UNHEDGED': { return: 3.70, volatility: 10.34 },
  'WORLD_EX_UK_GOVERNMENT_BONDS': { return: 3.90, volatility: 3.97 },
  'WORLD_EX_UK_GOVERNMENT_BONDS_UNHEDGED': { return: 3.60, volatility: 9.06 },
  'EMERGING_MARKETS_SOVEREIGN_DEBT': { return: 6.00, volatility: 6.38 },
  'EMERGING_MARKETS_LOCAL_CURRENCY_DEBT': { return: 6.10, volatility: 6.61 },
  'EMERGING_MARKETS_CORPORATE_BONDS': { return: 5.80, volatility: 6.08 },
  
  // UK EQUITY
  'UK_ALL_CAP': { return: 6.00, volatility: 16.81 },
  'UK_LARGE_CAP': { return: 6.00, volatility: 16.81 },
  'UK_SMALL_CAP': { return: 6.50, volatility: 7.86 },
  
  // US EQUITY
  'US_LARGE_CAP': { return: 6.10, volatility: 7.07 },
  'US_SMALL_CAP': { return: 6.40, volatility: 7.44 },
  
  // EUROPEAN EQUITY
  'EURO_AREA_LARGE_CAP': { return: 7.20, volatility: 8.65 },
  'EURO_AREA_LARGE_CAP_HEDGED': { return: 7.70, volatility: 9.02 },
  'EURO_AREA_SMALL_CAP': { return: 7.80, volatility: 9.43 },
  'EURO_AREA_SMALL_CAP_HEDGED': { return: 8.20, volatility: 9.67 },
  
  // JAPANESE EQUITY
  'JAPANESE_EQUITY': { return: 8.20, volatility: 9.69 },
  'JAPANESE_EQUITY_HEDGED': { return: 8.40, volatility: 9.72 },
  
  // ASIAN EQUITY
  'AC_ASIA_EX_JAPAN_EQUITY': { return: 7.30, volatility: 8.72 },
  'CHINESE_DOMESTIC_EQUITY': { return: 7.10, volatility: 10.33 },
  
  // EMERGING MARKETS
  'EMERGING_MARKETS_EQUITY': { return: 7.20, volatility: 8.61 },
  'AC_WORLD_EQUITY': { return: 6.40, volatility: 7.27 },
  'AC_WORLD_EX_UK_EQUITY': { return: 6.40, volatility: 7.30 },
  'DEVELOPED_WORLD_EQUITY': { return: 6.30, volatility: 7.19 },
  
  // GLOBAL BONDS
  'GLOBAL_CONVERTIBLE_BONDS': { return: 5.30, volatility: 4.89 },
  'GLOBAL_CREDIT_SENSITIVE_CONVERTIBLE': { return: 4.60, volatility: 4.90 },
  
  // REAL ESTATE
  'US_CORE_REAL_ESTATE': { return: 7.60, volatility: 8.17 },
  'EUROPEAN_CORE_REAL_ESTATE': { return: 6.30, volatility: 9.00 },
  'EUROPEAN_CORE_REAL_ESTATE_HEDGED': { return: 6.80, volatility: 7.34 },
  'UK_CORE_REAL_ESTATE': { return: 7.80, volatility: 8.59 },
  'EUROPEAN_VALUE_ADDED_REAL_ESTATE': { return: 8.40, volatility: 8.58 },
  'EUROPEAN_VALUE_ADDED_REAL_ESTATE_HEDGED': { return: 8.90, volatility: 10.28 },
  'GLOBAL_REIT': { return: 8.10, volatility: 8.06 },
  
  // INFRASTRUCTURE
  'GLOBAL_CORE_INFRASTRUCTURE': { return: 5.90, volatility: 6.35 },
  'GLOBAL_CORE_TRANSPORT': { return: 7.30, volatility: 8.08 },
  'GLOBAL_TIMBERLAND': { return: 5.70, volatility: 9.49 },
  
  // COMMODITIES
  'COMMODITIES': { return: 4.00, volatility: 5.29 },
  'GOLD': { return: 4.90, volatility: 6.21 },
  
  // ALTERNATIVE INVESTMENTS
  'PRIVATE_EQUITY': { return: 9.60, volatility: 10.20 },
  'VENTURE_CAPITAL': { return: 7.90, volatility: 9.69 },
  'DIVERSIFIED_HEDGE_FUNDS': { return: 5.00, volatility: 5.16 },
  'EVENT_DRIVEN_HEDGE_FUNDS': { return: 4.90, volatility: 5.20 },
  'LONG_BIAS_HEDGE_FUNDS': { return: 5.20, volatility: 5.77 },
  'RELATIVE_VALUE_HEDGE_FUNDS': { return: 5.40, volatility: 5.63 },
  'MACRO_HEDGE_FUNDS': { return: 3.80, volatility: 4.03 },
  'DIRECT_LENDING': { return: 7.10, volatility: 8.21 },
  
  // INFLATION
  'UK_INFLATION': { return: 2.20, volatility: 2.22 },
  
  // FALLBACK
  'UNKNOWN': { return: 7.00, volatility: 15.00 },
};

// Asset class detection
const ASSET_CLASS_PATTERNS = {
  // CASH
  'CASH': ['VMFXX', 'SPAXX', 'MONEY MARKET', 'CASH', 'SWEEP', 'FDRXX'],
  'UK_CASH': ['UK CASH', 'GBP CASH', 'STERLING CASH'],
  
  // US BONDS
  'US_AGGREGATE_BONDS': ['AGG', 'BND', 'SCHZ', 'BOND', 'FIXED', 'AGGREGATE'],
  'US_INV_GRADE_CORPORATE_BONDS': ['LQD', 'VCIT', 'VCLT', 'CORPORATE', 'INVESTMENT GRADE'],
  'US_HIGH_YIELD_BONDS': ['HYG', 'JNK', 'USHY', 'HIGH YIELD', 'JUNK'],
  'US_LEVERAGED_LOANS': ['BKLN', 'SRLN', 'LEVERAGED', 'SENIOR LOAN'],
  
  // EURO BONDS
  'EURO_AGGREGATE_BONDS': ['EURO AGGREGATE', 'EUR BOND', 'EUROPEAN BOND'],
  'EURO_INV_GRADE_CORPORATE_BONDS': ['EURO CORPORATE', 'EUR IG'],
  'EURO_HIGH_YIELD_BONDS': ['EURO HIGH YIELD', 'EUR HY'],
  'EURO_GOVERNMENT_BONDS': ['EURO GOVT', 'EUROPEAN GOVERNMENT'],
  
  // UK BONDS
  'UK_INV_GRADE_CORPORATE_BONDS': ['UK CORPORATE', 'GILT CORPORATE'],
  'UK_GILTS': ['GILT', 'UK GOVERNMENT'],
  'UK_INFLATION_LINKED_BONDS': ['UK LINKER', 'INDEX LINKED', 'UK TIPS', 'IL GILT'],
  
  // GLOBAL BONDS
  'GLOBAL_CREDIT': ['GLOBAL CREDIT', 'WORLD CREDIT'],
  'WORLD_GOVERNMENT_BONDS': ['WORLD GOVT', 'GLOBAL GOVERNMENT'],
  'WORLD_GOVERNMENT_BONDS_UNHEDGED': ['WORLD GOVT UNHEDGED'],
  'WORLD_EX_UK_GOVERNMENT_BONDS': ['WORLD EX UK GOVT'],
  'WORLD_EX_UK_GOVERNMENT_BONDS_UNHEDGED': ['WORLD EX UK GOVT UNHEDGED'],
  'GLOBAL_CONVERTIBLE_BONDS': ['CONVERTIBLE', 'CWB'],
  'GLOBAL_CREDIT_SENSITIVE_CONVERTIBLE': ['CREDIT SENSITIVE CONVERTIBLE'],
  
  // EMERGING MARKET BONDS
  'EMERGING_MARKETS_SOVEREIGN_DEBT': ['EMB', 'PCY', 'EMERGING DEBT', 'EM SOVEREIGN'],
  'EMERGING_MARKETS_LOCAL_CURRENCY_DEBT': ['EMLC', 'EM LOCAL'],
  'EMERGING_MARKETS_CORPORATE_BONDS': ['EMCB', 'EM CORPORATE'],
  
  // US EQUITY
  'US_LARGE_CAP': ['VOO', 'SPY', 'IVV', 'VTI', 'SCHB', 'ITOT', 'FXAIX', 'VFIAX', 'S&P', '500', 'US LARGE CAP', 'SPX'],
  'US_SMALL_CAP': ['IWM', 'VB', 'VTWO', 'IJR', 'SCHA', 'SMALL', 'MICRO', 'RUSSELL 2000', 'US SMALL CAP', 'OBMCX'],
  
  // UK EQUITY
  'UK_ALL_CAP': ['UK ALL CAP', 'FTSE ALL'],
  'UK_LARGE_CAP': ['UK LARGE', 'FTSE 100', 'UKX'],
  'UK_SMALL_CAP': ['UK SMALL', 'FTSE 250'],
  
  // EUROPEAN EQUITY
  'EURO_AREA_LARGE_CAP': ['EURO LARGE', 'EURO STOXX', 'EUROPEAN LARGE'],
  'EURO_AREA_LARGE_CAP_HEDGED': ['EURO LARGE HEDGED'],
  'EURO_AREA_SMALL_CAP': ['EURO SMALL', 'EUROPEAN SMALL'],
  'EURO_AREA_SMALL_CAP_HEDGED': ['EURO SMALL HEDGED'],
  
  // JAPANESE EQUITY
  'JAPANESE_EQUITY': ['EWJ', 'JAPAN', 'NIKKEI', 'TOPIX', 'JAPANESE'],
  'JAPANESE_EQUITY_HEDGED': ['JAPAN HEDGED', 'JAPANESE HEDGED', 'DXJF'],
  
  // ASIAN EQUITY
  'AC_ASIA_EX_JAPAN_EQUITY': ['ASIA EX JAPAN', 'AAXJ', 'ASIAN'],
  'CHINESE_DOMESTIC_EQUITY': ['CHINA', 'MCHI', 'FXI', 'CHINESE', 'CSI'],
  
  // EMERGING & GLOBAL EQUITY
  'EMERGING_MARKETS_EQUITY': ['VWO', 'IEMG', 'SCHE', 'EEM', 'EMERGING', 'EM EQUITY'],
  'AC_WORLD_EQUITY': ['ACWI', 'VT', 'WORLD EQUITY', 'GLOBAL EQUITY'],
  'AC_WORLD_EX_UK_EQUITY': ['WORLD EX UK', 'ACWI EX UK'],
  'DEVELOPED_WORLD_EQUITY': ['VEA', 'IEFA', 'SCHF', 'VXUS', 'IXUS', 'DEVELOPED', 'EAFE'],
  
  // REAL ESTATE
  'US_CORE_REAL_ESTATE': ['US REAL ESTATE', 'US REIT CORE'],
  'EUROPEAN_CORE_REAL_ESTATE': ['EUROPEAN REAL ESTATE', 'EURO REIT'],
  'EUROPEAN_CORE_REAL_ESTATE_HEDGED': ['EUROPEAN REAL ESTATE HEDGED'],
  'UK_CORE_REAL_ESTATE': ['UK REAL ESTATE', 'UK REIT', 'UK PROPERTY'],
  'EUROPEAN_VALUE_ADDED_REAL_ESTATE': ['EURO VALUE ADD', 'EUROPEAN VALUE'],
  'EUROPEAN_VALUE_ADDED_REAL_ESTATE_HEDGED': ['EURO VALUE ADD HEDGED'],
  'GLOBAL_REIT': ['VNQ', 'REIT', 'REAL ESTATE', 'PROPERTY', 'GLOBAL REIT'],
  
  // INFRASTRUCTURE & ALTERNATIVES
  'GLOBAL_CORE_INFRASTRUCTURE': ['INFRASTRUCTURE', 'IGF', 'IFRA'],
  'GLOBAL_CORE_TRANSPORT': ['TRANSPORT', 'TRANSPORTATION'],
  'GLOBAL_TIMBERLAND': ['TIMBERLAND', 'TIMBER', 'FORESTRY'],
  
  // COMMODITIES
  'COMMODITIES': ['DBC', 'GSG', 'COMMODITY', 'OIL', 'CRUDE'],
  'GOLD': ['GLD', 'IAU', 'GOLD', 'PHYS'],
  
  // PRIVATE MARKETS
  'PRIVATE_EQUITY': ['PRIVATE EQUITY', 'PE FUND', 'BUYOUT'],
  'VENTURE_CAPITAL': ['VENTURE', 'VC', 'STARTUP'],
  'DIRECT_LENDING': ['DIRECT LENDING', 'PRIVATE CREDIT', 'PRIVATE DEBT'],
  
  // HEDGE FUNDS
  'DIVERSIFIED_HEDGE_FUNDS': ['HEDGE FUND', 'ALTERNATIVE', 'DIVERSIFIED HEDGE'],
  'EVENT_DRIVEN_HEDGE_FUNDS': ['EVENT DRIVEN', 'MERGER ARB'],
  'LONG_BIAS_HEDGE_FUNDS': ['LONG BIAS', 'EQUITY HEDGE'],
  'RELATIVE_VALUE_HEDGE_FUNDS': ['RELATIVE VALUE', 'MARKET NEUTRAL'],
  'MACRO_HEDGE_FUNDS': ['MACRO', 'GLOBAL MACRO', 'CTA'],
  
  // INFLATION
  'UK_INFLATION': ['UK INFLATION', 'UK CPI', 'RPI'],
};

// ==================== FILE PARSERS ====================
const parseChaseHTML = (htmlContent) => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlContent, 'text/html');
  const table = doc.querySelector('table');
  
  if (!table) throw new Error('No table found in Chase file');
  
  const rows = Array.from(table.querySelectorAll('tr')).slice(1);
  
  const positions = rows
    .map(row => {
      const cells = Array.from(row.querySelectorAll('td')).map(td => td.textContent.trim());
      if (cells.length !== 71) return null;
      
      return {
        ticker: cells[4],
        description: cells[3],
        quantity: parseFloat(cells[6].replace(/,/g, '')) || 0,
        price: parseFloat(cells[9].replace(/,/g, '')) || 0,
        value: parseFloat(cells[15].replace(/,/g, '')) || 0,
        cost: parseFloat(cells[19].replace(/,/g, '')) || 0,
        gainLoss: parseFloat(cells[26].replace(/,/g, '')) || 0,
      };
    })
    .filter(p => p && p.value > 0);
  
  return positions;
};

const parseGenericCSV = (text) => {
  // Proper CSV parser that handles quoted fields with commas
  const parseCSVLine = (line) => {
    const result = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      const nextChar = line[i + 1];
      
      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current);
    return result;
  };
  
  const parseNumber = (str) => {
    if (!str) return 0;
    const cleaned = String(str).replace(/[,$"]/g, '').trim();
    return parseFloat(cleaned) || 0;
  };
  
  const lines = text.trim().split('\n').filter(line => line.trim());
  if (lines.length === 0) throw new Error('CSV file is empty');
  
  const headers = parseCSVLine(lines[0]);
  console.log('CSV Headers:', headers);
  
  const tickerIdx = headers.findIndex(h => h.toLowerCase().includes('ticker') || h.toLowerCase().includes('symbol'));
  const quantityIdx = headers.findIndex(h => h.toLowerCase().includes('quantity') || h.toLowerCase().includes('shares'));
  const priceIdx = headers.findIndex(h => h.toLowerCase() === 'price' || h.toLowerCase().includes('unit price') || h.toLowerCase().includes('last price'));
  const valueIdx = headers.findIndex(h => h.toLowerCase() === 'value' || h.toLowerCase().includes('market value') || h.toLowerCase().includes('total value'));
  const costIdx = headers.findIndex(h => h.toLowerCase() === 'cost' || h.toLowerCase().includes('cost basis') || h.toLowerCase().includes('total cost'));
  const descIdx = headers.findIndex(h => h.toLowerCase().includes('description') || h.toLowerCase().includes('security'));
  
  console.log('Column indices:', { tickerIdx, quantityIdx, priceIdx, valueIdx, costIdx, descIdx });
  
  if (tickerIdx === -1) {
    throw new Error(`Could not find ticker/symbol column. Available columns: ${headers.join(', ')}`);
  }
  
  const positions = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (line.toUpperCase().startsWith('FOOTNOTES')) break;
    
    const cells = parseCSVLine(line);
    const ticker = cells[tickerIdx]?.trim();
    
    // Skip empty tickers or totals rows
    if (!ticker || ticker.toLowerCase().includes('total') || ticker.toLowerCase() === 'n/a') {
      continue;
    }
    
    const quantity = parseNumber(cells[quantityIdx]);
    const price = parseNumber(cells[priceIdx]);
    const value = valueIdx !== -1 ? parseNumber(cells[valueIdx]) : quantity * price;
    const cost = costIdx !== -1 ? parseNumber(cells[costIdx]) : value;
    
    if (value > 0) {
      positions.push({
        ticker: ticker,
        description: cells[descIdx]?.trim() || ticker,
        quantity,
        price,
        value,
        cost,
        gainLoss: value - cost,
      });
    }
  }
  
  if (positions.length === 0) {
    throw new Error('No valid positions found in CSV. Make sure the file contains ticker symbols and values.');
  }
  
  console.log(`✅ Parsed ${positions.length} positions, total: $${positions.reduce((s, p) => s + p.value, 0).toLocaleString()}`);
  return positions;
};

const parseExcelFile = async (arrayBuffer) => {
  if (!window.XLSX) {
    const script = document.createElement('script');
    script.src = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
    document.head.appendChild(script);
    await new Promise((resolve) => {
      script.onload = resolve;
    });
  }
  
  const workbook = window.XLSX.read(arrayBuffer, { type: 'array' });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  const data = window.XLSX.utils.sheet_to_json(firstSheet, { header: 1 });
  
  const headers = data[0].map(h => String(h).toLowerCase());
  const tickerIdx = headers.findIndex(h => h.includes('ticker') || h.includes('symbol'));
  const quantityIdx = headers.findIndex(h => h.includes('quantity') || h.includes('shares'));
  const priceIdx = headers.findIndex(h => h.includes('price') || h.includes('current'));
  const valueIdx = headers.findIndex(h => h.includes('value') || h.includes('market'));
  const costIdx = headers.findIndex(h => h.includes('cost') || h.includes('basis'));
  
  const positions = data.slice(1).map(row => {
    const quantity = parseFloat(String(row[quantityIdx] || '').replace(/,/g, '')) || 0;
    const price = parseFloat(String(row[priceIdx] || '').replace(/,/g, '')) || 0;
    const value = valueIdx !== -1 ? parseFloat(String(row[valueIdx] || '').replace(/,/g, '')) || 0 : quantity * price;
    const cost = costIdx !== -1 ? parseFloat(String(row[costIdx] || '').replace(/,/g, '')) || 0 : value;
    
    return {
      ticker: row[tickerIdx] || 'N/A',
      description: row[tickerIdx] || 'N/A',
      quantity,
      price,
      value,
      cost,
      gainLoss: value - cost,
    };
  }).filter(p => p.value > 0);
  
  return positions;
};

// ==================== ASSET CLASS DETECTION ====================
// ==================== ETF LOOK-THROUGH DATABASE ====================
// Maps ETF tickers to their underlying asset class (not just based on name)
const ETF_LOOKTHROUGH = {
  // Gold & Precious Metals
  'GLD': 'GOLD',
  'IAU': 'GOLD',
  'PHYS': 'GOLD',
  'SGOL': 'GOLD',
  'SLV': 'COMMODITIES', // Silver
  'PPLT': 'COMMODITIES', // Platinum
  'PALL': 'COMMODITIES', // Palladium
  
  // Commodities & Energy
  'DBC': 'COMMODITIES',
  'DBA': 'COMMODITIES', // Agriculture
  'USO': 'COMMODITIES', // Oil
  'UNG': 'COMMODITIES', // Natural Gas
  'XLE': 'COMMODITIES', // Energy sector
  'PDBC': 'COMMODITIES',
  
  // Real Estate (REITs)
  'VNQ': 'US_CORE_REAL_ESTATE',
  'IYR': 'US_CORE_REAL_ESTATE',
  'SCHH': 'US_CORE_REAL_ESTATE',
  'RWR': 'US_CORE_REAL_ESTATE',
  'REET': 'GLOBAL_REIT',
  'VNQI': 'GLOBAL_REIT',
  'RWX': 'GLOBAL_REIT',
  
  // US Bonds
  'AGG': 'US_AGGREGATE_BONDS',
  'BND': 'US_AGGREGATE_BONDS',
  'BNDX': 'GLOBAL_AGGREGATE_BONDS',
  'TLT': 'US_GOVT_BONDS',
  'IEF': 'US_GOVT_BONDS',
  'SHY': 'US_GOVT_BONDS',
  'LQD': 'US_CORPORATE_BONDS',
  'VCIT': 'US_CORPORATE_BONDS',
  'VCSH': 'US_CORPORATE_BONDS',
  'HYG': 'US_HIGH_YIELD_BONDS',
  'JNK': 'US_HIGH_YIELD_BONDS',
  'MUB': 'US_GOVT_BONDS', // Municipal
  'TIP': 'US_INFLATION_LINKED_BONDS',
  'VTIP': 'US_INFLATION_LINKED_BONDS',
  
  // US Large Cap
  'SPY': 'US_LARGE_CAP',
  'VOO': 'US_LARGE_CAP',
  'IVV': 'US_LARGE_CAP',
  'VTI': 'US_LARGE_CAP',
  'ITOT': 'US_LARGE_CAP',
  'SCHB': 'US_LARGE_CAP',
  'QQQ': 'US_LARGE_CAP', // Tech-heavy but still large cap
  'DIA': 'US_LARGE_CAP', // Dow
  'IWB': 'US_LARGE_CAP',
  'SCHX': 'US_LARGE_CAP',
  
  // US Small/Mid Cap
  'IWM': 'US_SMALL_CAP',
  'VB': 'US_SMALL_CAP',
  'IJR': 'US_SMALL_CAP',
  'SCHA': 'US_SMALL_CAP',
  'VBR': 'US_SMALL_CAP', // Small cap value
  'VBK': 'US_SMALL_CAP', // Small cap growth
  'IJH': 'US_SMALL_CAP', // Mid cap
  'VO': 'US_SMALL_CAP', // Mid cap
  'MDY': 'US_SMALL_CAP', // Mid cap
  
  // International Developed
  'VEA': 'DEVELOPED_WORLD_EQUITY',
  'IEFA': 'DEVELOPED_WORLD_EQUITY',
  'SCHF': 'DEVELOPED_WORLD_EQUITY',
  'EFA': 'DEVELOPED_WORLD_EQUITY',
  'IXUS': 'DEVELOPED_WORLD_EQUITY',
  'VXUS': 'DEVELOPED_WORLD_EQUITY',
  
  // Europe
  'VGK': 'EURO_AREA_LARGE_CAP',
  'EZU': 'EURO_AREA_LARGE_CAP',
  'FEZ': 'EURO_AREA_LARGE_CAP',
  
  // Japan
  'EWJ': 'JAPANESE_EQUITY',
  'DXJ': 'JAPANESE_EQUITY',
  'DXJF': 'JAPANESE_EQUITY_HEDGED',
  
  // Emerging Markets
  'VWO': 'EMERGING_MARKETS_EQUITY',
  'IEMG': 'EMERGING_MARKETS_EQUITY',
  'EEM': 'EMERGING_MARKETS_EQUITY',
  'SCHE': 'EMERGING_MARKETS_EQUITY',
  'SPEM': 'EMERGING_MARKETS_EQUITY',
  
  // China
  'MCHI': 'CHINESE_DOMESTIC_EQUITY',
  'FXI': 'CHINESE_DOMESTIC_EQUITY',
  'KWEB': 'CHINESE_DOMESTIC_EQUITY',
  'CNYA': 'CHINESE_DOMESTIC_EQUITY',
  
  // Global/World
  'VT': 'DEVELOPED_WORLD_EQUITY',
  'ACWI': 'DEVELOPED_WORLD_EQUITY',
  'URTH': 'DEVELOPED_WORLD_EQUITY',
  
  // Infrastructure
  'IGF': 'INFRASTRUCTURE',
  'IFRA': 'INFRASTRUCTURE',
  'PAVE': 'INFRASTRUCTURE',
  
  // Sector ETFs (map to US Large Cap with sector tag)
  'XLK': 'US_LARGE_CAP', // Technology
  'XLF': 'US_LARGE_CAP', // Financials
  'XLV': 'US_LARGE_CAP', // Healthcare
  'XLY': 'US_LARGE_CAP', // Consumer Discretionary
  'XLP': 'US_LARGE_CAP', // Consumer Staples
  'XLI': 'US_LARGE_CAP', // Industrials
  'XLB': 'US_LARGE_CAP', // Materials
  'XLU': 'US_LARGE_CAP', // Utilities
  'XLRE': 'US_CORE_REAL_ESTATE', // Real Estate
};

// Sector mapping for individual stocks
const SECTOR_NAMES = {
  'Technology': 'Technology',
  'Financial Services': 'Financials',
  'Healthcare': 'Healthcare',
  'Consumer Cyclical': 'Consumer Discretionary',
  'Consumer Defensive': 'Consumer Staples',
  'Industrials': 'Industrials',
  'Basic Materials': 'Materials',
  'Energy': 'Energy',
  'Real Estate': 'Real Estate',
  'Utilities': 'Utilities',
  'Communication Services': 'Communication',
  'Communication': 'Communication',
  'Financials': 'Financials',
  'Consumer Discretionary': 'Consumer Discretionary',
  'Consumer Staples': 'Consumer Staples',
  'Materials': 'Materials',
};

const detectAssetClass = (ticker, description) => {
  // First, check if it's a known ETF with specific look-through
  const tickerUpper = ticker.toUpperCase();
  if (ETF_LOOKTHROUGH[tickerUpper]) {
    return ETF_LOOKTHROUGH[tickerUpper];
  }
  
  // Otherwise, use pattern matching
  const searchText = `${ticker} ${description}`.toUpperCase();
  
  for (const [assetClass, patterns] of Object.entries(ASSET_CLASS_PATTERNS)) {
    for (const pattern of patterns) {
      if (searchText.includes(pattern.toUpperCase())) {
        return assetClass;
      }
    }
  }
  
  return 'US_LARGE_CAP';
};

// ==================== PORTFOLIO ANALYSIS ====================
const analyzePortfolio = async (positions, sectorOverrides = {}, assetClassOverrides = {}) => {
  let totalValue = 0;
  const assetAllocation = {};
  const sectorAllocation = {};
  const allocationBreakdown = [];
  const sectorBreakdown = [];
  const tickerSectorMap = {}; // Track which sector each ticker was assigned to
  
  // Comprehensive ticker to sector mapping
  const tickerToSector = {
    // Technology
    'AAPL': 'Technology', 'MSFT': 'Technology', 'GOOGL': 'Technology', 'GOOG': 'Technology',
    'META': 'Technology', 'NVDA': 'Technology', 'AVGO': 'Technology', 'ORCL': 'Technology',
    'CRM': 'Technology', 'ADBE': 'Technology', 'AMD': 'Technology', 'INTC': 'Technology',
    'QCOM': 'Technology', 'TXN': 'Technology', 'NOW': 'Technology', 'INTU': 'Technology',
    'AMAT': 'Technology', 'MU': 'Technology', 'LRCX': 'Technology', 'KLAC': 'Technology',
    'SNPS': 'Technology', 'CDNS': 'Technology', 'MCHP': 'Technology', 'MRVL': 'Technology',
    'PANW': 'Technology', 'CRWD': 'Technology', 'ZS': 'Technology', 'NET': 'Technology',
    'DDOG': 'Technology', 'SNOW': 'Technology', 'PLTR': 'Technology', 'ASML': 'Technology',
    'TSM': 'Technology', 'SHOP': 'Technology', 'SQ': 'Technology', 'PYPL': 'Technology',
    'ADSK': 'Technology', 'WDAY': 'Technology', 'TEAM': 'Technology', 'OKTA': 'Technology',
    'DOCU': 'Technology', 'ZM': 'Technology', 'TWLO': 'Technology', 'MDB': 'Technology',
    
    // Communication Services
    'AMZN': 'Consumer Discretionary', 'TSLA': 'Consumer Discretionary', 'HD': 'Consumer Discretionary',
    'MCD': 'Consumer Discretionary', 'NKE': 'Consumer Discretionary', 'SBUX': 'Consumer Discretionary',
    'TJX': 'Consumer Discretionary', 'LOW': 'Consumer Discretionary', 'TGT': 'Consumer Discretionary',
    'BKNG': 'Consumer Discretionary', 'CMG': 'Consumer Discretionary', 'MAR': 'Consumer Discretionary',
    'UBER': 'Consumer Discretionary', 'ABNB': 'Consumer Discretionary',
    
    // Healthcare
    'UNH': 'Healthcare', 'JNJ': 'Healthcare', 'LLY': 'Healthcare', 'ABBV': 'Healthcare',
    'MRK': 'Healthcare', 'TMO': 'Healthcare', 'ABT': 'Healthcare', 'DHR': 'Healthcare',
    'PFE': 'Healthcare', 'BMY': 'Healthcare', 'AMGN': 'Healthcare', 'GILD': 'Healthcare',
    'CVS': 'Healthcare', 'CI': 'Healthcare', 'ELV': 'Healthcare', 'HUM': 'Healthcare',
    'ISRG': 'Healthcare', 'REGN': 'Healthcare', 'VRTX': 'Healthcare', 'ZTS': 'Healthcare',
    
    // Financials
    'BRK.B': 'Financials', 'BRKB': 'Financials', 'JPM': 'Financials', 'V': 'Financials',
    'MA': 'Financials', 'BAC': 'Financials', 'WFC': 'Financials', 'MS': 'Financials',
    'GS': 'Financials', 'SPGI': 'Financials', 'BLK': 'Financials', 'C': 'Financials',
    'AXP': 'Financials', 'SCHW': 'Financials', 'CB': 'Financials', 'MMC': 'Financials',
    'PGR': 'Financials', 'AON': 'Financials', 'USB': 'Financials', 'TFC': 'Financials',
    'PNC': 'Financials', 'COF': 'Financials', 'ICE': 'Financials', 'CME': 'Financials',
    
    // Industrials
    'CAT': 'Industrials', 'BA': 'Industrials', 'HON': 'Industrials', 'UNP': 'Industrials',
    'RTX': 'Industrials', 'LMT': 'Industrials', 'DE': 'Industrials', 'UPS': 'Industrials',
    'GE': 'Industrials', 'MMM': 'Industrials', 'FDX': 'Industrials', 'NSC': 'Industrials',
    
    // Consumer Staples
    'PG': 'Consumer Staples', 'KO': 'Consumer Staples', 'PEP': 'Consumer Staples',
    'COST': 'Consumer Staples', 'WMT': 'Consumer Staples', 'PM': 'Consumer Staples',
    'MO': 'Consumer Staples', 'MDLZ': 'Consumer Staples', 'CL': 'Consumer Staples',
    
    // Energy
    'XOM': 'Energy', 'CVX': 'Energy', 'COP': 'Energy', 'SLB': 'Energy',
    'EOG': 'Energy', 'PSX': 'Energy', 'MPC': 'Energy', 'VLO': 'Energy',
    
    // Utilities
    'NEE': 'Utilities', 'DUK': 'Utilities', 'SO': 'Utilities', 'D': 'Utilities',
    
    // Real Estate
    'AMT': 'Real Estate', 'PLD': 'Real Estate', 'CCI': 'Real Estate', 'EQIX': 'Real Estate',
    
    // Materials
    'LIN': 'Materials', 'APD': 'Materials', 'SHW': 'Materials', 'FCX': 'Materials',
    
    // Cybersecurity
    'CYBR': 'Technology',
    
    // Crypto/Digital Assets
    'GLXY': 'Financials',
  };
  
  // ETF sector allocations (look-through to underlying sectors)
  const etfSectorAllocations = {
    // Broad Market ETFs
    'FXAIX': { 'Technology': 33, 'Financials': 13, 'Healthcare': 12, 'Consumer Discretionary': 11, 'Communication Services': 9, 'Industrials': 8, 'Consumer Staples': 6, 'Energy': 3, 'Utilities': 2, 'Real Estate': 2, 'Materials': 1 },
    'FNCMX': { 'Technology': 52, 'Consumer Discretionary': 15, 'Communication Services': 12, 'Healthcare': 7, 'Financials': 5, 'Industrials': 4, 'Consumer Staples': 3, 'Materials': 1, 'Utilities': 1 },
    'SCHG': { 'Technology': 45, 'Consumer Discretionary': 16, 'Healthcare': 10, 'Financials': 9, 'Communication Services': 8, 'Industrials': 6, 'Consumer Staples': 4, 'Real Estate': 1, 'Materials': 1 },
    'QQQM': { 'Technology': 50, 'Consumer Discretionary': 17, 'Communication Services': 14, 'Healthcare': 6, 'Consumer Staples': 5, 'Industrials': 4, 'Utilities': 2, 'Energy': 1, 'Materials': 1 },
    'SCHD': { 'Financials': 18, 'Healthcare': 16, 'Consumer Staples': 13, 'Industrials': 12, 'Energy': 11, 'Consumer Discretionary': 10, 'Technology': 9, 'Utilities': 8, 'Materials': 3 },
    
    // Sector-specific ETFs
    'XLK': { 'Technology': 100 },
    'XLF': { 'Financials': 100 },
    'XLV': { 'Healthcare': 100 },
    'XLY': { 'Consumer Discretionary': 100 },
    'XLP': { 'Consumer Staples': 100 },
    'XLI': { 'Industrials': 100 },
    'XLB': { 'Materials': 100 },
    'XLE': { 'Energy': 100 },
    'XLU': { 'Utilities': 100 },
    'XLRE': { 'Real Estate': 100 },
    
    // Growth/Tech ETFs
    'JTEK': { 'Technology': 85, 'Communication Services': 10, 'Consumer Discretionary': 5 },
    'JGRO': { 'Technology': 50, 'Healthcare': 15, 'Consumer Discretionary': 15, 'Financials': 10, 'Communication Services': 10 },
    'GRNY': { 'Technology': 40, 'Healthcare': 20, 'Financials': 15, 'Consumer Discretionary': 15, 'Industrials': 10 },
    
    // Small cap
    'OBMCX': { 'Healthcare': 25, 'Technology': 20, 'Financials': 15, 'Industrials': 15, 'Consumer Discretionary': 15, 'Materials': 5, 'Energy': 3, 'Real Estate': 2 },
    'CWS': { 'Technology': 35, 'Healthcare': 25, 'Financials': 20, 'Consumer Discretionary': 10, 'Industrials': 10 },
    'FCTE': { 'Technology': 30, 'Financials': 25, 'Healthcare': 20, 'Industrials': 15, 'Consumer Discretionary': 10 },
  };
  
  // Check for learned asset classes from community
  const learnedAssetClasses = {};
  
  // OPTIMIZATION: Check localStorage first (instant, free)
  const localCache = {};
  try {
    const cached = localStorage.getItem('ticker_cache');
    if (cached) {
      const parsed = JSON.parse(cached);
      Object.assign(localCache, parsed);
      console.log(`💾 Loaded ${Object.keys(localCache).length} tickers from local cache`);
    }
  } catch (err) {
    console.log('Local cache not available');
  }
  
  const learnedPromises = positions.map(async (pos) => {
    const tickerUpper = pos.ticker.toUpperCase();
    // Skip if user has already overridden
    if (assetClassOverrides[tickerUpper]) return;
    
    // Check localStorage first (instant, no API call!)
    if (localCache[tickerUpper]) {
      learnedAssetClasses[tickerUpper] = localCache[tickerUpper];
      console.log(`⚡ Using cached: ${tickerUpper} → ${localCache[tickerUpper]}`);
      return;
    }
    
    try {
      const response = await fetch(`http://localhost:3001/api/get-learned-asset-class/${tickerUpper}`);
      const data = await response.json();
      if (data.found && data.confidence !== 'low') {
        learnedAssetClasses[tickerUpper] = data.assetClass;
        // Cache locally for instant future access
        localCache[tickerUpper] = data.assetClass;
        console.log(`🎓 Using learned: ${tickerUpper} → ${data.assetClass} (${data.votes} votes)`);
      }
    } catch (err) {
      // Silently fail if API not available
    }
  });
  
  await Promise.all(learnedPromises);
  
  // Save updated local cache
  try {
    localStorage.setItem('ticker_cache', JSON.stringify(localCache));
  } catch (err) {
    console.log('Could not save to local cache');
  }
  
  // First pass: collect unknown tickers
  const unknownTickers = [];
  
  for (const pos of positions) {
    totalValue += pos.value;
    const tickerUpper = pos.ticker.toUpperCase();
    
    // Check if user has overridden this ticker's asset class
    const assetClass = assetClassOverrides[tickerUpper] || learnedAssetClasses[tickerUpper] || detectAssetClass(pos.ticker, pos.description);
    assetAllocation[assetClass] = (assetAllocation[assetClass] || 0) + pos.value;
    
    // Check if ticker is unknown (not in our mappings)
    const isKnownStock = tickerToSector[tickerUpper];
    const isKnownETF = etfSectorAllocations[tickerUpper];
    const isCash = pos.description && pos.description.toLowerCase().includes('money market');
    const isFixedIncome = assetClass.includes('BOND') || assetClass.includes('CASH');
    const isCommodity = assetClass.includes('GOLD') || assetClass.includes('COMMODITIES');
    const isRealEstate = assetClass.includes('REAL_ESTATE') || assetClass.includes('REIT');
    
    if (!isKnownStock && !isKnownETF && !isCash && !isFixedIncome && !isCommodity && !isRealEstate && 
        (assetClass.includes('EQUITY') || assetClass.includes('CAP'))) {
      unknownTickers.push({ ticker: tickerUpper, description: pos.description, value: pos.value });
    }
  }
  
  // Lookup unknown tickers via API (batched to avoid rate limits)
  const sectorLookups = {};
  if (unknownTickers.length > 0) {
    console.log(`🔍 Looking up ${unknownTickers.length} unknown tickers:`, unknownTickers.map(t => t.ticker).join(', '));
    
    // Load sector cache from localStorage
    let sectorCache = {};
    try {
      const cached = localStorage.getItem('sector_cache');
      if (cached) {
        sectorCache = JSON.parse(cached);
        console.log(`💾 Loaded ${Object.keys(sectorCache).length} sectors from local cache`);
      }
    } catch (err) {
      console.log('Sector cache not available');
    }
    
    // Filter out tickers we already have cached locally
    const needsLookup = unknownTickers.filter(({ ticker }) => {
      if (sectorCache[ticker]) {
        sectorLookups[ticker] = sectorCache[ticker];
        console.log(`⚡ Using cached sector: ${ticker} → ${sectorCache[ticker].sector}`);
        return false;
      }
      return true;
    });
    
    console.log(`🌐 Need to lookup ${needsLookup.length} tickers (${unknownTickers.length - needsLookup.length} cached)`);
    
    // Process in batches of 3 to avoid rate limits
    const batchSize = 3;
    for (let i = 0; i < needsLookup.length; i += batchSize) {
      const batch = needsLookup.slice(i, i + batchSize);
      
      const batchPromises = batch.map(async ({ ticker, description }) => {
        try {
          const response = await fetch('http://localhost:3001/api/lookup-sector', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ticker, description })
          });
          
          if (response.ok) {
            const data = await response.json();
            sectorLookups[ticker] = data;
            sectorCache[ticker] = data; // Add to local cache
            console.log(`✅ Looked up ${ticker}: ${data.sector}${data.cached ? ' (cached in Redis)' : ' (NEW)'}`);
          } else {
            console.warn(`⚠️  Failed to lookup ${ticker}: ${response.status}`);
          }
        } catch (error) {
          console.warn(`⚠️  Error looking up ${ticker}:`, error.message);
        }
      });
      
      await Promise.all(batchPromises);
      
      // Add 1 second delay between batches to avoid rate limits
      if (i + batchSize < needsLookup.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    // Save updated sector cache
    try {
      localStorage.setItem('sector_cache', JSON.stringify(sectorCache));
      console.log(`💾 Saved ${Object.keys(sectorCache).length} sectors to local cache`);
    } catch (err) {
      console.log('Could not save sector cache');
    }
  }
  
  // Second pass: allocate to sectors
  positions.forEach(pos => {
    
    // Sector allocation
    const tickerUpper = pos.ticker.toUpperCase();
    const assetClass = assetClassOverrides[tickerUpper] || learnedAssetClasses[tickerUpper] || detectAssetClass(pos.ticker, pos.description);
    
    // Check if user has overridden this ticker's sector
    if (sectorOverrides[tickerUpper]) {
      const sector = sectorOverrides[tickerUpper];
      sectorAllocation[sector] = (sectorAllocation[sector] || 0) + pos.value;
      tickerSectorMap[tickerUpper] = sector;
    }
    // Check if we have a lookup result for this ticker
    else if (sectorLookups[tickerUpper]) {
      const lookup = sectorLookups[tickerUpper];
      if (lookup.allocation) {
        // ETF/Fund with sector breakdown
        let primarySector = 'Other';
        let maxPercentage = 0;
        for (const [sector, percentage] of Object.entries(lookup.allocation)) {
          const sectorValue = (pos.value * percentage) / 100;
          sectorAllocation[sector] = (sectorAllocation[sector] || 0) + sectorValue;
          if (percentage > maxPercentage) {
            maxPercentage = percentage;
            primarySector = sector;
          }
        }
        tickerSectorMap[tickerUpper] = primarySector; // Store primary sector for display
      } else {
        // Stock with single sector
        const sector = lookup.sector || 'Other';
        sectorAllocation[sector] = (sectorAllocation[sector] || 0) + pos.value;
        tickerSectorMap[tickerUpper] = sector;
      }
    }
    // Check if it's an ETF with known sector allocations (look-through)
    else if (etfSectorAllocations[tickerUpper]) {
      const allocations = etfSectorAllocations[tickerUpper];
      let primarySector = 'Other';
      let maxPercentage = 0;
      for (const [sector, percentage] of Object.entries(allocations)) {
        const sectorValue = (pos.value * percentage) / 100;
        sectorAllocation[sector] = (sectorAllocation[sector] || 0) + sectorValue;
        if (percentage > maxPercentage) {
          maxPercentage = percentage;
          primarySector = sector;
        }
      }
      tickerSectorMap[tickerUpper] = primarySector;
    }
    // Check if it's a stock with known sector
    else if (tickerToSector[tickerUpper]) {
      const sector = tickerToSector[tickerUpper];
      sectorAllocation[sector] = (sectorAllocation[sector] || 0) + pos.value;
      tickerSectorMap[tickerUpper] = sector;
    }
    // Check if description contains sector info
    else if (pos.description && pos.description.toLowerCase().includes('money market')) {
      sectorAllocation['Cash'] = (sectorAllocation['Cash'] || 0) + pos.value;
      tickerSectorMap[tickerUpper] = 'Cash';
    }
    else if (assetClass.includes('BOND') || assetClass.includes('CASH')) {
      sectorAllocation['Fixed Income'] = (sectorAllocation['Fixed Income'] || 0) + pos.value;
      tickerSectorMap[tickerUpper] = 'Fixed Income';
    }
    else if (assetClass.includes('GOLD') || assetClass.includes('COMMODITIES')) {
      sectorAllocation['Commodities'] = (sectorAllocation['Commodities'] || 0) + pos.value;
      tickerSectorMap[tickerUpper] = 'Commodities';
    }
    else if (assetClass.includes('REAL_ESTATE') || assetClass.includes('REIT')) {
      sectorAllocation['Real Estate'] = (sectorAllocation['Real Estate'] || 0) + pos.value;
      tickerSectorMap[tickerUpper] = 'Real Estate';
    }
    // Unknown equity - default to diversified allocation
    else if (assetClass.includes('EQUITY') || assetClass.includes('CAP')) {
      // Assume broad market allocation for unknown equities
      const broadMarketAllocation = { 'Technology': 30, 'Financials': 15, 'Healthcare': 13, 'Consumer Discretionary': 12, 'Industrials': 9, 'Communication Services': 8, 'Consumer Staples': 6, 'Energy': 3, 'Utilities': 2, 'Real Estate': 2 };
      for (const [sector, percentage] of Object.entries(broadMarketAllocation)) {
        const sectorValue = (pos.value * percentage) / 100;
        sectorAllocation[sector] = (sectorAllocation[sector] || 0) + sectorValue;
      }
      tickerSectorMap[tickerUpper] = 'Technology'; // Default to largest sector
    }
    else {
      sectorAllocation['Other'] = (sectorAllocation['Other'] || 0) + pos.value;
      tickerSectorMap[tickerUpper] = 'Other';
    }
  });
  
  let weightedReturn = 0;
  let weightedVolatilitySquared = 0;
  
  for (const [assetClass, value] of Object.entries(assetAllocation)) {
    const weight = value / totalValue;
    const assumptions = LTCMA[assetClass] || LTCMA['UNKNOWN'];
    weightedReturn += weight * assumptions.return;
    weightedVolatilitySquared += Math.pow(weight * assumptions.volatility, 2);
    
    allocationBreakdown.push({
      assetClass,
      value,
      weight: weight * 100,
      expectedReturn: assumptions.return,
      volatility: assumptions.volatility,
      contribution: weight * assumptions.return,
    });
  }
  
  // Create sector breakdown
  for (const [sector, value] of Object.entries(sectorAllocation)) {
    const weight = value / totalValue;
    sectorBreakdown.push({
      sector,
      value,
      weight: weight * 100,
    });
  }
  
  allocationBreakdown.sort((a, b) => b.weight - a.weight);
  sectorBreakdown.sort((a, b) => b.weight - a.weight);
  
  const weightedVolatility = Math.sqrt(weightedVolatilitySquared);
  
  return {
    expectedReturn: weightedReturn,
    expectedVolatility: weightedVolatility,
    assetAllocation,
    allocationBreakdown,
    sectorAllocation,
    sectorBreakdown,
    totalValue,
    tickerSectorMap, // Map of ticker -> assigned sector
  };
};

// ==================== MONTE CARLO SIMULATION ====================
const runMonteCarloSimulation = (initialValue, years, expectedReturn, volatility, contributionAmount = 0, contributionFreq = 'monthly', numSimulations = 10000, leverage = 1.0, borrowingRate = 0) => {
  const projections = [];
  const simResults = [];
  let marginCallCount = 0;
  
  const periodsPerYear = {
    'daily': 252,
    'weekly': 52,
    'monthly': 12,
    'quarterly': 4,
    'annually': 1,
  }[contributionFreq] || 12;
  
  const contributionPerPeriod = contributionAmount / periodsPerYear;
  
  // Leverage adjustments
  const leveragedReturn = leverage > 1.0 
    ? (expectedReturn * leverage - (leverage - 1) * borrowingRate)
    : expectedReturn;
  const leveragedVolatility = volatility * leverage;
  
  for (let sim = 0; sim < numSimulations; sim++) {
    let equity = initialValue;
    let debt = initialValue * (leverage - 1);
    let value = equity + debt;
    const simPath = [equity];
    let marginCalled = false;
    
    for (let year = 1; year <= years; year++) {
      for (let period = 0; period < periodsPerYear; period++) {
        if (!marginCalled) {
          const periodReturn = (leveragedReturn / 100) / periodsPerYear;
          const periodVol = (leveragedVolatility / 100) / Math.sqrt(periodsPerYear);
          const randomReturn = periodReturn + periodVol * (Math.random() * 2 - 1) * Math.sqrt(3);
          
          value = value * (1 + randomReturn) + contributionPerPeriod;
          
          if (leverage > 1.0) {
            debt = debt * (1 + (borrowingRate / 100) / periodsPerYear);
            equity = value - debt;
            
            // Margin call check: if equity falls below 30% of position value
            if (equity / value < 0.30) {
              marginCalled = true;
              marginCallCount++;
              // Liquidation with 50% penalty
              equity = equity * 0.5;
            }
          } else {
            equity = value;
          }
        }
      }
      
      simPath.push(equity);
    }
    
    simResults.push(simPath);
  }
  
  for (let year = 0; year <= years; year++) {
    const yearValues = simResults.map(sim => sim[year]).sort((a, b) => a - b);
    
    projections.push({
      year: new Date().getFullYear() + year,
      median: yearValues[Math.floor(numSimulations * 0.5)],
      p10: yearValues[Math.floor(numSimulations * 0.1)],
      p25: yearValues[Math.floor(numSimulations * 0.25)],
      p75: yearValues[Math.floor(numSimulations * 0.75)],
      p90: yearValues[Math.floor(numSimulations * 0.9)],
    });
  }
  
  return {
    projections,
    marginCallRate: (marginCallCount / numSimulations) * 100,
  };
};

// ==================== COMPOUND INTEREST CALCULATOR (FIXED) ====================
const calculateCompoundInterest = (principal, monthlyContribution, years, annualRate, compoundFreq, leverage = 1.0, borrowingRate = 0) => {
  if (leverage === 1.0) {
    // Standard calculation without leverage
    const r = annualRate / 100;
    const n = {
      'daily': 365,
      'monthly': 12,
      'quarterly': 4,
      'semiannually': 2,
      'annually': 1,
    }[compoundFreq];
    
    const fvPrincipal = principal * Math.pow(1 + r / n, n * years);
    
    let fvContributions = 0;
    if (monthlyContribution !== 0) {
      const monthlyRate = r / 12;
      const months = years * 12;
      fvContributions = monthlyContribution * ((Math.pow(1 + monthlyRate, months) - 1) / monthlyRate) * (1 + monthlyRate);
    }
    
    return fvPrincipal + fvContributions;
  } else {
    // With leverage
    const netReturn = annualRate * leverage - (leverage - 1) * borrowingRate;
    const r = netReturn / 100;
    const n = {
      'daily': 365,
      'monthly': 12,
      'quarterly': 4,
      'semiannually': 2,
      'annually': 1,
    }[compoundFreq];
    
    const leveragedPrincipal = principal * leverage;
    const fvPrincipal = leveragedPrincipal * Math.pow(1 + r / n, n * years);
    
    let fvContributions = 0;
    if (monthlyContribution !== 0) {
      const monthlyRate = r / 12;
      const months = years * 12;
      fvContributions = (monthlyContribution * leverage) * ((Math.pow(1 + monthlyRate, months) - 1) / monthlyRate) * (1 + monthlyRate);
    }
    
    const totalDebt = principal * (leverage - 1) * Math.pow(1 + borrowingRate / 100 / n, n * years);
    
    return Math.max(0, fvPrincipal + fvContributions - totalDebt);
  }
};

// Backsolve for required return
const backsolveReturn = (principal, monthlyContribution, years, targetValue, compoundFreq, leverage = 1.0, borrowingRate = 0) => {
  let low = 0;
  let high = 50;
  let iterations = 0;
  const tolerance = 0.001;
  
  while (iterations < 100 && (high - low) > tolerance) {
    const mid = (low + high) / 2;
    const result = calculateCompoundInterest(principal, monthlyContribution, years, mid, compoundFreq, leverage, borrowingRate);
    
    if (Math.abs(result - targetValue) < tolerance) {
      return mid;
    }
    
    if (result < targetValue) {
      low = mid;
    } else {
      high = mid;
    }
    
    iterations++;
  }
  
  return (low + high) / 2;
};

// ==================== API FUNCTIONS ====================
const fetchStockData = async (ticker) => {
  console.log(`🔄 Fetching live data for ${ticker} via backend proxy...`);
  
  try {
    // Call OUR backend instead of the API directly
    const response = await fetch(`${BACKEND_API_URL}/api/stock/${ticker}`);
    
    if (!response.ok) {
      console.log(`⚠️ Backend returned status ${response.status}`);
      
      let errorData;
      try {
        errorData = await response.json();
        console.log('📋 Error data from backend:', errorData);
      } catch (parseError) {
        console.error('Failed to parse error response:', parseError);
        throw new Error(`HTTP ${response.status}`);
      }
      
      // If backend signals premium stock (402 from FMP), show upgrade message
      if (errorData.useYahooFallback || response.status === 503 || errorData.fmpStatus === 402) {
        throw new Error(`${ticker} requires a premium data subscription. This stock is available with our Pro plan, which includes access to 5,000+ stocks with complete financial data. Upgrade to analyze premium stocks like ${ticker}!`);
      }
      
      throw new Error(errorData.message || `HTTP ${response.status}`);
    }
    
    const data = await response.json();
    
    // Backend returns objects directly, not arrays
    const profileData = data.profile;
    const quoteData = data.quote;
    const incomeData = data.income || [];
    const cashFlowData = data.cashFlow || [];
    let balanceSheetData = data.balance || [];

    console.log('✅ Received data from backend:');
    console.log('  Profile:', profileData ? 'present' : 'missing');
    console.log('  Quote:', quoteData ? 'present' : 'missing');
    console.log('  Income records:', incomeData.length);
    console.log('  Cash Flow records:', cashFlowData.length);
    console.log('  Balance Sheet records:', balanceSheetData.length);

    // Validate data
    if (!profileData) {
      throw new Error(`No profile data found for ticker "${ticker}". Please verify the symbol is correct.`);
    }
    if (!quoteData) {
      throw new Error(`No quote data found for ticker "${ticker}". Please verify the symbol is correct.`);
    }

    const profile = profileData;  // Already an object, not an array
    const quote = quoteData;      // Already an object, not an array
    const latestIncome = incomeData && incomeData.length > 0 ? incomeData[0] : null;

    // Calculate PE ratio and get EPS from income statement or quote
    const eps = quote.eps || (latestIncome ? latestIncome.epsDiluted || latestIncome.eps || 0 : 0);
    const pe = quote.pe || (eps > 0 ? quote.price / eps : 0);
    const sharesOutstanding = quote.sharesOutstanding || (latestIncome ? latestIncome.weightedAverageShsOutDil || latestIncome.weightedAverageShsOut || 0 : 0);

    console.log('💰 Calculated metrics:', { eps, pe, sharesOutstanding });
    console.log('   Quote data:', { 
      price: quote.price, 
      eps: quote.eps, 
      pe: quote.pe,
      sharesOutstanding: quote.sharesOutstanding 
    });

    // Process income statement data
    const income = (incomeData || []).map(item => ({
      date: item.date,
      revenue: item.revenue || 0,
      netIncome: item.netIncome || 0,
      eps: item.epsDiluted || item.eps || 0
    }));

    // Process cash flow data
    const cashFlow = (cashFlowData || []).map(item => ({
      date: item.date,
      freeCashFlow: item.freeCashFlow || 0
    }));

    console.log(`✅ Successfully processed data for ${ticker}`);

    return {
      profile: {
        companyName: profile.companyName || profile.symbol,
        symbol: profile.symbol,
        price: quote.price || profile.price,
        industry: profile.industry || 'N/A',
        sector: profile.sector || 'N/A',
        mktCap: quote.marketCap || profile.marketCap || 0,
        description: profile.description || 'No description available.'
      },
      quote: {
        symbol: quote.symbol,
        name: quote.name || profile.companyName,
        price: quote.price,
        changesPercentage: quote.changePercentage || 0,
        change: quote.change || 0,
        dayLow: quote.dayLow || 0,
        dayHigh: quote.dayHigh || 0,
        yearHigh: quote.yearHigh || 0,
        yearLow: quote.yearLow || 0,
        marketCap: quote.marketCap || 0,
        priceAvg50: quote.priceAvg50 || 0,
        priceAvg200: quote.priceAvg200 || 0,
        volume: quote.volume || 0,
        avgVolume: profile.avgVolume || 50000000,
        open: quote.open || 0,
        previousClose: quote.previousClose || 0,
        eps: eps,
        pe: pe,
        sharesOutstanding: sharesOutstanding
      },
      income,
      cashFlow,
      balanceSheet: balanceSheetData
    };
  } catch (error) {
    console.error(`❌ Error fetching data for ${ticker}:`, error);
    throw new Error(`Failed to fetch data for ticker "${ticker}". ${error.message}`);
  }
};

// ==================== STOCK PROJECTIONS ====================
const calculateStockProjections = (baseRevenue, baseNetIncome, shares, assumptions) => {
  const projections = [];
  const currentYear = new Date().getFullYear();
  
  for (let i = 0; i < 5; i++) {
    const year = currentYear + i;
    const revenue = baseRevenue * Math.pow(1 + assumptions.revenueGrowth / 100, i);
    const netIncome = revenue * (assumptions.netMargin / 100);
    const eps = netIncome / shares;
    const priceLow = eps * assumptions.peLow;
    const priceHigh = eps * assumptions.peHigh;
    
    projections.push({
      year,
      revenue: Math.round(revenue),
      netIncome: Math.round(netIncome),
      eps: eps.toFixed(2),
      priceLow: Math.round(priceLow),
      priceHigh: Math.round(priceHigh),
    });
  }
  
  return projections;
};

const calculateDCF = (fcf, wacc, terminalGrowth, fcfGrowth, years = 5) => {
  let dcfValue = 0;
  let projectedFCF = fcf;
  
  for (let i = 1; i <= years; i++) {
    projectedFCF *= (1 + fcfGrowth / 100);
    const pv = projectedFCF / Math.pow(1 + wacc / 100, i);
    dcfValue += pv;
  }
  
  const terminalFCF = projectedFCF * (1 + terminalGrowth / 100);
  const terminalValue = terminalFCF / ((wacc / 100) - (terminalGrowth / 100));
  const pvTerminal = terminalValue / Math.pow(1 + wacc / 100, years);
  
  dcfValue += pvTerminal;
  
  return Math.round(dcfValue);
};

// ==================== MAIN COMPONENT ====================
// ==================== AI INSIGHTS TAB COMPONENT ====================
const AIInsightsTab = ({ 
  uploadedPDF, setUploadedPDF, 
  pdfAnalysis, setPdfAnalysis,
  isAnalyzing, setIsAnalyzing,
  aiRecommendations, setAiRecommendations,
  selectedRiskProfile, setSelectedRiskProfile,
  portfolio = [], setPortfolio  // Default to empty array
}) => {
  
  const fileInputRef = useRef(null);
  const [aiError, setAiError] = useState(null);
  const [selectedExampleProfile, setSelectedExampleProfile] = useState('balanced');
  
  // Create different example portfolios based on risk profile
  // Uses percentage-based allocation (will calculate shares based on $50,000 portfolio)
  const getExamplePortfolio = (riskProfile) => {
    const portfolioValue = 50000; // Standard example portfolio size
    
    if (riskProfile === 'conservative') {
      // 30% Stocks, 70% Bonds
      return [
        { ticker: 'VOO', percentage: 15, avgCost: 400, assetClass: 'US Large Cap Equity' },
        { ticker: 'VXUS', percentage: 10, avgCost: 60, assetClass: 'International Equity' },
        { ticker: 'VNQ', percentage: 5, avgCost: 85, assetClass: 'US Real Estate' },
        { ticker: 'BND', percentage: 40, avgCost: 75, assetClass: 'US Aggregate Bonds' },
        { ticker: 'VGIT', percentage: 20, avgCost: 60, assetClass: 'US Intermediate-Term Treasury' },
        { ticker: 'TIP', percentage: 10, avgCost: 110, assetClass: 'US TIPS' }
      ].map(p => ({
        ...p,
        shares: Math.round((portfolioValue * p.percentage / 100) / p.avgCost),
        value: portfolioValue * p.percentage / 100
      }));
    } else if (riskProfile === 'growth') {
      // 85% Stocks, 15% Bonds
      return [
        { ticker: 'VOO', percentage: 35, avgCost: 400, assetClass: 'US Large Cap Equity' },
        { ticker: 'VTI', percentage: 20, avgCost: 220, assetClass: 'US Total Market Equity' },
        { ticker: 'VXUS', percentage: 15, avgCost: 60, assetClass: 'International Equity' },
        { ticker: 'VGT', percentage: 10, avgCost: 450, assetClass: 'US Technology' },
        { ticker: 'VNQ', percentage: 5, avgCost: 85, assetClass: 'US Real Estate' },
        { ticker: 'BND', percentage: 15, avgCost: 75, assetClass: 'US Aggregate Bonds' }
      ].map(p => ({
        ...p,
        shares: Math.round((portfolioValue * p.percentage / 100) / p.avgCost),
        value: portfolioValue * p.percentage / 100
      }));
    } else { // balanced (60% equities / 40% bonds)
      return [
        { ticker: 'VOO', percentage: 25, avgCost: 400, assetClass: 'US Large Cap Equity' },
        { ticker: 'VTI', percentage: 15, avgCost: 220, assetClass: 'US Total Market Equity' },
        { ticker: 'VXUS', percentage: 15, avgCost: 60, assetClass: 'International Equity' },
        { ticker: 'VNQ', percentage: 5, avgCost: 85, assetClass: 'US Real Estate' },
        { ticker: 'BND', percentage: 30, avgCost: 75, assetClass: 'US Aggregate Bonds' },
        { ticker: 'VGIT', percentage: 10, avgCost: 60, assetClass: 'US Intermediate-Term Treasury' }
      ].map(p => ({
        ...p,
        shares: Math.round((portfolioValue * p.percentage / 100) / p.avgCost),
        value: portfolioValue * p.percentage / 100
      }));
    }
  };
  
  // Use user's portfolio if they have one, otherwise use example based on selected profile
  const safePortfolio = Array.isArray(portfolio) && portfolio.length > 0 
    ? portfolio 
    : getExamplePortfolio(selectedExampleProfile);
  const isUsingExample = !Array.isArray(portfolio) || portfolio.length === 0;
  
  // Handle PDF upload
  const handlePDFUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    if (file.type !== 'application/pdf') {
      setAiError({ type: 'WRONG_FILE_TYPE_PDF', message: 'Please upload a PDF file for market outlook analysis.' });
      return;
    }
    
    setUploadedPDF(file);
    setIsAnalyzing(true);
    setPdfAnalysis(null);
    setAiRecommendations(null);
    setAiError(null);  // Clear previous errors
    
    try {
      // Call backend API with the file directly
      await analyzePDFOutlook(file, file.name, safePortfolio);
      
    } catch (error) {
      console.error('Error uploading PDF:', error);
      setAiError({ type: 'API_ERROR', message: error.message });
      setIsAnalyzing(false);
    }
  };
  
  // Analyze PDF with backend API
  const analyzePDFOutlook = async (file, fileName, currentPortfolio) => {
    try {
      // Create FormData for multipart upload
      const formData = new FormData();
      formData.append('pdf', file);
      
      // Include portfolio data if available
      console.log('🔍 Current portfolio being sent:', {
        exists: !!currentPortfolio,
        isArray: Array.isArray(currentPortfolio),
        length: currentPortfolio?.length || 0,
        isExample: isUsingExample,
        riskProfile: isUsingExample ? selectedExampleProfile : 'user portfolio',
        sample: currentPortfolio?.[0]
      });
      
      if (currentPortfolio && currentPortfolio.length > 0) {
        formData.append('portfolio', JSON.stringify(currentPortfolio));
        if (isUsingExample) {
          console.log(`📊 Using example ${selectedExampleProfile} portfolio for analysis:`, currentPortfolio.length, 'positions');
        } else {
          console.log('✅ Portfolio attached to request:', currentPortfolio.length, 'positions');
        }
      } else {
        console.log('ℹ️ No portfolio attached - will get risk profile selector');
      }
      
      console.log('📤 Sending PDF to backend for analysis...');
      
      // Call backend API
      const response = await fetch('http://localhost:3001/api/analyze-pdf', {
        method: 'POST',
        body: formData
        // Note: Don't set Content-Type header, browser will set it with boundary
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.details || errorData.error || 'API request failed');
      }
      
      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.error || 'Analysis failed');
      }
      
      console.log('✅ PDF Analysis Complete:', result.data);
      console.log('🔍 Recommendations type:', Array.isArray(result.data.recommendations) ? 'array' : typeof result.data.recommendations);
      console.log('🔍 Recommendations value:', result.data.recommendations);
      console.log('🔍 Has portfolio analysis:', !!result.data.portfolioAnalysis);
      console.log('🔍 Risk profile needed:', !!result.data.riskProfileNeeded);
      
      // Set the analysis data
      setPdfAnalysis(result.data);
      
      // Handle recommendations - could be array (with portfolio) or object (without portfolio)
      const recs = result.data.recommendations;
      
      if (Array.isArray(recs)) {
        console.log('✅ Setting recommendations as array:', recs.length, 'items');
        console.log('📊 First recommendation:', recs[0]);
        setAiRecommendations(recs);
      } else if (recs && typeof recs === 'object') {
        // No portfolio - recommendations are grouped by risk profile
        console.log('ℹ️ No portfolio - recommendations grouped by risk profile');
        console.log('📊 Available profiles:', Object.keys(recs));
        setAiRecommendations([]);
        setSelectedRiskProfile(null); // Reset selection
      } else {
        console.warn('⚠️ Unexpected recommendations format:', typeof recs);
        setAiRecommendations([]);
      }
      
    } catch (error) {
      console.error('❌ Error analyzing PDF:', error);
      
      // Determine error type
      let errorType = 'API_ERROR';
      let errorMessage = error.message;
      
      if (error.message.includes('File too large') || error.message.includes('413')) {
        errorType = 'FILE_TOO_LARGE';
      } else if (error.message.includes('parse') || error.message.includes('PDF')) {
        errorType = 'PDF_PARSE_ERROR';
      } else if (error.message.includes('429')) {
        errorType = 'RATE_LIMIT';
      } else if (error.message.includes('ECONNREFUSED') || error.message.includes('network')) {
        errorType = 'NETWORK_ERROR';
      }
      
      setAiError({ type: errorType, message: errorMessage });
    } finally {
      setIsAnalyzing(false);
    }
  };
  
  // Apply recommendations to portfolio
  const applyRecommendations = () => {
    if (!aiRecommendations || aiRecommendations.length === 0) return;
    
    const confirmed = window.confirm('This will update your portfolio based on AI recommendations. Continue?');
    if (!confirmed) return;
    
    // Safety check
    if (!aiRecommendations || !Array.isArray(aiRecommendations) || aiRecommendations.length === 0) {
      alert('No recommendations available to apply');
      return;
    }
    
    // Calculate total current portfolio value
    const currentTotal = safePortfolio.reduce((sum, p) => sum + p.value, 0) || 100000;
    
    // Create new positions based on recommendations
    const newPositions = aiRecommendations.map(rec => ({
      ticker: rec.ticker,
      shares: 0, // We'll use value-based
      value: currentTotal * (rec.allocation / 100),
      assetClass: 'PENDING', // Will be detected on portfolio analysis
      description: rec.name
    }));
    
    setPortfolio(newPositions);
    alert('Portfolio updated with AI recommendations!');
  };
  
  return (
    <div style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto' }}>
      <h2 style={{ 
        fontSize: '2rem', 
        fontWeight: '700', 
        marginBottom: '1rem',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
      }}>
        🤖 AI Portfolio Insights
      </h2>
      
      <p style={{ 
        fontSize: '1.1rem', 
        color: '#64748b', 
        marginBottom: '2rem',
        lineHeight: '1.6'
      }}>
        Upload a market outlook PDF from banks or asset managers. Our AI will analyze it and suggest how to implement those views in your portfolio.
      </p>
      
      {/* Example Portfolio Notice */}
      {isUsingExample && (
        <div style={{
          padding: '1.5rem',
          marginBottom: '1.5rem',
          background: '#fffbeb',
          border: '2px solid #fbbf24',
          borderRadius: '12px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
            <div style={{ fontSize: '1.5rem' }}>💡</div>
            <div>
              <strong style={{ color: '#92400e', display: 'block', marginBottom: '0.25rem' }}>
                Using Example Portfolio
              </strong>
              <span style={{ color: '#78350f', fontSize: '0.9rem' }}>
                You haven't uploaded your portfolio yet. Select a risk profile below to see example analysis. 
                Upload your own portfolio in the "Portfolio Analyzer" tab for personalized recommendations.
              </span>
            </div>
          </div>
          
          {/* Risk Profile Selector */}
          <div style={{ marginTop: '1rem' }}>
            <label style={{ 
              display: 'block', 
              marginBottom: '0.75rem', 
              fontWeight: '600', 
              color: '#92400e',
              fontSize: '0.95rem'
            }}>
              Select Risk Profile:
            </label>
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
              {[
                { value: 'conservative', label: '🛡️ Conservative', description: '30% Stocks, 70% Bonds' },
                { value: 'balanced', label: '⚖️ Balanced', description: '60% Stocks, 40% Bonds' },
                { value: 'growth', label: '📈 Growth', description: '85% Stocks, 15% Bonds' }
              ].map(profile => (
                <button
                  key={profile.value}
                  onClick={() => setSelectedExampleProfile(profile.value)}
                  style={{
                    flex: '1',
                    minWidth: '180px',
                    padding: '1rem',
                    background: selectedExampleProfile === profile.value ? '#667eea' : 'white',
                    color: selectedExampleProfile === profile.value ? 'white' : '#4a5568',
                    border: selectedExampleProfile === profile.value ? '2px solid #667eea' : '2px solid #e2e8f0',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    fontWeight: '600',
                    fontSize: '0.9rem',
                    textAlign: 'left'
                  }}
                  onMouseEnter={(e) => {
                    if (selectedExampleProfile !== profile.value) {
                      e.currentTarget.style.borderColor = '#667eea';
                      e.currentTarget.style.background = '#f7fafc';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (selectedExampleProfile !== profile.value) {
                      e.currentTarget.style.borderColor = '#e2e8f0';
                      e.currentTarget.style.background = 'white';
                    }
                  }}
                >
                  <div style={{ marginBottom: '0.25rem' }}>{profile.label}</div>
                  <div style={{ 
                    fontSize: '0.75rem', 
                    opacity: selectedExampleProfile === profile.value ? 0.9 : 0.7,
                    fontWeight: '400'
                  }}>
                    {profile.description}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      
      {/* Upload Section */}
      <Card style={{ marginBottom: '2rem', background: 'linear-gradient(135deg, #667eea15 0%, #764ba215 100%)' }}>
        <h3 style={{ fontSize: '1.3rem', fontWeight: '600', marginBottom: '1rem' }}>
          📄 Upload Market Outlook
        </h3>
        
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf"
          onChange={handlePDFUpload}
          style={{ display: 'none' }}
        />
        
        <div
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            e.currentTarget.style.borderColor = '#764ba2';
            e.currentTarget.style.background = '#f8f9ff';
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            e.stopPropagation();
            e.currentTarget.style.borderColor = '#667eea';
            e.currentTarget.style.background = 'white';
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            e.currentTarget.style.borderColor = '#667eea';
            e.currentTarget.style.background = 'white';
            
            const file = e.dataTransfer.files[0];
            if (file && file.type === 'application/pdf') {
              const fakeEvent = { target: { files: [file] } };
              handlePDFUpload(fakeEvent);
            } else {
              alert('Please drop a PDF file');
            }
          }}
          style={{
            border: '3px dashed #667eea',
            borderRadius: '12px',
            padding: '3rem',
            textAlign: 'center',
            cursor: 'pointer',
            background: 'white',
            transition: 'all 0.3s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = '#764ba2';
            e.currentTarget.style.background = '#f8f9ff';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = '#667eea';
            e.currentTarget.style.background = 'white';
          }}
        >
          {uploadedPDF ? (
            <div>
              <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📄</div>
              <div style={{ fontSize: '1.1rem', fontWeight: '600', color: '#0f172a' }}>
                {uploadedPDF.name}
              </div>
              <div style={{ fontSize: '0.9rem', color: '#64748b', marginTop: '0.5rem' }}>
                Click to upload a different file
              </div>
            </div>
          ) : (
            <div>
              <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>☁️</div>
              <div style={{ fontSize: '1.1rem', fontWeight: '600', color: '#0f172a', marginBottom: '0.5rem' }}>
                Click to upload or drag and drop
              </div>
              <div style={{ fontSize: '0.9rem', color: '#64748b' }}>
                PDF files only (e.g., "Goldman Sachs 2025 Outlook.pdf")
              </div>
            </div>
          )}
        </div>
        
        <UploadHelpText type="pdf" />
      </Card>
      
      {/* Re-run Analysis Button */}
      {uploadedPDF && !isAnalyzing && pdfAnalysis && (
        <Card style={{ marginBottom: '2rem', textAlign: 'center' }}>
          <button
            onClick={() => {
              console.log('🔄 Re-running analysis with current portfolio:', safePortfolio.length, 'positions');
              setIsAnalyzing(true);
              setPdfAnalysis(null);
              setAiRecommendations(null);
              analyzePDFOutlook(uploadedPDF, uploadedPDF.name, safePortfolio)
                .catch(error => {
                  console.error('Error re-running analysis:', error);
                  setIsAnalyzing(false);
                });
            }}
            style={{
              padding: '1rem 2rem',
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              color: 'white',
              border: 'none',
              borderRadius: '12px',
              fontSize: '1rem',
              fontWeight: '600',
              cursor: 'pointer',
              transition: 'transform 0.2s ease',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              margin: '0 auto'
            }}
            onMouseEnter={(e) => e.currentTarget.style.transform = 'translateY(-2px)'}
            onMouseLeave={(e) => e.currentTarget.style.transform = 'translateY(0)'}
          >
            <span style={{ fontSize: '1.2rem' }}>🔄</span>
            Re-run Analysis with Current Portfolio
          </button>
          <div style={{ fontSize: '0.85rem', color: '#64748b', marginTop: '0.75rem' }}>
            {safePortfolio.length > 0 
              ? `Will analyze based on your ${safePortfolio.length} current positions` 
              : 'Will provide recommendations for new portfolio (no positions loaded)'}
          </div>
        </Card>
      )}
      
      {/* Loading State */}
      {isAnalyzing && (
        <Card style={{ marginBottom: '2rem', textAlign: 'center', padding: '3rem' }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🤖</div>
          <div style={{ fontSize: '1.3rem', fontWeight: '600', marginBottom: '0.5rem' }}>
            Analyzing PDF with AI...
          </div>
          <div style={{ fontSize: '0.9rem', color: '#64748b' }}>
            This may take 30-60 seconds
          </div>
        </Card>
      )}
      
      {/* Error Display */}
      {aiError && <ErrorMessage type={aiError.type} customMessage={aiError.message} />}
      
      {/* Analysis Results */}
      {pdfAnalysis && !isAnalyzing && (
        <div>
          <AIAnalysisDisclaimer />
          {/* Portfolio Analysis (if available) */}
          {pdfAnalysis.portfolioAnalysis && (
            <Card style={{ marginBottom: '2rem', background: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)', border: '2px solid #f59e0b' }}>
              <h3 style={{ fontSize: '1.3rem', fontWeight: '600', marginBottom: '1rem', color: '#78350f' }}>
                🔍 Your Portfolio Analysis
              </h3>
              
              {/* Risk Profile & Total Value */}
              {pdfAnalysis.portfolioAnalysis.totalValue && (
                <div style={{ marginBottom: '1.5rem', padding: '1rem', background: '#fffbeb', borderRadius: '8px', border: '2px solid #fbbf24' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                    <div>
                      <div style={{ fontSize: '0.85rem', color: '#92400e', marginBottom: '0.25rem' }}>Total Portfolio Value</div>
                      <div style={{ fontSize: '1.5rem', fontWeight: '700', color: '#78350f' }}>
                        ${pdfAnalysis.portfolioAnalysis.totalValue.toLocaleString()}
                      </div>
                    </div>
                    {pdfAnalysis.portfolioAnalysis.riskProfile && (
                      <div>
                        <div style={{ fontSize: '0.85rem', color: '#92400e', marginBottom: '0.25rem' }}>Detected Risk Profile</div>
                        <div style={{ fontSize: '1.2rem', fontWeight: '700', color: '#78350f' }}>
                          {pdfAnalysis.portfolioAnalysis.riskProfile}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
              
              {/* Fund Classification */}
              {pdfAnalysis.portfolioAnalysis.fundClassification && (
                <div style={{ marginBottom: '1.5rem' }}>
                  <h4 style={{ fontSize: '1.1rem', fontWeight: '600', marginBottom: '0.75rem', color: '#92400e' }}>
                    📋 Active vs Passive Classification:
                  </h4>
                  
                  {pdfAnalysis.portfolioAnalysis.fundClassification.activeFunds?.length > 0 && (
                    <div style={{ marginBottom: '0.75rem', padding: '1rem', background: '#fef3c7', borderLeft: '4px solid #f59e0b', borderRadius: '8px' }}>
                      <div style={{ fontWeight: '700', fontSize: '0.95rem', color: '#78350f', marginBottom: '0.5rem' }}>
                        🎯 Actively Managed Funds:
                      </div>
                      {pdfAnalysis.portfolioAnalysis.fundClassification.activeFunds.map((fund, idx) => (
                        <div key={idx} style={{ fontSize: '0.85rem', color: '#92400e', marginBottom: '0.25rem' }}>
                          • <strong>{fund.ticker}</strong> - {fund.name}
                          {fund.reason && <div style={{ fontSize: '0.8rem', color: '#b45309', marginLeft: '1rem' }}>↳ {fund.reason}</div>}
                        </div>
                      ))}
                    </div>
                  )}
                  
                  {pdfAnalysis.portfolioAnalysis.fundClassification.passiveFunds?.length > 0 && (
                    <div style={{ marginBottom: '0.75rem', padding: '1rem', background: '#f0fdf4', borderLeft: '4px solid #10b981', borderRadius: '8px' }}>
                      <div style={{ fontWeight: '700', fontSize: '0.95rem', color: '#065f46', marginBottom: '0.5rem' }}>
                        📊 Passive Index Funds:
                      </div>
                      {pdfAnalysis.portfolioAnalysis.fundClassification.passiveFunds.map((fund, idx) => (
                        <div key={idx} style={{ fontSize: '0.85rem', color: '#047857', marginBottom: '0.25rem' }}>
                          • <strong>{fund.ticker}</strong> - {fund.name}
                          {fund.reason && <div style={{ fontSize: '0.8rem', color: '#059669', marginLeft: '1rem' }}>↳ {fund.reason}</div>}
                        </div>
                      ))}
                    </div>
                  )}
                  
                  {pdfAnalysis.portfolioAnalysis.fundClassification.individualStocks?.length > 0 && (
                    <div style={{ padding: '1rem', background: '#eff6ff', borderLeft: '4px solid #3b82f6', borderRadius: '8px' }}>
                      <div style={{ fontWeight: '700', fontSize: '0.95rem', color: '#1e40af', marginBottom: '0.5rem' }}>
                        📈 Individual Stocks:
                      </div>
                      <div style={{ fontSize: '0.85rem', color: '#1e3a8a' }}>
                        {pdfAnalysis.portfolioAnalysis.fundClassification.individualStocks.join(', ')}
                      </div>
                    </div>
                  )}
                </div>
              )}
              
              {/* Sector Breakdown */}
              {pdfAnalysis.portfolioAnalysis.sectorBreakdown && pdfAnalysis.portfolioAnalysis.sectorBreakdown.length > 0 && (
                <div style={{ marginBottom: '1.5rem' }}>
                  <h4 style={{ fontSize: '1.1rem', fontWeight: '600', marginBottom: '0.75rem', color: '#92400e' }}>
                    🎯 Sector Exposure Analysis:
                  </h4>
                  <div style={{ display: 'grid', gap: '0.75rem' }}>
                    {pdfAnalysis.portfolioAnalysis.sectorBreakdown.map((sector, idx) => (
                      <div
                        key={idx}
                        style={{
                          padding: '1rem',
                          background: '#f0fdf4',
                          borderLeft: '4px solid #10b981',
                          borderRadius: '8px',
                        }}
                      >
                        <div style={{ fontWeight: '700', fontSize: '1rem', color: '#065f46', marginBottom: '0.25rem' }}>
                          {sector.sector}: {sector.percentage}%
                          {sector.dollarValue && ` ($${sector.dollarValue.toLocaleString()})`}
                        </div>
                        <div style={{ fontSize: '0.85rem', color: '#047857', marginBottom: '0.25rem' }}>
                          {sector.assessment}
                        </div>
                        {sector.sources && (
                          <div style={{ fontSize: '0.8rem', color: '#059669', fontFamily: 'monospace' }}>
                            Sources: {sector.sources}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              
              {/* Theme Breakdown - only show if themes exist */}
              {pdfAnalysis.portfolioAnalysis.themes && pdfAnalysis.portfolioAnalysis.themes.length > 0 && (
              <div style={{ marginBottom: '1.5rem' }}>
                <h4 style={{ fontSize: '1.1rem', fontWeight: '600', marginBottom: '0.75rem', color: '#92400e' }}>
                  Current Theme Exposure:
                </h4>
                <div style={{ display: 'grid', gap: '0.75rem' }}>
                  {pdfAnalysis.portfolioAnalysis.themes.map((theme, idx) => (
                    <div
                      key={idx}
                      style={{
                        padding: '1rem',
                        background: '#fffbeb',
                        borderLeft: '4px solid #f59e0b',
                        borderRadius: '8px',
                      }}
                    >
                      <div style={{ fontWeight: '700', fontSize: '1rem', color: '#78350f', marginBottom: '0.25rem' }}>
                        {theme.theme}: {theme.percentage}%
                        {theme.dollarValue && ` ($${theme.dollarValue.toLocaleString()})`}
                      </div>
                      {theme.positions && (
                        <div style={{ fontSize: '0.85rem', color: '#b45309', marginBottom: '0.5rem', fontFamily: 'monospace' }}>
                          {theme.positions}
                        </div>
                      )}
                      <div style={{ fontSize: '0.9rem', color: '#92400e', marginBottom: '0.25rem' }}>
                        {theme.assessment}
                      </div>
                      <div style={{ fontSize: '0.85rem', color: '#b45309', fontStyle: 'italic' }}>
                        → {theme.recommendation}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              )}
              
              {/* Strengths (NEW) */}
              {pdfAnalysis.portfolioAnalysis.strengths && pdfAnalysis.portfolioAnalysis.strengths.length > 0 && (
                <div style={{ marginBottom: '1.5rem' }}>
                  <h4 style={{ fontSize: '0.95rem', fontWeight: '600', marginBottom: '0.5rem', color: '#92400e' }}>
                    ✨ Portfolio Strengths:
                  </h4>
                  <ul style={{ fontSize: '0.85rem', color: '#78350f', paddingLeft: '1.5rem', margin: 0 }}>
                    {pdfAnalysis.portfolioAnalysis.strengths.map((strength, idx) => (
                      <li key={idx} style={{ marginBottom: '0.25rem' }}>{strength}</li>
                    ))}
                  </ul>
                </div>
              )}
              
              {/* Gaps & Concentrations */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                {pdfAnalysis.portfolioAnalysis.gaps && pdfAnalysis.portfolioAnalysis.gaps.length > 0 && (
                  <div>
                    <h4 style={{ fontSize: '0.95rem', fontWeight: '600', marginBottom: '0.5rem', color: '#92400e' }}>
                      ⚠️ Gaps Identified:
                    </h4>
                    <ul style={{ fontSize: '0.85rem', color: '#78350f', paddingLeft: '1.5rem', margin: 0 }}>
                      {pdfAnalysis.portfolioAnalysis.gaps.map((gap, idx) => (
                        <li key={idx} style={{ marginBottom: '0.25rem' }}>{gap}</li>
                      ))}
                    </ul>
                  </div>
                )}
                
                {pdfAnalysis.portfolioAnalysis.concentrations && pdfAnalysis.portfolioAnalysis.concentrations.length > 0 && (
                  <div>
                    <h4 style={{ fontSize: '0.95rem', fontWeight: '600', marginBottom: '0.5rem', color: '#92400e' }}>
                      📍 Concentrations:
                    </h4>
                    <ul style={{ fontSize: '0.85rem', color: '#78350f', paddingLeft: '1.5rem', margin: 0 }}>
                      {pdfAnalysis.portfolioAnalysis.concentrations.map((conc, idx) => (
                        <li key={idx} style={{ marginBottom: '0.25rem' }}>{conc}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </Card>
          )}
          
          {/* Summary */}
          <Card style={{ marginBottom: '2rem' }}>
            <h3 style={{ fontSize: '1.3rem', fontWeight: '600', marginBottom: '1rem' }}>
              📊 Outlook Summary
            </h3>
            <p style={{ fontSize: '1rem', color: '#475569', lineHeight: '1.6' }}>
              {pdfAnalysis.summary}
            </p>
          </Card>
          
          {/* Key Views */}
          <Card style={{ marginBottom: '2rem' }}>
            <h3 style={{ fontSize: '1.3rem', fontWeight: '600', marginBottom: '1rem' }}>
              🎯 Key Investment Views
            </h3>
            <div style={{ display: 'grid', gap: '0.75rem' }}>
              {pdfAnalysis.keyViews?.map((view, idx) => (
                <div
                  key={idx}
                  style={{
                    padding: '1rem',
                    background: 'linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%)',
                    borderLeft: '4px solid #0ea5e9',
                    borderRadius: '8px',
                    fontSize: '0.95rem',
                    color: '#0f172a',
                  }}
                >
                  {view}
                </div>
              ))}
            </div>
          </Card>
          
          {/* Recommendations */}
          {pdfAnalysis.proposedPortfolio ? (
            <Card style={{ marginBottom: '2rem', background: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)', border: '2px solid #f59e0b' }}>
              <h3 style={{ fontSize: '1.3rem', fontWeight: '600', marginBottom: '1rem', color: '#78350f' }}>
                🎯 Proposed Portfolio Based on Outlook
              </h3>
              <p style={{ fontSize: '1rem', color: '#92400e', marginBottom: '1.5rem' }}>
                {pdfAnalysis.proposedPortfolio.rationale}
              </p>
              
              {/* Portfolio Summary */}
              <div style={{ 
                display: 'grid', 
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', 
                gap: '1rem',
                marginBottom: '2rem',
                padding: '1rem',
                background: '#fffbeb',
                borderRadius: '8px'
              }}>
                <div>
                  <div style={{ fontSize: '0.8rem', color: '#78350f', marginBottom: '0.25rem' }}>Total Value</div>
                  <div style={{ fontSize: '1.5rem', fontWeight: '700', color: '#92400e' }}>
                    ${pdfAnalysis.proposedPortfolio.totalValue?.toLocaleString() || '100,000'}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '0.8rem', color: '#78350f', marginBottom: '0.25rem' }}>Expected Return</div>
                  <div style={{ fontSize: '1.5rem', fontWeight: '700', color: '#16a34a' }}>
                    {pdfAnalysis.proposedPortfolio.expectedReturn?.toFixed(1)}%
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '0.8rem', color: '#78350f', marginBottom: '0.25rem' }}>Expected Volatility</div>
                  <div style={{ fontSize: '1.5rem', fontWeight: '700', color: '#ea580c' }}>
                    {pdfAnalysis.proposedPortfolio.expectedVolatility?.toFixed(1)}%
                  </div>
                </div>
              </div>
              
              {/* Holdings Table */}
              <div style={{ overflowX: 'auto', marginBottom: '1.5rem' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #f59e0b' }}>
                      <th style={{ padding: '0.75rem', textAlign: 'left', color: '#78350f', fontSize: '0.85rem' }}>TICKER</th>
                      <th style={{ padding: '0.75rem', textAlign: 'left', color: '#78350f', fontSize: '0.85rem' }}>NAME</th>
                      <th style={{ padding: '0.75rem', textAlign: 'left', color: '#78350f', fontSize: '0.85rem' }}>ASSET CLASS</th>
                      <th style={{ padding: '0.75rem', textAlign: 'right', color: '#78350f', fontSize: '0.85rem' }}>WEIGHT</th>
                      <th style={{ padding: '0.75rem', textAlign: 'right', color: '#78350f', fontSize: '0.85rem' }}>VALUE</th>
                      <th style={{ padding: '0.75rem', textAlign: 'left', color: '#78350f', fontSize: '0.85rem' }}>RATIONALE</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pdfAnalysis.proposedPortfolio.allocation?.map((holding, idx) => (
                      <tr key={idx} style={{ borderBottom: '1px solid #fde68a' }}>
                        <td style={{ padding: '0.75rem', fontWeight: '600', color: '#1a202c' }}>{holding.ticker}</td>
                        <td style={{ padding: '0.75rem', color: '#4a5568', fontSize: '0.9rem' }}>{holding.name}</td>
                        <td style={{ padding: '0.75rem', color: '#4a5568', fontSize: '0.9rem' }}>{holding.assetClass}</td>
                        <td style={{ padding: '0.75rem', textAlign: 'right', fontWeight: '600', color: '#16a34a' }}>
                          {holding.targetWeight}%
                        </td>
                        <td style={{ padding: '0.75rem', textAlign: 'right', color: '#4a5568' }}>
                          ${holding.targetValue?.toLocaleString()}
                        </td>
                        <td style={{ padding: '0.75rem', color: '#78350f', fontSize: '0.9rem', lineHeight: '1.4' }}>
                          {holding.rationale}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              
              {/* Key Characteristics */}
              {pdfAnalysis.proposedPortfolio.keyCharacteristics && (
                <div style={{ padding: '1rem', background: '#fef3c7', borderRadius: '8px' }}>
                  <strong style={{ color: '#78350f', display: 'block', marginBottom: '0.5rem' }}>
                    Key Characteristics:
                  </strong>
                  <ul style={{ margin: 0, paddingLeft: '1.5rem', color: '#92400e' }}>
                    {pdfAnalysis.proposedPortfolio.keyCharacteristics.map((char, idx) => (
                      <li key={idx} style={{ marginBottom: '0.25rem' }}>{char}</li>
                    ))}
                  </ul>
                </div>
              )}
              
              <div style={{ marginTop: '1.5rem', padding: '1rem', background: '#fef3c7', borderRadius: '8px', fontSize: '0.85rem', color: '#92400e' }}>
                💡 <strong>Tip:</strong> Upload your current portfolio in the Portfolio Analyzer tab to see how it compares to this proposed allocation and get specific rebalancing recommendations.
              </div>
            </Card>
          ) : pdfAnalysis.riskProfileNeeded ? (
            <Card style={{ marginBottom: '2rem', background: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)', border: '2px solid #f59e0b' }}>
              <h3 style={{ fontSize: '1.3rem', fontWeight: '600', marginBottom: '1rem', color: '#78350f' }}>
                ⚙️ Risk Profile Needed
              </h3>
              <p style={{ fontSize: '1rem', color: '#92400e', marginBottom: '1.5rem' }}>
                Since no portfolio was provided, please select your risk tolerance to see personalized recommendations:
              </p>
              
              {pdfAnalysis.riskProfileOptions && (
                <div style={{ display: 'grid', gap: '1rem' }}>
                  {Object.entries(pdfAnalysis.riskProfileOptions).map(([profile, description]) => (
                    <div
                      key={profile}
                      onClick={() => {
                        console.log('📊 Selected risk profile:', profile);
                        setSelectedRiskProfile(profile);
                        // Set recommendations to the array for this profile
                        if (pdfAnalysis.recommendations && pdfAnalysis.recommendations[profile]) {
                          setAiRecommendations(pdfAnalysis.recommendations[profile]);
                        }
                      }}
                      style={{
                        padding: '1.5rem',
                        background: selectedRiskProfile === profile ? '#fef3c7' : '#fffbeb',
                        border: selectedRiskProfile === profile ? '3px solid #f59e0b' : '2px solid #fbbf24',
                        borderRadius: '12px',
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.transform = 'translateY(-2px)';
                        e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.transform = 'translateY(0)';
                        e.currentTarget.style.boxShadow = 'none';
                      }}
                    >
                      <div style={{ fontSize: '1.2rem', fontWeight: '700', color: '#78350f', marginBottom: '0.5rem', textTransform: 'capitalize' }}>
                        {profile.replace(/([A-Z])/g, ' $1').trim()} {selectedRiskProfile === profile && '✓'}
                      </div>
                      <div style={{ fontSize: '0.9rem', color: '#92400e' }}>
                        {description}
                      </div>
                      {pdfAnalysis.recommendations && pdfAnalysis.recommendations[profile] && (
                        <div style={{ marginTop: '1rem', fontSize: '0.85rem', color: '#b45309' }}>
                          📊 {pdfAnalysis.recommendations[profile].length} recommendations available
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              
              <div style={{ marginTop: '1.5rem', padding: '1rem', background: '#fef3c7', borderRadius: '8px', fontSize: '0.85rem', color: '#92400e' }}>
                💡 <strong>Tip:</strong> Upload your portfolio in the Portfolio Analyzer tab for personalized recommendations based on your actual holdings.
              </div>
            </Card>
          ) : null}
          
          {/* Show recommendations section if: (1) has portfolio with recommendations OR (2) risk profile selected */}
          {((aiRecommendations && Array.isArray(aiRecommendations) && aiRecommendations.length > 0) || 
            (pdfAnalysis?.riskProfileNeeded && selectedRiskProfile && aiRecommendations?.length > 0)) && (
          <Card style={{ marginBottom: '2rem' }}>
            <h3 style={{ fontSize: '1.3rem', fontWeight: '600', marginBottom: '1rem' }}>
              💡 {pdfAnalysis?.riskProfileNeeded ? `Recommendations for ${selectedRiskProfile?.replace(/([A-Z])/g, ' $1').trim()} Profile` : 'Recommended Portfolio Changes'}
            </h3>
            
            <div style={{ display: 'grid', gap: '1rem' }}>
              {Array.isArray(aiRecommendations) && aiRecommendations.length > 0 ? (
                aiRecommendations.map((rec, idx) => (
                <div
                  key={idx}
                  style={{
                    padding: '1.5rem',
                    background: '#ffffff',
                    border: '2px solid #e2e8f0',
                    borderRadius: '12px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '1rem' }}>
                    <div>
                      <div style={{ fontSize: '1.2rem', fontWeight: '700', color: '#0f172a' }}>
                        {rec.ticker}
                        {rec.name && <span style={{ fontSize: '0.9rem', color: '#64748b', marginLeft: '0.5rem' }}>- {rec.name}</span>}
                      </div>
                    </div>
                    {rec.action && (
                      <div style={{
                        padding: '0.5rem 1rem',
                        background: rec.action === 'TRIM' ? '#fff7ed' : rec.action === 'ADD' ? '#dcfce7' : '#e0f2fe',
                        color: rec.action === 'TRIM' ? '#c2410c' : rec.action === 'ADD' ? '#166534' : '#075985',
                        borderRadius: '8px',
                        fontWeight: '700',
                        fontSize: '0.9rem',
                      }}>
                        {rec.action}
                      </div>
                    )}
                  </div>
                  
                  {/* Dollar amounts and percentages */}
                  {rec.changeAmount && (
                    <div style={{ marginBottom: '1rem', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', padding: '1rem', background: '#f8fafc', borderRadius: '8px' }}>
                      <div>
                        <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '0.25rem' }}>Current</div>
                        <div style={{ fontSize: '1rem', fontWeight: '600', color: '#0f172a' }}>
                          ${rec.currentAmount?.toLocaleString() || '0'}
                          <span style={{ fontSize: '0.85rem', color: '#64748b', marginLeft: '0.25rem' }}>({rec.currentPercent}%)</span>
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '0.25rem' }}>Change</div>
                        <div style={{ fontSize: '1rem', fontWeight: '700', color: rec.changeAmount > 0 ? '#16a34a' : '#dc2626' }}>
                          {rec.changeAmount > 0 ? '+' : ''}${rec.changeAmount.toLocaleString()}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '0.25rem' }}>New</div>
                        <div style={{ fontSize: '1rem', fontWeight: '600', color: '#667eea' }}>
                          ${rec.newAmount?.toLocaleString()}
                          <span style={{ fontSize: '0.85rem', color: '#64748b', marginLeft: '0.25rem' }}>({rec.newPercent}%)</span>
                        </div>
                      </div>
                    </div>
                  )}
                  
                  {/* For old-style recommendations without dollar details */}
                  {!rec.changeAmount && rec.allocation && (
                    <div style={{ marginBottom: '1rem' }}>
                      <div style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '0.25rem' }}>
                        Target Allocation
                      </div>
                      <div style={{ fontSize: '1.5rem', fontWeight: '700', color: '#667eea' }}>
                        {rec.allocation}%
                      </div>
                    </div>
                  )}
                  
                  <div style={{ 
                    padding: '1rem',
                    background: '#f8fafc',
                    borderRadius: '8px',
                    fontSize: '0.9rem',
                    color: '#475569',
                    lineHeight: '1.5'
                  }}>
                    <strong>Rationale:</strong> {rec.rationale}
                  </div>
                </div>
              ))
              ) : (
                <div style={{ padding: '2rem', textAlign: 'center', color: '#64748b', background: '#f8fafc', borderRadius: '12px' }}>
                  <p style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>No recommendations available</p>
                  <p style={{ fontSize: '0.85rem' }}>Upload a portfolio in the Portfolio Analyzer tab first</p>
                </div>
              )}
            </div>
            
            {/* Net cash required summary */}
            {pdfAnalysis.netCashRequired !== undefined && (
              <div style={{ marginTop: '1rem', padding: '1rem', background: pdfAnalysis.netCashRequired > 0 ? '#fef3c7' : '#dcfce7', borderRadius: '8px', border: '2px solid ' + (pdfAnalysis.netCashRequired > 0 ? '#fbbf24' : '#22c55e') }}>
                <div style={{ fontWeight: '600', marginBottom: '0.25rem' }}>
                  {pdfAnalysis.netCashRequired > 0 ? '💰 Additional Cash Required:' : '✅ Cash Neutral Rebalancing:'}
                </div>
                <div style={{ fontSize: '1.2rem', fontWeight: '700' }}>
                  ${Math.abs(pdfAnalysis.netCashRequired).toLocaleString()}
                  {pdfAnalysis.netCashRequired === 0 && <span style={{ fontSize: '0.9rem', fontWeight: '400', marginLeft: '0.5rem' }}>(funded by TRIM positions)</span>}
                </div>
              </div>
            )}
            {/* Apply Button */}
            {aiRecommendations && aiRecommendations.length > 0 && (
              <button
                onClick={applyRecommendations}
                style={{
                  width: '100%',
                  marginTop: '1.5rem',
                  padding: '1.25rem',
                  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '12px',
                  fontSize: '1.1rem',
                  fontWeight: '600',
                  cursor: 'pointer',
                  transition: 'transform 0.2s ease',
                }}
                onMouseEnter={(e) => e.currentTarget.style.transform = 'translateY(-2px)'}
                onMouseLeave={(e) => e.currentTarget.style.transform = 'translateY(0)'}
              >
                🚀 Apply These Recommendations to Portfolio
              </button>
            )}
          </Card>
          )}
          
          {/* Rebalancing Trades (if portfolio exists) */}
          {pdfAnalysis.rebalancing && pdfAnalysis.rebalancing.length > 0 && (
            <Card style={{ marginBottom: '2rem' }}>
              <h3 style={{ fontSize: '1.3rem', fontWeight: '600', marginBottom: '1rem' }}>
                ⚖️ Suggested Rebalancing Trades
              </h3>
              
              <div style={{ display: 'grid', gap: '0.75rem' }}>
                {pdfAnalysis.rebalancing.map((trade, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '1rem',
                      background: trade.action === 'BUY' ? '#f0fdf4' : '#fef2f2',
                      borderLeft: `4px solid ${trade.action === 'BUY' ? '#22c55e' : '#ef4444'}`,
                      borderRadius: '8px',
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: '700', fontSize: '1rem', marginBottom: '0.25rem' }}>
                        {trade.action} {trade.ticker}
                      </div>
                      <div style={{ fontSize: '0.85rem', color: '#64748b' }}>
                        {trade.reason}
                      </div>
                    </div>
                    <div style={{ fontSize: '1.1rem', fontWeight: '700' }}>
                      ${typeof trade.amount === 'number' ? trade.amount.toLocaleString() : '0'}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
          
          {/* Expected Impact */}
          {pdfAnalysis.expectedImpact && (
            <Card>
              <h3 style={{ fontSize: '1.3rem', fontWeight: '600', marginBottom: '1rem' }}>
                📈 Expected Impact
              </h3>
              
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
                <div style={{ 
                  padding: '1.25rem',
                  background: '#fef3c7',
                  borderRadius: '12px',
                }}>
                  <div style={{ fontSize: '0.85rem', color: '#92400e', marginBottom: '0.5rem' }}>
                    Risk Level
                  </div>
                  <div style={{ fontSize: '1.3rem', fontWeight: '700', color: '#78350f' }}>
                    {pdfAnalysis.expectedImpact.riskLevel}
                  </div>
                </div>
                
                <div style={{ 
                  padding: '1.25rem',
                  background: '#d1fae5',
                  borderRadius: '12px',
                }}>
                  <div style={{ fontSize: '0.85rem', color: '#065f46', marginBottom: '0.5rem' }}>
                    Expected Return
                  </div>
                  <div style={{ fontSize: '1.3rem', fontWeight: '700', color: '#047857' }}>
                    {pdfAnalysis.expectedImpact.expectedReturn}
                  </div>
                </div>
                
                <div style={{ 
                  padding: '1.25rem',
                  background: '#dbeafe',
                  borderRadius: '12px',
                }}>
                  <div style={{ fontSize: '0.85rem', color: '#1e40af', marginBottom: '0.5rem' }}>
                    Volatility Change
                  </div>
                  <div style={{ fontSize: '1.3rem', fontWeight: '700', color: '#1e3a8a' }}>
                    {pdfAnalysis.expectedImpact.volatilityChange}
                  </div>
                </div>
              </div>
            </Card>
          )}
        </div>
      )}
      
      {/* Empty State */}
      {!uploadedPDF && !isAnalyzing && (
        <Card style={{ textAlign: 'center', padding: '3rem', background: '#f8f9ff' }}>
          <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>📊</div>
          <div style={{ fontSize: '1.2rem', fontWeight: '600', color: '#0f172a', marginBottom: '0.5rem' }}>
            No PDF Uploaded Yet
          </div>
          <div style={{ fontSize: '0.95rem', color: '#64748b', lineHeight: '1.6', maxWidth: '500px', margin: '0 auto' }}>
            Upload a market outlook PDF to get AI-powered investment recommendations tailored to your portfolio.
          </div>
        </Card>
      )}
      
      {pdfAnalysis && <MainDisclaimer />}
    </div>
  );
};

// ==================== MAIN APP ====================
export default function InvestmentDashboard() {
  const [activeTab, setActiveTab] = useState('portfolio');
  const [showExpenseRatio, setShowExpenseRatio] = useState(false);
  
  // AI Insights state
  const [uploadedPDF, setUploadedPDF] = useState(null);
  const [pdfAnalysis, setPdfAnalysis] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [aiRecommendations, setAiRecommendations] = useState(null);
  const [selectedRiskProfile, setSelectedRiskProfile] = useState(null); // Track which profile user selected
  const [portfolio, setPortfolio] = useState(null);
  const [portfolioAnalysis, setPortfolioAnalysis] = useState(null);
  const [sectorOverrides, setSectorOverrides] = useState({});
  
  // User activity tracking
  const [userId] = useState(() => {
    let id = localStorage.getItem('user_id');
    if (!id) {
      id = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      localStorage.setItem('user_id', id);
    }
    return id;
  });
  
  const [sessionId] = useState(() => {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  });
  
  // Track user activity
  useEffect(() => {
    const trackActivity = (action) => {
      console.log(`📊 Tracking activity: ${action}, userId: ${userId.substring(0, 15)}...`);
      fetch('http://localhost:3001/api/analytics/activity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          sessionId,
          action,
          timestamp: new Date().toISOString()
        })
      })
      .then(res => res.json())
      .then(data => console.log('✅ Activity tracked:', data))
      .catch(err => console.log('❌ Activity tracking failed:', err));
    };
    
    // Track initial visit
    console.log('🎬 App mounted - tracking initial visit');
    trackActivity('visit');
    
    // Track activity every 5 minutes to maintain "live" status
    const interval = setInterval(() => {
      console.log('⏰ 5-minute ping - tracking active status');
      trackActivity('active');
    }, 5 * 60 * 1000);
    
    return () => clearInterval(interval);
  }, [userId, sessionId]);
  
  const [assetClassOverrides, setAssetClassOverrides] = useState(() => {
    // Load user's personal overrides from localStorage on mount
    try {
      const saved = localStorage.getItem('user_asset_class_overrides');
      if (saved) {
        console.log('📥 Loaded user overrides from localStorage');
        return JSON.parse(saved);
      }
    } catch (err) {
      console.log('Could not load user overrides');
    }
    return {};
  });
  const [customAssetClasses, setCustomAssetClasses] = useState(() => {
    // Load user's custom asset classes from localStorage on mount
    try {
      const saved = localStorage.getItem('custom_asset_classes');
      if (saved) {
        console.log('📥 Loaded custom asset classes from localStorage');
        return JSON.parse(saved);
      }
    } catch (err) {
      console.log('Could not load custom asset classes');
    }
    return {};
  }); // { className: { return: 8, volatility: 15 } }
  const [stockData, setStockData] = useState(null);
  const [stockTicker, setStockTicker] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  
  // Financial statement PDF upload state
  const [incomeFile, setIncomeFile] = useState(null);
  const [balanceFile, setBalanceFile] = useState(null);
  const [cashFlowFile, setCashFlowFile] = useState(null);
  const [combinedFile, setCombinedFile] = useState(null);
  const [pdfParsing, setPdfParsing] = useState(false);
  const [pdfParseSuccess, setPdfParseSuccess] = useState(null);
  const [showPdfUpload, setShowPdfUpload] = useState(false);
  
  // Portfolio state
  const [projectionYears, setProjectionYears] = useState(10);
  const [monthlyContribution, setMonthlyContribution] = useState(0);
  const [contributionFreq, setContributionFreq] = useState('monthly');
  const [isDragging, setIsDragging] = useState(false);
  const [leverageRatio, setLeverageRatio] = useState(1.0);
  const [interestRate, setInterestRate] = useState(5.0);
  const [comparisonPortfolio, setComparisonPortfolio] = useState(null);
  const [showComparisonProjection, setShowComparisonProjection] = useState(false);
  
  // Compound calculator state
  const [compoundMode, setCompoundMode] = useState('forward'); // 'forward' or 'backsolve'
  const [compoundInputs, setCompoundInputs] = useState({
    principal: 10000,
    monthlyContribution: 500,
    years: 10,
    annualRate: 7,
    compoundFreq: 'annually',
    rateVariance: 2,
    targetValue: 1000000, // for backsolve
    leverage: 1.0,
    borrowingRate: 5.0,
  });
  
  // Stock analyzer state
  const [scenario, setScenario] = useState('base');
  const [stockAssumptions, setStockAssumptions] = useState({
    bull: { revenueGrowth: 30, netMargin: 20, peLow: 40, peHigh: 60 },
    base: { revenueGrowth: 15, netMargin: 15, peLow: 25, peHigh: 35 },
    bear: { revenueGrowth: 5, netMargin: 10, peLow: 15, peHigh: 20 },
  });
  
  // DCF state
  const [dcfMode, setDcfMode] = useState('summary'); // 'summary' or 'detailed'
  const [dcfInputs, setDcfInputs] = useState({
    wacc: 10,
    terminalGrowth: 3,
    fcfGrowth: 15,
    // Detailed DCF inputs
    revenueGrowth: [15, 12, 10, 8, 5], // 5-year projections
    grossMargin: 60,
    opexMargin: 35, // Operating expenses as % of revenue
    daMargin: 5, // D&A as % of revenue
    taxRate: 25,
    capexMargin: 8, // CapEx as % of revenue
    nwcChange: 2, // Change in NWC as % of revenue change
    terminalEbitdaMultiple: 12, // For multiple-based terminal value
  });

  const handleFile = useCallback(async (file) => {
    setLoading(true);
    setError(null);
    
    try {
      const text = await file.text();
      let positions;
      
      if (file.name.endsWith('.xls') && text.includes('<table')) {
        positions = parseChaseHTML(text);
      } else if (file.name.endsWith('.csv')) {
        positions = parseGenericCSV(text);
      } else if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
        const buffer = await file.arrayBuffer();
        positions = await parseExcelFile(buffer);
      } else {
        throw new Error('Unsupported file format');
      }
      
      console.log('Parsed positions:', positions);
      
      const totalValue = positions.reduce((sum, p) => sum + p.value, 0);
      const totalCost = positions.reduce((sum, p) => sum + p.cost, 0);
      const totalGainLoss = positions.reduce((sum, p) => sum + p.gainLoss, 0);
      
      const analysis = await analyzePortfolio(positions, sectorOverrides, assetClassOverrides);
      
      console.log('Portfolio analysis:', analysis);
      
      // Attach detected sector to each position
      const positionsWithSectors = positions.map(pos => ({
        ...pos,
        detectedSector: analysis.tickerSectorMap[pos.ticker.toUpperCase()] || 'Other'
      }));
      
      setPortfolio({
        positions: positionsWithSectors,
        totalValue,
        totalCost,
        totalGainLoss,
        returnPct: (totalGainLoss / totalCost) * 100,
      });
      
      setPortfolioAnalysis(analysis);
      
      // Send analytics (fire and forget - don't block user experience)
      try {
        const topAssetClasses = analysis.allocationBreakdown?.slice(0, 5).map(item => ({
          name: item.assetClass,
          weight: item.weight
        }));
        
        // Track portfolio upload
        fetch('http://localhost:3001/api/analytics/activity', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId,
            sessionId,
            action: 'upload',
            timestamp: new Date().toISOString()
          })
        }).catch(err => console.log('Activity tracking failed:', err));
        
        // Track portfolio details
        fetch('http://localhost:3001/api/analytics/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId,
            positionCount: positions.length,
            totalValue: totalValue,
            expectedReturn: analysis.expectedReturn,
            expectedVolatility: analysis.expectedVolatility,
            topAssetClasses: topAssetClasses,
            timestamp: new Date().toISOString()
          })
        }).catch(err => console.log('Analytics logging failed:', err));
      } catch (analyticsErr) {
        // Silently fail - analytics shouldn't break user experience
        console.log('Analytics error:', analyticsErr);
      }
    } catch (err) {
      setError(err.message);
      console.error('File parsing error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleStockSearch = async () => {
    if (!stockTicker) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const data = await fetchStockData(stockTicker.toUpperCase());
      console.log('📥 Stock data received from API:', data);
      
      // Check if we have existing PDF-extracted financial data
      // PDF data has more fields than API data (researchDevelopment, sellingGeneralAdmin, etc.)
      const hasPdfData = stockData && 
                        stockData.income && 
                        stockData.income[0] &&
                        stockData.income[0].researchDevelopment !== undefined; // This field only exists in PDF data
      
      // Check if ticker changed
      const tickerChanged = stockData && 
                           stockData.profile && 
                           stockData.profile.symbol !== stockTicker.toUpperCase() &&
                           stockData.profile.symbol !== 'CUSTOM';
      
      if (hasPdfData && !tickerChanged) {
        console.log('✅ Preserving PDF-extracted financial data (same ticker)');
        console.log('   PDF income has', Object.keys(stockData.income[0]).length, 'fields');
        console.log('   API income has', data.income ? Object.keys(data.income[0]).length : 0, 'fields');
        // Merge: Keep PDF financial data, update profile/quote from API
        setStockData({
          ...data,
          income: stockData.income,
          balance: stockData.balance,
          cashFlow: stockData.cashFlow
        });
      } else {
        if (tickerChanged && hasPdfData) {
          console.log('ℹ️  Ticker changed - clearing PDF data');
          setPdfParseSuccess(null); // Clear success message too
        } else {
          console.log('ℹ️  No PDF data found, using API data');
        }
        // No PDF data OR ticker changed - use API data as-is
        setStockData(data);
      }
    } catch (err) {
      if (err.message.includes('HTTP 404')) {
        setError(`Stock "${stockTicker}" not found. This may be a premium-only stock or the ticker may be incorrect. Try: AAPL, MSFT, GOOGL, TSLA, NVDA, META, AMZN, or verify the ticker symbol.`);
      } else if (err.message.includes('premium data subscription')) {
        setError(err.message);
      } else {
        setError(err.message);
      }
      console.error('Stock search error:', err);
    } finally {
      setLoading(false);
    }
  };

  // Handle financial statement PDF upload and parsing
  const handleFinancialPdfUpload = async () => {
    // Check if we have either 3 separate files OR 1 combined file
    const hasThreeSeparate = incomeFile && balanceFile && cashFlowFile;
    const hasCombined = combinedFile;
    
    if (!hasThreeSeparate && !hasCombined) {
      setError('Please upload either all three separate statements OR one combined document');
      return;
    }
    
    setPdfParsing(true);
    setError(null);
    setPdfParseSuccess(null);
    
    try {
      const formData = new FormData();
      
      if (hasCombined) {
        // Use combined file for all three
        console.log('📤 Uploading combined financial document...');
        formData.append('income', combinedFile);
        formData.append('balance', combinedFile);
        formData.append('cashFlow', combinedFile);
      } else {
        // Use three separate files
        console.log('📤 Uploading 3 separate financial statements...');
        formData.append('income', incomeFile);
        formData.append('balance', balanceFile);
        formData.append('cashFlow', cashFlowFile);
      }
      
      const response = await fetch('http://localhost:3001/api/parse-financials', {
        method: 'POST',
        body: formData
      });
      
      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to parse financial statements');
      }
      
      console.log('✅ Financial statements parsed:', result);
      
      // Merge with existing stock data if available, or create new
      const mergedData = stockData ? {
        profile: stockData.profile || {
          companyName: result.data.companyName,
          symbol: 'CUSTOM',
          industry: 'N/A',
          sector: 'N/A'
        },
        quote: stockData.quote || {
          symbol: 'CUSTOM',
          name: result.data.companyName,
          price: 0,
          marketCap: 0,
          sharesOutstanding: 0
        },
        income: result.data.income,
        balance: result.data.balance,
        cashFlow: result.data.cashFlow
      } : {
        profile: {
          companyName: result.data.companyName,
          symbol: 'CUSTOM',
          industry: 'N/A',
          sector: 'N/A'
        },
        quote: {
          symbol: 'CUSTOM',
          name: result.data.companyName,
          price: 0,
          marketCap: 0,
          sharesOutstanding: 0
        },
        income: result.data.income,
        balance: result.data.balance,
        cashFlow: result.data.cashFlow
      };
      
      console.log('📊 Setting merged stock data:');
      console.log('   Company:', mergedData.profile?.companyName);
      console.log('   Income years:', mergedData.income?.length);
      console.log('   Balance years:', mergedData.balance?.length);
      console.log('   CashFlow years:', mergedData.cashFlow?.length);
      if (mergedData.income && mergedData.income[0]) {
        console.log('   Income sample:', mergedData.income[0]);
        console.log('   Income fields:', Object.keys(mergedData.income[0]));
      }
      
      setStockData(mergedData);
      setPdfParseSuccess({
        companyName: result.data.companyName,
        cached: result.cached,
        mode: hasCombined ? 'combined' : 'separate',
        years: {
          income: result.data.income?.length || 0,
          balance: result.data.balance?.length || 0,
          cashFlow: result.data.cashFlow?.length || 0
        }
      });
      
      // Clear files
      setIncomeFile(null);
      setBalanceFile(null);
      setCashFlowFile(null);
      setCombinedFile(null);
      
      // Close upload UI
      setShowPdfUpload(false);
      
    } catch (err) {
      console.error('❌ PDF parsing error:', err);
      setError(err.message);
    } finally {
      setPdfParsing(false);
    }
  };

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  // Calculate projections (memoized to prevent random fluctuations)
  const portfolioSimulation = useMemo(() => {
    return portfolioAnalysis
      ? runMonteCarloSimulation(
          portfolioAnalysis.totalValue,
          projectionYears,
          portfolioAnalysis.expectedReturn,
          portfolioAnalysis.expectedVolatility,
          monthlyContribution,
          contributionFreq,
          10000,
          leverageRatio,
          interestRate
        )
      : { projections: [], marginCallRate: 0 };
  }, [portfolioAnalysis, projectionYears, monthlyContribution, contributionFreq, leverageRatio, interestRate]);
  
  const portfolioProjections = portfolioSimulation.projections || [];
  const marginCallRate = portfolioSimulation.marginCallRate || 0;
  
  // Comparison portfolio projections
  const comparisonReturns = {
    '100stocks': { return: 6.10, vol: 14.55 },
    '80_20': { return: 5.78, vol: 11.80 },
    '60_40': { return: 5.46, vol: 9.25 },
    '40_60': { return: 5.14, vol: 7.05 },
    '100bonds': { return: 4.50, vol: 4.82 },
  };
  
  const comparisonSimulation = useMemo(() => {
    return showComparisonProjection && comparisonPortfolio && portfolioAnalysis
      ? runMonteCarloSimulation(
          portfolioAnalysis.totalValue,
          projectionYears,
          comparisonReturns[comparisonPortfolio].return,
          comparisonReturns[comparisonPortfolio].vol,
          monthlyContribution,
          contributionFreq,
          10000,
          1.0,
          0
        )
      : { projections: [], marginCallRate: 0 };
  }, [showComparisonProjection, comparisonPortfolio, portfolioAnalysis, projectionYears, monthlyContribution, contributionFreq]);
  
  const comparisonProjections = comparisonSimulation.projections || [];

  const compoundResult = compoundMode === 'forward'
    ? calculateCompoundInterest(
        compoundInputs.principal,
        compoundInputs.monthlyContribution,
        compoundInputs.years,
        compoundInputs.annualRate,
        compoundInputs.compoundFreq,
        compoundInputs.leverage,
        compoundInputs.borrowingRate
      )
    : null;
  
  const requiredReturn = compoundMode === 'backsolve'
    ? backsolveReturn(
        compoundInputs.principal,
        compoundInputs.monthlyContribution,
        compoundInputs.years,
        compoundInputs.targetValue,
        compoundInputs.compoundFreq,
        compoundInputs.leverage,
        compoundInputs.borrowingRate
      )
    : null;

  const stockProjections = stockData && stockData.income && stockData.income[0] ? calculateStockProjections(
    stockData.income[0].revenue || 0,
    stockData.income[0].netIncome || 0,
    stockData.quote?.sharesOutstanding || 1,
    stockAssumptions[scenario]
  ) : [];

  const dcfValue = stockData && stockData.cashFlow && stockData.cashFlow[0] && stockData.cashFlow[0].freeCashFlow
    ? calculateDCF(
        stockData.cashFlow[0].freeCashFlow,
        dcfInputs.wacc,
        dcfInputs.terminalGrowth,
        dcfInputs.fcfGrowth
      )
    : 0;

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(to bottom, #f8fafc 0%, #e2e8f0 100%)',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    }}>
      {/* Header */}
      <div style={{
        background: 'white',
        borderBottom: '1px solid #e2e8f0',
        padding: '1.5rem 2rem',
        boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
      }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 style={{
              fontSize: '1.75rem',
              fontWeight: '700',
              color: '#0f172a',
              margin: 0,
              letterSpacing: '-0.02em',
            }}>
              Investment Analysis Suite
            </h1>
            <p style={{ margin: '0.25rem 0 0', color: '#64748b', fontSize: '0.875rem' }}>
              Professional portfolio tracking, stock analysis, and valuation tools
            </p>
          </div>
          <button
            onClick={() => setShowExpenseRatio(true)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.75rem 1.5rem',
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              fontSize: '0.9rem',
              fontWeight: '600',
              cursor: 'pointer',
              boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
              transition: 'transform 0.2s, box-shadow 0.2s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-2px)';
              e.currentTarget.style.boxShadow = '0 4px 8px rgba(0,0,0,0.15)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';
            }}
          >
            <DollarSign size={18} />
            Upgrade to Premium
          </button>
        </div>
      </div>

      {/* Navigation */}
      <div style={{
        background: 'white',
        borderBottom: '1px solid #e2e8f0',
        padding: '0 2rem',
      }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto', display: 'flex', gap: '2rem' }}>
          <TabButton
            active={activeTab === 'portfolio'}
            onClick={() => setActiveTab('portfolio')}
            icon={<PieChart size={18} />}
            label="Portfolio Analyzer"
          />
          <TabButton
            active={activeTab === 'ai'}
            onClick={() => setActiveTab('ai')}
            icon={<Info size={18} />}
            label="AI Insights"
          />
          <TabButton
            active={activeTab === 'compound'}
            onClick={() => setActiveTab('compound')}
            icon={<Calculator size={18} />}
            label="Compound Calculator"
          />
          <TabButton
            active={activeTab === 'dca'}
            onClick={() => setActiveTab('dca')}
            icon={<DollarSign size={18} />}
            label="DCA Calculator"
          />
          <TabButton
            active={activeTab === 'retirement'}
            onClick={() => setActiveTab('retirement')}
            icon={<Calendar size={18} />}
            label="Retirement Spending"
          />
          <TabButton
            active={activeTab === 'stock'}
            onClick={() => setActiveTab('stock')}
            icon={<TrendingUp size={18} />}
            label="Stock Analyzer"
          />
          <TabButton
            active={activeTab === 'dcf'}
            onClick={() => setActiveTab('dcf')}
            icon={<BarChart3 size={18} />}
            label="DCF Valuation"
          />
        </div>
      </div>

      {/* Main Content */}
      <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '2rem' }}>
        {activeTab === 'portfolio' && (
          <PortfolioTab
            portfolio={portfolio}
            portfolioAnalysis={portfolioAnalysis}
            setPortfolioAnalysis={setPortfolioAnalysis}
            sectorOverrides={sectorOverrides}
            setSectorOverrides={setSectorOverrides}
            assetClassOverrides={assetClassOverrides}
            setAssetClassOverrides={setAssetClassOverrides}
            customAssetClasses={customAssetClasses}
            setCustomAssetClasses={setCustomAssetClasses}
            projectionYears={projectionYears}
            setProjectionYears={setProjectionYears}
            monthlyContribution={monthlyContribution}
            setMonthlyContribution={setMonthlyContribution}
            contributionFreq={contributionFreq}
            setContributionFreq={setContributionFreq}
            projections={portfolioProjections}
            leverageRatio={leverageRatio}
            setLeverageRatio={setLeverageRatio}
            interestRate={interestRate}
            setInterestRate={setInterestRate}
            comparisonPortfolio={comparisonPortfolio}
            setComparisonPortfolio={setComparisonPortfolio}
            showComparisonProjection={showComparisonProjection}
            setShowComparisonProjection={setShowComparisonProjection}
            comparisonProjections={comparisonProjections}
            marginCallRate={marginCallRate}
            isDragging={isDragging}
            setIsDragging={setIsDragging}
            onDrop={onDrop}
            handleFile={handleFile}
            loading={loading}
            error={error}
            setPortfolio={setPortfolio}
          />
        )}
        
        {activeTab === 'compound' && (
          <CompoundCalculatorTab
            mode={compoundMode}
            setMode={setCompoundMode}
            inputs={compoundInputs}
            setInputs={setCompoundInputs}
            result={compoundResult}
            requiredReturn={requiredReturn}
            portfolioData={portfolio && portfolioAnalysis ? {
              totalValue: portfolioAnalysis.totalValue,
              expectedReturn: portfolioAnalysis.expectedReturn,
            } : null}
          />
        )}
        
        {activeTab === 'retirement' && (
          <RetirementSpendingTab 
            portfolioData={portfolio && portfolioAnalysis ? {
              totalValue: portfolioAnalysis.totalValue,
              expectedReturn: portfolioAnalysis.expectedReturn,
              expectedVolatility: portfolioAnalysis.expectedVolatility,
            } : null}
          />
        )}
        
        {activeTab === 'stock' && (
          <StockAnalyzerTab
            stockTicker={stockTicker}
            setStockTicker={setStockTicker}
            handleStockSearch={handleStockSearch}
            stockData={stockData}
            scenario={scenario}
            setScenario={setScenario}
            stockAssumptions={stockAssumptions}
            setStockAssumptions={setStockAssumptions}
            stockProjections={stockProjections}
            loading={loading}
            error={error}
            incomeFile={incomeFile}
            setIncomeFile={setIncomeFile}
            balanceFile={balanceFile}
            setBalanceFile={setBalanceFile}
            cashFlowFile={cashFlowFile}
            setCashFlowFile={setCashFlowFile}
            combinedFile={combinedFile}
            setCombinedFile={setCombinedFile}
            pdfParsing={pdfParsing}
            setPdfParsing={setPdfParsing}
            pdfParseSuccess={pdfParseSuccess}
            setPdfParseSuccess={setPdfParseSuccess}
            showPdfUpload={showPdfUpload}
            setShowPdfUpload={setShowPdfUpload}
            handleFinancialPdfUpload={handleFinancialPdfUpload}
            setStockData={setStockData}
            setError={setError}
          />
        )}

        {/* AI INSIGHTS TAB */}
        {activeTab === 'ai' && (
          <AIInsightsTab
            uploadedPDF={uploadedPDF}
            setUploadedPDF={setUploadedPDF}
            pdfAnalysis={pdfAnalysis}
            setPdfAnalysis={setPdfAnalysis}
            isAnalyzing={isAnalyzing}
            setIsAnalyzing={setIsAnalyzing}
            aiRecommendations={aiRecommendations}
            setAiRecommendations={setAiRecommendations}
            selectedRiskProfile={selectedRiskProfile}
            setSelectedRiskProfile={setSelectedRiskProfile}
            portfolio={portfolio?.positions || []}
            setPortfolio={setPortfolio}
          />
        )}
        
        {activeTab === 'dcf' && (
          <DCFTab
            stockData={stockData}
            dcfInputs={dcfInputs}
            setDcfInputs={setDcfInputs}
            dcfValue={dcfValue}
            stockTicker={stockTicker}
            setStockTicker={setStockTicker}
            handleStockSearch={handleStockSearch}
            loading={loading}
            error={error}
            dcfMode={dcfMode}
            setDcfMode={setDcfMode}
          />
        )}
        
        {activeTab === 'dca' && <DCACalculatorTab />}
      </div>
      
      {/* Expense Ratio Modal */}
      {showExpenseRatio && (
        <PremiumModal onClose={() => setShowExpenseRatio(false)} />
      )}
      
      <FooterDisclaimer />
    </div>
  );
}

// ==================== TAB COMPONENTS ====================
function TabButton({ active, onClick, icon, label }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        padding: '1rem 0',
        background: 'none',
        border: 'none',
        borderBottom: active ? '2px solid #3b82f6' : '2px solid transparent',
        color: active ? '#3b82f6' : '#64748b',
        fontWeight: active ? '600' : '500',
        fontSize: '0.875rem',
        cursor: 'pointer',
        transition: 'all 0.2s',
      }}
    >
      {icon}
      {label}
    </button>
  );
}

// ==================== PORTFOLIO TAB ====================
// ==================== DCA CALCULATOR COMPONENT ====================
function DCACalculatorTab() {
  // Input states
  const [amountPerPeriod, setAmountPerPeriod] = useState(100);
  const [frequency, setFrequency] = useState('monthly'); // daily, weekly, biweekly, monthly, quarterly
  const [ticker, setTicker] = useState('VOO');
  const [customReturns, setCustomReturns] = useState({
    '1m': 2.5,
    '3m': 7.8,
    '6m': 12.3,
    'ytd': 15.2,
    '1yr': 18.5,
    '3yr': 25.4,
    '5yr': 45.8,
    '10yr': 102.3
  });

  // Calculate number of periods and total amount based on frequency
  const calculatePeriods = (freq) => {
    if (freq === 'daily') return 365;
    if (freq === 'weekly') return 52;
    if (freq === 'biweekly') return 26;
    if (freq === 'monthly') return 12;
    if (freq === 'quarterly') return 4;
    return 12;
  };

  const periods = calculatePeriods(frequency);
  const totalAmount = amountPerPeriod * periods; // Dynamic total based on per-period amount

  // Calculate DCA vs Lump Sum for each time period
  const calculateReturns = useMemo(() => {
    const results = [];
    const timeframes = [
      { key: '1m', label: '1 Month', multiplier: 1/12 },
      { key: '3m', label: '3 Months', multiplier: 3/12 },
      { key: '6m', label: '6 Months', multiplier: 6/12 },
      { key: 'ytd', label: 'YTD', multiplier: new Date().getMonth() / 12 },
      { key: '1yr', label: '1 Year', multiplier: 1 },
      { key: '3yr', label: '3 Years', multiplier: 3 },
      { key: '5yr', label: '5 Years', multiplier: 5 },
      { key: '10yr', label: '10 Years', multiplier: 10 }
    ];

    timeframes.forEach(({ key, label, multiplier }) => {
      const annualReturn = customReturns[key];
      const totalReturn = annualReturn / 100;
      
      // Lump Sum: Invest all at once
      const lumpSumFinal = totalAmount * (1 + totalReturn);
      const lumpSumGain = lumpSumFinal - totalAmount;
      const lumpSumReturnPct = (lumpSumGain / totalAmount) * 100;

      // DCA: Invest periodically - assumes linear price growth
      const avgGrowthRate = totalReturn / periods;
      let dcaTotal = 0;
      
      for (let i = 0; i < periods; i++) {
        const priceMultiplier = 1 + (avgGrowthRate * i);
        const sharesAtThisPrice = amountPerPeriod / priceMultiplier;
        const finalValueOfTheseShares = sharesAtThisPrice * (1 + totalReturn);
        dcaTotal += finalValueOfTheseShares;
      }
      
      const dcaGain = dcaTotal - totalAmount;
      const dcaReturnPct = (dcaGain / totalAmount) * 100;
      
      const difference = lumpSumFinal - dcaTotal;
      const differencePct = ((lumpSumFinal - dcaTotal) / dcaTotal) * 100;

      results.push({
        timeframe: label,
        annualReturn: annualReturn,
        lumpSum: {
          final: lumpSumFinal,
          gain: lumpSumGain,
          returnPct: lumpSumReturnPct
        },
        dca: {
          final: dcaTotal,
          gain: dcaGain,
          returnPct: dcaReturnPct
        },
        difference: difference,
        differencePct: differencePct,
        winner: lumpSumFinal > dcaTotal ? 'Lump Sum' : 'DCA'
      });
    });

    return results;
  }, [totalAmount, frequency, customReturns, periods, amountPerPeriod]);

  // Prepare chart data
  const chartData = calculateReturns.map(result => ({
    name: result.timeframe,
    'Lump Sum': result.lumpSum.final,
    'DCA': result.dca.final,
    'Difference': Math.abs(result.difference)
  }));

  const formatCurrency = (value) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(value);
  };

  const formatPercent = (value) => {
    return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
  };

  const getFrequencyLabel = () => {
    if (frequency === 'daily') return 'daily';
    if (frequency === 'weekly') return 'weekly';
    if (frequency === 'biweekly') return 'bi-weekly';
    if (frequency === 'monthly') return 'monthly';
    if (frequency === 'quarterly') return 'quarterly';
    return 'monthly';
  };

  return (
    <div>
      <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem', color: '#1a202c' }}>
        💰 DCA vs Lump Sum Calculator
      </h1>
      <p style={{ color: '#718096', marginBottom: '2rem' }}>
        Compare Dollar Cost Averaging against investing all at once
      </p>

      {/* Input Section */}
      <Card title="Investment Parameters">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1.5rem' }}>
          {/* Amount Per Period */}
          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', color: '#4a5568', fontSize: '0.875rem' }}>
              Amount Per {frequency.charAt(0).toUpperCase() + frequency.slice(1)} Period
            </label>
            <input
              type="number"
              value={amountPerPeriod}
              onChange={(e) => setAmountPerPeriod(Number(e.target.value))}
              style={{
                width: '100%',
                padding: '0.75rem',
                border: '2px solid #e2e8f0',
                borderRadius: '8px',
                fontSize: '1rem'
              }}
            />
            <div style={{ marginTop: '0.5rem', fontSize: '0.875rem', color: '#718096' }}>
              Annual total: {formatCurrency(totalAmount)}
            </div>
          </div>

          {/* Frequency */}
          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', color: '#4a5568', fontSize: '0.875rem' }}>
              DCA Frequency
            </label>
            <select
              value={frequency}
              onChange={(e) => setFrequency(e.target.value)}
              style={{
                width: '100%',
                padding: '0.75rem',
                border: '2px solid #e2e8f0',
                borderRadius: '8px',
                fontSize: '1rem'
              }}
            >
              <option value="daily">Daily (365 periods/year)</option>
              <option value="weekly">Weekly (52 periods/year)</option>
              <option value="biweekly">Bi-Weekly (26 periods/year)</option>
              <option value="monthly">Monthly (12 periods/year)</option>
              <option value="quarterly">Quarterly (4 periods/year)</option>
            </select>
          </div>

          {/* Ticker */}
          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', color: '#4a5568', fontSize: '0.875rem' }}>
              Ticker Symbol (Optional)
            </label>
            <input
              type="text"
              value={ticker}
              onChange={(e) => setTicker(e.target.value.toUpperCase())}
              placeholder="VOO, SPY, etc."
              style={{
                width: '100%',
                padding: '0.75rem',
                border: '2px solid #e2e8f0',
                borderRadius: '8px',
                fontSize: '1rem'
              }}
            />
          </div>
        </div>

        {/* Summary */}
        <div style={{ 
          marginTop: '1.5rem', 
          padding: '1rem', 
          background: '#f7fafc', 
          borderRadius: '8px',
          fontSize: '0.875rem',
          color: '#2d3748'
        }}>
          <strong>DCA Plan:</strong> Invest {formatCurrency(amountPerPeriod)} {getFrequencyLabel()} for {periods} periods = {formatCurrency(totalAmount)} annual total
        </div>
      </Card>

      {/* Custom Returns Input */}
      <Card title="Historical Returns (%)">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem' }}>
          {Object.keys(customReturns).map(key => (
            <div key={key}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', color: '#4a5568', fontSize: '0.875rem' }}>
                {key === 'ytd' ? 'YTD' : key.toUpperCase()}
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  type="number"
                  step="0.1"
                  value={customReturns[key]}
                  onChange={(e) => setCustomReturns({ ...customReturns, [key]: Number(e.target.value) })}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    paddingRight: '2rem',
                    border: '2px solid #e2e8f0',
                    borderRadius: '8px',
                    fontSize: '1rem'
                  }}
                />
                <span style={{ 
                  position: 'absolute', 
                  right: '0.75rem', 
                  top: '50%', 
                  transform: 'translateY(-50%)',
                  color: '#718096',
                  pointerEvents: 'none'
                }}>%</span>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Chart */}
      <Card title="Visual Comparison">
        <ResponsiveContainer width="100%" height={400}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" />
            <YAxis 
              tickFormatter={(value) => `$${(value / 1000).toFixed(0)}K`}
            />
            <Tooltip 
              formatter={(value) => formatCurrency(value)}
              contentStyle={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '8px' }}
            />
            <Legend />
            <Bar dataKey="Lump Sum" fill="#667eea" />
            <Bar dataKey="DCA" fill="#48bb78" />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      {/* Results Table */}
      <Card title="Detailed Comparison">
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
                <th style={{ padding: '1rem', textAlign: 'left', color: '#4a5568', fontWeight: '600', fontSize: '0.875rem' }}>
                  TIMEFRAME
                </th>
                <th style={{ padding: '1rem', textAlign: 'right', color: '#4a5568', fontWeight: '600', fontSize: '0.875rem' }}>
                  RETURN
                </th>
                <th style={{ padding: '1rem', textAlign: 'right', color: '#4a5568', fontWeight: '600', fontSize: '0.875rem' }}>
                  LUMP SUM
                </th>
                <th style={{ padding: '1rem', textAlign: 'right', color: '#4a5568', fontWeight: '600', fontSize: '0.875rem' }}>
                  DCA
                </th>
                <th style={{ padding: '1rem', textAlign: 'right', color: '#4a5568', fontWeight: '600', fontSize: '0.875rem' }}>
                  DIFFERENCE
                </th>
                <th style={{ padding: '1rem', textAlign: 'center', color: '#4a5568', fontWeight: '600', fontSize: '0.875rem' }}>
                  WINNER
                </th>
              </tr>
            </thead>
            <tbody>
              {calculateReturns.map((result, idx) => (
                <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '1rem', fontWeight: '600', color: '#1a202c' }}>
                    {result.timeframe}
                  </td>
                  <td style={{ padding: '1rem', textAlign: 'right', color: '#2d3748' }}>
                    {formatPercent(result.annualReturn)}
                  </td>
                  <td style={{ padding: '1rem', textAlign: 'right' }}>
                    <div style={{ fontWeight: '600', color: '#1a202c' }}>
                      {formatCurrency(result.lumpSum.final)}
                    </div>
                    <div style={{ fontSize: '0.875rem', color: result.lumpSum.gain >= 0 ? '#48bb78' : '#f56565' }}>
                      {formatCurrency(result.lumpSum.gain)} ({formatPercent(result.lumpSum.returnPct)})
                    </div>
                  </td>
                  <td style={{ padding: '1rem', textAlign: 'right' }}>
                    <div style={{ fontWeight: '600', color: '#1a202c' }}>
                      {formatCurrency(result.dca.final)}
                    </div>
                    <div style={{ fontSize: '0.875rem', color: result.dca.gain >= 0 ? '#48bb78' : '#f56565' }}>
                      {formatCurrency(result.dca.gain)} ({formatPercent(result.dca.returnPct)})
                    </div>
                  </td>
                  <td style={{ padding: '1rem', textAlign: 'right', fontWeight: '600', color: result.difference >= 0 ? '#48bb78' : '#f56565' }}>
                    {formatCurrency(Math.abs(result.difference))}
                    <div style={{ fontSize: '0.875rem' }}>
                      ({formatPercent(Math.abs(result.differencePct))})
                    </div>
                  </td>
                  <td style={{ padding: '1rem', textAlign: 'center' }}>
                    <span style={{
                      padding: '0.375rem 0.75rem',
                      borderRadius: '12px',
                      fontSize: '0.75rem',
                      fontWeight: '600',
                      background: result.winner === 'Lump Sum' ? '#c6f6d5' : '#bee3f8',
                      color: result.winner === 'Lump Sum' ? '#2f855a' : '#2c5282'
                    }}>
                      {result.winner}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Key Insights */}
      <div style={{ 
        marginTop: '2rem',
        padding: '1.5rem',
        background: '#fffbeb',
        border: '2px solid #fbbf24',
        borderRadius: '12px'
      }}>
        <h3 style={{ fontSize: '1rem', fontWeight: '600', color: '#92400e', marginBottom: '0.75rem' }}>
          💡 Key Insights
        </h3>
        <ul style={{ margin: 0, paddingLeft: '1.5rem', color: '#78350f', lineHeight: '1.6' }}>
          <li><strong>Lump sum</strong> typically outperforms DCA in rising markets because your money is invested sooner</li>
          <li><strong>DCA</strong> reduces risk by averaging your entry price over time - psychologically easier during volatility</li>
          <li><strong>Time horizon matters:</strong> The difference becomes more pronounced over longer periods</li>
          <li><strong>Market timing:</strong> DCA helps if you're worried about buying at a market peak</li>
        </ul>
      </div>
    </div>
  );
}

// ==================== PORTFOLIO TAB COMPONENT ====================
function PortfolioTab({ 
  portfolio, 
  portfolioAnalysis,
  setPortfolioAnalysis,
  sectorOverrides,
  setSectorOverrides,
  assetClassOverrides,
  setAssetClassOverrides,
  customAssetClasses,
  setCustomAssetClasses,
  projectionYears, 
  setProjectionYears, 
  monthlyContribution,
  setMonthlyContribution,
  contributionFreq,
  setContributionFreq,
  projections,
  leverageRatio,
  setLeverageRatio,
  interestRate,
  setInterestRate,
  comparisonPortfolio,
  setComparisonPortfolio,
  showComparisonProjection,
  setShowComparisonProjection,
  comparisonProjections,
  marginCallRate,
  isDragging, 
  setIsDragging, 
  onDrop, 
  handleFile, 
  loading, 
  error, 
  setPortfolio
}) {
  const [showReturnInfo, setShowReturnInfo] = useState(false);
  const [showRiskInfo, setShowRiskInfo] = useState(false);
  const [showMonteCarloInfo, setShowMonteCarloInfo] = useState(false);
  const [showAssetAllocationInfo, setShowAssetAllocationInfo] = useState(false);
  const [showPercentilesInfo, setShowPercentilesInfo] = useState(false);
  const [showFrequencyInfo, setShowFrequencyInfo] = useState(false);
  const [showCustomAssetClassModal, setShowCustomAssetClassModal] = useState(false);
  const [customAssetClassName, setCustomAssetClassName] = useState('');
  const [customAssetClassReturn, setCustomAssetClassReturn] = useState('');
  const [customAssetClassVolatility, setCustomAssetClassVolatility] = useState('');
  const [editingTicker, setEditingTicker] = useState(null); // Track which ticker's pencil was clicked
  
  if (!portfolio) {
    return (
      <div
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        style={{
          maxWidth: '700px',
          margin: '4rem auto',
          padding: '4rem 2rem',
          border: `2px dashed ${isDragging ? '#3b82f6' : '#cbd5e1'}`,
          borderRadius: '16px',
          textAlign: 'center',
          cursor: 'pointer',
          transition: 'all 0.3s ease',
          background: isDragging ? 'rgba(59, 130, 246, 0.05)' : 'white',
        }}
        onClick={() => document.getElementById('fileInput').click()}
      >
        <Upload size={48} style={{ margin: '0 auto 1.5rem', color: '#64748b' }} />
        <h3 style={{ fontSize: '1.5rem', marginBottom: '0.5rem', color: '#0f172a' }}>
          Upload Your Portfolio
        </h3>
        <p style={{ color: '#64748b', marginBottom: '1.5rem', fontSize: '0.95rem' }}>
          Supports Chase, Schwab, Fidelity, E*Trade, Robinhood
          <br />
          CSV, XLS, or XLSX formats
        </p>
        <input
          id="fileInput"
          type="file"
          accept=".csv,.xls,.xlsx"
          onChange={(e) => handleFile(e.target.files[0])}
          style={{ display: 'none' }}
        />
        <button style={{
          background: '#3b82f6',
          color: 'white',
          border: 'none',
          padding: '0.75rem 2rem',
          borderRadius: '8px',
          fontSize: '0.95rem',
          fontWeight: '600',
          cursor: 'pointer',
        }}>
          Choose File
        </button>
        
        <UploadHelpText type="csv" />
        
        {loading && <p style={{ marginTop: '1rem', color: '#3b82f6' }}>Processing...</p>}
        {error && <p style={{ marginTop: '1rem', color: '#ef4444' }}>{error}</p>}
      </div>
    );
  }

  const isPremiumLocked = false; // Premium restrictions removed - show all features

  // Safety check - if no portfolio, show upload UI
  if (!portfolio || !portfolio.positions) {
    return (
      <div style={{ textAlign: 'center', padding: '4rem 2rem' }}>
        <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem', color: '#64748b' }}>
          No Portfolio Loaded
        </h2>
        <p style={{ color: '#94a3b8', marginBottom: '2rem' }}>
          Upload a portfolio file to begin analysis (CSV, XLS, or XLSX)
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* Stats Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.5rem', marginBottom: '2rem' }}>
        <MetricCard
          label="Total Value"
          value={`$${portfolio.totalValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}`}
          icon={<DollarSign size={24} />}
          color="#3b82f6"
        />
        <MetricCard
          label="Total Gain/Loss"
          value={`$${portfolio.totalGainLoss.toLocaleString('en-US', { minimumFractionDigits: 2 })}`}
          icon={<TrendingUp size={24} />}
          color={portfolio.totalGainLoss >= 0 ? '#10b981' : '#ef4444'}
        />
        <MetricCard
          label="Total Return"
          value={`${portfolio.returnPct.toFixed(2)}%`}
          icon={<Percent size={24} />}
          color={portfolio.returnPct >= 0 ? '#10b981' : '#ef4444'}
        />
        <MetricCard
          label="Expected Return"
          value={`${portfolioAnalysis?.expectedReturn.toFixed(2)}%`}
          icon={<TrendingUp size={24} />}
          color="#8b5cf6"
          subtitle="Based on asset mix"
          infoButton={true}
          onInfoClick={() => setShowReturnInfo(!showReturnInfo)}
        />
        <MetricCard
          label="Portfolio Risk"
          value={`${portfolioAnalysis?.expectedVolatility.toFixed(2)}%`}
          icon={<BarChart3 size={24} />}
          color="#f59e0b"
          subtitle="Annual volatility"
          infoButton={true}
          onInfoClick={() => setShowRiskInfo(!showRiskInfo)}
        />
        <MetricCard
          label="Positions"
          value={portfolio.positions.length}
          icon={<Calendar size={24} />}
          color="#06b6d4"
        />
      </div>

      {/* Info Modals */}
      {showReturnInfo && (
        <InfoModal
          title="How Expected Return is Calculated"
          onClose={() => setShowReturnInfo(false)}
        >
          <p style={{ marginBottom: '1rem', color: '#475569', lineHeight: '1.6' }}>
            Your portfolio's expected return of <strong>{portfolioAnalysis?.expectedReturn.toFixed(2)}%</strong> is calculated using 
            JP Morgan's 2026 Long-Term Capital Market Assumptions (LTCMA) based on your asset allocation:
          </p>
          
          <div style={{ marginBottom: '1rem' }}>
            {portfolioAnalysis?.allocationBreakdown.map((item, idx) => (
              <div key={idx} style={{
                padding: '0.75rem',
                background: '#f8fafc',
                borderRadius: '6px',
                marginBottom: '0.5rem',
                fontSize: '0.875rem',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                  <strong>{formatAssetClassForDisplay(item.assetClass)}</strong>
                  <span>{item.weight.toFixed(1)}% of portfolio</span>
                </div>
                <div style={{ color: '#64748b', fontSize: '0.8rem' }}>
                  Expected Return: {item.expectedReturn}% × Weight: {item.weight.toFixed(1)}% = 
                  <strong style={{ color: '#3b82f6' }}> {item.contribution.toFixed(2)}% contribution</strong>
                </div>
              </div>
            ))}
          </div>
          
          <div style={{
            padding: '1rem',
            background: '#eff6ff',
            borderRadius: '8px',
            border: '1px solid #bfdbfe',
          }}>
            <div style={{ fontSize: '0.875rem', color: '#1e40af' }}>
              <strong>Total Expected Return:</strong> Sum of all contributions = {portfolioAnalysis?.expectedReturn.toFixed(2)}%
            </div>
          </div>
        </InfoModal>
      )}

      {showRiskInfo && (
        <InfoModal
          title="How Portfolio Risk is Calculated"
          onClose={() => setShowRiskInfo(false)}
        >
          <p style={{ marginBottom: '1rem', color: '#475569', lineHeight: '1.6' }}>
            Your portfolio's risk (volatility) of <strong>{portfolioAnalysis?.expectedVolatility.toFixed(2)}%</strong> represents 
            the expected annual standard deviation of returns. This is calculated using:
          </p>
          
          <ul style={{ marginBottom: '1rem', color: '#475569', lineHeight: '1.8', paddingLeft: '1.5rem' }}>
            <li>Each asset class's individual volatility from LTCMA</li>
            <li>Your portfolio weights in each asset class</li>
            <li>Mathematical formula: √(Σ(weight × volatility)²)</li>
          </ul>
          
          <div style={{
            padding: '1rem',
            background: '#fef3c7',
            borderRadius: '8px',
            border: '1px solid #fcd34d',
            marginBottom: '1rem',
          }}>
            <div style={{ fontSize: '0.875rem', color: '#78350f' }}>
              <strong>What this means:</strong> In a typical year, your portfolio's return could deviate 
              by ±{portfolioAnalysis?.expectedVolatility.toFixed(2)}% from the expected return. Higher diversification 
              typically reduces risk.
            </div>
          </div>
          
          <div style={{ fontSize: '0.85rem', color: '#64748b' }}>
            {portfolioAnalysis?.allocationBreakdown.slice(0, 3).map((item, idx) => (
              <div key={idx} style={{ marginBottom: '0.5rem' }}>
                • {formatAssetClassForDisplay(item.assetClass)}: {item.volatility}% volatility × {item.weight.toFixed(1)}% weight
              </div>
            ))}
          </div>
        </InfoModal>
      )}

      {/* Asset Allocation */}
      <Card 
        title="Asset Allocation Analysis" 
        style={{ marginBottom: '2rem' }}
        onInfoClick={() => setShowAssetAllocationInfo(!showAssetAllocationInfo)}
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1rem' }}>
          {Object.entries(portfolioAnalysis?.assetAllocation || {}).map(([assetClass, value]) => {
            const percentage = (value / portfolioAnalysis.totalValue * 100).toFixed(1);
            const assumptions = LTCMA[assetClass] || LTCMA['UNKNOWN'];
            return (
              <div key={assetClass} style={{
                padding: '1rem',
                background: '#f8fafc',
                borderRadius: '8px',
                border: '1px solid #e2e8f0',
              }}>
                <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '0.25rem' }}>
                  {formatAssetClassForDisplay(assetClass)}
                </div>
                <div style={{ fontSize: '1.25rem', fontWeight: '700', color: '#0f172a', marginBottom: '0.25rem' }}>
                  {percentage}%
                </div>
                <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                  Exp. Return: {assumptions.return}% | Vol: {assumptions.volatility}%
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Sector Breakdown */}
      {portfolioAnalysis?.sectorBreakdown && portfolioAnalysis.sectorBreakdown.length > 0 && (
        <Card 
          title="Sector & Category Breakdown" 
          subtitle="Distribution across sectors and asset categories"
          style={{ marginBottom: '2rem' }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '1rem' }}>
            {portfolioAnalysis.sectorBreakdown.map(({ sector, value, weight }) => {
              // Color coding for different sectors
              const sectorColors = {
                'Technology': '#3b82f6',
                'Financials': '#10b981',
                'Healthcare': '#ef4444',
                'Consumer Discretionary': '#f59e0b',
                'Consumer Staples': '#8b5cf6',
                'Industrials': '#6366f1',
                'Materials': '#14b8a6',
                'Energy': '#f97316',
                'Utilities': '#84cc16',
                'Real Estate': '#06b6d4',
                'Communication': '#ec4899',
                'Commodities': '#eab308',
                'Fixed Income': '#64748b',
                'Infrastructure': '#0ea5e9',
                'Other': '#94a3b8',
              };
              
              const color = sectorColors[sector] || '#94a3b8';
              
              return (
                <div key={sector} style={{
                  padding: '1rem',
                  background: `${color}10`,
                  borderRadius: '8px',
                  border: `2px solid ${color}40`,
                }}>
                  <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '0.5rem', fontWeight: '600' }}>
                    {sector}
                  </div>
                  <div style={{ fontSize: '1.5rem', fontWeight: '700', color, marginBottom: '0.25rem' }}>
                    {weight.toFixed(1)}%
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                    ${(value / 1000).toFixed(1)}k
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Projection Settings */}
      <Card 
        title="Monte Carlo Projection Settings (10,000 Simulations)" 
        style={{ marginBottom: '2rem' }}
        onInfoClick={() => setShowMonteCarloInfo(!showMonteCarloInfo)}
      >
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '2rem' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '0.75rem', color: '#475569', fontSize: '0.9rem', fontWeight: '500' }}>
              Time Horizon: <strong style={{ color: '#0f172a' }}>{projectionYears} years</strong>
            </label>
            <input
              type="range"
              min="1"
              max="30"
              value={projectionYears}
              onChange={(e) => setProjectionYears(Number(e.target.value))}
              style={{ width: '100%', accentColor: '#3b82f6' }}
            />
          </div>
          
          <div>
            <label style={{ display: 'block', marginBottom: '0.75rem', color: '#475569', fontSize: '0.9rem', fontWeight: '500' }}>
              Contribution Amount: <strong style={{ color: '#0f172a' }}>${monthlyContribution.toLocaleString()}</strong>
            </label>
            <input
              type="number"
              value={monthlyContribution}
              onChange={(e) => setMonthlyContribution(Number(e.target.value) || 0)}
              style={{
                width: '100%',
                padding: '0.5rem',
                border: '2px solid #e2e8f0',
                borderRadius: '6px',
                fontSize: '1rem',
              }}
            />
          </div>
          
          <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem', color: '#475569', fontSize: '0.9rem', fontWeight: '500' }}>
              Contribution Frequency
              <button
                onClick={() => setShowFrequencyInfo(!showFrequencyInfo)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 0,
                  display: 'flex',
                  alignItems: 'center',
                  color: '#3b82f6',
                }}
              >
                <Info size={14} />
              </button>
            </label>
            <select
              value={contributionFreq}
              onChange={(e) => setContributionFreq(e.target.value)}
              style={{
                width: '100%',
                padding: '0.5rem',
                border: '2px solid #e2e8f0',
                borderRadius: '6px',
                fontSize: '1rem',
                background: 'white',
              }}
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
              <option value="annually">Annually</option>
            </select>
          </div>
        </div>
        
        {/* Leverage Controls */}
        <div style={{ 
          marginTop: '1.5rem', 
          padding: '1.5rem', 
          background: '#fef3c7', 
          border: '2px solid #fbbf24',
          borderRadius: '8px',
        }}>
          <div style={{ marginBottom: '1rem' }}>
            <strong style={{ fontSize: '1rem', color: '#78350f' }}>⚡ Leverage Settings (Advanced)</strong>
          </div>
          
          <div style={{ display: 'grid', gridTemplateColumns: leverageRatio > 1.0 ? '1fr 1fr' : '1fr', gap: '1.5rem' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '0.75rem', color: '#78350f', fontSize: '0.9rem', fontWeight: '500' }}>
                Leverage Ratio: <strong style={{ color: '#0f172a' }}>{leverageRatio.toFixed(2)}x</strong>
              </label>
              <input
                type="range"
                min="1.0"
                max="3.0"
                step="0.1"
                value={leverageRatio}
                onChange={(e) => setLeverageRatio(Number(e.target.value))}
                style={{ width: '100%', accentColor: '#f59e0b' }}
              />
              <div style={{ fontSize: '0.75rem', color: '#78350f', marginTop: '0.25rem' }}>
                1.0x = No leverage | 2.0x = Double | 3.0x = Triple
              </div>
            </div>
            
            {leverageRatio > 1.0 && (
              <div>
                <label style={{ display: 'block', marginBottom: '0.75rem', color: '#78350f', fontSize: '0.9rem', fontWeight: '500' }}>
                  Borrowing Rate: <strong style={{ color: '#0f172a' }}>{interestRate.toFixed(1)}%</strong>
                </label>
                <input
                  type="range"
                  min="1.0"
                  max="15.0"
                  step="0.5"
                  value={interestRate}
                  onChange={(e) => setInterestRate(Number(e.target.value))}
                  style={{ width: '100%', accentColor: '#f59e0b' }}
                />
                <div style={{ fontSize: '0.75rem', color: '#78350f', marginTop: '0.25rem' }}>
                  Cost of borrowing (margin rates, HELOC, etc.)
                </div>
              </div>
            )}
          </div>
          
          {leverageRatio > 1.0 && (
            <div style={{
              marginTop: '1rem',
              padding: '0.75rem',
              background: '#fffbeb',
              borderRadius: '6px',
              fontSize: '0.85rem',
              color: '#78350f',
            }}>
              <strong>Net Expected Return:</strong> {((portfolioAnalysis?.expectedReturn || 0) * leverageRatio - (leverageRatio - 1) * interestRate).toFixed(2)}% 
              (Portfolio: {(portfolioAnalysis?.expectedReturn || 0).toFixed(2)}% × {leverageRatio.toFixed(2)} - Borrowing Cost: {((leverageRatio - 1) * interestRate).toFixed(2)}%)
            </div>
          )}
        </div>
        
        <div style={{
          marginTop: '1.5rem',
          padding: '1rem',
          background: '#eff6ff',
          borderRadius: '8px',
          border: '1px solid #bfdbfe',
        }}>
          <div style={{ display: 'flex', alignItems: 'start', gap: '0.5rem' }}>
            <Info size={16} style={{ color: '#3b82f6', marginTop: '0.125rem', flexShrink: 0 }} />
            <div style={{ fontSize: '0.85rem', color: '#1e40af' }}>
              <strong>Asset-Based Projection:</strong> This uses your portfolio's actual asset allocation 
              and JP Morgan's LTCMA to project realistic returns with 10,000 Monte Carlo simulations.
              Expected Return: <strong>{portfolioAnalysis?.expectedReturn.toFixed(2)}%</strong> | 
              Volatility: <strong>{portfolioAnalysis?.expectedVolatility.toFixed(2)}%</strong>
            </div>
          </div>
        </div>
      </Card>
      
      {/* Margin Call Risk Warning */}
      {leverageRatio > 1.0 && marginCallRate > 0 && (
        <Card style={{ marginBottom: '2rem' }}>
          <div style={{
            padding: '1.5rem',
            background: marginCallRate > 10 ? '#fee2e2' : marginCallRate > 5 ? '#fef3c7' : '#d1fae5',
            border: `2px solid ${marginCallRate > 10 ? '#fca5a5' : marginCallRate > 5 ? '#fcd34d' : '#6ee7b7'}`,
            borderRadius: '12px',
          }}>
            <div style={{ display: 'flex', alignItems: 'start', gap: '1rem' }}>
              <div style={{ fontSize: '2rem' }}>
                {marginCallRate > 10 ? '🚨' : marginCallRate > 5 ? '⚠️' : '✅'}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{
                  fontSize: '1.25rem',
                  fontWeight: '700',
                  color: marginCallRate > 10 ? '#991b1b' : marginCallRate > 5 ? '#78350f' : '#065f46',
                  marginBottom: '0.5rem',
                }}>
                  Margin Call Risk: {marginCallRate.toFixed(1)}%
                </div>
                <div style={{
                  fontSize: '0.95rem',
                  color: marginCallRate > 10 ? '#991b1b' : marginCallRate > 5 ? '#78350f' : '#047857',
                  lineHeight: '1.6',
                }}>
                  In <strong>{marginCallRate.toFixed(1)}%</strong> of scenarios ({Math.floor(marginCallRate * 100)} out of 10,000 simulations),
                  your portfolio equity fell below 30% and triggered a margin call, resulting in forced liquidation with penalties.
                  
                  <div style={{ 
                    marginTop: '1rem',
                    paddingTop: '1rem',
                    borderTop: `1px solid ${marginCallRate > 10 ? '#fca5a5' : marginCallRate > 5 ? '#fcd34d' : '#6ee7b7'}`,
                  }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem' }}>
                      <div>
                        <div style={{ fontSize: '0.75rem', opacity: 0.8 }}>RISK LEVEL</div>
                        <div style={{ fontWeight: '700', fontSize: '1.1rem' }}>
                          {marginCallRate < 5 ? 'Low' : marginCallRate < 15 ? 'Moderate' : 'High'}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: '0.75rem', opacity: 0.8 }}>LEVERAGE RATIO</div>
                        <div style={{ fontWeight: '700', fontSize: '1.1rem' }}>
                          {leverageRatio.toFixed(2)}x
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: '0.75rem', opacity: 0.8 }}>LIQUIDATION THRESHOLD</div>
                        <div style={{ fontWeight: '700', fontSize: '1.1rem' }}>
                          -{(100 / leverageRatio).toFixed(0)}% drop
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  {marginCallRate > 10 && (
                    <div style={{
                      marginTop: '1rem',
                      padding: '0.75rem',
                      background: '#fef2f2',
                      borderRadius: '6px',
                      fontSize: '0.85rem',
                    }}>
                      <strong>⚠️ High Risk Warning:</strong> With {leverageRatio.toFixed(2)}x leverage, a {(100 / leverageRatio).toFixed(0)}% portfolio decline 
                      wipes out your equity. Consider reducing leverage or increasing your safety margin.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </Card>
      )}
      
      {/* Comparison Portfolio */}
      <Card 
        title="Compare Against Preset Portfolios" 
        subtitle="See how your portfolio stacks up"
        style={{ marginBottom: '2rem' }}
      >
        <div style={{ marginBottom: '1.5rem' }}>
          <label style={{ display: 'block', marginBottom: '0.75rem', color: '#475569', fontSize: '0.9rem', fontWeight: '500' }}>
            Select Comparison Portfolio
          </label>
          <select
            value={comparisonPortfolio || ''}
            onChange={(e) => setComparisonPortfolio(e.target.value || null)}
            style={{
              width: '100%',
              padding: '0.75rem',
              border: '2px solid #e2e8f0',
              borderRadius: '8px',
              fontSize: '1rem',
              background: '#fefce8',
              fontWeight: '600',
              color: '#0f172a',
            }}
          >
            <option value="">None</option>
            <option value="100stocks">100% Stocks</option>
            <option value="80_20">80/20 (Stocks/Bonds)</option>
            <option value="60_40">60/40 (Balanced)</option>
            <option value="40_60">40/60 (Conservative)</option>
            <option value="100bonds">100% Bonds</option>
          </select>
        </div>
        
        {comparisonPortfolio && (
          <div style={{ marginTop: '1rem' }}>
            <label style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '0.5rem', 
              cursor: 'pointer',
              padding: '0.75rem',
              background: '#f8fafc',
              borderRadius: '8px',
              border: '1px solid #e2e8f0',
            }}>
              <input
                type="checkbox"
                checked={showComparisonProjection}
                onChange={(e) => setShowComparisonProjection(e.target.checked)}
                style={{ cursor: 'pointer', width: '16px', height: '16px', accentColor: '#3b82f6' }}
              />
              <span style={{ fontSize: '0.9rem', color: '#475569', fontWeight: '500' }}>
                📊 Show comparison portfolio projection on chart
              </span>
            </label>
          </div>
        )}
      </Card>

      {/* Projection Chart */}
      {projections.length > 0 && (
        <Card title="Portfolio Value Projection" style={{ marginBottom: '2rem' }}>
          <div style={{ marginBottom: '2rem', textAlign: 'center' }}>
            <div style={{ fontSize: '2.5rem', fontWeight: '700', color: '#3b82f6' }}>
              ${projections[projections.length - 1]?.median.toLocaleString('en-US', { maximumFractionDigits: 0 })}
            </div>
            <div style={{ fontSize: '0.95rem', color: '#64748b' }}>
              Median value in {projectionYears} years
            </div>
            <div style={{ fontSize: '0.85rem', color: '#94a3b8', marginTop: '0.5rem' }}>
              90% Confidence: ${projections[projections.length - 1]?.p10.toLocaleString('en-US', { maximumFractionDigits: 0 })} - 
              ${projections[projections.length - 1]?.p90.toLocaleString('en-US', { maximumFractionDigits: 0 })}
            </div>
          </div>

          <ResponsiveContainer width="100%" height={400}>
            <AreaChart data={projections.map((proj, idx) => ({
              ...proj,
              compMedian: comparisonProjections[idx]?.median,
              compP90: comparisonProjections[idx]?.p90,
              compP10: comparisonProjections[idx]?.p10,
            }))}>
              <defs>
                <linearGradient id="colorMedian" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                </linearGradient>
                <linearGradient id="colorCompMedian" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.2}/>
                  <stop offset="95%" stopColor="#f59e0b" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="year" stroke="#64748b" style={{ fontSize: '0.85rem' }} />
              <YAxis stroke="#64748b" tickFormatter={(val) => `$${(val/1000).toFixed(0)}K`} style={{ fontSize: '0.85rem' }} />
              <Tooltip
                contentStyle={{
                  background: 'white',
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px',
                  boxShadow: '0 4px 6px rgba(0,0,0,0.05)',
                }}
                formatter={(value) => value ? [`$${value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`, ''] : ['N/A', '']}
              />
              
              {/* Your Portfolio Lines */}
              <Area type="monotone" dataKey="p90" stroke="#94a3b8" fill="transparent" strokeDasharray="5 5" strokeWidth={2} name="Your 90th" />
              <Area type="monotone" dataKey="p75" stroke="#cbd5e1" fill="transparent" strokeDasharray="3 3" strokeWidth={1} name="Your 75th" />
              <Area type="monotone" dataKey="median" stroke="#3b82f6" strokeWidth={3} fill="url(#colorMedian)" name="Your Median" />
              <Area type="monotone" dataKey="p25" stroke="#cbd5e1" fill="transparent" strokeDasharray="3 3" strokeWidth={1} name="Your 25th" />
              <Area type="monotone" dataKey="p10" stroke="#94a3b8" fill="transparent" strokeDasharray="5 5" strokeWidth={2} name="Your 10th" />
              
              {/* Comparison Portfolio Lines */}
              {showComparisonProjection && comparisonProjections.length > 0 && (
                <>
                  <Area 
                    type="monotone" 
                    dataKey="compMedian" 
                    stroke="#f59e0b" 
                    strokeWidth={3} 
                    fill="url(#colorCompMedian)" 
                    strokeDasharray="8 4"
                    name="Comparison Median" 
                  />
                  <Area 
                    type="monotone" 
                    dataKey="compP90" 
                    stroke="#fbbf24" 
                    fill="transparent" 
                    strokeDasharray="5 5" 
                    strokeWidth={1.5}
                    name="Comparison 90th" 
                  />
                  <Area 
                    type="monotone" 
                    dataKey="compP10" 
                    stroke="#fbbf24" 
                    fill="transparent" 
                    strokeDasharray="5 5" 
                    strokeWidth={1.5}
                    name="Comparison 10th" 
                  />
                </>
              )}
              
              <Legend />
            </AreaChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* Wealth Bars - 5 Year Increments */}
      {projections.length > 0 && (
        <Card title="Wealth Milestones - 5 Year Increments" subtitle="Average outcomes across best, expected, and worst scenarios" style={{ marginBottom: '2rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            {projections
              .filter((_, idx) => idx % 5 === 0 && idx > 0) // Every 5 years
              .map((proj, idx) => {
                // Calculate average of 95th+ percentile (best case)
                const bestCase = proj.p90 * 1.1; // Approximate 95th+ percentile
                
                // Median (expected)
                const expected = proj.median;
                
                // Calculate average of 5th- percentile (worst case)
                const worstCase = proj.p10 * 0.9; // Approximate 5th- percentile
                
                const maxValue = bestCase;
                
                return (
                  <div key={proj.year} style={{ marginBottom: '1rem' }}>
                    {/* Year Label */}
                    <div style={{ 
                      fontSize: '1rem', 
                      fontWeight: '600', 
                      color: '#0f172a',
                      marginBottom: '0.75rem',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}>
                      <span>Year {proj.year}</span>
                      <span style={{ fontSize: '0.85rem', color: '#64748b', fontWeight: '500' }}>
                        {((expected - portfolio.totalValue) / portfolio.totalValue * 100).toFixed(1)}% growth
                      </span>
                    </div>
                    
                    {/* Best Case Bar (Green) */}
                    <div style={{ marginBottom: '0.5rem' }}>
                      <div style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: '1rem',
                        marginBottom: '0.25rem'
                      }}>
                        <div style={{ 
                          fontSize: '0.75rem', 
                          color: '#10b981', 
                          fontWeight: '600',
                          width: '100px',
                          textAlign: 'right'
                        }}>
                          Best Case
                        </div>
                        <div style={{ flex: 1, position: 'relative', height: '32px' }}>
                          <div style={{
                            position: 'absolute',
                            left: 0,
                            top: 0,
                            height: '100%',
                            width: `${(bestCase / maxValue) * 100}%`,
                            background: 'linear-gradient(90deg, #10b981 0%, #34d399 100%)',
                            borderRadius: '6px',
                            display: 'flex',
                            alignItems: 'center',
                            paddingLeft: '0.75rem',
                            boxShadow: '0 2px 4px rgba(16, 185, 129, 0.2)',
                            transition: 'width 0.5s ease',
                          }}>
                            <span style={{ 
                              fontSize: '0.85rem', 
                              fontWeight: '700', 
                              color: 'white',
                              textShadow: '0 1px 2px rgba(0,0,0,0.2)'
                            }}>
                              ${bestCase.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                    
                    {/* Expected Bar (Blue) */}
                    <div style={{ marginBottom: '0.5rem' }}>
                      <div style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: '1rem',
                        marginBottom: '0.25rem'
                      }}>
                        <div style={{ 
                          fontSize: '0.75rem', 
                          color: '#3b82f6', 
                          fontWeight: '600',
                          width: '100px',
                          textAlign: 'right'
                        }}>
                          Expected
                        </div>
                        <div style={{ flex: 1, position: 'relative', height: '32px' }}>
                          <div style={{
                            position: 'absolute',
                            left: 0,
                            top: 0,
                            height: '100%',
                            width: `${(expected / maxValue) * 100}%`,
                            background: 'linear-gradient(90deg, #3b82f6 0%, #60a5fa 100%)',
                            borderRadius: '6px',
                            display: 'flex',
                            alignItems: 'center',
                            paddingLeft: '0.75rem',
                            boxShadow: '0 2px 4px rgba(59, 130, 246, 0.2)',
                            transition: 'width 0.5s ease',
                          }}>
                            <span style={{ 
                              fontSize: '0.85rem', 
                              fontWeight: '700', 
                              color: 'white',
                              textShadow: '0 1px 2px rgba(0,0,0,0.2)'
                            }}>
                              ${expected.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                    
                    {/* Worst Case Bar (Red) */}
                    <div>
                      <div style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: '1rem'
                      }}>
                        <div style={{ 
                          fontSize: '0.75rem', 
                          color: '#ef4444', 
                          fontWeight: '600',
                          width: '100px',
                          textAlign: 'right'
                        }}>
                          Worst Case
                        </div>
                        <div style={{ flex: 1, position: 'relative', height: '32px' }}>
                          <div style={{
                            position: 'absolute',
                            left: 0,
                            top: 0,
                            height: '100%',
                            width: `${(worstCase / maxValue) * 100}%`,
                            background: 'linear-gradient(90deg, #ef4444 0%, #f87171 100%)',
                            borderRadius: '6px',
                            display: 'flex',
                            alignItems: 'center',
                            paddingLeft: '0.75rem',
                            boxShadow: '0 2px 4px rgba(239, 68, 68, 0.2)',
                            transition: 'width 0.5s ease',
                          }}>
                            <span style={{ 
                              fontSize: '0.85rem', 
                              fontWeight: '700', 
                              color: 'white',
                              textShadow: '0 1px 2px rgba(0,0,0,0.2)'
                            }}>
                              ${worstCase.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                    
                    {/* Divider between years */}
                    {idx < Math.floor(projectionYears / 5) - 1 && (
                      <div style={{ 
                        height: '1px', 
                        background: '#e2e8f0', 
                        marginTop: '2rem' 
                      }} />
                    )}
                  </div>
                );
              })}
          </div>
          
          {/* Legend */}
          <div style={{ 
            marginTop: '2rem', 
            padding: '1rem', 
            background: '#f8fafc', 
            borderRadius: '8px',
            display: 'flex',
            justifyContent: 'center',
            gap: '2rem',
            flexWrap: 'wrap'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <div style={{ 
                width: '20px', 
                height: '20px', 
                background: 'linear-gradient(90deg, #10b981 0%, #34d399 100%)',
                borderRadius: '4px' 
              }} />
              <span style={{ fontSize: '0.85rem', color: '#475569' }}>
                Best Case (95th+ percentile avg)
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <div style={{ 
                width: '20px', 
                height: '20px', 
                background: 'linear-gradient(90deg, #3b82f6 0%, #60a5fa 100%)',
                borderRadius: '4px' 
              }} />
              <span style={{ fontSize: '0.85rem', color: '#475569' }}>
                Expected (50th percentile)
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <div style={{ 
                width: '20px', 
                height: '20px', 
                background: 'linear-gradient(90deg, #ef4444 0%, #f87171 100%)',
                borderRadius: '4px' 
              }} />
              <span style={{ fontSize: '0.85rem', color: '#475569' }}>
                Worst Case (5th- percentile avg)
              </span>
            </div>
          </div>
        </Card>
      )}

      {/* Holdings Table */}
      <Card title="Current Holdings">
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
                <th style={{ padding: '1rem', textAlign: 'left', color: '#475569', fontWeight: '600', fontSize: '0.85rem' }}>TICKER</th>
                <th style={{ padding: '1rem', textAlign: 'left', color: '#475569', fontWeight: '600', fontSize: '0.85rem' }}>ASSET CLASS</th>
                <th style={{ padding: '1rem', textAlign: 'right', color: '#475569', fontWeight: '600', fontSize: '0.85rem' }}>VALUE</th>
                <th style={{ padding: '1rem', textAlign: 'right', color: '#475569', fontWeight: '600', fontSize: '0.85rem' }}>COST</th>
                <th style={{ padding: '1rem', textAlign: 'right', color: '#475569', fontWeight: '600', fontSize: '0.85rem' }}>WEIGHT</th>
                <th style={{ padding: '1rem', textAlign: 'right', color: '#475569', fontWeight: '600', fontSize: '0.85rem' }}>GAIN/LOSS</th>
                <th style={{ padding: '1rem', textAlign: 'right', color: '#475569', fontWeight: '600', fontSize: '0.85rem' }}>RETURN</th>
              </tr>
            </thead>
            <tbody>
              {portfolio.positions.map((pos, idx) => {
                const tickerUpper = pos.ticker.toUpperCase();
                // IMPORTANT: Use assetClassOverrides from state (will trigger re-render when changed)
                const assetClass = assetClassOverrides[tickerUpper] || detectAssetClass(pos.ticker, pos.description);
                const weight = (pos.value / portfolio.totalValue * 100).toFixed(1);
                return (
                  <tr key={`${tickerUpper}-${assetClass}`} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '1rem', fontWeight: '600', color: '#0f172a' }}>{pos.ticker}</td>
                    <td style={{ padding: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <select
                        value={assetClass}
                        onChange={(e) => {
                          const newAssetClass = e.target.value;
                          const newOverrides = { ...assetClassOverrides, [tickerUpper]: newAssetClass };
                          
                          console.log(`🔄 Changing ${tickerUpper}: ${assetClass} → ${newAssetClass}`);
                          console.log('New overrides:', newOverrides);
                          
                          setAssetClassOverrides(newOverrides);
                          
                          // Save user's personal overrides (highest priority)
                          try {
                            localStorage.setItem('user_asset_class_overrides', JSON.stringify(newOverrides));
                            console.log(`💾 Saved user override: ${tickerUpper} → ${newAssetClass}`);
                          } catch (err) {
                            console.log('Could not save user override:', err);
                          }
                          
                          // Save to learned cache for future users (community cache)
                          fetch('http://localhost:3001/api/cache-asset-class', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ ticker: tickerUpper, assetClass: newAssetClass })
                          }).catch(err => console.log('Cache save failed:', err));
                          
                          // Also update general ticker cache
                          try {
                            const cached = JSON.parse(localStorage.getItem('ticker_cache') || '{}');
                            cached[tickerUpper] = newAssetClass;
                            localStorage.setItem('ticker_cache', JSON.stringify(cached));
                          } catch (err) {
                            console.log('Local cache save failed:', err);
                          }
                          
                          // Instantly recalculate analysis (synchronous, fast)
                          const newAssetAllocation = {};
                          let newTotalValue = 0;
                          let newWeightedReturn = 0;
                          let newWeightedVolatilitySquared = 0;
                          
                          portfolio.positions.forEach(p => {
                            const pTicker = p.ticker.toUpperCase();
                            const pAssetClass = newOverrides[pTicker] || detectAssetClass(p.ticker, p.description);
                            newAssetAllocation[pAssetClass] = (newAssetAllocation[pAssetClass] || 0) + p.value;
                            newTotalValue += p.value;
                          });
                          
                          const newAllocationBreakdown = [];
                          for (const [ac, value] of Object.entries(newAssetAllocation)) {
                            const weight = value / newTotalValue;
                            const assumptions = customAssetClasses[ac] || LTCMA[ac] || LTCMA['UNKNOWN'];
                            newWeightedReturn += weight * assumptions.return;
                            newWeightedVolatilitySquared += Math.pow(weight * assumptions.volatility, 2);
                            newAllocationBreakdown.push({
                              assetClass: ac,
                              value,
                              weight: weight * 100,
                              expectedReturn: assumptions.return,
                              volatility: assumptions.volatility,
                              contribution: weight * assumptions.return,
                            });
                          }
                          
                          newAllocationBreakdown.sort((a, b) => b.weight - a.weight);
                          const newWeightedVolatility = Math.sqrt(newWeightedVolatilitySquared);
                          
                          // Update analysis instantly
                          setPortfolioAnalysis({
                            ...portfolioAnalysis,
                            expectedReturn: newWeightedReturn,
                            expectedVolatility: newWeightedVolatility,
                            assetAllocation: newAssetAllocation,
                            allocationBreakdown: newAllocationBreakdown,
                            totalValue: newTotalValue,
                          });
                        }}
                        style={{
                          flex: 1,
                          padding: '0.4rem 0.6rem',
                          border: '1px solid #e2e8f0',
                          borderRadius: '4px',
                          fontSize: '0.85rem',
                          background: 'white',
                          color: '#64748b',
                          cursor: 'pointer'
                        }}
                      >
                        {/* Custom Asset Classes */}
                        {Object.keys(customAssetClasses).length > 0 && (
                          <optgroup label="✨ Custom">
                            {Object.keys(customAssetClasses).map(className => (
                              <option key={className} value={className}>
                                {formatAssetClassName(className)}
                              </option>
                            ))}
                          </optgroup>
                        )}
                        
                        <optgroup label="💰 Fixed Income">
                          <option value="UK_INFLATION">UK Inflation</option>
                          <option value="UK_CASH">UK Cash</option>
                          <option value="US_AGGREGATE_BONDS_HEDGED">U.S. Aggregate Bonds hedged</option>
                          <option value="EURO_AGGREGATE_BONDS_HEDGED">Euro Aggregate Bonds hedged</option>
                          <option value="US_INV_GRADE_CORPORATE_BONDS_HEDGED">U.S. Inv Grade Corporate Bonds hedged</option>
                          <option value="EURO_INV_GRADE_CORPORATE_BONDS_HEDGED">Euro Inv Grade Corporate Bonds hedged</option>
                          <option value="UK_INV_GRADE_CORPORATE_BONDS">UK Inv Grade Corporate Bonds</option>
                          <option value="US_HIGH_YIELD_BONDS_HEDGED">U.S. High Yield Bonds hedged</option>
                          <option value="EURO_HIGH_YIELD_BONDS_HEDGED">Euro High Yield Bonds hedged</option>
                          <option value="GLOBAL_CREDIT_HEDGED">Global Credit hedged</option>
                          <option value="US_LEVERAGED_LOANS_HEDGED">U.S. Leveraged Loans hedged</option>
                          <option value="EURO_GOVERNMENT_BONDS_HEDGED">Euro Government Bonds hedged</option>
                          <option value="UK_GILTS">UK Gilts</option>
                          <option value="UK_INFLATION_LINKED_BONDS">UK Inflation-Linked Bonds</option>
                          <option value="WORLD_GOVERNMENT_BONDS_HEDGED">World Government Bonds hedged</option>
                          <option value="WORLD_GOVERNMENT_BONDS">World Government Bonds</option>
                          <option value="WORLD_EX_UK_GOVERNMENT_BONDS_HEDGED">World ex-UK Government Bonds hedged</option>
                          <option value="WORLD_EX_UK_GOVERNMENT_BONDS">World ex-UK Government Bonds</option>
                          <option value="EMERGING_MARKETS_SOVEREIGN_DEBT_HEDGED">Emerging Markets Sovereign Debt hedged</option>
                          <option value="EMERGING_MARKETS_LOCAL_CURRENCY_DEBT">Emerging Markets Local Currency Debt</option>
                          <option value="EMERGING_MARKETS_CORPORATE_BONDS_HEDGED">Emerging Markets Corporate Bonds hedged</option>
                        </optgroup>
                        
                        <optgroup label="📈 Equities">
                          <option value="UK_ALL_CAP">UK All Cap</option>
                          <option value="UK_LARGE_CAP">UK Large Cap</option>
                          <option value="UK_SMALL_CAP">UK Small Cap</option>
                          <option value="US_LARGE_CAP">U.S. Large Cap</option>
                          <option value="US_SMALL_CAP">U.S. Small Cap</option>
                          <option value="US_MID_CAP">U.S. Mid Cap</option>
                          <option value="US_LARGE_CAP_HEDGED">U.S. Large Cap hedged</option>
                          <option value="EURO_AREA_LARGE_CAP">Euro Area Large Cap</option>
                          <option value="EURO_AREA_LARGE_CAP_HEDGED">Euro Area Large Cap hedged</option>
                          <option value="EURO_AREA_SMALL_CAP">Euro Area Small Cap</option>
                          <option value="EURO_AREA_SMALL_CAP_HEDGED">Euro Area Small Cap hedged</option>
                          <option value="JAPANESE_EQUITY">Japanese Equity</option>
                          <option value="JAPANESE_EQUITY_HEDGED">Japanese Equity hedged</option>
                          <option value="AC_ASIA_EX_JAPAN_EQUITY">AC Asia ex-Japan Equity</option>
                          <option value="CHINESE_DOMESTIC_EQUITY">Chinese Domestic Equity</option>
                          <option value="EMERGING_MARKETS_EQUITY">Emerging Markets Equity</option>
                          <option value="AC_WORLD_EQUITY">AC World Equity</option>
                          <option value="AC_WORLD_EX_UK_EQUITY">AC World ex-UK Equity</option>
                          <option value="DEVELOPED_WORLD_EQUITY">Developed World Equity</option>
                          <option value="DEVELOPED_WORLD_EX_UK_EQUITY_HEDGED">Developed World ex-UK Equity hedged</option>
                          <option value="INTERNATIONAL_DEVELOPED_EQUITY">International Developed Equity</option>
                        </optgroup>
                        
                        <optgroup label="🏗️ Alternatives">
                          <option value="GLOBAL_CREDIT_SENSITIVE_CONVERTIBLE_HEDGED">Global Credit Sensitive Convertible hedged</option>
                          <option value="US_CORE_REAL_ESTATE">U.S. Core Real Estate</option>
                          <option value="EUROPEAN_CORE_REAL_ESTATE">European Core Real Estate</option>
                          <option value="EUROPEAN_CORE_REAL_ESTATE_HEDGED">European Core Real Estate hedged</option>
                          <option value="UK_CORE_REAL_ESTATE">UK Core Real Estate</option>
                          <option value="EUROPEAN_VALUE_ADDED_REAL_ESTATE">European Value-Added Real Estate</option>
                          <option value="EUROPEAN_VALUE_ADDED_REAL_ESTATE_HEDGED">European Value-Added Real Estate hedged</option>
                          <option value="GLOBAL_REITS">Global REITs</option>
                          <option value="GLOBAL_CORE_INFRASTRUCTURE">Global Core Infrastructure</option>
                          <option value="GLOBAL_CORE_TRANSPORT">Global Core Transport</option>
                          <option value="GLOBAL_TIMBERLAND">Global Timberland</option>
                          <option value="COMMODITIES">Commodities</option>
                          <option value="GOLD">Gold</option>
                          <option value="PRIVATE_EQUITY">Private Equity</option>
                          <option value="VENTURE_CAPITAL">Venture Capital</option>
                          <option value="DIVERSIFIED_HEDGE_FUNDS_HEDGED">Diversified Hedge Funds hedged</option>
                          <option value="EVENT_DRIVEN_HEDGE_FUNDS_HEDGED">Event Driven Hedge Funds hedged</option>
                          <option value="LONG_BIAS_HEDGE_FUNDS_HEDGED">Long Bias Hedge Funds hedged</option>
                          <option value="RELATIVE_VALUE_HEDGE_FUNDS_HEDGED">Relative Value Hedge Funds hedged</option>
                          <option value="MACRO_HEDGE_FUNDS_HEDGED">Macro Hedge Funds hedged</option>
                          <option value="CASH">Cash</option>
                        </optgroup>
                      </select>
                      <button
                        onClick={() => {
                          setEditingTicker(tickerUpper);
                          setShowCustomAssetClassModal(true);
                        }}
                        style={{
                          padding: '0.4rem',
                          background: '#f8fafc',
                          border: '1px solid #e2e8f0',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          color: '#64748b',
                          transition: 'all 0.2s'
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = '#3b82f6';
                          e.currentTarget.style.color = 'white';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = '#f8fafc';
                          e.currentTarget.style.color = '#64748b';
                        }}
                        title="Create custom asset class"
                      >
                        <Edit size={14} />
                      </button>
                    </td>
                    <td style={{ padding: '1rem', textAlign: 'right', fontWeight: '600', color: '#0f172a' }}>
                      ${pos.value.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </td>
                    <td style={{ padding: '1rem', textAlign: 'right', color: '#64748b' }}>
                      ${pos.cost.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </td>
                    <td style={{ padding: '1rem', textAlign: 'right', color: '#64748b' }}>
                      {weight}%
                    </td>
                    <td style={{
                      padding: '1rem',
                      textAlign: 'right',
                      color: pos.gainLoss >= 0 ? '#10b981' : '#ef4444',
                      fontWeight: '600',
                    }}>
                      ${pos.gainLoss.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </td>
                    <td style={{
                      padding: '1rem',
                      textAlign: 'right',
                      color: pos.gainLoss >= 0 ? '#10b981' : '#ef4444',
                      fontWeight: '600',
                    }}>
                      {((pos.gainLoss / pos.cost) * 100).toFixed(2)}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <div style={{ textAlign: 'center', marginTop: '2rem', display: 'flex', gap: '1rem', justifyContent: 'center' }}>
        <button
          onClick={() => {
            if (window.confirm('Are you sure you want to clear your portfolio? This will remove all positions and analysis.')) {
              setPortfolio(null);
              setPortfolioAnalysis(null);
            }
          }}
          style={{
            background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
            border: 'none',
            color: 'white',
            padding: '0.75rem 2rem',
            borderRadius: '8px',
            fontSize: '0.95rem',
            fontWeight: '600',
            cursor: 'pointer',
            transition: 'transform 0.2s ease',
          }}
          onMouseEnter={(e) => e.currentTarget.style.transform = 'translateY(-2px)'}
          onMouseLeave={(e) => e.currentTarget.style.transform = 'translateY(0)'}
        >
          🗑️ Clear Portfolio
        </button>
        
        <button
          onClick={() => {
            setPortfolio(null);
            setPortfolioAnalysis(null);
          }}
          style={{
            background: 'white',
            border: '2px solid #e2e8f0',
            color: '#64748b',
            padding: '0.75rem 2rem',
            borderRadius: '8px',
            fontSize: '0.95rem',
            fontWeight: '600',
            cursor: 'pointer',
            transition: 'transform 0.2s ease',
          }}
          onMouseEnter={(e) => e.currentTarget.style.transform = 'translateY(-2px)'}
          onMouseLeave={(e) => e.currentTarget.style.transform = 'translateY(0)'}
        >
          📤 Upload New Portfolio
        </button>
        
        <button
          onClick={() => {
            if (window.confirm('Clear community cache? This will remove cached ticker data but keeps YOUR manual corrections.')) {
              try {
                localStorage.removeItem('ticker_cache');
                localStorage.removeItem('sector_cache');
                // DON'T remove user_asset_class_overrides - those are the user's manual corrections!
                alert('Community cache cleared! Your corrections are preserved.');
              } catch (err) {
                alert('Could not clear cache');
              }
            }
          }}
          style={{
            background: 'white',
            border: '2px solid #e2e8f0',
            color: '#64748b',
            padding: '0.75rem 2rem',
            borderRadius: '8px',
            fontSize: '0.95rem',
            fontWeight: '600',
            cursor: 'pointer',
            transition: 'transform 0.2s ease',
          }}
          onMouseEnter={(e) => e.currentTarget.style.transform = 'translateY(-2px)'}
          onMouseLeave={(e) => e.currentTarget.style.transform = 'translateY(0)'}
          title="Clear cached ticker and sector data"
        >
          🗄️ Clear Cache
        </button>
      </div>
      
      {/* Custom Asset Class Modal */}
      {showCustomAssetClassModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000
        }} onClick={() => setShowCustomAssetClassModal(false)}>
          <div style={{
            background: 'white',
            borderRadius: '12px',
            padding: '2rem',
            maxWidth: '500px',
            width: '90%',
            boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)'
          }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontSize: '1.5rem', fontWeight: '700', color: '#0f172a', marginBottom: '1.5rem' }}>
              Create Custom Asset Class
            </h3>
            
            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '600', color: '#475569', marginBottom: '0.5rem' }}>
                Asset Class Name
              </label>
              <input
                type="text"
                value={customAssetClassName}
                onChange={(e) => setCustomAssetClassName(e.target.value)}
                placeholder="e.g., Crypto, Art, Private Credit"
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  border: '2px solid #e2e8f0',
                  borderRadius: '8px',
                  fontSize: '1rem'
                }}
              />
            </div>
            
            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '600', color: '#475569', marginBottom: '0.5rem' }}>
                Expected Annual Return (%)
              </label>
              <input
                type="number"
                value={customAssetClassReturn}
                onChange={(e) => setCustomAssetClassReturn(e.target.value)}
                placeholder="e.g., 8.5"
                step="0.1"
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  border: '2px solid #e2e8f0',
                  borderRadius: '8px',
                  fontSize: '1rem'
                }}
              />
            </div>
            
            <div style={{ marginBottom: '2rem' }}>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '600', color: '#475569', marginBottom: '0.5rem' }}>
                Expected Volatility (%)
              </label>
              <input
                type="number"
                value={customAssetClassVolatility}
                onChange={(e) => setCustomAssetClassVolatility(e.target.value)}
                placeholder="e.g., 15.5"
                step="0.1"
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  border: '2px solid #e2e8f0',
                  borderRadius: '8px',
                  fontSize: '1rem'
                }}
              />
            </div>
            
            <div style={{ display: 'flex', gap: '1rem' }}>
              <button
                onClick={() => {
                  setShowCustomAssetClassModal(false);
                  setCustomAssetClassName('');
                  setCustomAssetClassReturn('');
                  setCustomAssetClassVolatility('');
                  setEditingTicker(null);
                }}
                style={{
                  flex: 1,
                  padding: '0.75rem',
                  background: '#f1f5f9',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '1rem',
                  fontWeight: '600',
                  color: '#64748b',
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (customAssetClassName && customAssetClassReturn && customAssetClassVolatility) {
                    // Preserve exact case, just replace spaces with underscores
                    const className = customAssetClassName.replace(/\s+/g, '_');
                    
                    // Add custom asset class
                    const newCustomClasses = {
                      ...customAssetClasses,
                      [className]: {
                        return: parseFloat(customAssetClassReturn),
                        volatility: parseFloat(customAssetClassVolatility)
                      }
                    };
                    setCustomAssetClasses(newCustomClasses);
                    
                    // Save to localStorage
                    try {
                      localStorage.setItem('custom_asset_classes', JSON.stringify(newCustomClasses));
                      console.log(`💾 Saved custom asset class: ${className}`);
                    } catch (err) {
                      console.log('Could not save custom asset class:', err);
                    }
                    
                    // Auto-assign to the ticker that was clicked
                    if (editingTicker) {
                      const newOverrides = { ...assetClassOverrides, [editingTicker]: className };
                      setAssetClassOverrides(newOverrides);
                      
                      // Save user's personal override
                      try {
                        localStorage.setItem('user_asset_class_overrides', JSON.stringify(newOverrides));
                        console.log(`💾 Saved user override: ${editingTicker} → ${className}`);
                      } catch (err) {
                        console.log('Could not save user override:', err);
                      }
                      
                      // Instantly recalculate analysis
                      const newAssetAllocation = {};
                      let newTotalValue = 0;
                      let newWeightedReturn = 0;
                      let newWeightedVolatilitySquared = 0;
                      
                      portfolio.positions.forEach(p => {
                        const pTicker = p.ticker.toUpperCase();
                        const pAssetClass = newOverrides[pTicker] || detectAssetClass(p.ticker, p.description);
                        newAssetAllocation[pAssetClass] = (newAssetAllocation[pAssetClass] || 0) + p.value;
                        newTotalValue += p.value;
                      });
                      
                      const newAllocationBreakdown = [];
                      for (const [ac, value] of Object.entries(newAssetAllocation)) {
                        const weight = value / newTotalValue;
                        const assumptions = customAssetClasses[ac] || { return: parseFloat(customAssetClassReturn), volatility: parseFloat(customAssetClassVolatility) } || LTCMA[ac] || LTCMA['UNKNOWN'];
                        newWeightedReturn += weight * assumptions.return;
                        newWeightedVolatilitySquared += Math.pow(weight * assumptions.volatility, 2);
                        newAllocationBreakdown.push({
                          assetClass: ac,
                          value,
                          weight: weight * 100,
                          expectedReturn: assumptions.return,
                          volatility: assumptions.volatility,
                          contribution: weight * assumptions.return,
                        });
                      }
                      
                      newAllocationBreakdown.sort((a, b) => b.weight - a.weight);
                      const newWeightedVolatility = Math.sqrt(newWeightedVolatilitySquared);
                      
                      // Update analysis instantly
                      setPortfolioAnalysis({
                        ...portfolioAnalysis,
                        expectedReturn: newWeightedReturn,
                        expectedVolatility: newWeightedVolatility,
                        assetAllocation: newAssetAllocation,
                        allocationBreakdown: newAllocationBreakdown,
                        totalValue: newTotalValue,
                      });
                    }
                    
                    // Close modal and reset
                    setShowCustomAssetClassModal(false);
                    setCustomAssetClassName('');
                    setCustomAssetClassReturn('');
                    setCustomAssetClassVolatility('');
                    setEditingTicker(null);
                  }
                }}
                style={{
                  flex: 1,
                  padding: '0.75rem',
                  background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '1rem',
                  fontWeight: '600',
                  color: 'white',
                  cursor: 'pointer'
                }}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Info Modals */}
      {showMonteCarloInfo && (
        <InfoModal title="Monte Carlo Simulation" onClose={() => setShowMonteCarloInfo(false)}>
          <p style={{ marginBottom: '1rem', color: '#475569', lineHeight: '1.6' }}>
            A statistical method that runs thousands of random scenarios to model potential outcomes.
          </p>
          <div style={{ marginBottom: '1rem', padding: '1rem', background: '#eff6ff', borderRadius: '8px', border: '1px solid #bfdbfe' }}>
            <strong style={{ color: '#1e40af' }}>How it works:</strong>
            <ol style={{ marginTop: '0.5rem', paddingLeft: '1.5rem', fontSize: '0.875rem', color: '#1e3a8a', lineHeight: '1.8' }}>
              <li>Takes your inputs (returns, volatility, contributions)</li>
              <li>Runs 10,000 different random market scenarios</li>
              <li>Shows range of possible outcomes</li>
            </ol>
          </div>
          <div style={{ marginBottom: '1rem' }}>
            <strong>What the percentiles mean:</strong>
            <ul style={{ marginTop: '0.5rem', paddingLeft: '1.5rem', lineHeight: '1.8', color: '#64748b', fontSize: '0.875rem' }}>
              <li><strong>90th percentile:</strong> You did better than 90% of scenarios (optimistic)</li>
              <li><strong>Median (50th):</strong> Middle outcome (typical)</li>
              <li><strong>10th percentile:</strong> Only 10% of scenarios were worse (conservative)</li>
            </ul>
          </div>
          <div style={{ padding: '1rem', background: '#fef3c7', borderRadius: '8px', border: '1px solid #fcd34d' }}>
            <strong style={{ color: '#78350f' }}>Why it's useful:</strong>
            <div style={{ marginTop: '0.5rem', fontSize: '0.875rem', color: '#78350f' }}>
              • Shows realistic range of outcomes<br/>
              • Accounts for market volatility<br/>
              • Better than single "average return" projection<br/>
              • Helps set realistic expectations
            </div>
          </div>
        </InfoModal>
      )}
      
      {showAssetAllocationInfo && (
        <InfoModal title="Asset Allocation" onClose={() => setShowAssetAllocationInfo(false)}>
          <p style={{ marginBottom: '1rem', color: '#475569', lineHeight: '1.6' }}>
            How your money is divided among different investment types (asset classes).
          </p>
          <div style={{ marginBottom: '1rem' }}>
            <strong>Common Asset Classes:</strong>
            <ul style={{ marginTop: '0.5rem', paddingLeft: '1.5rem', lineHeight: '1.8', color: '#64748b', fontSize: '0.875rem' }}>
              <li><strong>US Stocks:</strong> Companies traded in the United States</li>
              <li><strong>International Stocks:</strong> Companies outside the US</li>
              <li><strong>Bonds:</strong> Government and corporate debt securities</li>
              <li><strong>Cash:</strong> Money market funds, savings accounts</li>
              <li><strong>Real Estate:</strong> REITs and property investments</li>
              <li><strong>Commodities:</strong> Gold, oil, agricultural products</li>
            </ul>
          </div>
          <div style={{ padding: '1rem', background: '#eff6ff', borderRadius: '8px', border: '1px solid #bfdbfe', marginBottom: '1rem' }}>
            <strong style={{ color: '#1e40af' }}>Why it matters:</strong>
            <div style={{ marginTop: '0.5rem', fontSize: '0.875rem', color: '#1e3a8a' }}>
              Asset allocation is the #1 determinant of portfolio returns. It matters more than individual stock picking.
            </div>
          </div>
          <div style={{ padding: '1rem', background: '#fef3c7', borderRadius: '8px', border: '1px solid #fcd34d' }}>
            <strong style={{ color: '#78350f' }}>Rule of Thumb:</strong>
            <div style={{ marginTop: '0.5rem', fontSize: '0.875rem', color: '#78350f' }}>
              Traditional rule: Stock % = 100 - your age<br/>
              Example: At age 30 → 70% stocks, 30% bonds<br/>
              Adjust based on risk tolerance and time horizon
            </div>
          </div>
        </InfoModal>
      )}
      
      {showFrequencyInfo && (
        <InfoModal title="Contribution Frequency" onClose={() => setShowFrequencyInfo(false)}>
          <p style={{ marginBottom: '1rem', color: '#475569', lineHeight: '1.6' }}>
            How often you add money to your portfolio. Different frequencies can affect your results.
          </p>
          <div style={{ marginBottom: '1rem' }}>
            <strong>Frequency Options:</strong>
            <table style={{ width: '100%', fontSize: '0.875rem', marginTop: '0.5rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                  <th style={{ padding: '0.5rem', textAlign: 'left', color: '#64748b' }}>Frequency</th>
                  <th style={{ padding: '0.5rem', textAlign: 'right', color: '#64748b' }}>Contributions/Year</th>
                  <th style={{ padding: '0.5rem', textAlign: 'left', color: '#64748b' }}>Best For</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={{ padding: '0.5rem' }}>Daily</td>
                  <td style={{ padding: '0.5rem', textAlign: 'right' }}>252</td>
                  <td style={{ padding: '0.5rem', color: '#64748b' }}>Automated investing</td>
                </tr>
                <tr>
                  <td style={{ padding: '0.5rem' }}>Weekly</td>
                  <td style={{ padding: '0.5rem', textAlign: 'right' }}>52</td>
                  <td style={{ padding: '0.5rem', color: '#64748b' }}>Regular DCA strategy</td>
                </tr>
                <tr>
                  <td style={{ padding: '0.5rem' }}>Monthly</td>
                  <td style={{ padding: '0.5rem', textAlign: 'right' }}>12</td>
                  <td style={{ padding: '0.5rem', color: '#64748b' }}>Matches paycheck</td>
                </tr>
                <tr>
                  <td style={{ padding: '0.5rem' }}>Quarterly</td>
                  <td style={{ padding: '0.5rem', textAlign: 'right' }}>4</td>
                  <td style={{ padding: '0.5rem', color: '#64748b' }}>Bonus/dividend reinvest</td>
                </tr>
                <tr>
                  <td style={{ padding: '0.5rem' }}>Annually</td>
                  <td style={{ padding: '0.5rem', textAlign: 'right' }}>1</td>
                  <td style={{ padding: '0.5rem', color: '#64748b' }}>IRA contributions</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div style={{ padding: '1rem', background: '#eff6ff', borderRadius: '8px', border: '1px solid #bfdbfe' }}>
            <strong style={{ color: '#1e40af' }}>Dollar-Cost Averaging (DCA):</strong>
            <div style={{ marginTop: '0.5rem', fontSize: '0.875rem', color: '#1e3a8a' }}>
              Contributing regularly (vs. lump sum) reduces timing risk by buying more shares when prices are low and fewer when high.
            </div>
          </div>
        </InfoModal>
      )}
    </div>
  );
}

// ==================== COMPOUND CALCULATOR TAB ====================
function CompoundCalculatorTab({ mode, setMode, inputs, setInputs, result, requiredReturn, portfolioData }) {
  const updateInput = (field, value) => {
    setInputs(prev => ({ ...prev, [field]: value }));
  };
  
  const usePortfolioData = () => {
    if (portfolioData) {
      setInputs(prev => ({
        ...prev,
        principal: portfolioData.totalValue,
        annualRate: portfolioData.expectedReturn,
      }));
    }
  };

  const totalContributions = inputs.principal + (inputs.monthlyContribution * 12 * inputs.years);
  const totalInterest = result ? result - totalContributions : 0;

  return (
    <div>
      <Card title="Compound Interest Calculator" subtitle="Calculate future value or backsolve for required return">
        {/* Use Portfolio Data Button */}
        {portfolioData && (
          <div style={{
            marginBottom: '1.5rem',
            padding: '1rem',
            background: '#f0f9ff',
            border: '2px solid #bae6fd',
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <div>
              <div style={{ fontWeight: '600', color: '#0c4a6e', marginBottom: '0.25rem' }}>
                📊 Portfolio Data Available
              </div>
              <div style={{ fontSize: '0.875rem', color: '#075985' }}>
                Auto-fill with your portfolio: ${portfolioData.totalValue.toLocaleString()} @ {portfolioData.expectedReturn.toFixed(2)}% return
              </div>
            </div>
            <button
              onClick={usePortfolioData}
              style={{
                padding: '0.75rem 1.5rem',
                background: '#0ea5e9',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                fontSize: '0.875rem',
                fontWeight: '600',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                transition: 'all 0.2s',
              }}
              onMouseEnter={(e) => e.target.style.background = '#0284c7'}
              onMouseLeave={(e) => e.target.style.background = '#0ea5e9'}
            >
              Use Portfolio Data
            </button>
          </div>
        )}
        
        {/* Mode Selector */}
        <div style={{ marginBottom: '2rem' }}>
          <div style={{
            display: 'inline-flex',
            background: '#f1f5f9',
            borderRadius: '8px',
            padding: '0.25rem',
          }}>
            <button
              onClick={() => setMode('forward')}
              style={{
                padding: '0.5rem 1rem',
                background: mode === 'forward' ? 'white' : 'transparent',
                border: 'none',
                borderRadius: '6px',
                fontWeight: '600',
                fontSize: '0.875rem',
                cursor: 'pointer',
                color: mode === 'forward' ? '#3b82f6' : '#64748b',
                boxShadow: mode === 'forward' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
              }}
            >
              Calculate Future Value
            </button>
            <button
              onClick={() => setMode('backsolve')}
              style={{
                padding: '0.5rem 1rem',
                background: mode === 'backsolve' ? 'white' : 'transparent',
                border: 'none',
                borderRadius: '6px',
                fontWeight: '600',
                fontSize: '0.875rem',
                cursor: 'pointer',
                color: mode === 'backsolve' ? '#3b82f6' : '#64748b',
                boxShadow: mode === 'backsolve' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
              }}
            >
              Backsolve for Return
            </button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
          {/* Inputs */}
          <div>
            <h4 style={{ fontSize: '1rem', fontWeight: '600', color: '#0f172a', marginBottom: '1.5rem' }}>
              Initial Investment
            </h4>
            <InputField
              label="Initial Investment"
              value={inputs.principal}
              onChange={(e) => updateInput('principal', parseFloat(e.target.value) || 0)}
              prefix="$"
            />
            
            <h4 style={{ fontSize: '1rem', fontWeight: '600', color: '#0f172a', marginTop: '2rem', marginBottom: '1.5rem' }}>
              Contributions
            </h4>
            <InputField
              label="Monthly Contribution"
              value={inputs.monthlyContribution}
              onChange={(e) => updateInput('monthlyContribution', parseFloat(e.target.value) || 0)}
              prefix="$"
            />
            
            <InputField
              label="Time Horizon (Years)"
              value={inputs.years}
              onChange={(e) => updateInput('years', parseFloat(e.target.value) || 0)}
            />
            
            {mode === 'forward' ? (
              <>
                <h4 style={{ fontSize: '1rem', fontWeight: '600', color: '#0f172a', marginTop: '2rem', marginBottom: '1.5rem' }}>
                  Interest Rate
                </h4>
                <InputField
                  label="Annual Interest Rate (%)"
                  value={inputs.annualRate}
                  onChange={(e) => updateInput('annualRate', parseFloat(e.target.value) || 0)}
                  suffix="%"
                />
                
                <InputField
                  label="Rate Variance Range (%)"
                  value={inputs.rateVariance}
                  onChange={(e) => updateInput('rateVariance', parseFloat(e.target.value) || 0)}
                  suffix="%"
                />
              </>
            ) : (
              <>
                <h4 style={{ fontSize: '1rem', fontWeight: '600', color: '#0f172a', marginTop: '2rem', marginBottom: '1.5rem' }}>
                  Target Goal
                </h4>
                <InputField
                  label="Target Future Value"
                  value={inputs.targetValue}
                  onChange={(e) => updateInput('targetValue', parseFloat(e.target.value) || 0)}
                  prefix="$"
                  help="What amount do you want to reach?"
                />
              </>
            )}
            
            <h4 style={{ fontSize: '1rem', fontWeight: '600', color: '#0f172a', marginTop: '2rem', marginBottom: '1.5rem' }}>
              Compound Frequency
            </h4>
            <select
              value={inputs.compoundFreq}
              onChange={(e) => updateInput('compoundFreq', e.target.value)}
              style={{
                width: '100%',
                padding: '0.75rem',
                border: '2px solid #e2e8f0',
                borderRadius: '8px',
                fontSize: '1rem',
                background: '#fefce8',
                fontWeight: '600',
                color: '#0f172a',
              }}
            >
              <option value="annually">Annually</option>
              <option value="semiannually">Semiannually</option>
              <option value="quarterly">Quarterly</option>
              <option value="monthly">Monthly</option>
              <option value="daily">Daily</option>
            </select>
          </div>

          {/* Results */}
          <div>
            <h4 style={{ fontSize: '1rem', fontWeight: '600', color: '#0f172a', marginBottom: '1.5rem' }}>
              Results
            </h4>
            
            {mode === 'forward' ? (
              <>
                <div style={{
                  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                  borderRadius: '12px',
                  padding: '2rem',
                  color: 'white',
                  marginBottom: '2rem',
                }}>
                  <div style={{ fontSize: '0.875rem', opacity: 0.9, marginBottom: '0.5rem' }}>
                    Future Value
                  </div>
                  <div style={{ fontSize: '3rem', fontWeight: '700', marginBottom: '1rem' }}>
                    ${result?.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                  <div style={{ fontSize: '0.875rem', opacity: 0.8 }}>
                    After {inputs.years} years at {inputs.annualRate}%
                  </div>
                </div>

                <div style={{ display: 'grid', gap: '1rem', marginBottom: '2rem' }}>
                  <div style={{
                    padding: '1.5rem',
                    background: '#f8fafc',
                    borderRadius: '8px',
                    border: '1px solid #e2e8f0',
                  }}>
                    <div style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '0.5rem' }}>
                      Total Contributions
                    </div>
                    <div style={{ fontSize: '1.5rem', fontWeight: '700', color: '#0f172a' }}>
                      ${totalContributions.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </div>
                  </div>

                  <div style={{
                    padding: '1.5rem',
                    background: '#f0fdf4',
                    borderRadius: '8px',
                    border: '1px solid #bbf7d0',
                  }}>
                    <div style={{ fontSize: '0.85rem', color: '#166534', marginBottom: '0.5rem' }}>
                      Total Interest Earned
                    </div>
                    <div style={{ fontSize: '1.5rem', fontWeight: '700', color: '#15803d' }}>
                      ${totalInterest.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </div>
                  </div>
                </div>

                {/* Variance Scenarios */}
                <div>
                  <h4 style={{ fontSize: '1rem', fontWeight: '600', color: '#0f172a', marginBottom: '1rem' }}>
                    Rate Variance Scenarios
                  </h4>
                  {[-inputs.rateVariance, 0, inputs.rateVariance].map((variance, idx) => {
                    const rate = inputs.annualRate + variance;
                    const scenarioResult = calculateCompoundInterest(
                      inputs.principal,
                      inputs.monthlyContribution,
                      inputs.years,
                      rate,
                      inputs.compoundFreq
                    );
                    const label = variance < 0 ? 'Low' : variance > 0 ? 'High' : 'Base';
                    
                    return (
                      <div
                        key={idx}
                        style={{
                          padding: '1rem',
                          marginBottom: '0.5rem',
                          background: variance === 0 ? '#eff6ff' : '#f8fafc',
                          borderRadius: '8px',
                          border: `1px solid ${variance === 0 ? '#bfdbfe' : '#e2e8f0'}`,
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                        }}
                      >
                        <div>
                          <div style={{ fontSize: '0.85rem', color: '#64748b' }}>
                            {label} ({rate.toFixed(2)}%)
                          </div>
                          <div style={{ fontSize: '1.25rem', fontWeight: '600', color: '#0f172a' }}>
                            ${scenarioResult.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <>
                <div style={{
                  background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                  borderRadius: '12px',
                  padding: '2rem',
                  color: 'white',
                  marginBottom: '2rem',
                }}>
                  <div style={{ fontSize: '0.875rem', opacity: 0.9, marginBottom: '0.5rem' }}>
                    Required Annual Return
                  </div>
                  <div style={{ fontSize: '3rem', fontWeight: '700', marginBottom: '1rem' }}>
                    {requiredReturn?.toFixed(2)}%
                  </div>
                  <div style={{ fontSize: '0.875rem', opacity: 0.8 }}>
                    To reach ${inputs.targetValue.toLocaleString()} in {inputs.years} years
                  </div>
                </div>

                <div style={{
                  padding: '1.5rem',
                  background: '#eff6ff',
                  borderRadius: '8px',
                  border: '1px solid #bfdbfe',
                }}>
                  <div style={{ fontSize: '0.875rem', color: '#1e40af', lineHeight: '1.6' }}>
                    <strong>What this means:</strong> With your initial investment of ${inputs.principal.toLocaleString()} 
                    and monthly contributions of ${inputs.monthlyContribution.toLocaleString()}, you need an average 
                    annual return of <strong>{requiredReturn?.toFixed(2)}%</strong> to reach your goal 
                    of ${inputs.targetValue.toLocaleString()} in {inputs.years} years.
                  </div>
                </div>

                <div style={{
                  marginTop: '1.5rem',
                  padding: '1.5rem',
                  background: '#fef3c7',
                  borderRadius: '8px',
                  border: '1px solid #fcd34d',
                }}>
                  <div style={{ fontSize: '0.875rem', color: '#78350f', lineHeight: '1.6' }}>
                    <strong>Reality Check:</strong>
                    <ul style={{ marginTop: '0.5rem', paddingLeft: '1.5rem' }}>
                      <li>S&P 500 historical average: ~10%/year</li>
                      <li>Conservative portfolio: 6-7%/year</li>
                      <li>Aggressive portfolio: 8-12%/year</li>
                    </ul>
                    {requiredReturn > 15 && (
                      <div style={{ marginTop: '0.5rem', color: '#dc2626', fontWeight: '600' }}>
                        ⚠️ Returns above 15% are very aggressive and may require increased risk or longer timeframe.
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}

// Continue in next message due to length...

// Export stock analysis to Excel with formulas AND calculated values (Numbers-compatible)
const exportStockAnalysisToNumbers = (stockData, stockProjections, assumptions, scenario, enhancedMetrics) => {
  if (!stockData || !stockData.quote) {
    alert('No stock data available to export');
    return;
  }
  
  const wb = XLSX.utils.book_new();
  
  // ==================== SHEET 1: COMPANY INFO ====================
  const companyInfo = [
    ['STOCK ANALYSIS MODEL'],
    [''],
    ['Company:', stockData.profile?.companyName || ''],
    ['Ticker:', stockData.quote.symbol || ''],
    ['Sector:', stockData.profile?.sector || ''],
    ['Industry:', stockData.profile?.industry || ''],
    [''],
    ['Analysis Date:', new Date().toLocaleDateString()],
    ['Scenario:', scenario.toUpperCase()],
    [''],
    ['CURRENT MARKET DATA'],
    ['Current Price:', stockData.quote.price],
    ['Market Cap (B):', stockData.quote.marketCap / 1e9],
    ['Shares Outstanding (M):', stockData.quote.sharesOutstanding / 1e6],
  ];
  
  const ws1 = XLSX.utils.aoa_to_sheet(companyInfo);
  XLSX.utils.book_append_sheet(wb, ws1, 'Company Info');
  
  // ==================== SHEET 2: ASSUMPTIONS & INPUTS ====================
  const assumptionsData = [
    ['MODEL ASSUMPTIONS (Editable)'],
    [''],
    ['Assumption', 'Value', 'Notes'],
    ['Revenue Growth %', assumptions.revenueGrowth, 'Annual revenue growth rate'],
    ['Net Margin %', assumptions.netMargin, 'Net profit margin'],
    ['P/E Multiple Low', assumptions.peLow, 'Bear case P/E'],
    ['P/E Multiple High', assumptions.peHigh, 'Bull case P/E'],
    [''],
    ['CURRENT FINANCIALS (Latest Year)'],
    ['Metric', 'Value'],
    ['Revenue', stockData.income?.[0]?.revenue || 0],
    ['Net Income', stockData.income?.[0]?.netIncome || 0],
    ['EPS', { 
      f: '=B11/B14',
      v: (stockData.income?.[0]?.netIncome || 0) / (stockData.quote.sharesOutstanding || 1)
    }],
    ['Shares Outstanding', stockData.quote.sharesOutstanding],
  ];
  
  const ws2 = XLSX.utils.aoa_to_sheet(assumptionsData);
  XLSX.utils.book_append_sheet(wb, ws2, 'Assumptions');
  
  // ==================== SHEET 3: 5-YEAR PROJECTIONS WITH FORMULAS ====================
  const projectionsData = [
    ['5-YEAR FINANCIAL PROJECTIONS'],
    [''],
    ['Year', 'Revenue', 'Net Income', 'EPS', 'Price (Low)', 'Price (High)'],
  ];
  
  // Add projection rows with formulas AND calculated values for Numbers compatibility
  const baseRevenue = stockData.income?.[0]?.revenue || 0;
  const growthRate = assumptions.revenueGrowth / 100;
  const netMargin = assumptions.netMargin / 100;
  const shares = stockData.quote.sharesOutstanding;
  const peLow = assumptions.peLow;
  const peHigh = assumptions.peHigh;
  
  for (let i = 0; i < 5; i++) {
    const year = new Date().getFullYear() + i + 1;
    const rowNum = 4 + i; // Starting from row 4
    
    // Calculate actual values
    const revenue = i === 0 ? baseRevenue * (1 + growthRate) : stockProjections[i]?.revenue || 0;
    const netIncome = revenue * netMargin;
    const eps = netIncome / shares;
    const priceLow = eps * peLow;
    const priceHigh = eps * peHigh;
    
    projectionsData.push([
      year,
      { f: i === 0 ? `=Assumptions!B11*(1+Assumptions!B4/100)` : `=B${rowNum}*(1+Assumptions!B4/100)`, v: revenue },
      { f: `=B${rowNum+1}*(Assumptions!B5/100)`, v: netIncome },
      { f: `=C${rowNum+1}/Assumptions!B14`, v: eps },
      { f: `=D${rowNum+1}*Assumptions!B6`, v: priceLow },
      { f: `=D${rowNum+1}*Assumptions!B7`, v: priceHigh },
    ]);
  }
  
  const ws3 = XLSX.utils.aoa_to_sheet(projectionsData);
  XLSX.utils.book_append_sheet(wb, ws3, 'Projections');
  
  // ==================== SHEET 4: VALUATION SUMMARY ====================
  // Calculate metrics if not provided or if they're zero/null
  const income = stockData.income?.[0] || {};
  const balance = stockData.balanceSheet?.[0] || {};
  
  // Check if we actually have balance sheet data
  const hasBalanceSheet = stockData.balanceSheet && 
                         stockData.balanceSheet.length > 0 && 
                         balance.totalStockholdersEquity && 
                         balance.totalStockholdersEquity > 100;
  
  console.log('📊 Balance Sheet Debug:', {
    arrayLength: stockData.balanceSheet?.length || 0,
    hasBalanceData: hasBalanceSheet,
    totalEquity: balance.totalStockholdersEquity,
    totalAssets: balance.totalAssets,
  });
  
  const currentPrice = stockData.quote.price;
  const revenue = income.revenue || 1; // Avoid division by zero
  const netIncome = income.netIncome || 0;
  
  // Try multiple field names for balance sheet items (API inconsistencies)
  const totalAssets = balance.totalAssets || balance.totalAsset || 1;
  const totalEquity = balance.totalStockholdersEquity || balance.totalEquity || balance.shareholdersEquity || 1;
  const totalDebt = balance.totalDebt || balance.shortLongTermDebtTotal || balance.longTermDebt || 0;
  const currentAssets = balance.totalCurrentAssets || balance.currentAssets || 0;
  const currentLiabilities = balance.totalCurrentLiabilities || balance.currentLiabilities || 1;
  const sharesOutstanding = stockData.quote.sharesOutstanding || 1;
  const marketCap = stockData.quote.marketCap || 0;
  
  const eps = netIncome / sharesOutstanding;
  const currentPE = eps !== 0 ? currentPrice / eps : 0;
  const priceToSales = revenue !== 0 && revenue !== 1 ? marketCap / revenue : 0;
  
  // Only calculate balance sheet ratios if we have real data
  const priceToBook = hasBalanceSheet ? marketCap / totalEquity : null;
  const roe = hasBalanceSheet ? (netIncome / totalEquity) * 100 : null;
  const roa = hasBalanceSheet ? (netIncome / totalAssets) * 100 : null;
  const debtToEquity = hasBalanceSheet ? totalDebt / totalEquity : null;
  const currentRatio = hasBalanceSheet ? currentAssets / currentLiabilities : null;
  const netMarginPct = revenue !== 0 && revenue !== 1 ? (netIncome / revenue) * 100 : 0;
  const revenueGrowth = stockData.income?.[1] ? 
    ((income.revenue - stockData.income[1].revenue) / stockData.income[1].revenue) * 100 : 0;
  
  // Get fair value from year 5 projections if enhancedMetrics not available
  let fairValue = enhancedMetrics?.fairValue || 0;
  if (fairValue === 0 && stockProjections && stockProjections.length >= 5) {
    const year5 = stockProjections[4];
    if (year5 && year5.priceLow && year5.priceHigh) {
      fairValue = (year5.priceLow + year5.priceHigh) / 2;
    }
  }
  const upside = fairValue !== 0 ? ((fairValue - currentPrice) / currentPrice) * 100 : 0;
  
  // Format numbers to avoid showing zeros when data is actually missing
  const formatValue = (val, decimals = 2) => {
    if (val === 0 || val === null || val === undefined || !isFinite(val)) return 'N/A';
    return Number(val.toFixed(decimals));
  };
  
  const valuationData = [
    ['VALUATION SUMMARY'],
    [''],
    ['Metric', 'Value'],
    ['Current Price', currentPrice],
    ['Fair Value (5Y Target)', fairValue > 0 ? fairValue : 'N/A'],
    ['Upside %', { 
      f: '=(B5-B4)/B4*100',
      v: formatValue(upside, 2)
    }],
    [''],
    ['RECOMMENDATION', enhancedMetrics?.conclusion || 'N/A'],
    [''],
    ['KEY RATIOS'],
    ['P/E Ratio', formatValue(currentPE, 2)],
    ['Price/Sales', formatValue(priceToSales, 2)],
    ['Price/Book', formatValue(priceToBook, 2)],
    ['ROE %', formatValue(roe, 2)],
    ['ROA %', formatValue(roa, 2)],
    ['Debt/Equity', formatValue(debtToEquity, 2)],
    ['Current Ratio', formatValue(currentRatio, 2)],
    ['Net Margin %', formatValue(netMarginPct, 2)],
    ['Revenue Growth %', formatValue(revenueGrowth, 2)],
    [''],
    ['NOTE:', 'N/A indicates data not available from API'],
  ];
  
  const ws4 = XLSX.utils.aoa_to_sheet(valuationData);
  XLSX.utils.book_append_sheet(wb, ws4, 'Valuation Summary');
  
  // ==================== SHEET 5: DCF ANALYSIS ====================
  const wacc = 10; // Default WACC
  const terminalGrowth = 2.5; // Default terminal growth
  
  const dcfData = [
    ['DISCOUNTED CASH FLOW (DCF) ANALYSIS'],
    [''],
    ['Assumptions', 'Value'],
    ['WACC %', wacc],
    ['Terminal Growth %', terminalGrowth],
    ['Current FCF', stockData.cashFlow?.[0]?.freeCashFlow || 0],
    [''],
    ['Year', 'FCF', 'Discount Factor', 'PV of FCF'],
  ];
  
  // Add 5 years of FCF projections
  // dcfData currently has 8 elements (rows 1-8), so first data row will be row 9
  const currentFCF = stockData.cashFlow?.[0]?.freeCashFlow || 0;
  const fcfGrowth = assumptions.revenueGrowth / 100;
  
  for (let i = 1; i <= 5; i++) {
    const excelRow = 8 + i; // Excel row number: 9, 10, 11, 12, 13
    
    // Calculate actual values
    const fcf = currentFCF * Math.pow(1 + fcfGrowth, i);
    const discountFactor = 1 / Math.pow(1 + wacc/100, i);
    const pvFCF = fcf * discountFactor;
    
    dcfData.push([
      i,
      { f: i === 1 ? `=B6*(1+Assumptions!B4/100)` : `=B${excelRow-1}*(1+Assumptions!B4/100)`, v: fcf },
      { f: `=1/(1+B$4/100)^A${excelRow}`, v: discountFactor },
      { f: `=B${excelRow}*C${excelRow}`, v: pvFCF },
    ]);
  }
  
  // Calculate terminal value and equity value
  const lastFCF = currentFCF * Math.pow(1 + fcfGrowth, 5);
  const terminalValue = lastFCF * (1 + terminalGrowth/100) / (wacc/100 - terminalGrowth/100);
  const pvTerminalValue = terminalValue / Math.pow(1 + wacc/100, 5);
  const sumPVFCF = dcfData.slice(8, 13).reduce((sum, row) => sum + (row[3].v || 0), 0);
  const enterpriseValue = sumPVFCF + pvTerminalValue;
  const equityValue = enterpriseValue; // Assuming zero net debt
  const fairValuePerShare = equityValue / stockData.quote.sharesOutstanding;
  
  // Row 14 is empty, row 15 is Terminal Value, etc.
  dcfData.push(
    [''],  // Row 14
    ['Terminal Value', { f: `=B13*(1+B5/100)/(B$4/100-B5/100)`, v: terminalValue }],  // Row 15
    ['PV of Terminal Value', { f: `=B15*C13`, v: pvTerminalValue }],  // Row 16
    [''],  // Row 17
    ['Enterprise Value', { f: `=SUM(D9:D13)+B16`, v: enterpriseValue }],  // Row 18
    ['Less: Net Debt', 0],  // Row 19
    ['Equity Value', { f: `=B18-B19`, v: equityValue }],  // Row 20
    ['Shares Outstanding', stockData.quote.sharesOutstanding],  // Row 21
    ['Fair Value per Share', { f: `=B20/B21`, v: fairValuePerShare }],  // Row 22
  );
  
  const ws5 = XLSX.utils.aoa_to_sheet(dcfData);
  XLSX.utils.book_append_sheet(wb, ws5, 'DCF Analysis');
  
  // Generate filename and download
  const fileName = `${stockData.quote.symbol}_Analysis_${scenario}_Numbers_${new Date().toISOString().split('T')[0]}.xlsx`;
  XLSX.writeFile(wb, fileName);
};

// Export stock analysis to Excel with PROFESSIONAL FORMATTING (HTML-based)
const exportStockAnalysisToExcelPro = (stockData, stockProjections, assumptions, scenario, enhancedMetrics) => {
  if (!stockData || !stockData.quote) {
    alert('No stock data available to export');
    return;
  }
  
  const companyName = stockData.profile?.companyName || stockData.quote.symbol;
  const ticker = stockData.quote.symbol;
  const currentPrice = stockData.quote.price;
  const marketCap = (stockData.quote.marketCap / 1e9).toFixed(2);
  const shares = (stockData.quote.sharesOutstanding / 1e6).toFixed(0);
  
  // Get financial data
  const income = stockData.income?.[0] || {};
  const balance = stockData.balanceSheet?.[0] || {};
  const revenue = (income.revenue / 1e9).toFixed(2);
  const netIncome = (income.netIncome / 1e9).toFixed(2);
  
  const fairValue = enhancedMetrics?.fairValue || (stockProjections[4] ? ((stockProjections[4].priceLow + stockProjections[4].priceHigh) / 2) : 0);
  const upside = fairValue ? (((fairValue - currentPrice) / currentPrice) * 100).toFixed(2) : 'N/A';
  
  // Create professional HTML with embedded styling
  const html = `
<html>
<head>
<meta charset="UTF-8">
<style>
  body { font-family: Calibri, Arial, sans-serif; }
  table { border-collapse: collapse; width: 100%; }
  .title { font-size: 18pt; font-weight: bold; color: #1f4e78; padding: 10px; background: #dae3f3; text-align: center; }
  .section-header { font-size: 14pt; font-weight: bold; color: white; background: #4472c4; padding: 8px; }
  .sub-header { font-weight: bold; background: #d9e1f2; padding: 6px; }
  .label { font-weight: bold; padding: 6px; background: #f2f2f2; }
  .value { padding: 6px; text-align: right; }
  .highlight { background: #fff2cc; font-weight: bold; }
  .positive { color: #00b050; font-weight: bold; }
  .negative { color: #c00000; font-weight: bold; }
  td, th { border: 1px solid #d0d0d0; }
  .note { font-size: 9pt; font-style: italic; color: #7f7f7f; padding: 4px; }
</style>
</head>
<body>

<!-- COVER PAGE -->
<table>
  <tr><td class="title" colspan="6">INVESTMENT ANALYSIS MODEL</td></tr>
  <tr><td colspan="6" style="padding: 20px; text-align: center;">
    <div style="font-size: 24pt; font-weight: bold; color: #1f4e78;">${companyName}</div>
    <div style="font-size: 14pt; color: #7f7f7f; margin-top: 10px;">${ticker} | ${scenario.toUpperCase()} CASE</div>
    <div style="font-size: 10pt; color: #7f7f7f; margin-top: 20px;">Analysis Date: ${new Date().toLocaleDateString()}</div>
  </td></tr>
</table>

<br><br>

<!-- COMPANY SNAPSHOT -->
<table>
  <tr><td class="section-header" colspan="4">COMPANY SNAPSHOT</td></tr>
  <tr>
    <td class="label">Current Price</td><td class="value">$${currentPrice.toFixed(2)}</td>
    <td class="label">Market Cap</td><td class="value">$${marketCap}B</td>
  </tr>
  <tr>
    <td class="label">Shares Outstanding</td><td class="value">${shares}M</td>
    <td class="label">Sector</td><td class="value">${stockData.profile?.sector || 'N/A'}</td>
  </tr>
  <tr>
    <td class="label">Revenue (TTM)</td><td class="value">$${revenue}B</td>
    <td class="label">Net Income (TTM)</td><td class="value">$${netIncome}B</td>
  </tr>
</table>

<br>

<!-- VALUATION SUMMARY -->
<table>
  <tr><td class="section-header" colspan="4">VALUATION SUMMARY</td></tr>
  <tr>
    <td class="label">Fair Value (5Y Target)</td>
    <td class="value highlight">$${fairValue > 0 ? fairValue.toFixed(2) : 'N/A'}</td>
    <td class="label">Upside / (Downside)</td>
    <td class="value ${upside > 0 ? 'positive' : 'negative'}">${upside}%</td>
  </tr>
  <tr>
    <td class="label">Recommendation</td>
    <td class="value" colspan="3" style="font-weight: bold; font-size: 12pt;">${enhancedMetrics?.conclusion || 'N/A'}</td>
  </tr>
</table>

<br>

<!-- KEY FINANCIAL RATIOS -->
<table>
  <tr><td class="section-header" colspan="4">KEY FINANCIAL RATIOS</td></tr>
  <tr><td class="sub-header" colspan="4">Valuation Metrics</td></tr>
  <tr>
    <td class="label">P/E Ratio</td><td class="value">${enhancedMetrics?.currentPE?.toFixed(2) || 'N/A'}</td>
    <td class="label">Price/Sales</td><td class="value">${enhancedMetrics?.priceToSales?.toFixed(2) || 'N/A'}</td>
  </tr>
  <tr>
    <td class="label">Price/Book</td><td class="value">${enhancedMetrics?.priceToBook?.toFixed(2) || 'N/A'}</td>
    <td class="label">PEG Ratio</td><td class="value">N/A</td>
  </tr>
  <tr><td class="sub-header" colspan="4">Profitability & Efficiency</td></tr>
  <tr>
    <td class="label">Net Margin</td><td class="value">${enhancedMetrics?.netMargin?.toFixed(2) || 'N/A'}%</td>
    <td class="label">ROE</td><td class="value">${enhancedMetrics?.roe?.toFixed(2) || 'N/A'}%</td>
  </tr>
  <tr>
    <td class="label">ROA</td><td class="value">${enhancedMetrics?.roa?.toFixed(2) || 'N/A'}%</td>
    <td class="label">Revenue Growth</td><td class="value">${enhancedMetrics?.revenueGrowth?.toFixed(2) || 'N/A'}%</td>
  </tr>
  <tr><td class="sub-header" colspan="4">Financial Health</td></tr>
  <tr>
    <td class="label">Debt/Equity</td><td class="value">${enhancedMetrics?.debtToEquity?.toFixed(2) || 'N/A'}</td>
    <td class="label">Current Ratio</td><td class="value">${enhancedMetrics?.currentRatio?.toFixed(2) || 'N/A'}</td>
  </tr>
</table>

<br>

<!-- MODEL ASSUMPTIONS -->
<table>
  <tr><td class="section-header" colspan="3">MODEL ASSUMPTIONS (EDITABLE)</td></tr>
  <tr><td class="sub-header">Assumption</td><td class="sub-header">Value</td><td class="sub-header">Notes</td></tr>
  <tr><td class="label">Revenue Growth %</td><td class="value highlight">${assumptions.revenueGrowth}%</td><td class="note">Annual revenue growth rate</td></tr>
  <tr><td class="label">Net Margin %</td><td class="value highlight">${assumptions.netMargin}%</td><td class="note">Net profit margin</td></tr>
  <tr><td class="label">P/E Multiple (Low)</td><td class="value highlight">${assumptions.peLow}x</td><td class="note">Bear case P/E</td></tr>
  <tr><td class="label">P/E Multiple (High)</td><td class="value highlight">${assumptions.peHigh}x</td><td class="note">Bull case P/E</td></tr>
</table>

<br>

<!-- 5-YEAR PROJECTIONS -->
<table>
  <tr><td class="section-header" colspan="6">5-YEAR FINANCIAL PROJECTIONS</td></tr>
  <tr><td class="sub-header">Year</td><td class="sub-header">Revenue ($B)</td><td class="sub-header">Net Income ($B)</td><td class="sub-header">EPS ($)</td><td class="sub-header">Price Low ($)</td><td class="sub-header">Price High ($)</td></tr>
  ${stockProjections.map(proj => `
  <tr>
    <td class="value">${proj.year}</td>
    <td class="value">${((Number(proj.revenue) || 0) / 1e9).toFixed(2)}</td>
    <td class="value">${((Number(proj.netIncome) || 0) / 1e9).toFixed(2)}</td>
    <td class="value">${Number(proj.eps || 0).toFixed(2)}</td>
    <td class="value">${(Number(proj.priceLow) || 0).toFixed(2)}</td>
    <td class="value highlight">${(Number(proj.priceHigh) || 0).toFixed(2)}</td>
  </tr>
  `).join('')}
</table>

<br>

<!-- INVESTMENT HIGHLIGHTS -->
<table>
  <tr><td class="section-header" colspan="2">INVESTMENT HIGHLIGHTS</td></tr>
  <tr><td class="sub-header" style="width: 50%;">Strengths ✓</td><td class="sub-header" style="width: 50%;">Risks ⚠</td></tr>
  <tr>
    <td style="vertical-align: top; padding: 10px;">
      ${enhancedMetrics?.bullishSignals?.map(s => `• ${s}<br>`).join('') || '• Analysis not available'}
    </td>
    <td style="vertical-align: top; padding: 10px;">
      ${enhancedMetrics?.bearishSignals?.map(s => `• ${s}<br>`).join('') || '• Analysis not available'}
    </td>
  </tr>
</table>

<br><br>
<div class="note" style="text-align: center;">
This model is for informational purposes only and should not be considered investment advice.<br>
Generated by Investment Dashboard | ${new Date().toLocaleString()}
</div>

</body>
</html>
`;

  // Create blob and download
  const blob = new Blob([html], { type: 'application/vnd.ms-excel' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${ticker}_Professional_Analysis_${scenario}_${new Date().toISOString().split('T')[0]}.xls`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

// Export stock analysis to Excel with formulas ONLY (Excel/Google Sheets optimized)
const exportStockAnalysisToExcel = async (stockData, stockProjections, assumptions, scenario, enhancedMetrics) => {
  if (!stockData || !stockData.quote) {
    alert('No stock data available to export');
    return;
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Investment Dashboard';
  workbook.created = new Date();
  
  const ticker = stockData.quote.symbol;
  const companyName = stockData.profile?.companyName || ticker;
  
  // Colors
  const colors = {
    headerBg: '1F4E78', headerText: 'FFFFFF', sectionBg: '4472C4',
    subHeaderBg: 'D9E1F2', highlightBg: 'FFF2CC', labelBg: 'F2F2F2',
    positive: '00B050', negative: 'C00000', border: 'D0D0D0',
  };
  
  // Helper function to style header cells
  const styleHeader = (cell, text, bgColor = colors.headerBg) => {
    cell.value = text;
    cell.font = { bold: true, color: { argb: colors.headerText }, size: 12 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = {
      top: { style: 'thin', color: { argb: colors.border } },
      left: { style: 'thin', color: { argb: colors.border } },
      bottom: { style: 'thin', color: { argb: colors.border } },
      right: { style: 'thin', color: { argb: colors.border } }
    };
  };
  
  const styleLabel = (cell) => {
    cell.font = { bold: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.labelBg } };
  };
  
  // ==================== SHEET 1: COMPANY INFO ====================
  const ws1 = workbook.addWorksheet('Company Info', { views: [{ showGridLines: false }] });
  
  ws1.mergeCells('A1:B1');
  styleHeader(ws1.getCell('A1'), 'STOCK ANALYSIS MODEL');
  ws1.getCell('A1').font.size = 18;
  ws1.getRow(1).height = 30;
  
  ws1.getCell('A3').value = 'Company:'; ws1.getCell('B3').value = companyName;
  ws1.getCell('A4').value = 'Ticker:'; ws1.getCell('B4').value = ticker;
  ws1.getCell('A5').value = 'Sector:'; ws1.getCell('B5').value = stockData.profile?.sector || 'N/A';
  ws1.getCell('A6').value = 'Industry:'; ws1.getCell('B6').value = stockData.profile?.industry || 'N/A';
  ws1.getCell('A8').value = 'Analysis Date:'; ws1.getCell('B8').value = new Date().toLocaleDateString();
  ws1.getCell('A9').value = 'Scenario:'; ws1.getCell('B9').value = scenario.toUpperCase();
  
  ws1.getCell('A11').value = 'CURRENT MARKET DATA';
  ws1.getCell('A11').font = { bold: true, size: 12, color: { argb: colors.sectionBg } };
  
  ws1.getCell('A12').value = 'Current Price:'; ws1.getCell('B12').value = stockData.quote.price;
  ws1.getCell('B12').numFmt = '$#,##0.00';
  ws1.getCell('A13').value = 'Market Cap (B):'; ws1.getCell('B13').value = stockData.quote.marketCap / 1e9;
  ws1.getCell('B13').numFmt = '$#,##0.00';
  ws1.getCell('A14').value = 'Shares Outstanding (M):'; ws1.getCell('B14').value = stockData.quote.sharesOutstanding / 1e6;
  ws1.getCell('B14').numFmt = '#,##0.0';
  
  ['A3', 'A4', 'A5', 'A6', 'A8', 'A9', 'A12', 'A13', 'A14'].forEach(addr => styleLabel(ws1.getCell(addr)));
  ws1.getColumn(1).width = 25; ws1.getColumn(2).width = 20;
  
  // ==================== SHEET 2: ASSUMPTIONS ====================
  const ws2 = workbook.addWorksheet('Assumptions', { views: [{ showGridLines: false }] });
  
  ws2.mergeCells('A1:C1');
  styleHeader(ws2.getCell('A1'), 'MODEL ASSUMPTIONS (Editable)', colors.highlightBg);
  ws2.getCell('A1').font.color = { argb: '000000' };
  ws2.getRow(1).height = 25;
  
  styleHeader(ws2.getCell('A3'), 'Assumption');
  styleHeader(ws2.getCell('B3'), 'Value');
  styleHeader(ws2.getCell('C3'), 'Notes');
  
  const assData = [
    ['Revenue Growth %', assumptions.revenueGrowth, 'Annual revenue growth rate'],
    ['Net Margin %', assumptions.netMargin, 'Net profit margin'],
    ['P/E Multiple Low', assumptions.peLow, 'Bear case P/E'],
    ['P/E Multiple High', assumptions.peHigh, 'Bull case P/E'],
  ];
  
  assData.forEach((row, i) => {
    const rowNum = i + 4;
    ws2.getCell(`A${rowNum}`).value = row[0]; styleLabel(ws2.getCell(`A${rowNum}`));
    ws2.getCell(`B${rowNum}`).value = row[1];
    ws2.getCell(`B${rowNum}`).numFmt = '#,##0.0';
    ws2.getCell(`B${rowNum}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.highlightBg } };
    ws2.getCell(`C${rowNum}`).value = row[2];
    ws2.getCell(`C${rowNum}`).font = { italic: true, color: { argb: '666666' } };
  });
  
  ws2.getCell('A9').value = 'CURRENT FINANCIALS';
  ws2.getCell('A9').font = { bold: true, size: 12, color: { argb: colors.sectionBg } };
  
  styleHeader(ws2.getCell('A10'), 'Metric');
  styleHeader(ws2.getCell('B10'), 'Value');
  
  ws2.getCell('A11').value = 'Revenue'; ws2.getCell('B11').value = stockData.income?.[0]?.revenue || 0;
  ws2.getCell('B11').numFmt = '$#,##0';
  ws2.getCell('A12').value = 'Net Income'; ws2.getCell('B12').value = stockData.income?.[0]?.netIncome || 0;
  ws2.getCell('B12').numFmt = '$#,##0';
  ws2.getCell('A13').value = 'EPS'; 
  ws2.getCell('B13').value = { formula: '=B12/B14', result: (stockData.income?.[0]?.netIncome || 0) / (stockData.quote.sharesOutstanding || 1) };
  ws2.getCell('B13').numFmt = '$#,##0.00';
  ws2.getCell('A14').value = 'Shares Outstanding'; ws2.getCell('B14').value = stockData.quote.sharesOutstanding;
  ws2.getCell('B14').numFmt = '#,##0';
  
  ['A11', 'A12', 'A13', 'A14'].forEach(addr => styleLabel(ws2.getCell(addr)));
  ws2.getColumn(1).width = 25; ws2.getColumn(2).width = 15; ws2.getColumn(3).width = 35;
  
  // ==================== SHEET 3: PROJECTIONS ====================
  const ws3 = workbook.addWorksheet('Projections', { views: [{ showGridLines: false }] });
  
  ws3.mergeCells('A1:F1');
  styleHeader(ws3.getCell('A1'), '5-YEAR FINANCIAL PROJECTIONS');
  ws3.getCell('A1').font.size = 14;
  ws3.getRow(1).height = 25;
  
  ['Year', 'Revenue', 'Net Income', 'EPS', 'Price (Low)', 'Price (High)'].forEach((header, i) => {
    styleHeader(ws3.getCell(3, i + 1), header, colors.sectionBg);
  });
  
  for (let i = 0; i < 5; i++) {
    const year = new Date().getFullYear() + i + 1;
    const row = ws3.getRow(i + 4);
    
    row.getCell(1).value = year;
    
    if (i === 0) {
      row.getCell(2).value = { formula: '=Assumptions!B11*(1+Assumptions!B4/100)', result: stockData.income?.[0]?.revenue * (1 + assumptions.revenueGrowth / 100) };
    } else {
      row.getCell(2).value = { formula: `=B${i+3}*(1+Assumptions!B4/100)`, result: 0 };
    }
    row.getCell(2).numFmt = '$#,##0';
    
    row.getCell(3).value = { formula: `=B${i+4}*(Assumptions!B5/100)`, result: 0 };
    row.getCell(3).numFmt = '$#,##0';
    
    row.getCell(4).value = { formula: `=C${i+4}/Assumptions!B14`, result: 0 };
    row.getCell(4).numFmt = '$#,##0.00';
    
    row.getCell(5).value = { formula: `=D${i+4}*Assumptions!B6`, result: 0 };
    row.getCell(5).numFmt = '$#,##0.00';
    
    row.getCell(6).value = { formula: `=D${i+4}*Assumptions!B7`, result: 0 };
    row.getCell(6).numFmt = '$#,##0.00';
    
    // Alternate row colors
    if (i % 2 === 0) {
      for (let col = 1; col <= 6; col++) {
        row.getCell(col).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F9FAFB' } };
      }
    }
  }
  
  ws3.columns.forEach(col => col.width = 15);
  ws3.getColumn(1).width = 10;
  
  // ==================== SHEET 4: VALUATION ====================
  const ws4 = workbook.addWorksheet('Valuation Summary', { views: [{ showGridLines: false }] });
  
  ws4.mergeCells('A1:B1');
  styleHeader(ws4.getCell('A1'), 'VALUATION SUMMARY');
  ws4.getCell('A1').font.size = 14;
  ws4.getRow(1).height = 25;
  
  styleHeader(ws4.getCell('A3'), 'Metric');
  styleHeader(ws4.getCell('B3'), 'Value');
  
  ws4.getCell('A4').value = 'Current Price'; ws4.getCell('B4').value = stockData.quote.price;
  ws4.getCell('B4').numFmt = '$#,##0.00';
  
  ws4.getCell('A5').value = 'Fair Value (5Y Target)';
  ws4.getCell('B5').value = { formula: '=(Projections!E8+Projections!F8)/2', result: 0 };
  ws4.getCell('B5').numFmt = '$#,##0.00';
  ws4.getCell('B5').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.highlightBg } };
  
  ws4.getCell('A6').value = 'Upside %';
  ws4.getCell('B6').value = { formula: '=(B5-B4)/B4*100', result: 0 };
  ws4.getCell('B6').numFmt = '#,##0.0"%"';
  ws4.getCell('B6').font = { bold: true, color: { argb: colors.positive } };
  
  ws4.getCell('A8').value = 'RECOMMENDATION';
  ws4.getCell('A8').font = { bold: true, size: 12 };
  ws4.getCell('B8').value = enhancedMetrics?.conclusion || 'N/A';
  ws4.getCell('B8').font = { bold: true, size: 14 };
  
  ws4.getCell('A10').value = 'KEY RATIOS';
  ws4.getCell('A10').font = { bold: true, size: 12, color: { argb: colors.sectionBg } };
  
  styleHeader(ws4.getCell('A11'), 'Metric');
  styleHeader(ws4.getCell('B11'), 'Value');
  
  const ratios = [
    ['P/E Ratio', enhancedMetrics?.currentPE || 0, '#,##0.0'],
    ['Price/Sales', enhancedMetrics?.priceToSales || 0, '#,##0.00'],
    ['Price/Book', enhancedMetrics?.priceToBook, '#,##0.0'],
    ['ROE %', enhancedMetrics?.roe, '#,##0.0"%"'],
    ['ROA %', enhancedMetrics?.roa, '#,##0.0"%"'],
    ['Debt/Equity', enhancedMetrics?.debtToEquity, '#,##0.00'],
    ['Current Ratio', enhancedMetrics?.currentRatio, '#,##0.00'],
    ['Net Margin %', enhancedMetrics?.netMargin || 0, '#,##0.0"%"'],
    ['Revenue Growth %', enhancedMetrics?.revenueGrowth || 0, '#,##0.0"%"'],
  ];
  
  ratios.forEach((row, i) => {
    const rowNum = i + 12;
    ws4.getCell(`A${rowNum}`).value = row[0];
    styleLabel(ws4.getCell(`A${rowNum}`));
    ws4.getCell(`B${rowNum}`).value = row[1] !== null ? row[1] : 'N/A';
    ws4.getCell(`B${rowNum}`).numFmt = row[2];
  });
  
  ws4.getColumn(1).width = 25; ws4.getColumn(2).width = 20;
  
  // Save file
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const fileName = `${ticker}_Analysis_${scenario}_Excel_${new Date().toISOString().split('T')[0]}.xlsx`;
  saveAs(blob, fileName);
  
  console.log(`✅ Excel file exported: ${fileName}`);
};

// ==================== STOCK ANALYZER TAB ====================
// Calculate enhanced financial metrics
const calculateEnhancedMetrics = (stockData, stockProjections, scenario) => {
  if (!stockData || !stockData.quote || !stockData.income) {
    return null;
  }
  
  const currentPrice = stockData.quote.price;
  const income = stockData.income[0] || {};
  const balance = stockData.balanceSheet?.[0] || {};
  const cashFlow = stockData.cashFlow?.[0] || {};
  
  // Check if we have real balance sheet data
  const hasBalanceSheet = stockData.balanceSheet && 
                         stockData.balanceSheet.length > 0 &&
                         balance.totalStockholdersEquity &&
                         balance.totalStockholdersEquity > 100;
  
  // Current metrics
  const revenue = income.revenue || 0;
  const netIncome = income.netIncome || 0;
  const totalAssets = balance.totalAssets || 1;
  const totalEquity = balance.totalStockholdersEquity || 1;
  const totalDebt = balance.totalDebt || 0;
  const currentAssets = balance.totalCurrentAssets || 0;
  const currentLiabilities = balance.totalCurrentLiabilities || 1;
  const freeCashFlow = cashFlow.freeCashFlow || 0;
  const sharesOutstanding = stockData.quote.sharesOutstanding || 1;
  const marketCap = stockData.quote.marketCap || 0;
  
  // Calculate ratios (only balance sheet ones if data available)
  const eps = netIncome / sharesOutstanding;
  const currentPE = eps !== 0 ? currentPrice / eps : 0;
  const priceToSales = revenue !== 0 ? marketCap / revenue : 0;
  const priceToBook = hasBalanceSheet ? marketCap / totalEquity : null;
  const debtToEquity = hasBalanceSheet ? totalDebt / totalEquity : null;
  const currentRatio = hasBalanceSheet ? currentAssets / currentLiabilities : null;
  const roe = hasBalanceSheet ? (netIncome / totalEquity) * 100 : null;
  const roa = hasBalanceSheet ? (netIncome / totalAssets) * 100 : null;
  const netMargin = revenue !== 0 ? (netIncome / revenue) * 100 : 0;
  const grossMargin = revenue !== 0 ? ((income.grossProfit || 0) / revenue) * 100 : 0;
  
  // Growth calculations
  const revenueGrowth = stockData.income[1] ? 
    ((income.revenue - stockData.income[1].revenue) / stockData.income[1].revenue) * 100 : 0;
  const earningsGrowth = stockData.income[1] ? 
    ((income.netIncome - stockData.income[1].netIncome) / stockData.income[1].netIncome) * 100 : 0;
  
  // Fair value from projections (year 5 average)
  const year5Proj = stockProjections[4] || {};
  const fairValue = (year5Proj.priceLow && year5Proj.priceHigh) 
    ? (year5Proj.priceLow + year5Proj.priceHigh) / 2 
    : currentPrice;
  const upside = ((fairValue - currentPrice) / currentPrice) * 100;
  
  // Conclusion logic
  let conclusion = 'HOLD';
  let conclusionColor = '#f59e0b';
  let conclusionEmoji = '🟡';
  
  const bullishSignals = [];
  const bearishSignals = [];
  
  // Analyze signals
  if (upside > 20) bullishSignals.push('Significant upside potential');
  else if (upside < -10) bearishSignals.push('Limited upside or overvalued');
  
  if (revenueGrowth > 15) bullishSignals.push('Strong revenue growth');
  else if (revenueGrowth < 5) bearishSignals.push('Slowing revenue growth');
  
  if (netMargin > 20) bullishSignals.push('Excellent profit margins');
  else if (netMargin < 10) bearishSignals.push('Thin profit margins');
  
  if (roe > 15) bullishSignals.push('High return on equity');
  else if (roe < 10) bearishSignals.push('Low return on equity');
  
  if (debtToEquity < 0.5) bullishSignals.push('Conservative debt levels');
  else if (debtToEquity > 2.0) bearishSignals.push('High debt burden');
  
  if (currentRatio > 1.5) bullishSignals.push('Strong liquidity');
  else if (currentRatio < 1.0) bearishSignals.push('Liquidity concerns');
  
  if (currentPE < 20 && currentPE > 0) bullishSignals.push('Reasonable valuation');
  else if (currentPE > 40) bearishSignals.push('High valuation multiple');
  
  // Determine conclusion
  if (bullishSignals.length >= bearishSignals.length + 2) {
    conclusion = 'BUY';
    conclusionColor = '#10b981';
    conclusionEmoji = '🟢';
  } else if (bearishSignals.length >= bullishSignals.length + 2) {
    conclusion = 'SELL';
    conclusionColor = '#ef4444';
    conclusionEmoji = '🔴';
  }
  
  return {
    // Current metrics
    currentPrice,
    eps,
    currentPE,
    priceToSales,
    priceToBook,
    debtToEquity,
    currentRatio,
    roe,
    roa,
    netMargin,
    grossMargin,
    
    // Growth
    revenueGrowth,
    earningsGrowth,
    
    // Valuation
    fairValue,
    upside,
    
    // Conclusion
    conclusion,
    conclusionColor,
    conclusionEmoji,
    bullishSignals,
    bearishSignals,
  };
};

// ==================== FINANCIAL STATEMENT TABLES COMPONENT ====================
function FinancialStatementTables({ data, stockData, qualityScores, onDataUpdate }) {
  const [editingCell, setEditingCell] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [localData, setLocalData] = useState(data);

  // Update local data when props change
  useEffect(() => {
    console.log('=== FINANCIAL TABLES DEBUG ===');
    console.log('📊 Data prop received:', data);
    console.log('📊 Data type:', typeof data);
    console.log('📊 Has income?', !!data?.income);
    console.log('📊 Has balance?', !!data?.balance);
    console.log('📊 Has cashFlow?', !!data?.cashFlow);
    
    if (data?.income && data.income[0]) {
      console.log('📊 Income array length:', data.income.length);
      console.log('📊 First income entry:', data.income[0]);
      console.log('📊 Income fields:', Object.keys(data.income[0]));
    } else {
      console.log('❌ No income data!');
    }
    
    if (data?.balance && data.balance[0]) {
      console.log('📊 Balance array length:', data.balance.length);
      console.log('📊 Balance years:');
      data.balance.forEach((year, idx) => {
        console.log(`   [${idx}] ${year.date} - Assets: ${year.totalAssets}, Liabilities: ${year.totalLiabilities}, Equity: ${year.totalStockholdersEquity}`);
      });
      console.log('📊 First balance entry FULL:', data.balance[0]);
      console.log('📊 Balance fields:', Object.keys(data.balance[0]));
    } else {
      console.log('❌ No balance data!');
    }
    
    if (data?.cashFlow && data.cashFlow[0]) {
      console.log('📊 CashFlow array length:', data.cashFlow.length);
      console.log('📊 First cashFlow entry:', data.cashFlow[0]);
      console.log('📊 CashFlow fields:', Object.keys(data.cashFlow[0]));
    } else {
      console.log('❌ No cashFlow data!');
    }
    
    console.log('=== END DEBUG ===');
    setLocalData(data);
  }, [data]);

  const startEdit = (statement, yearIndex, field, currentValue) => {
    setEditingCell({ statement, yearIndex, field });
    setEditValue(currentValue?.toString() || '');
  };

  const saveEdit = () => {
    if (!editingCell) return;

    const { statement, yearIndex, field } = editingCell;
    const newValue = parseFloat(editValue.replace(/,/g, ''));

    if (isNaN(newValue)) {
      alert('Please enter a valid number');
      return;
    }

    // Update local data
    const updated = { ...localData };
    updated[statement][yearIndex][field] = newValue;
    setLocalData(updated);

    // Notify parent
    if (onDataUpdate) {
      onDataUpdate(updated);
    }

    setEditingCell(null);
  };

  const cancelEdit = () => {
    setEditingCell(null);
  };

  const formatNumber = (num, decimals = 0) => {
    if (num === null || num === undefined) return 'N/A';
    return Number(num).toLocaleString(undefined, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  };

  const formatCurrency = (num, inMillions = true) => {
    if (num === null || num === undefined) {
      return 'N/A';
    }
    try {
      const value = inMillions ? num / 1000000 : num;
      return formatNumber(value, 0);
    } catch (e) {
      console.error('Error formatting currency:', num, e);
      return 'N/A';
    }
  };

  const exportToExcel = async () => {
    try {
      const ExcelJS = (await import('exceljs')).default;
      const workbook = new ExcelJS.Workbook();
      
      // ============ SHEET 1: INCOME STATEMENT ============
      const incomeSheet = workbook.addWorksheet('Income Statement');
      const incomeYears = localData.income.map(y => new Date(y.date).getFullYear());
      
      incomeSheet.columns = [
        { header: 'Income Statement (in millions)', key: 'item', width: 35 },
        ...incomeYears.map((year, idx) => ({ header: year.toString(), key: `y${idx}`, width: 15 }))
      ];
      
      const incomeData = [
        ['Revenue', ...localData.income.map(y => y.revenue / 1000000)],
        ['Cost of Revenue', ...localData.income.map(y => y.costOfRevenue / 1000000)],
        ['Gross Profit', ...localData.income.map(y => y.grossProfit / 1000000)],
        ['Operating Expenses', ...localData.income.map(y => y.operatingExpenses / 1000000)],
        ['Operating Income', ...localData.income.map(y => y.operatingIncome / 1000000)],
        ['Net Income', ...localData.income.map(y => y.netIncome / 1000000)],
        ['EPS (Diluted)', ...localData.income.map(y => y.epsdiluted)]
      ];
      
      incomeData.forEach(row => {
        const rowData = { item: row[0] };
        row.slice(1).forEach((val, idx) => { rowData[`y${idx}`] = val; });
        incomeSheet.addRow(rowData);
      });
      
      incomeSheet.getRow(1).font = { bold: true, size: 12 };
      incomeSheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
      incomeSheet.getRow(1).font.color = { argb: 'FFFFFFFF' };
      
      // ============ SHEET 2: BALANCE SHEET ============
      const balanceSheet = workbook.addWorksheet('Balance Sheet');
      const balanceYears = localData.balance.map(y => new Date(y.date).getFullYear());
      
      balanceSheet.columns = [
        { header: 'Balance Sheet (in millions)', key: 'item', width: 35 },
        ...balanceYears.map((year, idx) => ({ header: year.toString(), key: `y${idx}`, width: 15 }))
      ];
      
      const balanceData = [
        ['ASSETS', ...Array(balanceYears.length).fill('')],
        ['Cash & Equivalents', ...localData.balance.map(y => y.cashAndCashEquivalents / 1000000)],
        ['Accounts Receivable', ...localData.balance.map(y => y.accountsReceivable / 1000000)],
        ['Inventory', ...localData.balance.map(y => y.inventory / 1000000)],
        ['Total Current Assets', ...localData.balance.map(y => y.totalCurrentAssets / 1000000)],
        ['Property, Plant & Equipment', ...localData.balance.map(y => y.propertyPlantEquipment / 1000000)],
        ['Total Assets', ...localData.balance.map(y => y.totalAssets / 1000000)],
        ['', ...Array(balanceYears.length).fill('')],
        ['LIABILITIES', ...Array(balanceYears.length).fill('')],
        ['Accounts Payable', ...localData.balance.map(y => y.accountsPayable / 1000000)],
        ['Short-term Debt', ...localData.balance.map(y => y.shortTermDebt / 1000000)],
        ['Long-term Debt', ...localData.balance.map(y => y.longTermDebt / 1000000)],
        ['Total Liabilities', ...localData.balance.map(y => y.totalLiabilities / 1000000)],
        ['', ...Array(balanceYears.length).fill('')],
        ['Total Equity', ...localData.balance.map(y => y.totalStockholdersEquity / 1000000)]
      ];
      
      balanceData.forEach(row => {
        const rowData = { item: row[0] };
        row.slice(1).forEach((val, idx) => { rowData[`y${idx}`] = val; });
        balanceSheet.addRow(rowData);
      });
      
      balanceSheet.getRow(1).font = { bold: true, size: 12 };
      balanceSheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF70AD47' } };
      balanceSheet.getRow(1).font.color = { argb: 'FFFFFFFF' };
      
      // ============ SHEET 3: CASH FLOW ============
      const cashFlowSheet = workbook.addWorksheet('Cash Flow');
      const cfYears = localData.cashFlow.map(y => new Date(y.date).getFullYear());
      
      cashFlowSheet.columns = [
        { header: 'Cash Flow Statement (in millions)', key: 'item', width: 35 },
        ...cfYears.map((year, idx) => ({ header: year.toString(), key: `y${idx}`, width: 15 }))
      ];
      
      const cfData = [
        ['Net Income', ...localData.cashFlow.map(y => y.netIncome / 1000000)],
        ['Depreciation & Amortization', ...localData.cashFlow.map(y => y.depreciationAmortization / 1000000)],
        ['Change in Working Capital', ...localData.cashFlow.map(y => y.changeInWorkingCapital / 1000000)],
        ['Operating Cash Flow', ...localData.cashFlow.map(y => y.operatingCashFlow / 1000000)],
        ['Capital Expenditure', ...localData.cashFlow.map(y => y.capitalExpenditure / 1000000)],
        ['Free Cash Flow', ...localData.cashFlow.map(y => y.freeCashFlow / 1000000)],
        ['Dividends Paid', ...localData.cashFlow.map(y => y.dividendsPaid / 1000000)]
      ];
      
      cfData.forEach(row => {
        const rowData = { item: row[0] };
        row.slice(1).forEach((val, idx) => { rowData[`y${idx}`] = val; });
        cashFlowSheet.addRow(rowData);
      });
      
      cashFlowSheet.getRow(1).font = { bold: true, size: 12 };
      cashFlowSheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC000' } };
      cashFlowSheet.getRow(1).font.color = { argb: 'FFFFFFFF' };
      
      // ============ SHEET 4: QUALITY SCORES & METRICS ============
      if (qualityScores && stockData) {
        const qualitySheet = workbook.addWorksheet('Quality Scores');
        
        qualitySheet.columns = [
          { header: 'Metric', key: 'metric', width: 40 },
          { header: 'Value', key: 'value', width: 15 },
          { header: 'Score', key: 'score', width: 15 }
        ];
        
        // Header
        qualitySheet.getRow(1).font = { bold: true, size: 12 };
        qualitySheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF9370DB' } };
        qualitySheet.getRow(1).font.color = { argb: 'FFFFFFFF' };
        
        // Company name
        qualitySheet.addRow({ metric: stockData.profile?.companyName || 'Company', value: '', score: '' });
        qualitySheet.addRow({ metric: '', value: '', score: '' });
        
        // Quality Scores
        qualitySheet.addRow({ metric: 'COMPOSITE SCORES', value: '', score: '' });
        qualitySheet.getRow(4).font = { bold: true };
        qualitySheet.addRow({ metric: 'CQVS - Overall Quality', value: qualityScores.cqvs || 0, score: qualityScores.cqvsLabel || 'N/A' });
        qualitySheet.addRow({ metric: 'Piotroski F-Score', value: qualityScores.piotroskiF || 0, score: '' });
        qualitySheet.addRow({ metric: 'Altman Z-Score', value: qualityScores.altmanZ || 0, score: '' });
        qualitySheet.addRow({ metric: 'Beneish M-Score', value: qualityScores.beneishM || 0, score: '' });
        qualitySheet.addRow({ metric: '', value: '', score: '' });
        
        // Calculate actual financial metrics
        const latest = localData.income[0];
        const latestBalance = localData.balance[0];
        const latestCF = localData.cashFlow[0];
        const prior = localData.income[1];
        
        if (latest && latestBalance) {
          qualitySheet.addRow({ metric: 'PROFITABILITY METRICS', value: '', score: '' });
          qualitySheet.getRow(10).font = { bold: true };
          
          const roe = latestBalance.totalStockholdersEquity ? (latest.netIncome / latestBalance.totalStockholdersEquity) * 100 : 0;
          const roa = latestBalance.totalAssets ? (latest.netIncome / latestBalance.totalAssets) * 100 : 0;
          const netMargin = latest.revenue ? (latest.netIncome / latest.revenue) * 100 : 0;
          const operatingMargin = latest.revenue ? (latest.operatingIncome / latest.revenue) * 100 : 0;
          const grossMargin = latest.revenue ? (latest.grossProfit / latest.revenue) * 100 : 0;
          
          qualitySheet.addRow({ metric: '  Return on Equity (ROE)', value: roe, score: '' });
          qualitySheet.addRow({ metric: '  Return on Assets (ROA)', value: roa, score: '' });
          qualitySheet.addRow({ metric: '  Net Profit Margin', value: netMargin, score: '' });
          qualitySheet.addRow({ metric: '  Operating Margin', value: operatingMargin, score: '' });
          qualitySheet.addRow({ metric: '  Gross Margin', value: grossMargin, score: '' });
          qualitySheet.addRow({ metric: '', value: '', score: '' });
          
          // Format as percentages
          [11, 12, 13, 14, 15].forEach(row => {
            qualitySheet.getCell(`B${row}`).numFmt = '0.00"%"';
          });
        }
        
        if (latest && prior) {
          qualitySheet.addRow({ metric: 'GROWTH METRICS', value: '', score: '' });
          qualitySheet.getRow(17).font = { bold: true };
          
          const revenueGrowth = prior.revenue ? ((latest.revenue - prior.revenue) / prior.revenue) * 100 : 0;
          const earningsGrowth = prior.netIncome ? ((latest.netIncome - prior.netIncome) / prior.netIncome) * 100 : 0;
          const epsGrowth = prior.epsdiluted ? ((latest.epsdiluted - prior.epsdiluted) / prior.epsdiluted) * 100 : 0;
          
          qualitySheet.addRow({ metric: '  Revenue Growth (YoY)', value: revenueGrowth, score: '' });
          qualitySheet.addRow({ metric: '  Earnings Growth (YoY)', value: earningsGrowth, score: '' });
          qualitySheet.addRow({ metric: '  EPS Growth (YoY)', value: epsGrowth, score: '' });
          qualitySheet.addRow({ metric: '', value: '', score: '' });
          
          // Format as percentages
          [18, 19, 20].forEach(row => {
            qualitySheet.getCell(`B${row}`).numFmt = '0.00"%"';
          });
        }
        
        if (latestBalance) {
          qualitySheet.addRow({ metric: 'FINANCIAL HEALTH METRICS', value: '', score: '' });
          qualitySheet.getRow(22).font = { bold: true };
          
          const currentRatio = latestBalance.totalCurrentLiabilities ? 
            latestBalance.totalCurrentAssets / latestBalance.totalCurrentLiabilities : 0;
          const debtToEquity = latestBalance.totalStockholdersEquity ? 
            latestBalance.totalDebt / latestBalance.totalStockholdersEquity : 0;
          const debtToAssets = latestBalance.totalAssets ? 
            latestBalance.totalDebt / latestBalance.totalAssets : 0;
          
          qualitySheet.addRow({ metric: '  Current Ratio', value: currentRatio, score: '' });
          qualitySheet.addRow({ metric: '  Debt-to-Equity Ratio', value: debtToEquity, score: '' });
          qualitySheet.addRow({ metric: '  Debt-to-Assets Ratio', value: debtToAssets, score: '' });
          qualitySheet.addRow({ metric: '', value: '', score: '' });
          
          // Format as numbers
          [23, 24, 25].forEach(row => {
            qualitySheet.getCell(`B${row}`).numFmt = '0.00';
          });
        }
        
        if (latest && latestBalance) {
          qualitySheet.addRow({ metric: 'EFFICIENCY METRICS', value: '', score: '' });
          qualitySheet.getRow(27).font = { bold: true };
          
          const assetTurnover = latestBalance.totalAssets ? latest.revenue / latestBalance.totalAssets : 0;
          const inventoryTurnover = latestBalance.inventory && latestBalance.inventory > 0 ? 
            latest.costOfRevenue / latestBalance.inventory : 0;
          const receivablesTurnover = latestBalance.accountsReceivable ? 
            latest.revenue / latestBalance.accountsReceivable : 0;
          
          qualitySheet.addRow({ metric: '  Asset Turnover', value: assetTurnover, score: '' });
          qualitySheet.addRow({ metric: '  Inventory Turnover', value: inventoryTurnover, score: '' });
          qualitySheet.addRow({ metric: '  Receivables Turnover', value: receivablesTurnover, score: '' });
          
          // Format as numbers
          [28, 29, 30].forEach(row => {
            qualitySheet.getCell(`B${row}`).numFmt = '0.00';
          });
        }
      }
      
      // ============ SHEET 5: VALUATION MODEL ============
      if (stockData && stockData.quote) {
        const valuationSheet = workbook.addWorksheet('Valuation Model');
        
        valuationSheet.columns = [
          { header: 'Valuation Assumptions', key: 'item', width: 40 },
          { header: 'Value', key: 'value', width: 20 }
        ];
        
        valuationSheet.getRow(1).font = { bold: true, size: 12 };
        valuationSheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF00B050' } };
        valuationSheet.getRow(1).font.color = { argb: 'FFFFFFFF' };
        
        // Current data
        const currentPrice = stockData.quote.price || 0;
        const sharesOutstanding = stockData.quote.sharesOutstanding || 0;
        const marketCap = stockData.quote.marketCap || 0;
        const latestIncome = localData.income[0];
        const latestEPS = latestIncome?.epsdiluted || 0;
        const latestRevenue = latestIncome?.revenue || 0;
        const latestNetIncome = latestIncome?.netIncome || 0;
        
        valuationSheet.addRow({ item: 'Company', value: stockData.profile?.companyName || 'N/A' });
        valuationSheet.addRow({ item: '', value: '' });
        valuationSheet.addRow({ item: 'CURRENT MARKET DATA', value: '' });
        valuationSheet.getRow(3).font = { bold: true };
        valuationSheet.addRow({ item: 'Current Stock Price', value: currentPrice });
        valuationSheet.addRow({ item: 'Shares Outstanding', value: sharesOutstanding });
        valuationSheet.addRow({ item: 'Market Cap', value: marketCap });
        valuationSheet.addRow({ item: 'Latest EPS', value: latestEPS });
        valuationSheet.addRow({ item: '', value: '' });
        
        // Valuation inputs (editable)
        valuationSheet.addRow({ item: 'VALUATION INPUTS (Edit These)', value: '' });
        valuationSheet.getRow(9).font = { bold: true };
        valuationSheet.getRow(9).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
        
        valuationSheet.addRow({ item: 'Target P/E Ratio', value: 25 });
        valuationSheet.addRow({ item: 'Expected EPS Growth (%)', value: 10 });
        valuationSheet.addRow({ item: 'Years Forward', value: 1 });
        valuationSheet.addRow({ item: '', value: '' });
        
        // Calculations with formulas
        valuationSheet.addRow({ item: 'CALCULATED VALUATION', value: '' });
        valuationSheet.getRow(15).font = { bold: true };
        valuationSheet.getRow(15).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF00B0F0' } };
        
        // Forward EPS = Current EPS * (1 + Growth)^Years
        // B8 = Latest EPS, B12 = Growth %, B13 = Years
        valuationSheet.addRow({ item: 'Forward EPS', value: { formula: 'B8*(1+B12/100)^B13' } });
        
        // Target Price = Forward EPS * Target P/E
        // B16 = Forward EPS, B11 = Target P/E
        valuationSheet.addRow({ item: 'Target Stock Price', value: { formula: 'B16*B11' } });
        
        // Upside = (Target - Current) / Current
        // B17 = Target Price, B5 = Current Price
        valuationSheet.addRow({ item: 'Upside/Downside (%)', value: { formula: '(B17-B5)/B5*100' } });
        
        // Format as percentages and currency
        valuationSheet.getCell('B12').numFmt = '0.00"%"';  // Expected EPS Growth (row 12)
        valuationSheet.getCell('B18').numFmt = '0.00"%"';  // Upside/Downside (row 18)
        valuationSheet.getCell('B5').numFmt = '$#,##0.00';  // Current Price (row 5)
        valuationSheet.getCell('B16').numFmt = '$#,##0.00'; // Forward EPS (row 16)
        valuationSheet.getCell('B17').numFmt = '$#,##0.00'; // Target Price (row 17)
        valuationSheet.getCell('B8').numFmt = '$#,##0.00';  // Latest EPS (row 8)
        valuationSheet.getCell('B11').numFmt = '0.00';      // Target P/E (row 11)
        valuationSheet.getCell('B13').numFmt = '0';         // Years Forward (row 13)
        
        // Add highlighting
        valuationSheet.getRow(17).font = { bold: true, size: 14, color: { argb: 'FF00B050' } }; // Target Price
        valuationSheet.getRow(18).font = { bold: true, size: 12 }; // Upside
      }
      
      // Generate file
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const companyName = stockData?.profile?.companyName?.replace(/[^a-z0-9]/gi, '_') || 'company';
      link.download = `${companyName}_financial_model_${new Date().toISOString().split('T')[0]}.xlsx`;
      link.click();
      window.URL.revokeObjectURL(url);
      
      console.log('✅ Financial model exported successfully');
    } catch (error) {
      console.error('Error exporting to Excel:', error);
      alert('Failed to export to Excel. Please try again.');
    }
  };

  const renderEditableCell = (statement, yearIndex, field, value, inMillions = true) => {
    const isEditing = editingCell?.statement === statement && 
                      editingCell?.yearIndex === yearIndex && 
                      editingCell?.field === field;

    const displayValue = inMillions ? formatCurrency(value, true) : formatNumber(value, 2);

    if (isEditing) {
      return (
        <input
          type="text"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={saveEdit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') saveEdit();
            if (e.key === 'Escape') cancelEdit();
          }}
          autoFocus
          style={{
            width: '100%',
            padding: '4px',
            border: '2px solid #3b82f6',
            borderRadius: '4px',
            textAlign: 'right',
            fontSize: '0.85rem'
          }}
        />
      );
    }

    return (
      <div
        onClick={() => startEdit(statement, yearIndex, field, value)}
        style={{
          cursor: 'pointer',
          padding: '6px 8px',
          borderRadius: '4px',
          transition: 'background 0.2s'
        }}
        onMouseEnter={(e) => e.currentTarget.style.background = '#f1f5f9'}
        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
      >
        {displayValue}
      </div>
    );
  };

  const tableStyle = {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '0.85rem',
    marginTop: '1rem'
  };

  const thStyle = {
    padding: '12px 8px',
    textAlign: 'left',
    borderBottom: '2px solid #e2e8f0',
    fontWeight: '600',
    color: '#0f172a',
    background: '#f8fafc'
  };

  const tdStyle = {
    padding: '10px 8px',
    textAlign: 'right',
    borderBottom: '1px solid #e2e8f0'
  };

  const labelStyle = {
    ...tdStyle,
    textAlign: 'left',
    fontWeight: '500',
    color: '#475569'
  };

  return (
    <div style={{ marginBottom: '2rem' }}>
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        marginBottom: '1rem'
      }}>
        <h3 style={{ fontSize: '1.3rem', fontWeight: '700', color: '#0f172a', margin: 0 }}>
          📊 Extracted Financial Statements
        </h3>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <button
            onClick={exportToExcel}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.5rem 1rem',
              background: '#10b981',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              fontSize: '0.875rem',
              fontWeight: '600',
              cursor: 'pointer',
              transition: 'background 0.2s'
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = '#059669'}
            onMouseLeave={(e) => e.currentTarget.style.background = '#10b981'}
          >
            📊 Export Financial Model
          </button>
          <div style={{ fontSize: '0.85rem', color: '#64748b' }}>
            💡 Click any number to edit
          </div>
        </div>
      </div>

      {/* Income Statement */}
      <details open style={{ marginBottom: '1.5rem' }}>
        <summary style={{ 
          cursor: 'pointer', 
          fontSize: '1.1rem', 
          fontWeight: '600', 
          padding: '0.75rem',
          background: '#f8fafc',
          borderRadius: '8px',
          marginBottom: '0.5rem'
        }}>
          💰 Income Statement (in millions)
        </summary>
        
        <div style={{ overflowX: 'auto' }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={{...thStyle, textAlign: 'left'}}>Item</th>
                {localData.income?.map((year, idx) => (
                  <th key={idx} style={{...thStyle, textAlign: 'right'}}>
                    {new Date(year.date).getFullYear()}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={labelStyle}>Revenue</td>
                {localData.income?.map((year, idx) => (
                  <td key={idx} style={tdStyle}>
                    {renderEditableCell('income', idx, 'revenue', year.revenue)}
                  </td>
                ))}
              </tr>
              <tr>
                <td style={labelStyle}>Cost of Revenue</td>
                {localData.income?.map((year, idx) => (
                  <td key={idx} style={tdStyle}>
                    {renderEditableCell('income', idx, 'costOfRevenue', year.costOfRevenue)}
                  </td>
                ))}
              </tr>
              <tr style={{ background: '#f8fafc' }}>
                <td style={{...labelStyle, fontWeight: '700'}}>Gross Profit</td>
                {localData.income?.map((year, idx) => (
                  <td key={idx} style={{...tdStyle, fontWeight: '700'}}>
                    {renderEditableCell('income', idx, 'grossProfit', year.grossProfit)}
                  </td>
                ))}
              </tr>
              <tr>
                <td style={labelStyle}>Operating Expenses</td>
                {localData.income?.map((year, idx) => (
                  <td key={idx} style={tdStyle}>
                    {renderEditableCell('income', idx, 'operatingExpenses', year.operatingExpenses)}
                  </td>
                ))}
              </tr>
              <tr style={{ background: '#f8fafc' }}>
                <td style={{...labelStyle, fontWeight: '700'}}>Operating Income</td>
                {localData.income?.map((year, idx) => (
                  <td key={idx} style={{...tdStyle, fontWeight: '700'}}>
                    {renderEditableCell('income', idx, 'operatingIncome', year.operatingIncome)}
                  </td>
                ))}
              </tr>
              <tr style={{ background: '#dbeafe' }}>
                <td style={{...labelStyle, fontWeight: '700', color: '#1e40af'}}>Net Income</td>
                {localData.income?.map((year, idx) => (
                  <td key={idx} style={{...tdStyle, fontWeight: '700', color: '#1e40af'}}>
                    {renderEditableCell('income', idx, 'netIncome', year.netIncome)}
                  </td>
                ))}
              </tr>
              <tr>
                <td style={labelStyle}>EPS (Diluted)</td>
                {localData.income?.map((year, idx) => (
                  <td key={idx} style={tdStyle}>
                    {renderEditableCell('income', idx, 'epsdiluted', year.epsdiluted, false)}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </details>

      {/* Balance Sheet */}
      <details open style={{ marginBottom: '1.5rem' }}>
        <summary style={{ 
          cursor: 'pointer', 
          fontSize: '1.1rem', 
          fontWeight: '600', 
          padding: '0.75rem',
          background: '#f8fafc',
          borderRadius: '8px',
          marginBottom: '0.5rem'
        }}>
          🏦 Balance Sheet (in millions)
        </summary>
        
        <div style={{ overflowX: 'auto' }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={{...thStyle, textAlign: 'left'}}>Item</th>
                {localData.balance?.map((year, idx) => (
                  <th key={idx} style={{...thStyle, textAlign: 'right'}}>
                    {new Date(year.date).getFullYear()}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr style={{ background: '#f8fafc', fontWeight: '700' }}>
                <td style={labelStyle}>ASSETS</td>
                {localData.balance?.map((year, idx) => (
                  <td key={idx} style={tdStyle}></td>
                ))}
              </tr>
              <tr>
                <td style={{...labelStyle, paddingLeft: '1.5rem'}}>Cash & Equivalents</td>
                {localData.balance?.map((year, idx) => (
                  <td key={idx} style={tdStyle}>
                    {renderEditableCell('balance', idx, 'cashAndCashEquivalents', year.cashAndCashEquivalents)}
                  </td>
                ))}
              </tr>
              <tr>
                <td style={{...labelStyle, paddingLeft: '1.5rem'}}>Accounts Receivable</td>
                {localData.balance?.map((year, idx) => (
                  <td key={idx} style={tdStyle}>
                    {renderEditableCell('balance', idx, 'accountsReceivable', year.accountsReceivable)}
                  </td>
                ))}
              </tr>
              <tr>
                <td style={{...labelStyle, paddingLeft: '1.5rem'}}>Inventory</td>
                {localData.balance?.map((year, idx) => (
                  <td key={idx} style={tdStyle}>
                    {renderEditableCell('balance', idx, 'inventory', year.inventory)}
                  </td>
                ))}
              </tr>
              <tr style={{ background: '#f8fafc' }}>
                <td style={{...labelStyle, fontWeight: '600'}}>Total Current Assets</td>
                {localData.balance?.map((year, idx) => (
                  <td key={idx} style={{...tdStyle, fontWeight: '600'}}>
                    {renderEditableCell('balance', idx, 'totalCurrentAssets', year.totalCurrentAssets)}
                  </td>
                ))}
              </tr>
              <tr>
                <td style={{...labelStyle, paddingLeft: '1.5rem'}}>Property, Plant & Equipment</td>
                {localData.balance?.map((year, idx) => (
                  <td key={idx} style={tdStyle}>
                    {renderEditableCell('balance', idx, 'propertyPlantEquipment', year.propertyPlantEquipment)}
                  </td>
                ))}
              </tr>
              <tr style={{ background: '#dbeafe' }}>
                <td style={{...labelStyle, fontWeight: '700', color: '#1e40af'}}>Total Assets</td>
                {localData.balance?.map((year, idx) => (
                  <td key={idx} style={{...tdStyle, fontWeight: '700', color: '#1e40af'}}>
                    {renderEditableCell('balance', idx, 'totalAssets', year.totalAssets)}
                  </td>
                ))}
              </tr>
              <tr style={{ background: '#f8fafc', fontWeight: '700' }}>
                <td style={labelStyle}>LIABILITIES</td>
                {localData.balance?.map((year, idx) => (
                  <td key={idx} style={tdStyle}></td>
                ))}
              </tr>
              <tr>
                <td style={{...labelStyle, paddingLeft: '1.5rem'}}>Accounts Payable</td>
                {localData.balance?.map((year, idx) => (
                  <td key={idx} style={tdStyle}>
                    {renderEditableCell('balance', idx, 'accountsPayable', year.accountsPayable)}
                  </td>
                ))}
              </tr>
              <tr>
                <td style={{...labelStyle, paddingLeft: '1.5rem'}}>Short-term Debt</td>
                {localData.balance?.map((year, idx) => (
                  <td key={idx} style={tdStyle}>
                    {renderEditableCell('balance', idx, 'shortTermDebt', year.shortTermDebt)}
                  </td>
                ))}
              </tr>
              <tr>
                <td style={{...labelStyle, paddingLeft: '1.5rem'}}>Long-term Debt</td>
                {localData.balance?.map((year, idx) => (
                  <td key={idx} style={tdStyle}>
                    {renderEditableCell('balance', idx, 'longTermDebt', year.longTermDebt)}
                  </td>
                ))}
              </tr>
              <tr style={{ background: '#f8fafc' }}>
                <td style={{...labelStyle, fontWeight: '600'}}>Total Liabilities</td>
                {localData.balance?.map((year, idx) => (
                  <td key={idx} style={{...tdStyle, fontWeight: '600'}}>
                    {renderEditableCell('balance', idx, 'totalLiabilities', year.totalLiabilities)}
                  </td>
                ))}
              </tr>
              <tr style={{ background: '#dcfce7' }}>
                <td style={{...labelStyle, fontWeight: '700', color: '#166534'}}>Total Equity</td>
                {localData.balance?.map((year, idx) => (
                  <td key={idx} style={{...tdStyle, fontWeight: '700', color: '#166534'}}>
                    {renderEditableCell('balance', idx, 'totalStockholdersEquity', year.totalStockholdersEquity)}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </details>

      {/* Cash Flow Statement */}
      <details open style={{ marginBottom: '1.5rem' }}>
        <summary style={{ 
          cursor: 'pointer', 
          fontSize: '1.1rem', 
          fontWeight: '600', 
          padding: '0.75rem',
          background: '#f8fafc',
          borderRadius: '8px',
          marginBottom: '0.5rem'
        }}>
          💸 Cash Flow Statement (in millions)
        </summary>
        
        <div style={{ overflowX: 'auto' }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={{...thStyle, textAlign: 'left'}}>Item</th>
                {localData.cashFlow?.map((year, idx) => (
                  <th key={idx} style={{...thStyle, textAlign: 'right'}}>
                    {new Date(year.date).getFullYear()}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={labelStyle}>Net Income</td>
                {localData.cashFlow?.map((year, idx) => (
                  <td key={idx} style={tdStyle}>
                    {renderEditableCell('cashFlow', idx, 'netIncome', year.netIncome)}
                  </td>
                ))}
              </tr>
              <tr>
                <td style={labelStyle}>Depreciation & Amortization</td>
                {localData.cashFlow?.map((year, idx) => (
                  <td key={idx} style={tdStyle}>
                    {renderEditableCell('cashFlow', idx, 'depreciationAmortization', year.depreciationAmortization)}
                  </td>
                ))}
              </tr>
              <tr>
                <td style={labelStyle}>Change in Working Capital</td>
                {localData.cashFlow?.map((year, idx) => (
                  <td key={idx} style={tdStyle}>
                    {renderEditableCell('cashFlow', idx, 'changeInWorkingCapital', year.changeInWorkingCapital)}
                  </td>
                ))}
              </tr>
              <tr style={{ background: '#dbeafe' }}>
                <td style={{...labelStyle, fontWeight: '700', color: '#1e40af'}}>Operating Cash Flow</td>
                {localData.cashFlow?.map((year, idx) => (
                  <td key={idx} style={{...tdStyle, fontWeight: '700', color: '#1e40af'}}>
                    {renderEditableCell('cashFlow', idx, 'operatingCashFlow', year.operatingCashFlow)}
                  </td>
                ))}
              </tr>
              <tr>
                <td style={labelStyle}>Capital Expenditure</td>
                {localData.cashFlow?.map((year, idx) => (
                  <td key={idx} style={tdStyle}>
                    {renderEditableCell('cashFlow', idx, 'capitalExpenditure', year.capitalExpenditure)}
                  </td>
                ))}
              </tr>
              <tr style={{ background: '#dcfce7' }}>
                <td style={{...labelStyle, fontWeight: '700', color: '#166534'}}>Free Cash Flow</td>
                {localData.cashFlow?.map((year, idx) => (
                  <td key={idx} style={{...tdStyle, fontWeight: '700', color: '#166534'}}>
                    {renderEditableCell('cashFlow', idx, 'freeCashFlow', year.freeCashFlow)}
                  </td>
                ))}
              </tr>
              <tr>
                <td style={labelStyle}>Dividends Paid</td>
                {localData.cashFlow?.map((year, idx) => (
                  <td key={idx} style={tdStyle}>
                    {renderEditableCell('cashFlow', idx, 'dividendsPaid', year.dividendsPaid)}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </details>

      <div style={{ 
        padding: '1rem', 
        background: '#fffbeb', 
        border: '1px solid #fbbf24',
        borderRadius: '8px',
        fontSize: '0.85rem',
        color: '#92400e'
      }}>
        <strong>💡 How to use:</strong> Click any number to edit. Press Enter to save, Escape to cancel. All amounts shown in millions except EPS.
      </div>
    </div>
  );
}

function StockAnalyzerTab({ 
  stockTicker, setStockTicker, handleStockSearch, stockData, setStockData, setError,
  scenario, setScenario, stockAssumptions, setStockAssumptions, stockProjections, loading, error,
  incomeFile, setIncomeFile, balanceFile, setBalanceFile, cashFlowFile, setCashFlowFile,
  combinedFile, setCombinedFile,
  pdfParsing, setPdfParsing, pdfParseSuccess, setPdfParseSuccess,
  showPdfUpload, setShowPdfUpload, handleFinancialPdfUpload
}) {
  const updateAssumption = (field, value) => {
    setStockAssumptions(prev => ({
      ...prev,
      [scenario]: { ...prev[scenario], [field]: parseFloat(value) || 0 }
    }));
  };

  const assumptions = stockAssumptions[scenario];
  const enhancedMetrics = (stockData && stockProjections && stockProjections.length > 0) 
    ? calculateEnhancedMetrics(stockData, stockProjections, scenario)
    : null;

  // Calculate quality scores
  const qualityScores = useMemo(() => {
    // Always return an object, even if data is incomplete
    if (!stockData || !stockData.income || stockData.income.length === 0) {
      return {
        piotroskiF: null,
        altmanZ: null,
        beneishM: null,
        cqvs: null,
        cqvsLabel: 'Insufficient Data',
        hasData: false,
        missingData: ['income statements']
      };
    }
    
    const financials = {
      income: stockData.income || [],
      balance: stockData.balance || [],
      cashFlow: stockData.cashFlow || []
    };
    
    // Calculate each score independently - they can fail individually
    const piotroskiF = calculatePiotroskiF(financials);
    const altmanZ = calculateAltmanZ(financials);
    const beneishM = calculateBeneishM(financials);
    
    // CQVS only if we have at least 2 scores
    let cqvs = null;
    let cqvsLabel = 'Insufficient Data';
    
    const validScores = [piotroskiF, altmanZ, beneishM].filter(s => s !== null);
    if (validScores.length >= 2) {
      cqvs = calculateCQVS(piotroskiF, altmanZ, beneishM, financials);
      cqvsLabel = getCQVSLabel(cqvs);
    }
    
    // Track what data is missing
    const missingData = [];
    if (!stockData.balance || stockData.balance.length === 0) missingData.push('balance sheets');
    if (!stockData.cashFlow || stockData.cashFlow.length === 0) missingData.push('cash flow statements');
    
    return {
      piotroskiF,
      altmanZ,
      beneishM,
      cqvs,
      cqvsLabel,
      hasData: validScores.length > 0,
      missingData
    };
  }, [stockData]);

  return (
    <div>
      <Card style={{ marginBottom: '2rem' }}>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <div style={{ flex: 1, position: 'relative' }}>
            <Search size={20} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
            <input
              type="text"
              placeholder="Enter stock ticker (e.g., AAPL, MSFT, TSLA)"
              value={stockTicker}
              onChange={(e) => setStockTicker(e.target.value.toUpperCase())}
              onKeyPress={(e) => e.key === 'Enter' && handleStockSearch()}
              style={{
                width: '100%',
                padding: '0.875rem 1rem 0.875rem 3rem',
                border: '2px solid #e2e8f0',
                borderRadius: '8px',
                fontSize: '1rem',
                outline: 'none',
              }}
            />
          </div>
          <button
            onClick={handleStockSearch}
            disabled={loading}
            style={{
              background: '#3b82f6',
              color: 'white',
              border: 'none',
              padding: '0.875rem 2rem',
              borderRadius: '8px',
              fontSize: '1rem',
              fontWeight: '600',
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.6 : 1,
            }}
          >
            {loading ? 'Searching...' : 'Analyze'}
          </button>
        </div>
        {error && <p style={{ marginTop: '1rem', color: '#ef4444', fontSize: '0.9rem' }}>{error}</p>}
      </Card>

      {/* Financial Statement PDF Upload */}
      <Card style={{ marginBottom: '2rem', background: showPdfUpload ? '#f8fafc' : 'white', transition: 'all 0.3s' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: showPdfUpload ? '1rem' : 0 }}>
          <div>
            <h3 style={{ fontSize: '1.25rem', fontWeight: '700', color: '#0f172a', margin: 0 }}>
              📄 Upload Financial Statements
            </h3>
            {!showPdfUpload && (
              <p style={{ color: '#64748b', fontSize: '0.9rem', margin: '0.25rem 0 0' }}>
                Can't find data via ticker? Upload PDF statements directly
              </p>
            )}
          </div>
          <button
            onClick={() => setShowPdfUpload(!showPdfUpload)}
            style={{
              background: 'transparent',
              border: '2px solid #e2e8f0',
              padding: '0.5rem 1rem',
              borderRadius: '8px',
              fontSize: '0.9rem',
              fontWeight: '600',
              color: '#64748b',
              cursor: 'pointer'
            }}
          >
            {showPdfUpload ? 'Hide' : 'Show Upload'}
          </button>
        </div>
        
        {showPdfUpload && (
          <div style={{ marginTop: '1rem' }}>
            <p style={{ color: '#64748b', marginBottom: '1rem', fontSize: '0.9rem' }}>
              Upload financial statements from company investor relations (10-K, annual report, investor presentation, etc.)
            </p>
            
            {pdfParseSuccess && (
              <div style={{ 
                padding: '1rem', 
                background: '#f0fdf4', 
                border: '1px solid #bbf7d0', 
                borderRadius: '8px',
                marginBottom: '1rem'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#16a34a', fontWeight: '600' }}>
                  ✅ Successfully Parsed: {pdfParseSuccess.companyName}
                </div>
                <div style={{ color: '#15803d', fontSize: '0.85rem', marginTop: '0.5rem' }}>
                  {pdfParseSuccess.cached && '💾 Data retrieved from cache - '}
                  {pdfParseSuccess.mode === 'combined' && '📄 Extracted from combined document - '}
                  {pdfParseSuccess.years.income} years income, {pdfParseSuccess.years.balance} years balance, {pdfParseSuccess.years.cashFlow} years cash flow
                </div>
              </div>
            )}
            
            {/* OPTION 1: Combined Document (Recommended) */}
            <div style={{ marginBottom: '1.5rem' }}>
              <div style={{ 
                padding: '1.25rem', 
                border: '3px solid #3b82f6',
                borderRadius: '12px',
                background: combinedFile ? '#eff6ff' : '#f8fafc'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                  <div style={{
                    background: '#3b82f6',
                    color: 'white',
                    padding: '0.25rem 0.75rem',
                    borderRadius: '6px',
                    fontSize: '0.75rem',
                    fontWeight: '700'
                  }}>
                    RECOMMENDED
                  </div>
                  <label style={{ 
                    fontSize: '1rem', 
                    fontWeight: '700', 
                    color: '#0f172a'
                  }}>
                    📑 Combined Document (10-K, Annual Report, etc.)
                  </label>
                </div>
                <p style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '0.75rem' }}>
                  Upload one PDF containing all financial statements. AI will extract income statement, balance sheet, and cash flow automatically.
                </p>
                <input
                  type="file"
                  accept=".pdf"
                  onChange={(e) => {
                    setCombinedFile(e.target.files[0]);
                    // Clear individual files if combined is selected
                    setIncomeFile(null);
                    setBalanceFile(null);
                    setCashFlowFile(null);
                  }}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    border: '2px solid #3b82f6',
                    borderRadius: '6px',
                    fontSize: '0.9rem',
                    background: 'white'
                  }}
                />
                {combinedFile && (
                  <div style={{ marginTop: '0.75rem', fontSize: '0.85rem', color: '#2563eb', fontWeight: '600' }}>
                    ✓ {combinedFile.name}
                  </div>
                )}
              </div>
            </div>
            
            {/* OR Divider */}
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '1rem', 
              marginBottom: '1.5rem',
              color: '#94a3b8',
              fontSize: '0.9rem',
              fontWeight: '600'
            }}>
              <div style={{ flex: 1, height: '1px', background: '#e2e8f0' }} />
              OR UPLOAD SEPARATELY
              <div style={{ flex: 1, height: '1px', background: '#e2e8f0' }} />
            </div>
            
            {/* OPTION 2: Three Separate Files */}
            <div style={{ 
              display: 'grid', 
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', 
              gap: '1rem',
              marginBottom: '1rem',
              opacity: combinedFile ? 0.5 : 1,
              pointerEvents: combinedFile ? 'none' : 'auto'
            }}>
              {/* Income Statement */}
              <div style={{ 
                padding: '1rem', 
                border: '2px dashed #e2e8f0', 
                borderRadius: '8px',
                background: incomeFile ? '#f0fdf4' : 'white'
              }}>
                <label style={{ 
                  display: 'block', 
                  fontSize: '0.9rem', 
                  fontWeight: '600', 
                  color: '#0f172a',
                  marginBottom: '0.5rem'
                }}>
                  📊 Income Statement
                </label>
                <input
                  type="file"
                  accept=".pdf"
                  onChange={(e) => {
                    setIncomeFile(e.target.files[0]);
                    setCombinedFile(null); // Clear combined if individual selected
                  }}
                  style={{
                    width: '100%',
                    padding: '0.5rem',
                    border: '1px solid #e2e8f0',
                    borderRadius: '4px',
                    fontSize: '0.85rem'
                  }}
                />
                {incomeFile && (
                  <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: '#16a34a' }}>
                    ✓ {incomeFile.name}
                  </div>
                )}
              </div>
              
              {/* Balance Sheet */}
              <div style={{ 
                padding: '1rem', 
                border: '2px dashed #e2e8f0', 
                borderRadius: '8px',
                background: balanceFile ? '#f0fdf4' : 'white'
              }}>
                <label style={{ 
                  display: 'block', 
                  fontSize: '0.9rem', 
                  fontWeight: '600', 
                  color: '#0f172a',
                  marginBottom: '0.5rem'
                }}>
                  💰 Balance Sheet
                </label>
                <input
                  type="file"
                  accept=".pdf"
                  onChange={(e) => {
                    setBalanceFile(e.target.files[0]);
                    setCombinedFile(null); // Clear combined if individual selected
                  }}
                  style={{
                    width: '100%',
                    padding: '0.5rem',
                    border: '1px solid #e2e8f0',
                    borderRadius: '4px',
                    fontSize: '0.85rem'
                  }}
                />
                {balanceFile && (
                  <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: '#16a34a' }}>
                    ✓ {balanceFile.name}
                  </div>
                )}
              </div>
              
              {/* Cash Flow */}
              <div style={{ 
                padding: '1rem', 
                border: '2px dashed #e2e8f0', 
                borderRadius: '8px',
                background: cashFlowFile ? '#f0fdf4' : 'white'
              }}>
                <label style={{ 
                  display: 'block', 
                  fontSize: '0.9rem', 
                  fontWeight: '600', 
                  color: '#0f172a',
                  marginBottom: '0.5rem'
                }}>
                  💸 Cash Flow Statement
                </label>
                <input
                  type="file"
                  accept=".pdf"
                  onChange={(e) => {
                    setCashFlowFile(e.target.files[0]);
                    setCombinedFile(null); // Clear combined if individual selected
                  }}
                  style={{
                    width: '100%',
                    padding: '0.5rem',
                    border: '1px solid #e2e8f0',
                    borderRadius: '4px',
                    fontSize: '0.85rem'
                  }}
                />
                {cashFlowFile && (
                  <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: '#16a34a' }}>
                    ✓ {cashFlowFile.name}
                  </div>
                )}
              </div>
            </div>
            
            <button
              onClick={handleFinancialPdfUpload}
              disabled={(!combinedFile && (!incomeFile || !balanceFile || !cashFlowFile)) || pdfParsing}
              style={{
                width: '100%',
                background: (combinedFile || (incomeFile && balanceFile && cashFlowFile)) ? '#3b82f6' : '#e2e8f0',
                color: (combinedFile || (incomeFile && balanceFile && cashFlowFile)) ? 'white' : '#94a3b8',
                border: 'none',
                padding: '0.875rem',
                borderRadius: '8px',
                fontSize: '1rem',
                fontWeight: '600',
                cursor: ((combinedFile || (incomeFile && balanceFile && cashFlowFile)) && !pdfParsing) ? 'pointer' : 'not-allowed',
                opacity: pdfParsing ? 0.6 : 1
              }}
            >
              {pdfParsing ? '🤖 Analyzing with AI... (10-15 seconds)' : combinedFile ? '📊 Analyze Combined Document' : '📊 Analyze Financial Statements'}
            </button>
            
            <div style={{ marginTop: '1rem', fontSize: '0.85rem', color: '#64748b' }}>
              <strong>💡 Tip:</strong> Find these statements on company investor relations pages. Look for "Annual Report" or "10-K" filings.
            </div>
          </div>
        )}
      </Card>

      {stockData && stockData.quote && (
        <>
          <Card style={{ marginBottom: '2rem' }}>
            <h2 style={{ fontSize: '1.75rem', fontWeight: '700', color: '#0f172a', margin: '0 0 0.5rem' }}>
              {stockData.profile?.companyName || stockTicker}
            </h2>
            <div style={{ display: 'flex', gap: '2rem', color: '#64748b', fontSize: '0.9rem' }}>
              <span>Price: <strong style={{ color: '#0f172a' }}>${stockData.quote?.price?.toFixed(2)}</strong></span>
              <span>Market Cap: <strong style={{ color: '#0f172a' }}>${(stockData.quote?.marketCap / 1e9).toFixed(2)}B</strong></span>
              <span>Shares: <strong style={{ color: '#0f172a' }}>{(stockData.quote?.sharesOutstanding / 1e6).toFixed(0)}M</strong></span>
            </div>
          </Card>
          
          {/* Financial Statement Tables (from PDF upload) */}
          {stockData.income && stockData.balance && stockData.cashFlow && (
            <Card style={{ marginBottom: '2rem' }}>
              <FinancialStatementTables 
                data={{
                  income: stockData.income,
                  balance: stockData.balance,
                  cashFlow: stockData.cashFlow
                }}
                stockData={stockData}
                qualityScores={qualityScores}
                onDataUpdate={(updatedData) => {
                  // Update stockData with edited values
                  setStockData({
                    ...stockData,
                    income: updatedData.income,
                    balance: updatedData.balance,
                    cashFlow: updatedData.cashFlow
                  });
                }}
              />
            </Card>
          )}
          
          {/* Quality Scores Dashboard */}
          {qualityScores && (
            <Card style={{ marginBottom: '2rem' }}>
              <h3 style={{ 
                fontSize: '1.5rem', 
                fontWeight: '700', 
                marginBottom: '1rem',
                color: '#0f172a'
              }}>
                📊 Quality Scores
              </h3>
              
              {/* CQVS - Main Score */}
              <div style={{
                padding: '20px',
                background: qualityScores.hasData 
                  ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
                  : 'linear-gradient(135deg, #94a3b8 0%, #64748b 100%)',
                borderRadius: '12px',
                marginBottom: '1rem',
                color: 'white'
              }}>
                <div style={{ 
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  alignItems: 'center' 
                }}>
                  <div>
                    <div style={{ fontSize: '14px', opacity: 0.9, marginBottom: '4px', display: 'flex', alignItems: 'center' }}>
                      Composite Quality Value Score (CQVS)
                      <InfoBubble metricKey="cqvs" />
                    </div>
                    <div style={{ fontSize: '48px', fontWeight: '700' }}>
                      {qualityScores.cqvs !== null ? qualityScores.cqvs.toFixed(1) : '—'}
                    </div>
                    <div style={{ fontSize: '18px', fontWeight: '600', marginTop: '4px' }}>
                      {qualityScores.cqvsLabel}
                    </div>
                    {qualityScores.missingData && qualityScores.missingData.length > 0 && (
                      <div style={{ fontSize: '12px', marginTop: '8px', opacity: 0.8 }}>
                        ⓘ Missing: {qualityScores.missingData.join(', ')}
                      </div>
                    )}
                  </div>
                  <div style={{
                    width: '100px',
                    height: '100px',
                    borderRadius: '50%',
                    border: '8px solid rgba(255,255,255,0.3)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '32px'
                  }}>
                    {qualityScores.cqvs === null ? '📊' : 
                     qualityScores.cqvs >= 75 ? '🌟' : 
                     qualityScores.cqvs >= 60 ? '✨' : 
                     qualityScores.cqvs >= 40 ? '📊' : '⚠️'}
                  </div>
                </div>
              </div>
              
              {/* Individual Scores */}
              <div style={{ 
                display: 'grid', 
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', 
                gap: '1rem',
                marginBottom: '1rem'
              }}>
                {/* Piotroski F-Score */}
                <div style={{
                  padding: '12px 16px',
                  backgroundColor: '#f8f9fa',
                  borderRadius: '8px',
                  border: '1px solid #e2e8f0'
                }}>
                  <div style={{ 
                    fontSize: '12px', 
                    color: '#64748b', 
                    marginBottom: '4px',
                    display: 'flex',
                    alignItems: 'center'
                  }}>
                    Piotroski F-Score
                    <InfoBubble metricKey="piotroskiF" />
                  </div>
                  <div style={{ 
                    fontSize: '20px', 
                    fontWeight: '700', 
                    color: qualityScores.piotroskiF === null ? '#94a3b8' :
                           qualityScores.piotroskiF >= 7 ? '#10b981' : 
                           qualityScores.piotroskiF >= 5 ? '#f59e0b' : '#ef4444'
                  }}>
                    {qualityScores.piotroskiF !== null ? `${qualityScores.piotroskiF}/9` : 'N/A'}
                  </div>
                </div>
                
                {/* Altman Z-Score */}
                <div style={{
                  padding: '12px 16px',
                  backgroundColor: '#f8f9fa',
                  borderRadius: '8px',
                  border: '1px solid #e2e8f0'
                }}>
                  <div style={{ 
                    fontSize: '12px', 
                    color: '#64748b', 
                    marginBottom: '4px',
                    display: 'flex',
                    alignItems: 'center'
                  }}>
                    Altman Z-Score
                    <InfoBubble metricKey="altmanZ" />
                  </div>
                  <div style={{ 
                    fontSize: '20px', 
                    fontWeight: '700', 
                    color: qualityScores.altmanZ === null ? '#94a3b8' :
                           qualityScores.altmanZ > 2.99 ? '#10b981' : 
                           qualityScores.altmanZ > 1.81 ? '#f59e0b' : '#ef4444'
                  }}>
                    {qualityScores.altmanZ !== null ? qualityScores.altmanZ.toFixed(2) : 'N/A'}
                  </div>
                </div>
                
                {/* Beneish M-Score */}
                <div style={{
                  padding: '12px 16px',
                  backgroundColor: '#f8f9fa',
                  borderRadius: '8px',
                  border: '1px solid #e2e8f0'
                }}>
                  <div style={{ 
                    fontSize: '12px', 
                    color: '#64748b', 
                    marginBottom: '4px',
                    display: 'flex',
                    alignItems: 'center'
                  }}>
                    Beneish M-Score
                    <InfoBubble metricKey="beneishM" />
                  </div>
                  <div style={{ 
                    fontSize: '20px', 
                    fontWeight: '700', 
                    color: qualityScores.beneishM === null ? '#94a3b8' :
                           qualityScores.beneishM < -2.22 ? '#10b981' : 
                           qualityScores.beneishM < -1.78 ? '#f59e0b' : '#ef4444'
                  }}>
                    {qualityScores.beneishM !== null ? qualityScores.beneishM.toFixed(2) : 'N/A'}
                  </div>
                </div>
              </div>
            </Card>
          )}
          
          {/* Debt vs Equity Analysis */}
          {stockData.balance && stockData.balance[0] && stockData.income && stockData.income[0] && (
            <Card style={{ marginBottom: '2rem' }}>
              <h3 style={{ 
                fontSize: '1.5rem', 
                fontWeight: '700', 
                marginBottom: '1rem',
                color: '#0f172a'
              }}>
                💰 Debt vs Equity Analysis
              </h3>
              
              {(() => {
                const bs = stockData.balance[0];
                const inc = stockData.income[0];
                const cf = stockData.cashFlow?.[0];
                
                const marketCap = stockData.quote?.marketCap || (bs.totalStockholdersEquity * 1.5);
                const netDebt = bs.totalDebt - bs.cashAndCashEquivalents;
                const enterpriseValue = marketCap + netDebt;
                const equityPercent = (marketCap / enterpriseValue) * 100;
                const debtPercent = 100 - equityPercent;
                
                const eps = inc.eps || (inc.netIncome / (stockData.quote?.sharesOutstanding || 1));
                const pe = stockData.quote?.price / eps;
                const earningsYield = (1 / pe) * 100;
                
                const fcf = cf?.freeCashFlow || 0;
                const fcfYield = marketCap > 0 ? (fcf / marketCap) * 100 : 0;
                
                return (
                  <div style={{
                    backgroundColor: '#f0fdf4',
                    padding: '20px',
                    borderRadius: '12px',
                    border: '2px solid #86efac'
                  }}>
                    {/* Market Cap & Net Debt */}
                    <div style={{ marginBottom: '12px' }}>
                      <div style={{ fontSize: '14px', color: '#166534', fontWeight: '600' }}>
                        Market cap: ${(marketCap / 1e9).toFixed(1)}Bn
                      </div>
                      <div style={{ fontSize: '14px', color: '#166534', fontWeight: '600' }}>
                        Net debt: ${(netDebt / 1e9).toFixed(1)}Bn
                      </div>
                    </div>
                    
                    {/* Enterprise Value */}
                    <div style={{
                      backgroundColor: '#dcfce7',
                      padding: '12px',
                      borderRadius: '8px',
                      marginBottom: '12px',
                      fontSize: '16px',
                      fontWeight: '700',
                      color: '#166534'
                    }}>
                      ${(marketCap / 1e9).toFixed(1)}Bn Equity + ${(netDebt / 1e9).toFixed(1)}Bn Net debt = 
                      <span style={{ color: '#f59e0b' }}> ${(enterpriseValue / 1e9).toFixed(1)}Bn Enterprise value</span>
                    </div>
                    
                    {/* Percentages */}
                    <div style={{ marginBottom: '12px' }}>
                      <div style={{ fontSize: '18px', fontWeight: '700', color: '#166534' }}>
                        ${(marketCap / 1e9).toFixed(1)}Bn Equity / ${(enterpriseValue / 1e9).toFixed(1)}Bn Enterprise value = {equityPercent.toFixed(0)}% Equity
                      </div>
                      <div style={{ fontSize: '16px', fontWeight: '600', color: '#ca8a04' }}>
                        100% - {equityPercent.toFixed(0)}% Equity = {debtPercent.toFixed(0)}% Debt
                      </div>
                    </div>
                    
                    {/* P/E Calculation */}
                    <div style={{
                      backgroundColor: '#fef3c7',
                      padding: '12px',
                      borderRadius: '8px',
                      marginBottom: '12px'
                    }}>
                      <div style={{ fontSize: '14px', color: '#92400e' }}>
                        ${eps.toFixed(2)} EPS / ${stockData.quote?.price.toFixed(2)} = {pe.toFixed(2)} P/E
                      </div>
                      <div style={{ fontSize: '14px', color: '#92400e', marginTop: '4px' }}>
                        {pe.toFixed(2)} P/E / {(equityPercent / 100).toFixed(2)} = {(pe / (equityPercent / 100)).toFixed(2)}x earnings on equity
                      </div>
                    </div>
                    
                    {/* FCF Analysis */}
                    <div style={{
                      backgroundColor: '#e0e7ff',
                      padding: '12px',
                      borderRadius: '8px'
                    }}>
                      <div style={{ fontSize: '14px', color: '#3730a3', marginBottom: '6px' }}>
                        Free Cash Flow (TTM): ${(fcf / 1e6).toFixed(0)}M
                      </div>
                      <div style={{ fontSize: '16px', fontWeight: '700', color: '#3730a3' }}>
                        FCF ${(fcf / 1e6).toFixed(0)}M × {(equityPercent / 100).toFixed(2)} = 
                        <span style={{ color: '#f59e0b' }}> ${((fcf * equityPercent / 100) / 1e6).toFixed(0)}M</span>
                      </div>
                      <div style={{ fontSize: '18px', fontWeight: '700', color: '#166534', marginTop: '8px' }}>
                        ${((fcf * equityPercent / 100) / 1e6).toFixed(0)}M / ${(marketCap / 1e9).toFixed(1)}Bn market cap = 
                        <span style={{ color: '#f59e0b' }}> {fcfYield.toFixed(1)}% FCF Yield</span>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </Card>
          )}
          
          {/* Investment Conclusion Card */}
          {enhancedMetrics && (
            <Card title="Investment Conclusion" style={{ marginBottom: '2rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '2rem' }}>
                {/* Recommendation Section */}
                <div style={{ 
                  textAlign: 'center', 
                  padding: '2rem',
                  background: 'linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)',
                  borderRadius: '12px',
                }}>
                  <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>
                    {enhancedMetrics.conclusionEmoji}
                  </div>
                  <div style={{ 
                    fontSize: '2rem', 
                    fontWeight: '700', 
                    color: enhancedMetrics.conclusionColor,
                    marginBottom: '1rem',
                  }}>
                    {enhancedMetrics.conclusion}
                  </div>
                  
                  <div style={{ marginTop: '1.5rem', padding: '1rem', background: 'white', borderRadius: '8px' }}>
                    <div style={{ fontSize: '0.875rem', color: '#64748b', marginBottom: '0.25rem' }}>
                      Fair Value (5Y Target)
                    </div>
                    <div style={{ fontSize: '1.75rem', fontWeight: '700', color: '#0f172a' }}>
                      ${enhancedMetrics.fairValue.toFixed(2)}
                    </div>
                    <div style={{ fontSize: '0.875rem', color: '#64748b', marginTop: '0.25rem' }}>
                      Current: ${enhancedMetrics.currentPrice.toFixed(2)}
                    </div>
                    <div style={{ 
                      fontSize: '1.25rem', 
                      fontWeight: '700', 
                      color: enhancedMetrics.upside > 0 ? '#10b981' : '#ef4444',
                      marginTop: '0.5rem',
                    }}>
                      {enhancedMetrics.upside > 0 ? '+' : ''}{enhancedMetrics.upside.toFixed(1)}% Upside
                    </div>
                  </div>
                </div>
                
                {/* Strengths & Weaknesses */}
                <div>
                  <div style={{ marginBottom: '1.5rem' }}>
                    <div style={{ 
                      fontSize: '1.1rem', 
                      fontWeight: '700', 
                      color: '#10b981',
                      marginBottom: '0.75rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                    }}>
                      ✅ Strengths
                    </div>
                    {enhancedMetrics.bullishSignals.length > 0 ? (
                      <ul style={{ margin: 0, paddingLeft: '1.5rem', color: '#475569' }}>
                        {enhancedMetrics.bullishSignals.map((signal, idx) => (
                          <li key={idx} style={{ marginBottom: '0.5rem' }}>{signal}</li>
                        ))}
                      </ul>
                    ) : (
                      <div style={{ color: '#94a3b8', fontStyle: 'italic' }}>No major strengths identified</div>
                    )}
                  </div>
                  
                  <div>
                    <div style={{ 
                      fontSize: '1.1rem', 
                      fontWeight: '700', 
                      color: '#ef4444',
                      marginBottom: '0.75rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                    }}>
                      ⚠️ Risks & Concerns
                    </div>
                    {enhancedMetrics.bearishSignals.length > 0 ? (
                      <ul style={{ margin: 0, paddingLeft: '1.5rem', color: '#475569' }}>
                        {enhancedMetrics.bearishSignals.map((signal, idx) => (
                          <li key={idx} style={{ marginBottom: '0.5rem' }}>{signal}</li>
                        ))}
                      </ul>
                    ) : (
                      <div style={{ color: '#94a3b8', fontStyle: 'italic' }}>No major concerns identified</div>
                    )}
                  </div>
                  
                  {/* Key Metrics Grid */}
                  <div style={{
                    marginTop: '1.5rem',
                    padding: '1rem',
                    background: '#f8fafc',
                    borderRadius: '8px',
                  }}>
                    <div style={{ fontSize: '0.9rem', fontWeight: '700', marginBottom: '0.75rem', color: '#64748b' }}>
                      KEY METRICS
                    </div>
                    <div style={{ 
                      display: 'grid', 
                      gridTemplateColumns: 'repeat(3, 1fr)', 
                      gap: '1rem',
                      fontSize: '0.85rem',
                    }}>
                      <div>
                        <div style={{ color: '#94a3b8' }}>P/E Ratio</div>
                        <div style={{ fontWeight: '700', color: '#0f172a' }}>{enhancedMetrics.currentPE.toFixed(1)}</div>
                      </div>
                      <div>
                        <div style={{ color: '#94a3b8' }}>ROE</div>
                        <div style={{ fontWeight: '700', color: '#0f172a' }}>
                          {enhancedMetrics.roe !== null ? enhancedMetrics.roe.toFixed(1) + '%' : 'N/A'}
                        </div>
                      </div>
                      <div>
                        <div style={{ color: '#94a3b8' }}>Debt/Equity</div>
                        <div style={{ fontWeight: '700', color: '#0f172a' }}>
                          {enhancedMetrics.debtToEquity !== null ? enhancedMetrics.debtToEquity.toFixed(2) : 'N/A'}
                        </div>
                      </div>
                      <div>
                        <div style={{ color: '#94a3b8' }}>Net Margin</div>
                        <div style={{ fontWeight: '700', color: '#0f172a' }}>{enhancedMetrics.netMargin.toFixed(1)}%</div>
                      </div>
                      <div>
                        <div style={{ color: '#94a3b8' }}>Rev Growth</div>
                        <div style={{ fontWeight: '700', color: enhancedMetrics.revenueGrowth > 0 ? '#10b981' : '#ef4444' }}>
                          {enhancedMetrics.revenueGrowth.toFixed(1)}%
                        </div>
                      </div>
                      <div>
                        <div style={{ color: '#94a3b8' }}>Current Ratio</div>
                        <div style={{ fontWeight: '700', color: '#0f172a' }}>
                          {enhancedMetrics.currentRatio !== null ? enhancedMetrics.currentRatio.toFixed(2) : 'N/A'}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </Card>
          )}
          
          {/* Export Buttons */}
          {stockData && stockData.quote && (
            <div style={{ marginBottom: '2rem' }}>
              <div style={{ 
                textAlign: 'center', 
                marginBottom: '1rem',
                fontSize: '1.1rem',
                fontWeight: '600',
                color: '#0f172a',
              }}>
                📥 Download Financial Model
              </div>
              
              <div style={{ 
                display: 'flex', 
                gap: '1.5rem', 
                justifyContent: 'center',
                flexWrap: 'wrap',
              }}>
                {/* Professional Report Button (NEW!) */}
                <div style={{ flex: '0 1 280px' }}>
                  <button
                    onClick={() => exportStockAnalysisToExcelPro(stockData, stockProjections, assumptions, scenario, enhancedMetrics)}
                    style={{
                      width: '100%',
                      padding: '1.25rem 1.5rem',
                      background: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',
                      color: 'white',
                      border: 'none',
                      borderRadius: '12px',
                      fontSize: '1rem',
                      fontWeight: '700',
                      cursor: 'pointer',
                      boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
                      transition: 'all 0.2s',
                    }}
                    onMouseEnter={(e) => {
                      e.target.style.transform = 'translateY(-2px)';
                      e.target.style.boxShadow = '0 6px 12px rgba(0,0,0,0.15)';
                    }}
                    onMouseLeave={(e) => {
                      e.target.style.transform = 'translateY(-2px)';
                      e.target.style.boxShadow = '0 4px 6px rgba(0,0,0,0.1)';
                    }}
                  >
                    <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>📑</div>
                    <div>Professional Report</div>
                  </button>
                  <div style={{ 
                    fontSize: '0.8rem', 
                    color: '#64748b', 
                    marginTop: '0.75rem',
                    textAlign: 'center',
                    lineHeight: '1.4',
                  }}>
                    <strong style={{ color: '#8b5cf6' }}>⭐ RECOMMENDED</strong><br/>
                    Beautiful formatting • Print-ready • Client presentations
                  </div>
                </div>
              
                {/* Excel/Google Sheets Button */}
                <div style={{ flex: '0 1 280px' }}>
                  <button
                    onClick={() => exportStockAnalysisToExcel(stockData, stockProjections, assumptions, scenario, enhancedMetrics)}
                    style={{
                      width: '100%',
                      padding: '1.25rem 1.5rem',
                      background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                      color: 'white',
                      border: 'none',
                      borderRadius: '12px',
                      fontSize: '1rem',
                      fontWeight: '700',
                      cursor: 'pointer',
                      boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
                      transition: 'all 0.2s',
                    }}
                    onMouseEnter={(e) => {
                      e.target.style.transform = 'translateY(-2px)';
                      e.target.style.boxShadow = '0 6px 12px rgba(0,0,0,0.15)';
                    }}
                    onMouseLeave={(e) => {
                      e.target.style.transform = 'translateY(0)';
                      e.target.style.boxShadow = '0 4px 6px rgba(0,0,0,0.1)';
                    }}
                  >
                    <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>📊</div>
                    <div>Excel / Google Sheets</div>
                  </button>
                  <div style={{ 
                    fontSize: '0.8rem', 
                    color: '#64748b', 
                    marginTop: '0.75rem',
                    textAlign: 'center',
                    lineHeight: '1.4',
                  }}>
                    Working formulas • Edit assumptions • Dynamic recalculation
                  </div>
                </div>
                
                {/* Mac Numbers Button */}
                <div style={{ flex: '0 1 280px' }}>
                  <button
                    onClick={() => exportStockAnalysisToNumbers(stockData, stockProjections, assumptions, scenario, enhancedMetrics)}
                    style={{
                      width: '100%',
                      padding: '1.25rem 1.5rem',
                      background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                      color: 'white',
                      border: 'none',
                      borderRadius: '12px',
                      fontSize: '1rem',
                      fontWeight: '700',
                      cursor: 'pointer',
                      boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
                      transition: 'all 0.2s',
                    }}
                    onMouseEnter={(e) => {
                      e.target.style.transform = 'translateY(-2px)';
                      e.target.style.boxShadow = '0 6px 12px rgba(0,0,0,0.15)';
                    }}
                    onMouseLeave={(e) => {
                      e.target.style.transform = 'translateY(0)';
                      e.target.style.boxShadow = '0 4px 6px rgba(0,0,0,0.1)';
                    }}
                  >
                    <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>🍎</div>
                    <div>Mac Numbers</div>
                  </button>
                  <div style={{ 
                    fontSize: '0.8rem', 
                    color: '#64748b', 
                    marginTop: '0.75rem',
                    textAlign: 'center',
                    lineHeight: '1.4',
                  }}>
                    Pre-calculated values • Mac-optimized • No formula errors
                  </div>
                </div>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem' }}>
            <ScenarioButton active={scenario === 'bull'} onClick={() => setScenario('bull')} label="Bull Case" color="#10b981" />
            <ScenarioButton active={scenario === 'base'} onClick={() => setScenario('base')} label="Base Case" color="#3b82f6" />
            <ScenarioButton active={scenario === 'bear'} onClick={() => setScenario('bear')} label="Bear Case" color="#ef4444" />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '2rem', marginBottom: '2rem' }}>
            <Card title="Assumptions (Editable)">
              <InputField
                label="Revenue Growth %"
                value={assumptions.revenueGrowth}
                onChange={(e) => updateAssumption('revenueGrowth', e.target.value)}
              />
              <InputField
                label="Net Margin %"
                value={assumptions.netMargin}
                onChange={(e) => updateAssumption('netMargin', e.target.value)}
              />
              <InputField
                label="P/E Low"
                value={assumptions.peLow}
                onChange={(e) => updateAssumption('peLow', e.target.value)}
              />
              <InputField
                label="P/E High"
                value={assumptions.peHigh}
                onChange={(e) => updateAssumption('peHigh', e.target.value)}
              />
            </Card>

            <Card title="5-Year Projections">
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
                      <th style={{ padding: '0.75rem', textAlign: 'left', color: '#475569', fontWeight: '600' }}>YEAR</th>
                      <th style={{ padding: '0.75rem', textAlign: 'right', color: '#475569', fontWeight: '600' }}>REVENUE</th>
                      <th style={{ padding: '0.75rem', textAlign: 'right', color: '#475569', fontWeight: '600' }}>NET INCOME</th>
                      <th style={{ padding: '0.75rem', textAlign: 'right', color: '#475569', fontWeight: '600' }}>EPS</th>
                      <th style={{ padding: '0.75rem', textAlign: 'right', color: '#475569', fontWeight: '600' }}>PRICE LOW</th>
                      <th style={{ padding: '0.75rem', textAlign: 'right', color: '#475569', fontWeight: '600' }}>PRICE HIGH</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stockProjections.map((proj, idx) => (
                      <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '0.75rem', fontWeight: '600', color: '#0f172a' }}>{proj.year}</td>
                        <td style={{ padding: '0.75rem', textAlign: 'right', color: '#64748b' }}>
                          ${(proj.revenue / 1e9).toFixed(2)}B
                        </td>
                        <td style={{ padding: '0.75rem', textAlign: 'right', color: '#64748b' }}>
                          ${(proj.netIncome / 1e9).toFixed(2)}B
                        </td>
                        <td style={{ padding: '0.75rem', textAlign: 'right', color: '#64748b' }}>
                          ${proj.eps}
                        </td>
                        <td style={{ padding: '0.75rem', textAlign: 'right', fontWeight: '600', color: '#f59e0b' }}>
                          ${proj.priceLow}
                        </td>
                        <td style={{ padding: '0.75rem', textAlign: 'right', fontWeight: '600', color: '#10b981' }}>
                          ${proj.priceHigh}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>

          <Card title="Projected Stock Price Range">
            <ResponsiveContainer width="100%" height={400}>
              <AreaChart data={stockProjections}>
                <defs>
                  <linearGradient id="priceGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="year" stroke="#64748b" />
                <YAxis stroke="#64748b" tickFormatter={(val) => `$${val}`} />
                <Tooltip
                  contentStyle={{
                    background: 'white',
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px',
                  }}
                />
                <Area type="monotone" dataKey="priceHigh" stroke="#10b981" fill="url(#priceGradient)" strokeWidth={2} name="High" />
                <Area type="monotone" dataKey="priceLow" stroke="#f59e0b" fill="transparent" strokeWidth={2} name="Low" />
              </AreaChart>
            </ResponsiveContainer>
          </Card>
        </>
      )}

      {!stockData && !loading && (
        <div style={{ textAlign: 'center', padding: '4rem 2rem', color: '#94a3b8' }}>
          <BarChart3 size={64} style={{ margin: '0 auto 1rem', opacity: 0.3 }} />
          <h3 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>No Stock Selected</h3>
          <p>Enter a ticker symbol above to begin your analysis</p>
        </div>
      )}
    </div>
  );
}

// ==================== DETAILED DCF MODEL VIEW ====================
function DetailedDCFView({ stockData, stockTicker, dcfInputs, updateDCFInput, updateRevenueGrowth, currentPrice, showEBITDAInfo, setShowEBITDAInfo, showNOPATInfo, setShowNOPATInfo, showTerminalValueInfo, setShowTerminalValueInfo, showFCFInfo, setShowFCFInfo }) {
  const currentYear = new Date().getFullYear();
  const baseRevenue = stockData.income && stockData.income[0] ? stockData.income[0].revenue / 1e6 : 0; // in millions
  const baseFCF = stockData.cashFlow && stockData.cashFlow[0] ? stockData.cashFlow[0].freeCashFlow / 1e6 : 0;
  
  // Build 5-year projection
  const buildProjections = () => {
    const projections = [];
    let revenue = baseRevenue;
    
    for (let i = 0; i < 5; i++) {
      const growthRate = dcfInputs.revenueGrowth[i] / 100;
      revenue = revenue * (1 + growthRate);
      
      const grossProfit = revenue * (dcfInputs.grossMargin / 100);
      const opex = revenue * (dcfInputs.opexMargin / 100);
      const ebitda = grossProfit - opex;
      const da = revenue * (dcfInputs.daMargin / 100);
      const ebit = ebitda - da;
      const taxes = ebit * (dcfInputs.taxRate / 100);
      const nopat = ebit - taxes;
      const capex = revenue * (dcfInputs.capexMargin / 100);
      const nwcChange = i > 0 ? (revenue - projections[i-1].revenue) * (dcfInputs.nwcChange / 100) : 0;
      const fcf = nopat + da - capex - nwcChange;
      const discountFactor = Math.pow(1 + dcfInputs.wacc / 100, i + 1);
      const pv = fcf / discountFactor;
      
      projections.push({
        year: currentYear + i + 1,
        revenue,
        grossProfit,
        grossMargin: (grossProfit / revenue) * 100,
        opex,
        ebitda,
        ebitdaMargin: (ebitda / revenue) * 100,
        da,
        ebit,
        ebitMargin: (ebit / revenue) * 100,
        taxes,
        nopat,
        capex,
        nwcChange,
        fcf,
        discountFactor,
        pv,
      });
    }
    
    return projections;
  };
  
  const projections = buildProjections();
  const sumPVFCF = projections.reduce((sum, p) => sum + p.pv, 0);
  
  // Terminal Value
  const terminalFCF = projections[4].fcf * (1 + dcfInputs.terminalGrowth / 100);
  const terminalValue = terminalFCF / ((dcfInputs.wacc / 100) - (dcfInputs.terminalGrowth / 100));
  const pvTerminal = terminalValue / Math.pow(1 + dcfInputs.wacc / 100, 5);
  
  // Enterprise Value to Equity Value
  const enterpriseValue = sumPVFCF + pvTerminal;
  const cash = 0; // Would need balance sheet data
  const debt = 0; // Would need balance sheet data
  const equityValue = enterpriseValue + cash - debt;
  const shares = stockData.quote?.sharesOutstanding || 1;
  const impliedPrice = equityValue / (shares / 1e6); // shares in millions
  const upside = ((impliedPrice - currentPrice) / currentPrice) * 100;
  
  return (
    <>
      <Card style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.75rem', fontWeight: '700', color: '#0f172a', margin: '0 0 1rem' }}>
          Detailed DCF Model: {stockData.profile?.companyName || stockTicker}
        </h2>
        
        {/* Assumptions Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1.5rem', marginBottom: '2rem' }}>
          <div>
            <label style={{ fontSize: '0.85rem', fontWeight: '500', color: '#475569', marginBottom: '0.5rem', display: 'block' }}>
              Gross Margin (%)
            </label>
            <input
              type="number"
              value={dcfInputs.grossMargin}
              onChange={(e) => updateDCFInput('grossMargin', e.target.value)}
              onFocus={(e) => e.target.select()}
              step="any"
              style={{
                width: '100%',
                padding: '0.75rem',
                border: '2px solid #e2e8f0',
                borderRadius: '8px',
                fontSize: '1rem',
                background: '#fefce8',
                fontWeight: '600',
              }}
            />
          </div>
          
          <div>
            <label style={{ fontSize: '0.85rem', fontWeight: '500', color: '#475569', marginBottom: '0.5rem', display: 'block' }}>
              OpEx Margin (%)
            </label>
            <input
              type="number"
              value={dcfInputs.opexMargin}
              onChange={(e) => updateDCFInput('opexMargin', e.target.value)}
              onFocus={(e) => e.target.select()}
              step="any"
              style={{
                width: '100%',
                padding: '0.75rem',
                border: '2px solid #e2e8f0',
                borderRadius: '8px',
                fontSize: '1rem',
                background: '#fefce8',
                fontWeight: '600',
              }}
            />
          </div>
          
          <div>
            <label style={{ fontSize: '0.85rem', fontWeight: '500', color: '#475569', marginBottom: '0.5rem', display: 'block' }}>
              Tax Rate (%)
            </label>
            <input
              type="number"
              value={dcfInputs.taxRate}
              onChange={(e) => updateDCFInput('taxRate', e.target.value)}
              onFocus={(e) => e.target.select()}
              step="any"
              style={{
                width: '100%',
                padding: '0.75rem',
                border: '2px solid #e2e8f0',
                borderRadius: '8px',
                fontSize: '1rem',
                background: '#fefce8',
                fontWeight: '600',
              }}
            />
          </div>
          
          <div>
            <label style={{ fontSize: '0.85rem', fontWeight: '500', color: '#475569', marginBottom: '0.5rem', display: 'block' }}>
              WACC (%)
            </label>
            <input
              type="number"
              value={dcfInputs.wacc}
              onChange={(e) => updateDCFInput('wacc', e.target.value)}
              onFocus={(e) => e.target.select()}
              step="any"
              style={{
                width: '100%',
                padding: '0.75rem',
                border: '2px solid #e2e8f0',
                borderRadius: '8px',
                fontSize: '1rem',
                background: '#fefce8',
                fontWeight: '600',
              }}
            />
          </div>
          
          <div>
            <label style={{ fontSize: '0.85rem', fontWeight: '500', color: '#475569', marginBottom: '0.5rem', display: 'block' }}>
              Terminal Growth (%)
            </label>
            <input
              type="number"
              value={dcfInputs.terminalGrowth}
              onChange={(e) => updateDCFInput('terminalGrowth', e.target.value)}
              onFocus={(e) => e.target.select()}
              step="any"
              style={{
                width: '100%',
                padding: '0.75rem',
                border: '2px solid #e2e8f0',
                borderRadius: '8px',
                fontSize: '1rem',
                background: '#fefce8',
                fontWeight: '600',
              }}
            />
          </div>
          
          <div>
            <label style={{ fontSize: '0.85rem', fontWeight: '500', color: '#475569', marginBottom: '0.5rem', display: 'block' }}>
              CapEx Margin (%)
            </label>
            <input
              type="number"
              value={dcfInputs.capexMargin}
              onChange={(e) => updateDCFInput('capexMargin', e.target.value)}
              onFocus={(e) => e.target.select()}
              step="any"
              style={{
                width: '100%',
                padding: '0.75rem',
                border: '2px solid #e2e8f0',
                borderRadius: '8px',
                fontSize: '1rem',
                background: '#fefce8',
                fontWeight: '600',
              }}
            />
          </div>
        </div>
      </Card>
      
      {/* Revenue Growth Assumptions */}
      <Card title="Revenue Growth Assumptions" style={{ marginBottom: '2rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '1rem' }}>
          {dcfInputs.revenueGrowth.map((growth, i) => (
            <div key={i}>
              <label style={{ fontSize: '0.85rem', fontWeight: '500', color: '#475569', marginBottom: '0.5rem', display: 'block' }}>
                Year {i + 1} ({currentYear + i + 1})
              </label>
              <input
                type="number"
                value={growth}
                onChange={(e) => updateRevenueGrowth(i, e.target.value)}
                onFocus={(e) => e.target.select()}
                step="any"
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  border: '2px solid #e2e8f0',
                  borderRadius: '8px',
                  fontSize: '1rem',
                  background: '#fefce8',
                  fontWeight: '600',
                  textAlign: 'center',
                }}
              />
              <div style={{ textAlign: 'center', fontSize: '0.75rem', color: '#64748b', marginTop: '0.25rem' }}>
                {growth}% growth
              </div>
            </div>
          ))}
        </div>
      </Card>
      
      {/* Income Statement & FCF Projection Table */}
      <Card title="Income Statement & Free Cash Flow Projection" style={{ marginBottom: '2rem' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
                <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: '600', color: '#64748b' }}>Line Item</th>
                <th style={{ padding: '0.75rem', textAlign: 'right', fontWeight: '600', color: '#64748b' }}>TTM</th>
                {projections.map(p => (
                  <th key={p.year} style={{ padding: '0.75rem', textAlign: 'right', fontWeight: '600', color: '#64748b' }}>{p.year}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr style={{ background: '#f8fafc' }}>
                <td style={{ padding: '0.75rem', fontWeight: '600' }}>Revenue</td>
                <td style={{ padding: '0.75rem', textAlign: 'right' }}>${baseRevenue.toFixed(0)}</td>
                {projections.map(p => (
                  <td key={p.year} style={{ padding: '0.75rem', textAlign: 'right', fontWeight: '600' }}>${p.revenue.toFixed(0)}</td>
                ))}
              </tr>
              <tr>
                <td style={{ padding: '0.75rem', paddingLeft: '1.5rem' }}>Gross Profit</td>
                <td style={{ padding: '0.75rem', textAlign: 'right' }}>-</td>
                {projections.map(p => (
                  <td key={p.year} style={{ padding: '0.75rem', textAlign: 'right' }}>${p.grossProfit.toFixed(0)}</td>
                ))}
              </tr>
              <tr style={{ fontSize: '0.75rem', color: '#64748b' }}>
                <td style={{ padding: '0.25rem 0.75rem', paddingLeft: '2rem' }}>Gross Margin</td>
                <td style={{ padding: '0.25rem 0.75rem', textAlign: 'right' }}>-</td>
                {projections.map(p => (
                  <td key={p.year} style={{ padding: '0.25rem 0.75rem', textAlign: 'right' }}>{p.grossMargin.toFixed(1)}%</td>
                ))}
              </tr>
              <tr>
                <td style={{ padding: '0.75rem', paddingLeft: '1.5rem' }}>Operating Expenses</td>
                <td style={{ padding: '0.75rem', textAlign: 'right' }}>-</td>
                {projections.map(p => (
                  <td key={p.year} style={{ padding: '0.75rem', textAlign: 'right' }}>(${ p.opex.toFixed(0)})</td>
                ))}
              </tr>
              <tr style={{ background: '#fef3c7' }}>
                <td style={{ padding: '0.75rem', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  EBITDA
                  <button
                    onClick={() => setShowEBITDAInfo(!showEBITDAInfo)}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      padding: 0,
                      display: 'flex',
                      alignItems: 'center',
                      color: '#3b82f6',
                    }}
                  >
                    <Info size={14} />
                  </button>
                </td>
                <td style={{ padding: '0.75rem', textAlign: 'right' }}>-</td>
                {projections.map(p => (
                  <td key={p.year} style={{ padding: '0.75rem', textAlign: 'right', fontWeight: '600' }}>${p.ebitda.toFixed(0)}</td>
                ))}
              </tr>
              <tr style={{ fontSize: '0.75rem', color: '#64748b', background: '#fef3c7' }}>
                <td style={{ padding: '0.25rem 0.75rem', paddingLeft: '2rem' }}>EBITDA Margin</td>
                <td style={{ padding: '0.25rem 0.75rem', textAlign: 'right' }}>-</td>
                {projections.map(p => (
                  <td key={p.year} style={{ padding: '0.25rem 0.75rem', textAlign: 'right' }}>{p.ebitdaMargin.toFixed(1)}%</td>
                ))}
              </tr>
              <tr>
                <td style={{ padding: '0.75rem', paddingLeft: '1.5rem' }}>D&A</td>
                <td style={{ padding: '0.75rem', textAlign: 'right' }}>-</td>
                {projections.map(p => (
                  <td key={p.year} style={{ padding: '0.75rem', textAlign: 'right' }}>(${ p.da.toFixed(0)})</td>
                ))}
              </tr>
              <tr style={{ background: '#eff6ff' }}>
                <td style={{ padding: '0.75rem', fontWeight: '600' }}>EBIT</td>
                <td style={{ padding: '0.75rem', textAlign: 'right' }}>-</td>
                {projections.map(p => (
                  <td key={p.year} style={{ padding: '0.75rem', textAlign: 'right', fontWeight: '600' }}>${p.ebit.toFixed(0)}</td>
                ))}
              </tr>
              <tr>
                <td style={{ padding: '0.75rem', paddingLeft: '1.5rem' }}>Taxes</td>
                <td style={{ padding: '0.75rem', textAlign: 'right' }}>-</td>
                {projections.map(p => (
                  <td key={p.year} style={{ padding: '0.75rem', textAlign: 'right' }}>(${ p.taxes.toFixed(0)})</td>
                ))}
              </tr>
              <tr style={{ background: '#f0fdf4' }}>
                <td style={{ padding: '0.75rem', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  NOPAT
                  <button
                    onClick={() => setShowNOPATInfo(!showNOPATInfo)}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      padding: 0,
                      display: 'flex',
                      alignItems: 'center',
                      color: '#3b82f6',
                    }}
                  >
                    <Info size={14} />
                  </button>
                </td>
                <td style={{ padding: '0.75rem', textAlign: 'right' }}>-</td>
                {projections.map(p => (
                  <td key={p.year} style={{ padding: '0.75rem', textAlign: 'right', fontWeight: '600' }}>${p.nopat.toFixed(0)}</td>
                ))}
              </tr>
              <tr>
                <td style={{ padding: '0.75rem', paddingLeft: '1.5rem' }}>+ D&A</td>
                <td style={{ padding: '0.75rem', textAlign: 'right' }}>-</td>
                {projections.map(p => (
                  <td key={p.year} style={{ padding: '0.75rem', textAlign: 'right' }}>${p.da.toFixed(0)}</td>
                ))}
              </tr>
              <tr>
                <td style={{ padding: '0.75rem', paddingLeft: '1.5rem' }}>- CapEx</td>
                <td style={{ padding: '0.75rem', textAlign: 'right' }}>-</td>
                {projections.map(p => (
                  <td key={p.year} style={{ padding: '0.75rem', textAlign: 'right' }}>(${ p.capex.toFixed(0)})</td>
                ))}
              </tr>
              <tr>
                <td style={{ padding: '0.75rem', paddingLeft: '1.5rem' }}>- Δ NWC</td>
                <td style={{ padding: '0.75rem', textAlign: 'right' }}>-</td>
                {projections.map(p => (
                  <td key={p.year} style={{ padding: '0.75rem', textAlign: 'right' }}>(${ p.nwcChange.toFixed(0)})</td>
                ))}
              </tr>
              <tr style={{ borderTop: '2px solid #e2e8f0', background: '#dbeafe', fontWeight: '700' }}>
                <td style={{ padding: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  Unlevered Free Cash Flow
                  <button
                    onClick={() => setShowFCFInfo(!showFCFInfo)}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      padding: 0,
                      display: 'flex',
                      alignItems: 'center',
                      color: '#3b82f6',
                    }}
                  >
                    <Info size={14} />
                  </button>
                </td>
                <td style={{ padding: '1rem', textAlign: 'right' }}>${baseFCF.toFixed(0)}</td>
                {projections.map(p => (
                  <td key={p.year} style={{ padding: '1rem', textAlign: 'right' }}>${p.fcf.toFixed(0)}</td>
                ))}
              </tr>
              <tr style={{ fontSize: '0.75rem', color: '#64748b', background: '#dbeafe' }}>
                <td style={{ padding: '0.25rem 1rem', paddingLeft: '2rem' }}>Discount Factor</td>
                <td style={{ padding: '0.25rem 1rem', textAlign: 'right' }}>-</td>
                {projections.map(p => (
                  <td key={p.year} style={{ padding: '0.25rem 1rem', textAlign: 'right' }}>{p.discountFactor.toFixed(3)}</td>
                ))}
              </tr>
              <tr style={{ background: '#dbeafe', fontWeight: '600' }}>
                <td style={{ padding: '0.75rem 1rem' }}>Present Value</td>
                <td style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>-</td>
                {projections.map(p => (
                  <td key={p.year} style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>${p.pv.toFixed(0)}</td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        
        <div style={{ marginTop: '1rem', fontSize: '0.75rem', color: '#64748b' }}>
          <strong>Note:</strong> All values in millions. NOPAT = Net Operating Profit After Tax. Δ NWC = Change in Net Working Capital.
        </div>
      </Card>
      
      {/* Valuation Summary */}
      <Card title="DCF Valuation Summary" style={{ marginBottom: '2rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
          <div>
            <table style={{ width: '100%', fontSize: '0.875rem' }}>
              <tbody>
                <tr>
                  <td style={{ padding: '0.75rem', color: '#64748b' }}>Sum of PV of FCFs (Years 1-5)</td>
                  <td style={{ padding: '0.75rem', textAlign: 'right', fontWeight: '600' }}>${sumPVFCF.toFixed(0)}M</td>
                </tr>
                <tr>
                  <td style={{ padding: '0.75rem', color: '#64748b' }}>Terminal FCF (Year 6)</td>
                  <td style={{ padding: '0.75rem', textAlign: 'right', fontWeight: '600' }}>${terminalFCF.toFixed(0)}M</td>
                </tr>
                <tr>
                  <td style={{ padding: '0.75rem', color: '#64748b' }}>Terminal Value</td>
                  <td style={{ padding: '0.75rem', textAlign: 'right', fontWeight: '600' }}>${terminalValue.toFixed(0)}M</td>
                </tr>
                <tr>
                  <td style={{ padding: '0.75rem', color: '#64748b' }}>PV of Terminal Value</td>
                  <td style={{ padding: '0.75rem', textAlign: 'right', fontWeight: '600' }}>${pvTerminal.toFixed(0)}M</td>
                </tr>
                <tr style={{ borderTop: '2px solid #e2e8f0', background: '#dbeafe' }}>
                  <td style={{ padding: '1rem', fontWeight: '700' }}>Enterprise Value</td>
                  <td style={{ padding: '1rem', textAlign: 'right', fontWeight: '700', fontSize: '1.125rem' }}>${enterpriseValue.toFixed(0)}M</td>
                </tr>
                <tr style={{ fontSize: '0.75rem', color: '#64748b' }}>
                  <td style={{ padding: '0.5rem', paddingLeft: '1.5rem' }}>% from Terminal Value</td>
                  <td style={{ padding: '0.5rem', textAlign: 'right' }}>{((pvTerminal / enterpriseValue) * 100).toFixed(1)}%</td>
                </tr>
              </tbody>
            </table>
          </div>
          
          <div>
            <div style={{
              background: 'linear-gradient(135deg, #3b82f6 0%, #1e40af 100%)',
              borderRadius: '12px',
              padding: '2rem',
              color: 'white',
              textAlign: 'center',
            }}>
              <div style={{ fontSize: '0.875rem', opacity: 0.9, marginBottom: '0.5rem' }}>
                Implied Share Price (DCF)
              </div>
              <div style={{ fontSize: '3rem', fontWeight: '700', marginBottom: '0.5rem' }}>
                ${impliedPrice.toFixed(2)}
              </div>
              <div style={{ fontSize: '0.875rem', opacity: 0.9, marginBottom: '1rem' }}>
                Current: ${currentPrice.toFixed(2)}
              </div>
              <div style={{
                padding: '0.75rem 1.5rem',
                background: upside > 0 ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)',
                borderRadius: '8px',
                fontSize: '1.25rem',
                fontWeight: '700',
              }}>
                {upside > 0 ? '+' : ''}{upside.toFixed(1)}% {upside > 0 ? 'Upside' : 'Downside'}
              </div>
            </div>
          </div>
        </div>
      </Card>
      
      {/* Info Modals for Detailed DCF */}
      {showEBITDAInfo && (
        <InfoModal title="EBITDA - Earnings Before Interest, Taxes, Depreciation & Amortization" onClose={() => setShowEBITDAInfo(false)}>
          <p style={{ marginBottom: '1rem', color: '#475569', lineHeight: '1.6' }}>
            A measure of a company's operating performance before accounting for financing and accounting decisions.
          </p>
          <div style={{ marginBottom: '1rem', padding: '1rem', background: '#f8fafc', borderRadius: '8px', fontFamily: 'monospace', fontSize: '0.875rem' }}>
            <strong>Formula:</strong><br/>
            EBITDA = Revenue - Cost of Goods Sold - Operating Expenses
          </div>
          <div style={{ marginBottom: '1rem' }}>
            <strong>Why exclude D&A, Interest & Taxes?</strong>
            <ul style={{ marginTop: '0.5rem', paddingLeft: '1.5rem', lineHeight: '1.8', color: '#64748b', fontSize: '0.875rem' }}>
              <li><strong>D&A:</strong> Non-cash expense, varies by accounting methods</li>
              <li><strong>Interest:</strong> Depends on capital structure (debt vs equity)</li>
              <li><strong>Taxes:</strong> Affected by jurisdiction and tax strategies</li>
            </ul>
          </div>
          <div style={{ padding: '1rem', background: '#eff6ff', borderRadius: '8px', border: '1px solid #bfdbfe' }}>
            <strong style={{ color: '#1e40af' }}>Use Cases:</strong>
            <div style={{ marginTop: '0.5rem', fontSize: '0.875rem', color: '#1e3a8a' }}>
              • Compare companies with different capital structures<br/>
              • Measure operating performance across industries<br/>
              • Common metric in M&A and valuations<br/>
              • EBITDA margin shows operational efficiency
            </div>
          </div>
        </InfoModal>
      )}
      
      {showNOPATInfo && (
        <InfoModal title="NOPAT - Net Operating Profit After Tax" onClose={() => setShowNOPATInfo(false)}>
          <p style={{ marginBottom: '1rem', color: '#475569', lineHeight: '1.6' }}>
            The profit a company would generate if it had no debt, representing pure operational performance after taxes.
          </p>
          <div style={{ marginBottom: '1rem', padding: '1rem', background: '#f8fafc', borderRadius: '8px', fontFamily: 'monospace', fontSize: '0.875rem' }}>
            <strong>Formula:</strong><br/>
            NOPAT = EBIT × (1 - Tax Rate)
          </div>
          <div style={{ marginBottom: '1rem' }}>
            <strong>Key Points:</strong>
            <ul style={{ marginTop: '0.5rem', paddingLeft: '1.5rem', lineHeight: '1.8', color: '#64748b', fontSize: '0.875rem' }}>
              <li>Excludes benefits/costs of debt (interest)</li>
              <li>Shows what owners would earn if company was all-equity financed</li>
              <li>Starting point for calculating Free Cash Flow</li>
              <li>Used in EVA (Economic Value Added) calculations</li>
            </ul>
          </div>
          <div style={{ padding: '1rem', background: '#fef3c7', borderRadius: '8px', border: '1px solid #fcd34d' }}>
            <strong style={{ color: '#78350f' }}>Why use it in DCF?</strong>
            <div style={{ marginTop: '0.5rem', fontSize: '0.875rem', color: '#78350f' }}>
              DCF values the entire enterprise (debt + equity), so we need operating profit that excludes financing decisions. NOPAT gives us that.
            </div>
          </div>
        </InfoModal>
      )}
      
      {showFCFInfo && (
        <InfoModal title="Unlevered Free Cash Flow (UFCF)" onClose={() => setShowFCFInfo(false)}>
          <p style={{ marginBottom: '1rem', color: '#475569', lineHeight: '1.6' }}>
            Cash generated by operations available to all investors (debt and equity holders), before considering debt payments.
          </p>
          <div style={{ marginBottom: '1rem', padding: '1rem', background: '#f8fafc', borderRadius: '8px', fontFamily: 'monospace', fontSize: '0.875rem' }}>
            <strong>Formula:</strong><br/>
            UFCF = NOPAT + D&A - CapEx - Δ NWC<br/><br/>
            Where:<br/>
            • D&A = Depreciation & Amortization (add back non-cash expense)<br/>
            • CapEx = Capital Expenditures (cash spent on assets)<br/>
            • Δ NWC = Change in Net Working Capital
          </div>
          <div style={{ marginBottom: '1rem' }}>
            <strong>Components Explained:</strong>
            <ul style={{ marginTop: '0.5rem', paddingLeft: '1.5rem', lineHeight: '1.8', color: '#64748b', fontSize: '0.875rem' }}>
              <li><strong>Add back D&A:</strong> It reduced NOPAT but didn't use cash</li>
              <li><strong>Subtract CapEx:</strong> Real cash spent on equipment, buildings, etc.</li>
              <li><strong>Subtract Δ NWC:</strong> Cash tied up in inventory, receivables, payables</li>
            </ul>
          </div>
          <div style={{ padding: '1rem', background: '#eff6ff', borderRadius: '8px', border: '1px solid #bfdbfe' }}>
            <strong style={{ color: '#1e40af' }}>Why "Unlevered"?</strong>
            <div style={{ marginTop: '0.5rem', fontSize: '0.875rem', color: '#1e3a8a' }}>
              "Unlevered" means before debt. This FCF is available to both debt and equity holders, making it perfect for enterprise valuation.
            </div>
          </div>
        </InfoModal>
      )}
    </>
  );
}

// ==================== DCF TAB ====================
function DCFTab({ stockData, dcfInputs, setDcfInputs, dcfValue, stockTicker, setStockTicker, handleStockSearch, loading, error, dcfMode, setDcfMode }) {
  const [showWACCInfo, setShowWACCInfo] = useState(false);
  const [showTerminalGrowthInfo, setShowTerminalGrowthInfo] = useState(false);
  const [showEBITDAInfo, setShowEBITDAInfo] = useState(false);
  const [showNOPATInfo, setShowNOPATInfo] = useState(false);
  const [showTerminalValueInfo, setShowTerminalValueInfo] = useState(false);
  const [showFCFInfo, setShowFCFInfo] = useState(false);
  
  const updateDCFInput = (field, value) => {
    setDcfInputs(prev => ({ ...prev, [field]: parseFloat(value) || 0 }));
  };
  
  const updateRevenueGrowth = (index, value) => {
    setDcfInputs(prev => {
      const newGrowth = [...prev.revenueGrowth];
      newGrowth[index] = parseFloat(value) || 0;
      return { ...prev, revenueGrowth: newGrowth };
    });
  };

  const impliedPricePerShare = stockData && stockData.quote?.sharesOutstanding 
    ? (dcfValue / stockData.quote.sharesOutstanding).toFixed(2)
    : 0;

  const currentPrice = stockData?.quote?.price || 0;
  const upside = currentPrice ? (((impliedPricePerShare - currentPrice) / currentPrice) * 100).toFixed(1) : 0;

  return (
    <div>
      <Card style={{ marginBottom: '2rem' }}>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginBottom: '1.5rem' }}>
          <div style={{ flex: 1, position: 'relative' }}>
            <Search size={20} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
            <input
              type="text"
              placeholder="Enter stock ticker for DCF analysis"
              value={stockTicker}
              onChange={(e) => setStockTicker(e.target.value.toUpperCase())}
              onKeyPress={(e) => e.key === 'Enter' && handleStockSearch()}
              style={{
                width: '100%',
                padding: '0.875rem 1rem 0.875rem 3rem',
                border: '2px solid #e2e8f0',
                borderRadius: '8px',
                fontSize: '1rem',
                outline: 'none',
              }}
            />
          </div>
          <button
            onClick={handleStockSearch}
            disabled={loading}
            style={{
              background: '#3b82f6',
              color: 'white',
              border: 'none',
              padding: '0.875rem 2rem',
              borderRadius: '8px',
              fontSize: '1rem',
              fontWeight: '600',
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.6 : 1,
            }}
          >
            {loading ? 'Loading...' : 'Load Data'}
          </button>
        </div>
        
        {/* Mode Toggle */}
        {stockData && stockData.quote && (
          <div style={{
            display: 'inline-flex',
            background: '#f1f5f9',
            borderRadius: '8px',
            padding: '0.25rem',
          }}>
            <button
              onClick={() => setDcfMode('summary')}
              style={{
                padding: '0.5rem 1.5rem',
                background: dcfMode === 'summary' ? 'white' : 'transparent',
                border: 'none',
                borderRadius: '6px',
                fontWeight: '600',
                fontSize: '0.875rem',
                cursor: 'pointer',
                color: dcfMode === 'summary' ? '#0f172a' : '#64748b',
                boxShadow: dcfMode === 'summary' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              }}
            >
              Summary
            </button>
            <button
              onClick={() => setDcfMode('detailed')}
              style={{
                padding: '0.5rem 1.5rem',
                background: dcfMode === 'detailed' ? 'white' : 'transparent',
                border: 'none',
                borderRadius: '6px',
                fontWeight: '600',
                fontSize: '0.875rem',
                cursor: 'pointer',
                color: dcfMode === 'detailed' ? '#0f172a' : '#64748b',
                boxShadow: dcfMode === 'detailed' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              }}
            >
              DCF Model
            </button>
          </div>
        )}
        
        {error && <p style={{ marginTop: '1rem', color: '#ef4444', fontSize: '0.9rem' }}>{error}</p>}
      </Card>

      {stockData && stockData.quote && stockData.cashFlow && stockData.cashFlow[0] && (
        <>
          {dcfMode === 'summary' ? (
            // SUMMARY VIEW (Current simple DCF)
            <>
          <Card style={{ marginBottom: '2rem' }}>
            <h2 style={{ fontSize: '1.75rem', fontWeight: '700', color: '#0f172a', margin: '0 0 0.5rem' }}>
              DCF Valuation: {stockData.profile?.companyName || stockTicker}
            </h2>
            <div style={{ display: 'flex', gap: '2rem', color: '#64748b', fontSize: '0.9rem' }}>
              <span>Current Price: <strong style={{ color: '#0f172a' }}>${currentPrice.toFixed(2)}</strong></span>
              <span>Free Cash Flow (TTM): <strong style={{ color: '#0f172a' }}>${(stockData.cashFlow[0]?.freeCashFlow / 1e9).toFixed(2)}B</strong></span>
            </div>
          </Card>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem', marginBottom: '2rem' }}>
            <Card title="DCF Assumptions (Editable)">
              <InputField
                label="WACC (%)"
                value={dcfInputs.wacc}
                onChange={(e) => updateDCFInput('wacc', e.target.value)}
                help="Weighted Average Cost of Capital"
                onInfoClick={() => setShowWACCInfo(!showWACCInfo)}
              />
              <InputField
                label="Terminal Growth Rate (%)"
                value={dcfInputs.terminalGrowth}
                onChange={(e) => updateDCFInput('terminalGrowth', e.target.value)}
                help="Perpetual growth rate"
                onInfoClick={() => setShowTerminalGrowthInfo(!showTerminalGrowthInfo)}
              />
              <InputField
                label="FCF Growth Rate (%)"
                value={dcfInputs.fcfGrowth}
                onChange={(e) => updateDCFInput('fcfGrowth', e.target.value)}
                help="Free Cash Flow growth for projection period"
              />
            </Card>

            <Card title="Valuation Results">
              <div style={{ padding: '1rem 0' }}>
                <div style={{ marginBottom: '2rem' }}>
                  <div style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '0.5rem' }}>Enterprise Value (DCF)</div>
                  <div style={{ fontSize: '2rem', fontWeight: '700', color: '#3b82f6' }}>
                    ${(dcfValue / 1e9).toFixed(2)}B
                  </div>
                </div>

                <div style={{ marginBottom: '2rem' }}>
                  <div style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '0.5rem' }}>Implied Price Per Share</div>
                  <div style={{ fontSize: '2rem', fontWeight: '700', color: '#8b5cf6' }}>
                    ${impliedPricePerShare}
                  </div>
                </div>

                <div style={{ 
                  background: upside > 0 ? '#d1fae5' : '#fee2e2',
                  padding: '1rem',
                  borderRadius: '8px',
                  textAlign: 'center',
                }}>
                  <div style={{ fontSize: '0.85rem', color: upside > 0 ? '#065f46' : '#991b1b', marginBottom: '0.25rem' }}>
                    Upside/Downside
                  </div>
                  <div style={{ fontSize: '1.5rem', fontWeight: '700', color: upside > 0 ? '#059669' : '#dc2626' }}>
                    {upside > 0 ? '+' : ''}{upside}%
                  </div>
                </div>
              </div>
            </Card>
          </div>
            </>
          ) : (
            // DETAILED DCF MODEL VIEW
            <DetailedDCFView 
              stockData={stockData}
              stockTicker={stockTicker}
              dcfInputs={dcfInputs}
              updateDCFInput={updateDCFInput}
              updateRevenueGrowth={updateRevenueGrowth}
              currentPrice={currentPrice}
              showEBITDAInfo={showEBITDAInfo}
              setShowEBITDAInfo={setShowEBITDAInfo}
              showNOPATInfo={showNOPATInfo}
              setShowNOPATInfo={setShowNOPATInfo}
              showTerminalValueInfo={showTerminalValueInfo}
              setShowTerminalValueInfo={setShowTerminalValueInfo}
              showFCFInfo={showFCFInfo}
              setShowFCFInfo={setShowFCFInfo}
            />
          )}
        </>
      )}

      {/* Info Modals */}
      {showWACCInfo && (
        <InfoModal
          title="WACC - Weighted Average Cost of Capital"
          onClose={() => setShowWACCInfo(false)}
        >
          <p style={{ marginBottom: '1rem', color: '#475569', lineHeight: '1.6' }}>
            The average rate a company expects to pay to finance its assets, weighted by debt and equity.
          </p>
          
          <div style={{ marginBottom: '1rem', padding: '1rem', background: '#f8fafc', borderRadius: '8px', fontFamily: 'monospace', fontSize: '0.875rem' }}>
            <strong>Formula:</strong><br/>
            WACC = (E/V × Re) + (D/V × Rd × (1-Tc))
          </div>
          
          <div style={{ marginBottom: '1rem' }}>
            <strong>Where:</strong>
            <ul style={{ marginTop: '0.5rem', paddingLeft: '1.5rem', lineHeight: '1.8', color: '#64748b' }}>
              <li>E/V = Equity weight</li>
              <li>Re = Cost of equity</li>
              <li>D/V = Debt weight</li>
              <li>Rd = Cost of debt</li>
              <li>Tc = Corporate tax rate</li>
            </ul>
          </div>
          
          <div style={{ padding: '1rem', background: '#eff6ff', borderRadius: '8px', border: '1px solid #bfdbfe', marginBottom: '1rem' }}>
            <strong style={{ color: '#1e40af' }}>Typical Ranges:</strong>
            <div style={{ marginTop: '0.5rem', fontSize: '0.875rem', color: '#1e3a8a' }}>
              • Mature companies: 7-10%<br/>
              • High-growth tech: 10-15%<br/>
              • Startups: 15-25%
            </div>
          </div>
          
          <div style={{ padding: '1rem', background: '#fef3c7', borderRadius: '8px', border: '1px solid #fcd34d' }}>
            <strong style={{ color: '#78350f' }}>Why it matters:</strong>
            <div style={{ marginTop: '0.5rem', fontSize: '0.875rem', color: '#78350f' }}>
              Used as the discount rate in DCF models. Higher WACC = lower valuation.
            </div>
          </div>
        </InfoModal>
      )}

      {showTerminalGrowthInfo && (
        <InfoModal
          title="Terminal Growth Rate"
          onClose={() => setShowTerminalGrowthInfo(false)}
        >
          <p style={{ marginBottom: '1rem', color: '#475569', lineHeight: '1.6' }}>
            The perpetual growth rate assumed for a company's cash flows beyond the explicit forecast period.
          </p>
          
          <div style={{ padding: '1rem', background: '#fef2f2', borderRadius: '8px', border: '1px solid #fecaca', marginBottom: '1rem' }}>
            <strong style={{ color: '#991b1b' }}>Key Principle:</strong>
            <div style={{ marginTop: '0.5rem', fontSize: '0.875rem', color: '#991b1b' }}>
              Should NOT exceed long-term GDP growth (typically 2-3%). Using 4%+ is unrealistic.
            </div>
          </div>
          
          <div style={{ marginBottom: '1rem' }}>
            <strong>Common Assumptions:</strong>
            <ul style={{ marginTop: '0.5rem', paddingLeft: '1.5rem', lineHeight: '1.8', color: '#64748b' }}>
              <li>Mature companies: 2-3%</li>
              <li>GDP growth rate: 2-3%</li>
              <li>Declining industries: 0-1%</li>
            </ul>
          </div>
          
          <div style={{ padding: '1rem', background: '#fef3c7', borderRadius: '8px', border: '1px solid #fcd34d' }}>
            <strong style={{ color: '#78350f' }}>Why it matters:</strong>
            <div style={{ marginTop: '0.5rem', fontSize: '0.875rem', color: '#78350f' }}>
              Small changes have HUGE impact since terminal value is often 60-80% of total DCF value.
            </div>
          </div>
        </InfoModal>
      )}

      {!stockData && !loading && (
        <div style={{ textAlign: 'center', padding: '4rem 2rem', color: '#94a3b8' }}>
          <Calculator size={64} style={{ margin: '0 auto 1rem', opacity: 0.3 }} />
          <h3 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>No Company Loaded</h3>
          <p>Enter a ticker symbol above to perform DCF valuation analysis</p>
        </div>
      )}
    </div>
  );
}

// ==================== RETIREMENT SPENDING TAB ====================
function RetirementSpendingTab({ portfolioData }) {
  const [mode, setMode] = useState('spending'); // 'spending' or 'annuity'
  const [inputs, setInputs] = useState({
    portfolioValue: 1000000,
    retirementAge: 65,
    lifeExpectancy: 90,
    annualInflation: 2.5,
    expectedReturn: 6.0,
    withdrawalRate: 4.0,
    age: 65,
    gender: 'male',
    annuityRate: 5.5, // Current annuity rates
  });
  
  // Info bubble state
  const [showTrinityInfo, setShowTrinityInfo] = useState(false);
  const [showWithdrawalInfo, setShowWithdrawalInfo] = useState(false);
  const [showGuytonInfo, setShowGuytonInfo] = useState(false);
  const [showAnnuityInfo, setShowAnnuityInfo] = useState(false);

  const updateInput = (field, value) => {
    setInputs(prev => ({ ...prev, [field]: value }));
  };
  
  const usePortfolioData = () => {
    if (portfolioData) {
      setInputs(prev => ({
        ...prev,
        portfolioValue: portfolioData.totalValue,
        expectedReturn: portfolioData.expectedReturn,
      }));
    }
  };

  // Calculate sustainable spending using 4% rule variants
  const calculateSustainableSpending = () => {
    const { portfolioValue, withdrawalRate, expectedReturn, annualInflation } = inputs;
    const yearsInRetirement = inputs.lifeExpectancy - inputs.age;
    
    // Simple withdrawal
    const simpleAnnualSpending = portfolioValue * (withdrawalRate / 100);
    const simpleMonthlySpending = simpleAnnualSpending / 12;
    
    // Dynamic withdrawal (Guyton-Klinger)
    const dynamicAnnualSpending = portfolioValue * 0.05; // More aggressive initial
    const dynamicMonthlySpending = dynamicAnnualSpending / 12;
    
    // Inflation-adjusted spending projection
    const realReturn = expectedReturn - annualInflation;
    
    // Monte Carlo success probability (simplified)
    const successRate = calculateSuccessRate(portfolioValue, simpleAnnualSpending, yearsInRetirement, expectedReturn, annualInflation);
    
    return {
      simpleAnnual: simpleAnnualSpending,
      simpleMonthly: simpleMonthlySpending,
      dynamicAnnual: dynamicAnnualSpending,
      dynamicMonthly: dynamicMonthlySpending,
      successRate,
      yearsInRetirement,
      realReturn,
    };
  };

  // Simplified success rate calculation
  const calculateSuccessRate = (portfolio, annualSpending, years, returnRate, inflation) => {
    const realReturn = (returnRate - inflation) / 100;
    const withdrawalRate = annualSpending / portfolio;
    
    // Trinity Study approximations
    if (withdrawalRate <= 0.03) return 100;
    if (withdrawalRate <= 0.04 && years <= 30) return 95;
    if (withdrawalRate <= 0.05 && years <= 30) return 85;
    if (withdrawalRate <= 0.06 && years <= 30) return 65;
    return 50;
  };

  // Calculate annuity payout
  const calculateAnnuityPayout = () => {
    const { portfolioValue, annuityRate, age, lifeExpectancy } = inputs;
    const yearsOfPayouts = lifeExpectancy - age;
    
    // Simple annuity calculation: Annuity rate applied to principal
    const annualPayout = portfolioValue * (annuityRate / 100);
    const monthlyPayout = annualPayout / 12;
    const totalPayouts = annualPayout * yearsOfPayouts;
    
    // Internal rate of return calculation
    const totalReceived = totalPayouts;
    const netGain = totalReceived - portfolioValue;
    const roi = (netGain / portfolioValue) * 100;
    
    return {
      annualPayout,
      monthlyPayout,
      totalPayouts,
      roi,
      yearsOfPayouts,
    };
  };

  const spendingResults = calculateSustainableSpending();
  const annuityResults = calculateAnnuityPayout();

  // Project spending over time
  const projections = [];
  for (let year = 0; year <= 30; year++) {
    const currentAge = inputs.age + year;
    if (currentAge > inputs.lifeExpectancy) break;
    
    let portfolioBalance = inputs.portfolioValue;
    for (let y = 0; y < year; y++) {
      const withdrawal = spendingResults.simpleAnnual * Math.pow(1 + inputs.annualInflation / 100, y);
      portfolioBalance = portfolioBalance * (1 + inputs.expectedReturn / 100) - withdrawal;
    }
    
    projections.push({
      year: new Date().getFullYear() + year,
      age: currentAge,
      balance: Math.max(0, portfolioBalance),
      withdrawal: spendingResults.simpleAnnual * Math.pow(1 + inputs.annualInflation / 100, year),
    });
  }

  return (
    <div>
      <Card title="Retirement Income Planning" subtitle="Calculate sustainable spending or compare annuity options">
        {/* Use Portfolio Data Button */}
        {portfolioData && (
          <div style={{
            marginBottom: '1.5rem',
            padding: '1rem',
            background: '#f0f9ff',
            border: '2px solid #bae6fd',
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <div>
              <div style={{ fontWeight: '600', color: '#0c4a6e', marginBottom: '0.25rem' }}>
                📊 Portfolio Data Available
              </div>
              <div style={{ fontSize: '0.875rem', color: '#075985' }}>
                Auto-fill with your portfolio: ${portfolioData.totalValue.toLocaleString()} @ {portfolioData.expectedReturn.toFixed(2)}% return
              </div>
            </div>
            <button
              onClick={usePortfolioData}
              style={{
                padding: '0.75rem 1.5rem',
                background: '#0ea5e9',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                fontSize: '0.875rem',
                fontWeight: '600',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                transition: 'all 0.2s',
              }}
              onMouseEnter={(e) => e.target.style.background = '#0284c7'}
              onMouseLeave={(e) => e.target.style.background = '#0ea5e9'}
            >
              Use Portfolio Data
            </button>
          </div>
        )}
        
        {/* Mode Selector */}
        <div style={{ marginBottom: '2rem' }}>
          <div style={{
            display: 'inline-flex',
            background: '#f1f5f9',
            borderRadius: '8px',
            padding: '0.25rem',
          }}>
            <button
              onClick={() => setMode('spending')}
              style={{
                padding: '0.5rem 1rem',
                background: mode === 'spending' ? 'white' : 'transparent',
                border: 'none',
                borderRadius: '6px',
                fontWeight: '600',
                fontSize: '0.875rem',
                cursor: 'pointer',
                color: mode === 'spending' ? '#3b82f6' : '#64748b',
                boxShadow: mode === 'spending' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
              }}
            >
              Sustainable Spending
            </button>
            <button
              onClick={() => setMode('annuity')}
              style={{
                padding: '0.5rem 1rem',
                background: mode === 'annuity' ? 'white' : 'transparent',
                border: 'none',
                borderRadius: '6px',
                fontWeight: '600',
                fontSize: '0.875rem',
                cursor: 'pointer',
                color: mode === 'annuity' ? '#3b82f6' : '#64748b',
                boxShadow: mode === 'annuity' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
              }}
            >
              Annuity Calculator
            </button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
          {/* Inputs */}
          <div>
            <h4 style={{ fontSize: '1rem', fontWeight: '600', color: '#0f172a', marginBottom: '1.5rem' }}>
              Portfolio & Personal Info
            </h4>
            <InputField
              label="Current Portfolio Value"
              value={inputs.portfolioValue}
              onChange={(e) => updateInput('portfolioValue', parseFloat(e.target.value) || 0)}
              prefix="$"
            />
            
            <InputField
              label="Current Age"
              value={inputs.age}
              onChange={(e) => updateInput('age', parseFloat(e.target.value) || 0)}
            />
            
            <InputField
              label="Life Expectancy"
              value={inputs.lifeExpectancy}
              onChange={(e) => updateInput('lifeExpectancy', parseFloat(e.target.value) || 0)}
            />
            
            {mode === 'spending' ? (
              <>
                <h4 style={{ fontSize: '1rem', fontWeight: '600', color: '#0f172a', marginTop: '2rem', marginBottom: '1.5rem' }}>
                  Assumptions
                </h4>
                <InputField
                  label="Annual Withdrawal Rate (%)"
                  value={inputs.withdrawalRate}
                  onChange={(e) => updateInput('withdrawalRate', parseFloat(e.target.value) || 0)}
                  help="Traditional 4% rule, or customize"
                  suffix="%"
                  onInfoClick={() => setShowWithdrawalInfo(!showWithdrawalInfo)}
                />
                
                <InputField
                  label="Expected Portfolio Return (%)"
                  value={inputs.expectedReturn}
                  onChange={(e) => updateInput('expectedReturn', parseFloat(e.target.value) || 0)}
                  suffix="%"
                />
                
                <InputField
                  label="Annual Inflation Rate (%)"
                  value={inputs.annualInflation}
                  onChange={(e) => updateInput('annualInflation', parseFloat(e.target.value) || 0)}
                  suffix="%"
                />
              </>
            ) : (
              <>
                <h4 style={{ fontSize: '1rem', fontWeight: '600', color: '#0f172a', marginTop: '2rem', marginBottom: '1.5rem' }}>
                  Annuity Details
                </h4>
                <select
                  value={inputs.gender}
                  onChange={(e) => updateInput('gender', e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    border: '2px solid #e2e8f0',
                    borderRadius: '8px',
                    fontSize: '1rem',
                    background: '#fefce8',
                    fontWeight: '600',
                    color: '#0f172a',
                    marginBottom: '1.25rem',
                  }}
                >
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="joint">Joint (Couple)</option>
                </select>
                
                <InputField
                  label="Annuity Rate (%)"
                  value={inputs.annuityRate}
                  onChange={(e) => updateInput('annuityRate', parseFloat(e.target.value) || 0)}
                  help="Current market rates: 5-7% depending on age"
                  suffix="%"
                />
              </>
            )}
          </div>

          {/* Results */}
          <div>
            <h4 style={{ fontSize: '1rem', fontWeight: '600', color: '#0f172a', marginBottom: '1.5rem' }}>
              {mode === 'spending' ? 'Sustainable Spending Analysis' : 'Annuity Payout Analysis'}
            </h4>
            
            {mode === 'spending' ? (
              <>
                <div style={{
                  background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                  borderRadius: '12px',
                  padding: '2rem',
                  color: 'white',
                  marginBottom: '2rem',
                }}>
                  <div style={{ fontSize: '0.875rem', opacity: 0.9, marginBottom: '0.5rem' }}>
                    Safe Annual Spending ({inputs.withdrawalRate}% Rule)
                  </div>
                  <div style={{ fontSize: '3rem', fontWeight: '700', marginBottom: '0.25rem' }}>
                    ${spendingResults.simpleAnnual.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                  </div>
                  <div style={{ fontSize: '1.25rem', opacity: 0.9 }}>
                    ${spendingResults.simpleMonthly.toLocaleString('en-US', { maximumFractionDigits: 0 })}/month
                  </div>
                </div>

                <div style={{ display: 'grid', gap: '1rem', marginBottom: '2rem' }}>
                  <div style={{
                    padding: '1.5rem',
                    background: spendingResults.successRate >= 90 ? '#f0fdf4' : '#fef3c7',
                    borderRadius: '8px',
                    border: `1px solid ${spendingResults.successRate >= 90 ? '#bbf7d0' : '#fcd34d'}`,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', color: spendingResults.successRate >= 90 ? '#166534' : '#78350f', marginBottom: '0.5rem' }}>
                      Success Rate (Trinity Study)
                      <button
                        onClick={() => setShowTrinityInfo(!showTrinityInfo)}
                        style={{
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          padding: 0,
                          display: 'flex',
                          alignItems: 'center',
                          color: '#3b82f6',
                        }}
                      >
                        <Info size={16} />
                      </button>
                    </div>
                    <div style={{ fontSize: '2rem', fontWeight: '700', color: spendingResults.successRate >= 90 ? '#15803d' : '#92400e' }}>
                      {spendingResults.successRate}%
                    </div>
                    <div style={{ fontSize: '0.75rem', marginTop: '0.5rem', color: spendingResults.successRate >= 90 ? '#166534' : '#78350f' }}>
                      Over {spendingResults.yearsInRetirement} years
                    </div>
                  </div>

                  <div style={{
                    padding: '1.5rem',
                    background: '#eff6ff',
                    borderRadius: '8px',
                    border: '1px solid #bfdbfe',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', color: '#1e40af', marginBottom: '0.5rem' }}>
                      Dynamic Strategy (5% Initial)
                      <button
                        onClick={() => setShowGuytonInfo(!showGuytonInfo)}
                        style={{
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          padding: 0,
                          display: 'flex',
                          alignItems: 'center',
                          color: '#3b82f6',
                        }}
                      >
                        <Info size={16} />
                      </button>
                    </div>
                    <div style={{ fontSize: '1.5rem', fontWeight: '700', color: '#1e40af' }}>
                      ${spendingResults.dynamicAnnual.toLocaleString('en-US', { maximumFractionDigits: 0 })}/year
                    </div>
                    <div style={{ fontSize: '0.85rem', marginTop: '0.5rem', color: '#1e40af' }}>
                      ${spendingResults.dynamicMonthly.toLocaleString('en-US', { maximumFractionDigits: 0 })}/month
                    </div>
                  </div>
                </div>

                <div style={{
                  padding: '1.5rem',
                  background: '#fef3c7',
                  borderRadius: '8px',
                  border: '1px solid #fcd34d',
                }}>
                  <div style={{ fontSize: '0.875rem', color: '#78350f', lineHeight: '1.6' }}>
                    <strong>Strategy Comparison:</strong>
                    <ul style={{ marginTop: '0.5rem', paddingLeft: '1.5rem', marginBottom: 0 }}>
                      <li><strong>Conservative (4%):</strong> Highest safety, lowest spending</li>
                      <li><strong>Dynamic (5%):</strong> Adjust based on portfolio performance</li>
                      <li><strong>Real Return:</strong> {spendingResults.realReturn.toFixed(2)}% after inflation</li>
                    </ul>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div style={{
                  background: 'linear-gradient(135deg, #3b82f6 0%, #1e40af 100%)',
                  borderRadius: '12px',
                  padding: '2rem',
                  color: 'white',
                  marginBottom: '2rem',
                }}>
                  <div style={{ fontSize: '0.875rem', opacity: 0.9, marginBottom: '0.5rem' }}>
                    Guaranteed Annual Income
                  </div>
                  <div style={{ fontSize: '3rem', fontWeight: '700', marginBottom: '0.25rem' }}>
                    ${annuityResults.annualPayout.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                  </div>
                  <div style={{ fontSize: '1.25rem', opacity: 0.9 }}>
                    ${annuityResults.monthlyPayout.toLocaleString('en-US', { maximumFractionDigits: 0 })}/month for life
                  </div>
                </div>

                <div style={{ display: 'grid', gap: '1rem' }}>
                  <div style={{
                    padding: '1.5rem',
                    background: '#f8fafc',
                    borderRadius: '8px',
                    border: '1px solid #e2e8f0',
                  }}>
                    <div style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '0.5rem' }}>
                      Total Lifetime Payouts
                    </div>
                    <div style={{ fontSize: '1.5rem', fontWeight: '700', color: '#0f172a' }}>
                      ${annuityResults.totalPayouts.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                    </div>
                    <div style={{ fontSize: '0.75rem', marginTop: '0.5rem', color: '#64748b' }}>
                      Over {annuityResults.yearsOfPayouts} years (to age {inputs.lifeExpectancy})
                    </div>
                  </div>

                  <div style={{
                    padding: '1.5rem',
                    background: annuityResults.roi > 0 ? '#f0fdf4' : '#fee2e2',
                    borderRadius: '8px',
                    border: `1px solid ${annuityResults.roi > 0 ? '#bbf7d0' : '#fecaca'}`,
                  }}>
                    <div style={{ fontSize: '0.85rem', color: annuityResults.roi > 0 ? '#166534' : '#991b1b', marginBottom: '0.5rem' }}>
                      Net Return vs Investment
                    </div>
                    <div style={{ fontSize: '1.5rem', fontWeight: '700', color: annuityResults.roi > 0 ? '#15803d' : '#dc2626' }}>
                      {annuityResults.roi > 0 ? '+' : ''}{annuityResults.roi.toFixed(1)}%
                    </div>
                  </div>

                  <div style={{
                    padding: '1.5rem',
                    background: '#eff6ff',
                    borderRadius: '8px',
                    border: '1px solid #bfdbfe',
                  }}>
                    <div style={{ fontSize: '0.875rem', color: '#1e40af', lineHeight: '1.6' }}>
                      <strong>Annuity Benefits:</strong>
                      <ul style={{ marginTop: '0.5rem', paddingLeft: '1.5rem', marginBottom: 0 }}>
                        <li>Guaranteed income for life</li>
                        <li>No market risk</li>
                        <li>Predictable cash flow</li>
                        <li>Inflation protection available (COLA)</li>
                      </ul>
                    </div>
                  </div>

                  <div style={{
                    padding: '1.5rem',
                    background: '#fef3c7',
                    borderRadius: '8px',
                    border: '1px solid #fcd34d',
                  }}>
                    <div style={{ fontSize: '0.875rem', color: '#78350f', lineHeight: '1.6' }}>
                      <strong>Annuity Drawbacks:</strong>
                      <ul style={{ marginTop: '0.5rem', paddingLeft: '1.5rem', marginBottom: 0 }}>
                        <li>No inheritance (principal lost)</li>
                        <li>Illiquid - can't access principal</li>
                        <li>Fixed income (without COLA)</li>
                        <li>Longevity risk if die early</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </Card>

      {mode === 'spending' && (
        <Card title="Portfolio Balance Projection" style={{ marginTop: '2rem' }}>
          <ResponsiveContainer width="100%" height={400}>
            <AreaChart data={projections}>
              <defs>
                <linearGradient id="balanceGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="year" stroke="#64748b" style={{ fontSize: '0.85rem' }} />
              <YAxis stroke="#64748b" tickFormatter={(val) => `$${(val/1000).toFixed(0)}K`} style={{ fontSize: '0.85rem' }} />
              <Tooltip
                contentStyle={{
                  background: 'white',
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px',
                }}
                formatter={(value, name) => {
                  if (name === 'balance') return [`$${value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`, 'Portfolio Balance'];
                  if (name === 'withdrawal') return [`$${value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`, 'Annual Withdrawal'];
                  return [value, name];
                }}
              />
              <Area type="monotone" dataKey="balance" stroke="#10b981" fill="url(#balanceGradient)" strokeWidth={3} name="balance" />
            </AreaChart>
          </ResponsiveContainer>
          
          <div style={{
            marginTop: '1.5rem',
            padding: '1rem',
            background: '#eff6ff',
            borderRadius: '8px',
            border: '1px solid #bfdbfe',
          }}>
            <div style={{ fontSize: '0.875rem', color: '#1e40af', lineHeight: '1.6' }}>
              <strong>Projection Notes:</strong> This chart shows your portfolio balance over time with inflation-adjusted withdrawals. 
              If the line reaches zero before your life expectancy, consider reducing spending or increasing expected returns.
            </div>
          </div>
        </Card>
      )}

      {/* Info Modals */}
      {showTrinityInfo && (
        <InfoModal title="Trinity Study - Safe Withdrawal Rates" onClose={() => setShowTrinityInfo(false)}>
          <p style={{ marginBottom: '1rem', color: '#475569', lineHeight: '1.6' }}>
            A landmark 1998 study analyzing safe withdrawal rates from retirement portfolios.
          </p>
          <div style={{ marginBottom: '1rem', padding: '1rem', background: '#eff6ff', borderRadius: '8px', border: '1px solid #bfdbfe' }}>
            <strong style={{ color: '#1e40af' }}>The 4% Rule:</strong>
            <div style={{ marginTop: '0.5rem', fontSize: '0.875rem', color: '#1e3a8a' }}>
              Withdraw 4% of initial portfolio value (adjusted for inflation) annually with a 95% success rate over 30 years with 50/50 stocks/bonds.
            </div>
          </div>
          <div style={{ marginBottom: '1rem' }}>
            <strong>Success Rates (30-year retirement):</strong>
            <ul style={{ marginTop: '0.5rem', paddingLeft: '1.5rem', lineHeight: '1.8', color: '#64748b' }}>
              <li>3% withdrawal: ~100% success</li>
              <li>4% withdrawal: ~95% success</li>
              <li>5% withdrawal: ~85% success</li>
              <li>6% withdrawal: ~65% success</li>
            </ul>
          </div>
          <div style={{ padding: '1rem', background: '#fef3c7', borderRadius: '8px', border: '1px solid #fcd34d' }}>
            <strong style={{ color: '#78350f' }}>Important Notes:</strong>
            <ul style={{ marginTop: '0.5rem', paddingLeft: '1.5rem', fontSize: '0.875rem', color: '#78350f' }}>
              <li>Based on historical US data (1926-1995)</li>
              <li>Success = not running out of money</li>
              <li>Most scenarios end with substantial wealth</li>
              <li>Lower bond yields may require &lt;4% today</li>
            </ul>
          </div>
        </InfoModal>
      )}

      {showWithdrawalInfo && (
        <InfoModal title="Withdrawal Rate" onClose={() => setShowWithdrawalInfo(false)}>
          <p style={{ marginBottom: '1rem', color: '#475569', lineHeight: '1.6' }}>
            The percentage of your portfolio you withdraw each year in retirement.
          </p>
          <div style={{ marginBottom: '1rem', padding: '1rem', background: '#f8fafc', borderRadius: '8px', fontFamily: 'monospace', fontSize: '0.875rem' }}>
            <strong>Example:</strong><br/>
            Year 1: Withdraw 4% of $1M = $40,000<br/>
            Year 2: Withdraw $40,000 × 1.03 (inflation) = $41,200<br/>
            Year 3: Continue adjusting for inflation...
          </div>
          <div style={{ marginBottom: '1rem' }}>
            <strong>Safe Ranges:</strong>
            <ul style={{ marginTop: '0.5rem', paddingLeft: '1.5rem', lineHeight: '1.8', color: '#64748b' }}>
              <li>Conservative: 3.0-3.5%</li>
              <li>Moderate: 3.5-4.0%</li>
              <li>Aggressive: 4.0-5.0%</li>
            </ul>
          </div>
          <div style={{ padding: '1rem', background: '#fef3c7', borderRadius: '8px', border: '1px solid #fcd34d' }}>
            <strong style={{ color: '#78350f' }}>Factors Affecting Safety:</strong>
            <div style={{ marginTop: '0.5rem', fontSize: '0.875rem', color: '#78350f' }}>
              • Retirement length (longer = lower rate needed)<br/>
              • Asset allocation (stocks vs bonds)<br/>
              • Market conditions at retirement<br/>
              • Flexibility to reduce spending if needed
            </div>
          </div>
        </InfoModal>
      )}

      {showGuytonInfo && (
        <InfoModal title="Guyton-Klinger Dynamic Withdrawal" onClose={() => setShowGuytonInfo(false)}>
          <p style={{ marginBottom: '1rem', color: '#475569', lineHeight: '1.6' }}>
            A dynamic withdrawal strategy with guardrails that adjusts spending based on portfolio performance.
          </p>
          <div style={{ marginBottom: '1rem', padding: '1rem', background: '#eff6ff', borderRadius: '8px', border: '1px solid #bfdbfe' }}>
            <strong style={{ color: '#1e40af' }}>Core Rules:</strong>
            <ol style={{ marginTop: '0.5rem', paddingLeft: '1.5rem', fontSize: '0.875rem', color: '#1e3a8a', lineHeight: '1.8' }}>
              <li>Start with initial withdrawal rate (e.g., 5%)</li>
              <li>Increase by inflation each year</li>
              <li>If portfolio drops &gt;20%, cut spending by 10%</li>
              <li>If portfolio grows &gt;20%, increase spending by 10%</li>
            </ol>
          </div>
          <div style={{ marginBottom: '1rem' }}>
            <strong>Advantages over static 4% rule:</strong>
            <ul style={{ marginTop: '0.5rem', paddingLeft: '1.5rem', lineHeight: '1.8', color: '#166534', fontSize: '0.875rem' }}>
              <li>Potential for higher withdrawals</li>
              <li>Responds to market conditions</li>
              <li>Preserves wealth better in bull markets</li>
              <li>Reduces failure risk in bear markets</li>
            </ul>
          </div>
          <div style={{ padding: '1rem', background: '#fef2f2', borderRadius: '8px', border: '1px solid #fecaca' }}>
            <strong style={{ color: '#991b1b' }}>Downsides:</strong>
            <div style={{ marginTop: '0.5rem', fontSize: '0.875rem', color: '#991b1b' }}>
              • Variable income year-to-year<br/>
              • Requires spending discipline<br/>
              • More complex to implement
            </div>
          </div>
        </InfoModal>
      )}

      {showAnnuityInfo && (
        <InfoModal title="Annuities - Guaranteed Income" onClose={() => setShowAnnuityInfo(false)}>
          <p style={{ marginBottom: '1rem', color: '#475569', lineHeight: '1.6' }}>
            An insurance product that converts a lump sum into guaranteed income for life or a set period.
          </p>
          <div style={{ marginBottom: '1rem' }}>
            <strong>Pros:</strong>
            <ul style={{ marginTop: '0.5rem', paddingLeft: '1.5rem', lineHeight: '1.8', color: '#166534', fontSize: '0.875rem' }}>
              <li>✓ Guaranteed income for life</li>
              <li>✓ No market risk</li>
              <li>✓ Can't outlive the money</li>
              <li>✓ Simple and predictable</li>
            </ul>
          </div>
          <div style={{ marginBottom: '1rem' }}>
            <strong>Cons:</strong>
            <ul style={{ marginTop: '0.5rem', paddingLeft: '1.5rem', lineHeight: '1.8', color: '#991b1b', fontSize: '0.875rem' }}>
              <li>✗ Give up access to principal</li>
              <li>✗ No inheritance (standard annuities)</li>
              <li>✗ Inflation erodes purchasing power</li>
              <li>✗ Opportunity cost if you die early</li>
            </ul>
          </div>
          <div style={{ padding: '1rem', background: '#eff6ff', borderRadius: '8px', border: '1px solid #bfdbfe', marginBottom: '1rem' }}>
            <strong style={{ color: '#1e40af' }}>Current Rates (2024):</strong>
            <div style={{ marginTop: '0.5rem', fontSize: '0.875rem', color: '#1e3a8a' }}>
              • 65-year-old male: ~6-7% payout<br/>
              • 65-year-old female: ~5.5-6.5% payout<br/>
              • Joint life: ~5-6% payout
            </div>
          </div>
          <div style={{ padding: '1rem', background: '#fef3c7', borderRadius: '8px', border: '1px solid #fcd34d' }}>
            <strong style={{ color: '#78350f' }}>When to Consider:</strong>
            <div style={{ marginTop: '0.5rem', fontSize: '0.875rem', color: '#78350f' }}>
              • Want guaranteed income floor<br/>
              • Worried about longevity risk<br/>
              • Have pension gap to fill<br/>
              • Age 70+ (better rates)
            </div>
          </div>
        </InfoModal>
      )}
    </div>
  );
}

// ==================== UTILITY COMPONENTS ====================
function Card({ title, subtitle, children, style = {}, onInfoClick }) {
  return (
    <div style={{
      background: 'white',
      borderRadius: '12px',
      padding: '1.5rem',
      boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
      border: '1px solid #e2e8f0',
      ...style,
    }}>
      {title && (
        <div style={{ marginBottom: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <h3 style={{
              fontSize: '1.125rem',
              fontWeight: '600',
              color: '#0f172a',
              margin: 0,
              flex: 1,
            }}>
              {title}
            </h3>
            {onInfoClick && (
              <button
                onClick={onInfoClick}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 0,
                  display: 'flex',
                  alignItems: 'center',
                  color: '#3b82f6',
                }}
              >
                <Info size={18} />
              </button>
            )}
          </div>
          {subtitle && (
            <p style={{ margin: '0.25rem 0 0', fontSize: '0.875rem', color: '#64748b' }}>
              {subtitle}
            </p>
          )}
        </div>
      )}
      {children}
    </div>
  );
}

function MetricCard({ label, value, icon, color, subtitle, infoButton, onInfoClick }) {
  return (
    <div style={{
      background: 'white',
      borderRadius: '12px',
      padding: '1.5rem',
      boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
      border: '1px solid #e2e8f0',
      transition: 'transform 0.2s',
      position: 'relative',
    }}>
      {infoButton && (
        <button
          onClick={onInfoClick}
          style={{
            position: 'absolute',
            top: '1rem',
            right: '1rem',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: '#94a3b8',
            padding: 0,
          }}
        >
          <Info size={18} />
        </button>
      )}
      <div style={{ color, marginBottom: '0.75rem' }}>{icon}</div>
      <div style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '0.5rem' }}>
        {label}
      </div>
      <div style={{ fontSize: '1.75rem', fontWeight: '700', color: '#0f172a' }}>
        {value}
      </div>
      {subtitle && (
        <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.25rem' }}>
          {subtitle}
        </div>
      )}
    </div>
  );
}

function InputField({ label, value, onChange, help, prefix, suffix, onInfoClick }) {
  return (
    <div style={{ marginBottom: '1.25rem' }}>
      <label style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        fontSize: '0.85rem',
        fontWeight: '500',
        color: '#475569',
        marginBottom: '0.5rem',
      }}>
        {label}
        {onInfoClick && (
          <button
            onClick={onInfoClick}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
              display: 'flex',
              alignItems: 'center',
              color: '#3b82f6',
            }}
          >
            <Info size={16} />
          </button>
        )}
      </label>
      <div style={{ position: 'relative' }}>
        {prefix && (
          <span style={{
            position: 'absolute',
            left: '0.75rem',
            top: '50%',
            transform: 'translateY(-50%)',
            color: '#64748b',
            fontWeight: '600',
          }}>
            {prefix}
          </span>
        )}
        <input
          type="number"
          value={value}
          onChange={onChange}
          onFocus={(e) => e.target.select()}
          step="any"
          style={{
            width: '100%',
            padding: prefix || suffix ? '0.75rem 2.5rem 0.75rem 0.75rem' : '0.75rem',
            paddingLeft: prefix ? '2rem' : '0.75rem',
            border: '2px solid #e2e8f0',
            borderRadius: '8px',
            fontSize: '1rem',
            background: '#fefce8',
            fontWeight: '600',
            color: '#0f172a',
          }}
        />
        {suffix && (
          <span style={{
            position: 'absolute',
            right: '0.75rem',
            top: '50%',
            transform: 'translateY(-50%)',
            color: '#64748b',
            fontWeight: '600',
          }}>
            {suffix}
          </span>
        )}
      </div>
      {help && (
        <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.25rem' }}>
          {help}
        </div>
      )}
    </div>
  );
}

function ScenarioButton({ active, onClick, label, color }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        padding: '1rem',
        background: active ? color : 'white',
        color: active ? 'white' : '#64748b',
        border: active ? 'none' : '2px solid #e2e8f0',
        borderRadius: '8px',
        fontSize: '1rem',
        fontWeight: '600',
        cursor: 'pointer',
        transition: 'all 0.2s',
      }}
    >
      {label}
    </button>
  );
}

function InfoModal({ title, children, onClose }) {
  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0,0,0,0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
      padding: '2rem',
    }}
    onClick={onClose}
    >
      <div
        style={{
          background: 'white',
          borderRadius: '16px',
          maxWidth: '600px',
          width: '100%',
          maxHeight: '80vh',
          overflow: 'auto',
          padding: '2rem',
          boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '1.5rem' }}>
          <h3 style={{ fontSize: '1.5rem', fontWeight: '700', color: '#0f172a', margin: 0 }}>
            {title}
          </h3>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '1.5rem',
              color: '#64748b',
              cursor: 'pointer',
              padding: 0,
            }}
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function PremiumModal({ onClose }) {
  const [netWorth, setNetWorth] = useState('');
  const subscriptionCost = 99; // Annual cost
  
  const expenseRatio = netWorth && !isNaN(netWorth) && Number(netWorth) > 0
    ? (subscriptionCost / Number(netWorth)) * 100
    : 0;
  
  const avgMutualFundFee = 0.50; // 0.50% average
  const savingsVsMutualFund = avgMutualFundFee - expenseRatio;
  const savingsPercentage = expenseRatio > 0 ? ((savingsVsMutualFund / avgMutualFundFee) * 100) : 0;
  
  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0,0,0,0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
      padding: '2rem',
    }}
    onClick={onClose}
    >
      <div
        style={{
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          borderRadius: '20px',
          maxWidth: '500px',
          width: '100%',
          padding: '2.5rem',
          boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)',
          color: 'white',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🚀</div>
          <h2 style={{ fontSize: '2rem', fontWeight: '700', margin: 0, marginBottom: '0.5rem' }}>
            Unlock Premium Features
          </h2>
          <p style={{ fontSize: '1rem', opacity: 0.9, margin: 0 }}>
            Leverage, AI insights, and advanced tools
          </p>
        </div>

        <div style={{
          background: 'rgba(255,255,255,0.15)',
          borderRadius: '12px',
          padding: '1.5rem',
          marginBottom: '1.5rem',
          backdropFilter: 'blur(10px)',
        }}>
          <label style={{ 
            display: 'block', 
            marginBottom: '0.75rem', 
            fontSize: '0.9rem',
            fontWeight: '600',
            opacity: 0.95,
          }}>
            What's your total net worth?
          </label>
          <input
            type="number"
            value={netWorth}
            onChange={(e) => setNetWorth(e.target.value)}
            placeholder="450000"
            style={{
              width: '100%',
              padding: '1rem',
              fontSize: '1.5rem',
              fontWeight: '700',
              border: '2px solid rgba(255,255,255,0.3)',
              borderRadius: '8px',
              background: 'rgba(255,255,255,0.95)',
              color: '#0f172a',
              textAlign: 'center',
            }}
          />
        </div>

        {expenseRatio > 0 && (
          <div style={{
            background: 'rgba(255,255,255,0.95)',
            borderRadius: '12px',
            padding: '1.5rem',
            marginBottom: '1.5rem',
            color: '#0f172a',
          }}>
            <div style={{ marginBottom: '1rem' }}>
              <div style={{ fontSize: '0.875rem', color: '#64748b', marginBottom: '0.25rem' }}>
                Annual Cost
              </div>
              <div style={{ fontSize: '2rem', fontWeight: '700', color: '#667eea' }}>
                ${subscriptionCost}/year
              </div>
            </div>

            <div style={{ 
              padding: '1rem', 
              background: '#f0fdf4', 
              borderRadius: '8px',
              border: '2px solid #86efac',
              marginBottom: '1rem',
            }}>
              <div style={{ fontSize: '0.875rem', color: '#166534', marginBottom: '0.25rem' }}>
                That's only
              </div>
              <div style={{ fontSize: '1.75rem', fontWeight: '700', color: '#15803d' }}>
                {expenseRatio.toFixed(3)}%
              </div>
              <div style={{ fontSize: '0.875rem', color: '#166534' }}>
                of your ${Number(netWorth).toLocaleString()} portfolio
              </div>
            </div>

            <div style={{ fontSize: '0.875rem', color: '#475569', marginBottom: '0.5rem' }}>
              📊 <strong>Compare to fund fees:</strong>
            </div>
            <div style={{ 
              display: 'grid', 
              gridTemplateColumns: '1fr 1fr', 
              gap: '0.5rem',
              fontSize: '0.875rem',
            }}>
              <div>
                <div style={{ color: '#64748b' }}>Average mutual fund:</div>
                <div style={{ fontWeight: '700', color: '#dc2626' }}>{avgMutualFundFee}%</div>
              </div>
              <div>
                <div style={{ color: '#64748b' }}>Your cost:</div>
                <div style={{ fontWeight: '700', color: '#15803d' }}>{expenseRatio.toFixed(3)}%</div>
              </div>
            </div>
            
            {savingsPercentage > 0 && (
              <div style={{
                marginTop: '1rem',
                padding: '0.75rem',
                background: '#dbeafe',
                borderRadius: '6px',
                textAlign: 'center',
                fontSize: '0.875rem',
                fontWeight: '600',
                color: '#1e40af',
              }}>
                🎉 You save {savingsPercentage.toFixed(0)}% vs typical fund fees!
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: '1rem' }}>
          <button
            onClick={onClose}
            style={{
              flex: 1,
              padding: '1rem',
              background: 'rgba(255,255,255,0.2)',
              border: '2px solid rgba(255,255,255,0.3)',
              borderRadius: '12px',
              color: 'white',
              fontSize: '1rem',
              fontWeight: '600',
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
          >
            Maybe Later
          </button>
          <button
            onClick={() => {
              // TODO: Add payment integration
              alert('Payment integration coming soon!');
            }}
            style={{
              flex: 1,
              padding: '1rem',
              background: 'white',
              border: 'none',
              borderRadius: '12px',
              color: '#667eea',
              fontSize: '1rem',
              fontWeight: '700',
              cursor: 'pointer',
              boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
              transition: 'all 0.2s',
            }}
          >
            Subscribe Now
          </button>
        </div>
      </div>
    </div>
  );
}
