const express = require('express');
const cors = require('cors');
const multer = require('multer');
const axios = require('axios');
const crypto = require('crypto');
const { Redis } = require('@upstash/redis');
const pdfParse = require('pdf-parse');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// ==================== ENVIRONMENT VERIFICATION ====================
console.log('\n🔍 Environment Variables Check:');
console.log(`   ANTHROPIC_API_KEY: ${process.env.ANTHROPIC_API_KEY ? '✅ Present' : '❌ Missing'}`);
console.log(`   FMP_API_KEY: ${process.env.FMP_API_KEY ? '✅ Present' : '❌ Missing'}`);
console.log(`   UPSTASH_REDIS_REST_URL: ${process.env.UPSTASH_REDIS_REST_URL ? '✅ Present' : '❌ Missing'}`);
console.log(`   UPSTASH_REDIS_REST_TOKEN: ${process.env.UPSTASH_REDIS_REST_TOKEN ? '✅ Present' : '❌ Missing'}`);
console.log('');

if (!process.env.FMP_API_KEY) {
  console.warn('⚠️  WARNING: FMP_API_KEY is missing!');
  console.warn('   Stock Analyzer will NOT work without it.');
  console.warn('   Add FMP_API_KEY to your .env file in the backend directory.\n');
}

// Initialize Upstash Redis for persistent caching (OPTIONAL)
// Cache survives server restarts and is shared across all instances
let redis = null;
let cacheEnabled = false;

(async () => {
  try {
    if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
      console.log('💾 Initializing Upstash Redis connection...');
      console.log(`   URL: ${process.env.UPSTASH_REDIS_REST_URL}`);
      console.log(`   Token: ${process.env.UPSTASH_REDIS_REST_TOKEN.substring(0, 10)}...`);
      
      redis = new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      });
      
      console.log('💾 Testing Redis connection with ping...');
      
      // Verify Redis connection with timeout
      const pingPromise = redis.ping();
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Connection timeout after 5 seconds')), 5000)
      );
      
      await Promise.race([pingPromise, timeoutPromise]);
      
      cacheEnabled = true;
      console.log('✅ Cache connection successful - caching enabled');
      console.log('   PDF analyses will be cached to save API costs');
    } else {
      console.log('⚠️  Redis credentials not found in .env - caching disabled');
    }
  } catch (error) {
    console.warn('⚠️  Cache connection failed:', error.message);
    console.warn('   Possible causes:');
    console.warn('   - No internet connection');
    console.warn('   - Firewall blocking Upstash');
    console.warn('   - Invalid credentials');
    console.warn('   - Upstash service down');
    console.warn('   App will work normally, but PDF analyses won\'t be cached');
    redis = null;
    cacheEnabled = false;
  }
})();

// ==================== REQUEST LOGGING MIDDLEWARE ====================
app.use((req, res, next) => {
  console.log(`📥 ${req.method} ${req.path}`);
  next();
});

// ==================== SESSION MIDDLEWARE ====================
// Using in-memory sessions (will be lost on server restart, but simpler and more reliable)
// For production, you'd want to use a persistent session store like connect-redis

app.use(session({
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production', // HTTPS only in production
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

console.log('✅ Session middleware configured (in-memory)');
console.log('⚠️  Note: Sessions will be lost on server restart - just logout/login again');

// ==================== RATE LIMITING ====================
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 login attempts per windowMs
  message: 'Too many login attempts, please try again later.'
});

// Apply rate limiters
app.use('/api/', apiLimiter);
app.use('/api/admin/login', authLimiter);

// ==================== TEST ENDPOINT ====================
app.get('/api/test', (req, res) => {
  console.log('✅ TEST ENDPOINT WORKS!');
  res.json({ message: 'Test endpoint working!' });
});

// Middleware
app.use(cors({
  origin: (origin, callback) => {
    const allowedOrigins = process.env.ALLOWED_ORIGINS.split(',');
    console.log(`🌐 CORS Check - Origin: ${origin}, Allowed: ${allowedOrigins.join(', ')}`);
    
    // Allow requests with no origin (like Postman, curl, same-origin, or local HTML files)
    // This includes both undefined and null origins
    if (!origin || origin === 'null') {
      console.log('   ✅ No origin (same-origin, tool, or local file) - ALLOWED');
      return callback(null, true);
    }
    
    if (allowedOrigins.includes(origin)) {
      console.log('   ✅ Origin ALLOWED');
      callback(null, true);
    } else {
      console.log('   ❌ Origin BLOCKED');
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST'],
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Configure multer for memory storage
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 15 * 1024 * 1024 } // 15MB limit
});

// Helper function to build portfolio context for Claude
function buildPortfolioContext(portfolio) {
  if (!portfolio || portfolio.length === 0) {
    return { hasPortfolio: false, context: '' };
  }
  
  // Calculate value for each position if not present (shares * avgCost)
  const portfolioWithValues = portfolio.map(p => ({
    ...p,
    value: p.value || (p.shares * p.avgCost)
  }));
  
  const totalValue = portfolioWithValues.reduce((sum, p) => sum + p.value, 0);
  
  let context = `\n**CURRENT PORTFOLIO TO ANALYZE:**\n\n`;
  context += `Total Portfolio Value: $${totalValue.toLocaleString()}\n\n`;
  context += `Holdings (${portfolioWithValues.length} positions):\n`;
  
  portfolioWithValues.forEach(position => {
    const percentage = ((position.value / totalValue) * 100).toFixed(1);
    context += `- ${position.ticker}: $${position.value.toLocaleString()} (${percentage}%)\n`;
  });
  
  context += `\n`;
  
  return { hasPortfolio: true, context, totalValue, positionCount: portfolioWithValues.length };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PDF CACHING FUNCTIONS (Upstash Redis - Persistent)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Calculate SHA-256 hash of PDF buffer
 * This uniquely identifies the PDF content
 */
function getPdfHash(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Get cached outlook analysis by PDF hash
 * Returns null if not found
 */
async function getCachedOutlook(pdfHash) {
  if (!cacheEnabled || !redis) {
    return null;
  }
  
  try {
    const cacheKey = `outlook_${pdfHash}`;
    const cached = await redis.get(cacheKey);
    return cached;
  } catch (error) {
    console.warn('⚠️  Cache GET error:', error.message);
    return null;
  }
}

/**
 * Store outlook analysis in cache
 * TTL: null = never expires (permanent storage)
 */
async function cacheOutlook(pdfHash, analysisData) {
  if (!cacheEnabled || !redis) {
    console.log('ℹ️  Cache disabled - skipping cache storage');
    return;
  }
  
  try {
    const cacheKey = `outlook_${pdfHash}`;
    const dataToCache = {
      ...analysisData,
      cached_at: new Date().toISOString(),
      pdf_hash: pdfHash
    };
    
    // Set with no expiration (permanent)
    await redis.set(cacheKey, JSON.stringify(dataToCache));
    console.log(`💾 Outlook cached to Upstash Redis (permanent)`);
  } catch (error) {
    console.warn('⚠️  Cache SET error:', error.message);
  }
}

/**
 * Get cache statistics
 */
async function getCacheStats() {
  if (!cacheEnabled || !redis) {
    return {
      enabled: false,
      message: 'Cache is disabled'
    };
  }
  
  try {
    // Get all outlook keys
    const keys = await redis.keys('outlook_*');
    
    // Get memory stats from Redis
    const info = await redis.info('stats');
    
    // Parse hits/misses from info string if available
    let hits = 0;
    let misses = 0;
    
    if (info) {
      const hitsMatch = info.match(/keyspace_hits:(\d+)/);
      const missesMatch = info.match(/keyspace_misses:(\d+)/);
      if (hitsMatch) hits = parseInt(hitsMatch[1]);
      if (missesMatch) misses = parseInt(missesMatch[1]);
    }
    
    const total = hits + misses;
    const hitRate = total > 0 ? ((hits / total) * 100).toFixed(1) + '%' : '0%';
    
    return {
      cached_outlooks: keys.length,
      hits: hits,
      misses: misses,
      hit_rate: hitRate,
      keys: keys,
      storage: 'Upstash Redis (persistent)'
    };
  } catch (error) {
    console.error('❌ Cache STATS error:', error.message);
    return {
      cached_outlooks: 0,
      hits: 0,
      misses: 0,
      hit_rate: '0%',
      keys: [],
      error: error.message
    };
  }
}

// ==================== FINANCIAL STATEMENT CACHING ====================

/**
 * Get cached financial statements
 * Combines hash of all 3 PDFs into single cache key
 */
async function getCachedFinancials(incomeHash, balanceHash, cashFlowHash) {
  if (!cacheEnabled || !redis) {
    return null;
  }
  
  try {
    const combinedHash = crypto.createHash('sha256')
      .update(`${incomeHash}${balanceHash}${cashFlowHash}`)
      .digest('hex');
    
    // Version 2: Fixed JSON serialization
    const cacheKey = `financials_v2_${combinedHash}`;
    const cached = await redis.get(cacheKey);
    
    if (!cached) {
      return null;
    }
    
    // Try to parse the cached data
    try {
      const parsed = JSON.parse(cached);
      console.log(`✅ CACHE HIT - Using cached financial data from ${parsed.cached_at || 'unknown time'}`);
      return parsed;
    } catch (parseError) {
      console.warn(`⚠️  Corrupt cache data found, clearing it...`);
      // Delete corrupt cache entry
      await redis.del(cacheKey);
      return null;
    }
  } catch (error) {
    console.warn('⚠️  Financial cache GET error:', error.message);
    return null;
  }
}

/**
 * Cache financial statements permanently
 */
async function cacheFinancials(incomeHash, balanceHash, cashFlowHash, financialData) {
  if (!cacheEnabled || !redis) {
    console.log('ℹ️  Cache disabled - skipping financial data storage');
    return;
  }
  
  try {
    const combinedHash = crypto.createHash('sha256')
      .update(`${incomeHash}${balanceHash}${cashFlowHash}`)
      .digest('hex');
    
    // Version 2: Fixed JSON serialization
    const cacheKey = `financials_v2_${combinedHash}`;
    
    // Create clean object without any potential circular references
    const dataToCache = {
      companyName: financialData.companyName,
      fiscalYearEnd: financialData.fiscalYearEnd,
      currencyUnits: financialData.currencyUnits,
      income: financialData.income,
      balance: financialData.balance,
      cashFlow: financialData.cashFlow,
      cached_at: new Date().toISOString(),
      statement_hashes: { incomeHash, balanceHash, cashFlowHash }
    };
    
    // Test JSON.stringify before caching
    const testString = JSON.stringify(dataToCache);
    if (!testString || testString === '[object Object]') {
      throw new Error('Data serialization failed');
    }
    
    // Set with no expiration (permanent)
    await redis.set(cacheKey, testString);
    console.log(`💾 Financial statements cached to Upstash Redis (permanent)`);
    console.log(`   Cache key: financials_v2_${combinedHash.substring(0, 8)}...`);
  } catch (error) {
    console.warn('⚠️  Financial cache SET error:', error.message);
    console.warn('   Data will not be cached (will re-parse next time)');
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    service: 'Investment Dashboard API'
  });
});

// Cache statistics endpoint
app.get('/api/cache-stats', async (req, res) => {
  try {
    const stats = await getCacheStats();
    res.json({
      success: true,
      cache: stats,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// PDF Analysis Endpoint
// ==================== HELPER: Portfolio Analysis Prompt Format ====================
function getFullPortfolioAnalysisPrompt(portfolioInfo) {
  return `
**⚠️ CRITICAL PERCENTAGE FORMATTING:**
- Percentages MUST be decimal numbers, NOT basis points or whole numbers
- 5.5% position = "percentage": 5.5 (NOT 550, NOT 5500)
- 12.3% position = "percentage": 12.3 (NOT 1230)
- If position is $18,000 of $150,000 portfolio = 12.0% = "percentage": 12.0

**JSON FORMAT (USE EXACT STRUCTURE):**
{
  "portfolioAnalysis": {
    "totalValue": ${portfolioInfo.totalValue},
    "riskProfile": "Aggressive/Moderate/Conservative",
    "themes": [
      {
        "theme": "Growth/Tech Innovation",
        "percentage": 35.0,
        "dollarValue": 52500,
        "positions": "JTEK (12.0%, $18k), SCHG (10.0%, $15k)",
        "assessment": "Strong exposure through mix of active/passive",
        "recommendation": "Maintain core allocation"
      }
      // ⚠️ CRITICAL: You MUST return 2-5 themes grouping portfolio holdings
      // percentage = (dollarValue / totalValue) * 100
      // Example: If theme is $52,500 of $150,000 = (52500/150000)*100 = 35.0
    ],
    "gaps": ["List missing allocations"],
    "concentrations": ["List overweight positions"],
    "strengths": ["List portfolio strengths"]
  },
  "riskProfileNeeded": false,
  "recommendations": [
    {
      "action": "TRIM",
      "ticker": "JTEK",
      "currentAmount": 18000,
      "newAmount": 13000,
      "changeAmount": -5000,
      "currentPercent": 12.0,
      "newPercent": 8.7,
      "rationale": "Reason with PDF citation (Page X)"
    },
    {
      "action": "ADD",
      "ticker": "VXUS",
      "name": "Vanguard Total International Stock ETF",
      "currentAmount": 0,
      "newAmount": 10000,
      "changeAmount": 10000,
      "currentPercent": 0.0,
      "newPercent": 6.7,
      "rationale": "Reason with PDF citation (Page X)"
    }
  ]
}

**PERCENTAGE CALCULATION EXAMPLES:**
- If portfolio is $150,000 total:
  - $13,000 position = (13000/150000)*100 = 8.67% → "newPercent": 8.7
  - $10,000 position = (10000/150000)*100 = 6.67% → "newPercent": 6.7
  - $22,000 position = (22000/150000)*100 = 14.67% → "newPercent": 14.7

**REMEMBER:**
- currentPercent + newPercent are DECIMAL percentages (e.g., 8.7 means 8.7%)
- changeAmount must equal (newAmount - currentAmount)
- All TRIMs and ADDs must cite PDF pages
- Themes section is REQUIRED with proper percentage calculations

Return ONLY this JSON structure. No markdown, no preamble.`;
}

app.post('/api/analyze-pdf', upload.single('pdf'), async (req, res) => {
  try {
    console.log('📄 PDF Analysis Request Received');
    
    // Check if file was uploaded
    if (!req.file) {
      return res.status(400).json({ error: 'No PDF file uploaded' });
    }
    
    // Check file size (15MB limit)
    const fileSizeMB = req.file.size / (1024 * 1024);
    console.log(`📊 PDF Size: ${fileSizeMB.toFixed(2)} MB`);
    
    if (fileSizeMB > 15) {
      console.error(`❌ File too large: ${fileSizeMB.toFixed(2)} MB (limit: 15 MB)`);
      return res.status(413).json({
        success: false,
        error: 'PDF file is too large. Maximum file size is 15MB. Please try a smaller file or compress your PDF.',
        errorType: 'FILE_TOO_LARGE',
        fileSize: fileSizeMB.toFixed(2),
        timestamp: new Date().toISOString()
      });
    }

    // Calculate PDF hash for caching
    const pdfHash = getPdfHash(req.file.buffer);
    console.log(`🔑 PDF Hash: ${pdfHash.substring(0, 16)}...`);
    
    // Check if we have this outlook cached
    const cachedOutlook = await getCachedOutlook(pdfHash);
    
    if (cachedOutlook) {
      console.log('✅ CACHE HIT - Using cached outlook analysis');
      console.log(`💰 Cost saved: ~$0.05 (15,000 tokens)`);
      console.log(`📅 Cached at: ${cachedOutlook.cached_at || 'unknown'}`);
      
      // Parse if it's a string (Redis returns strings)
      const parsedCache = typeof cachedOutlook === 'string' 
        ? JSON.parse(cachedOutlook) 
        : cachedOutlook;
      
      // Get portfolio data for any portfolio-specific analysis
      const portfolioData = req.body.portfolio ? JSON.parse(req.body.portfolio) : null;
      const portfolioInfo = buildPortfolioContext(portfolioData);
      
      // Log portfolio detection
      console.log(`📈 Portfolio Detection (Cache Hit):`);
      console.log(`   Has portfolio: ${portfolioInfo.hasPortfolio}`);
      console.log(`   Portfolio data received: ${portfolioData ? 'YES' : 'NO'}`);
      console.log(`   Portfolio length: ${portfolioData?.length || 0}`);
      if (portfolioInfo.hasPortfolio) {
        console.log(`   Positions: ${portfolioInfo.positionCount}, Value: $${portfolioInfo.totalValue.toLocaleString()}`);
        console.log(`   Risk profile will be: FALSE (portfolio provided)`);
      } else {
        console.log(`   Risk profile will be: TRUE (no portfolio)`);
      }
      
      // If no portfolio, return cached outlook directly
      if (!portfolioInfo.hasPortfolio) {
        return res.json({
          success: true,
          data: parsedCache,
          cached: true,
          cache_source: 'Upstash Redis (persistent)',
          timestamp: new Date().toISOString()
        });
      }
      
      // If portfolio exists, generate portfolio-specific recommendations
      // using the cached outlook (but with FULL analysis including themes)
      console.log('📊 Generating full portfolio analysis using cached outlook...');
      
      // Use SAME prompt as non-cached, just inject cached outlook as PDF summary
      const cachedPrompt = `You are analyzing a portfolio against a market outlook document.

**MARKET OUTLOOK SUMMARY (from cached analysis):**
${JSON.stringify(parsedCache, null, 2)}

**CURRENT PORTFOLIO TO ANALYZE:**
${portfolioInfo.context}

**YOUR TASK:**
Provide comprehensive portfolio analysis in the EXACT JSON format specified below. You MUST include ALL sections including themes.

${getFullPortfolioAnalysisPrompt(portfolioInfo)}

Return ONLY valid JSON matching the format exactly. Include themes, gaps, concentrations, strengths, AND recommendations.`;
      
      const portfolioResponse = await axios.post(
        'https://api.anthropic.com/v1/messages',
        {
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4000, // Increased for full analysis
          messages: [
            {
              role: 'user',
              content: cachedPrompt
            }
          ]
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': process.env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01'
          }
        }
      );
      
      // Parse full portfolio analysis
      let portfolioAnalysis;
      try {
        const responseText = portfolioResponse.data.content[0].text;
        const cleanText = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        portfolioAnalysis = JSON.parse(cleanText);
      } catch (parseError) {
        console.warn('⚠️  Failed to parse portfolio analysis, using basic structure');
        portfolioAnalysis = { 
          portfolioAnalysis: null,
          riskProfileNeeded: false,
          recommendations: [] 
        };
      }
      
      // Combine cached outlook with portfolio analysis
      return res.json({
        success: true,
        data: {
          ...parsedCache,
          ...portfolioAnalysis, // This includes portfolioAnalysis, riskProfileNeeded, recommendations
        },
        cached: true,
        cache_source: 'Upstash Redis (persistent) + Portfolio Analysis',
        timestamp: new Date().toISOString()
      });
    }
    
    // CACHE MISS - Need to analyze PDF from scratch
    console.log('❌ CACHE MISS - Analyzing PDF (will cache result)');

    // Get portfolio data from request body
    const portfolioData = req.body.portfolio ? JSON.parse(req.body.portfolio) : null;
    
    // Convert PDF buffer to base64
    const base64PDF = req.file.buffer.toString('base64');
    console.log(`📊 PDF Size: ${(req.file.size / 1024).toFixed(2)} KB`);

    // Build portfolio context
    const portfolioInfo = buildPortfolioContext(portfolioData);
    
    console.log(`📈 Portfolio Detection:`);
    console.log(`   Has portfolio: ${portfolioInfo.hasPortfolio}`);
    console.log(`   Portfolio data received: ${portfolioData ? 'YES' : 'NO'}`);
    console.log(`   Portfolio length: ${portfolioData?.length || 0}`);
    if (portfolioInfo.hasPortfolio) {
      console.log(`   Positions: ${portfolioInfo.positionCount}, Value: $${portfolioInfo.totalValue.toLocaleString()}`);
      console.log(`   Risk profile will be: FALSE (portfolio provided)`);
    } else {
      console.log(`   Risk profile will be: TRUE (no portfolio)`);
    }

    // Call Claude API
    console.log('🤖 Calling Claude API...');
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'document',
                source: {
                  type: 'base64',
                  media_type: 'application/pdf',
                  data: base64PDF
                }
              },
              {
                type: 'text',
                text: `You are an elite investment advisor with deep expertise in portfolio construction, ETF selection, and market analysis.

**━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━**
**CRITICAL INSTRUCTIONS - READ FIRST**
**━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━**

**⚠️  ANTI-HALLUCINATION PROTOCOL - STRICTLY ENFORCE ⚠️**

You MUST follow these rules to prevent making up recommendations:

1. **Identify the PDF source**: Is this JPMorgan (JPM), Goldman Sachs (GS), HSBC, Deutsche Bank, or another firm? 
   Use the CORRECT firm name throughout your entire response.

2. **ONLY recommend what the PDF EXPLICITLY states**:
   - ❌ DO NOT infer or extrapolate beyond what's written
   - ❌ DO NOT apply general investment principles not in the PDF
   - ❌ DO NOT cite page numbers unless you can see that content ON that page
   - ✅ ONLY make recommendations based on EXPLICIT statements in the PDF
   - ✅ If the PDF says "overweight financials" → recommend financials
   - ✅ If the PDF says "underweight tech" → trim tech
   - ❌ If the PDF doesn't mention healthcare → DON'T recommend healthcare

3. **Page citations MUST be accurate**:
   - BEFORE citing a page, RE-READ that page in the PDF
   - The content you cite MUST actually appear on that page
   - If you're not certain which page, DON'T cite a page number
   - Format: "(Firm name, p. XX)" ONLY if you verified the page
   
4. **Verify sector/asset class recommendations against PDF**:
   - If PDF highlights "Financials, Energy, Value stocks" → recommend those
   - If PDF doesn't mention "Healthcare" → DON'T recommend healthcare
   - Match your recommendations EXACTLY to what the PDF emphasizes

5. **Cash-neutral ONLY**: Work within the existing portfolio value. 
   TRIM amounts must equal ADD amounts. netCashRequired MUST be $0.
   **If you need more TRIMs, TRIM MORE POSITIONS. There is no limit on number of TRIMs.**

6. **Use correct LTCMA data**: When calculating expected returns, use the LTCMA data 
   FROM THE PDF and attribute it to the correct firm.

7. **FNCMX IS PASSIVE - NOT ACTIVE!**
   ⚠️  CRITICAL: FNCMX = Fidelity Nasdaq Composite INDEX Fund
   ⚠️  It TRACKS AN INDEX (Nasdaq Composite)
   ⚠️  It is a PASSIVE index fund, NOT actively managed
   ⚠️  ALWAYS place FNCMX in "passiveFunds" array
   ⚠️  NEVER place FNCMX in "activeFunds" array

**━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━**
**SELF-CHECK BEFORE RESPONDING:**
**━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━**

Before finalizing recommendations, ask yourself:

1. "Did the PDF EXPLICITLY mention this sector/asset class?"
2. "Can I find the text I'm citing ON the page number I listed?"
3. "Am I making generic recommendations, or PDF-specific ones?"
4. "If I searched the PDF for 'healthcare', would I find supporting text?"

If the answer to ANY of these is NO or UNCERTAIN, DO NOT include that recommendation.

**━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━**

${portfolioInfo.hasPortfolio ? `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 0: EXTRACT WHAT THE PDF ACTUALLY SAYS (DO THIS FIRST!)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**BEFORE analyzing the portfolio or making ANY recommendations, first extract:**

1. **What sectors/asset classes does this PDF explicitly favor?**
   - List ONLY sectors/assets explicitly mentioned as "overweight", "attractive", "favored", "upgrade", "positive"
   - Example: If PDF says "Overweight Financials" → Note it
   - Example: If PDF says "Favor Value over Growth" → Note it
   - Example: If PDF doesn't mention Healthcare → DON'T include it

2. **What sectors/asset classes does this PDF explicitly avoid?**
   - List ONLY sectors/assets explicitly mentioned as "underweight", "unattractive", "avoid", "downgrade", "negative"
   - Example: If PDF says "Underweight Technology" → Note it
   - Example: If PDF says "Reduce duration" → Note it

3. **What are the key themes mentioned?**
   - AI, Rate normalization, Inflation, International diversification, etc.
   - ONLY themes EXPLICITLY mentioned in the PDF

**WRITE THIS DOWN (internal notes for yourself - don't include in final JSON):**

PDF FAVORS: [list sectors/assets]
PDF AVOIDS: [list sectors/assets]
KEY THEMES: [list themes]

**Your recommendations MUST align with these lists. If something isn't on these lists, DON'T recommend it!**

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 1: DETAILED PORTFOLIO ANALYSIS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${portfolioInfo.context}

**CRITICAL: This is the user's ACTUAL portfolio. DO NOT suggest replacing it entirely.**

**MANDATORY: You MUST analyze ALL ${portfolioInfo.positionCount} positions listed above. Do not skip or overlook any ticker, especially smaller positions.**

**━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━**
**CRITICAL: DO NOT CONFUSE DIFFERENT TICKERS!**
**━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━**

Research EACH ticker INDEPENDENTLY. Do NOT assume one ticker has the same holdings as another ticker.

**Common Mistakes to AVOID:**
❌ WRONG: "OBMCX has crypto mining exposure"
✅ CORRECT: "OBMCX is Oberweis Micro-Cap Fund - a small-cap growth fund (Technology 28%, Industrials 24%, Healthcare 21%, NO crypto)"

❌ WRONG: "OBMCX contributes to Digital Infrastructure/Crypto theme"
✅ CORRECT: "OBMCX contributes to Small Cap Growth theme"

❌ WRONG: "All positions are tech-focused"
✅ CORRECT: Research each one - some may be healthcare, financials, energy, etc.

**If you see crypto/bitcoin exposure, it's from specific tickers like:**
- BMNR, GLXY, IREN, RIOT, MARA, CLSK = These are crypto-related
- OBMCX, SCHG, JTEK, FNCMX, etc. = NOT crypto

**CRITICAL - VERIFY BEFORE CATEGORIZING:**
Before placing ANY ticker in "Digital Infrastructure" or "Crypto" theme:
1. Is it BMNR, GLXY, IREN, RIOT, MARA, or CLSK? → YES, it's crypto
2. Is it anything else? → Research it independently, don't assume crypto
3. OBMCX is NOT crypto - it's a diversified small-cap growth fund

**YOUR ANALYSIS TASKS:**

1. **Research Every Position (ALL ${portfolioInfo.positionCount} tickers without exception):**
   For EACH ticker above, determine:
   - What is it? (Company/ETF/Fund)
   - What business/strategy?
   - What investment theme does it represent?
   - **Is it actively managed or passively managed (index tracking)?**
   
   **HOW TO DETERMINE ACTIVE VS PASSIVE:**
   
   A fund is PASSIVE (index fund) if:
   - The name contains "Index" (e.g., "S&P 500 Index", "Nasdaq Composite Index")
   - The description says it "tracks" or "seeks to replicate" an index
   - It's from Vanguard/iShares/SPDR and matches a known index (S&P 500, Total Market, etc.)
   - Ticker patterns: VOO, VTI, SPY, IVV, QQQ, QQQM = all passive index funds
   - Very low expense ratio (<0.10%) usually indicates passive
   
   A fund is ACTIVE if:
   - Manager makes stock selection decisions
   - Name includes "Active", "Select", "Opportunities", "Growth", "Value" WITHOUT "Index"
   - Description mentions "actively managed" or "stock selection"
   - JPMorgan, Fidelity, T. Rowe Price active funds (not their index funds)
   - Expense ratio >0.30% often indicates active (but not always)
   
   **SPECIFIC EXAMPLES - MEMORIZE THESE:**
   - **PASSIVE:** VOO, VTI, SPY, IVV, QQQ, QQQM, SCHG, SCHX, VUG, VTV, VXUS, VEA, VWO, BND, AGG
   - **PASSIVE:** FNCMX = Fidelity Nasdaq Composite **INDEX** Fund (the word INDEX is key!)
   - **ACTIVE:** JTEK = JPMorgan U.S. Tech Leaders ETF (actively managed growth tech, NOT to be confused with JEPI)
   - **ACTIVE:** JGRO = JPMorgan Active Growth ETF (actively managed large-cap growth ETF combining two fundamental stock-picking approaches, holds ~100 stocks, NOT an options/income strategy) → "Large Cap Growth"
   - **ACTIVE:** GRNY = Fundstrat Granny Shots US Large Cap ETF (actively managed thematic stock selection, 20-50 large-cap stocks across 5-10 investment themes identified by Tom Lee, NOT an income/options strategy) → "Large Cap / Thematic"
   - **ACTIVE:** OBMCX = Oberweis Micro-Cap Fund (actively managed small-cap growth)
   - **ACTIVE:** ARKK, ARKW, ARKG = ARK actively managed innovation funds
   - **ACTIVE:** Fidelity Select funds (FSCSX, etc.), T. Rowe Price active funds
   
   When in doubt: If you can't determine from the name, state "Unable to determine active/passive status without additional research"
   
   Common Ticker Research:
   - IREN → Iris Energy: Bitcoin mining + AI data centers → "Digital Infrastructure / Crypto"
   - BMNR, GLXY → Crypto/Bitcoin mining companies → "Crypto / Digital Infrastructure"
   - NET → Cloudflare: CDN/edge/security → "Cloud Infrastructure / Growth Tech"  
   - JTEK → JPMorgan U.S. Tech Leaders ETF (**ACTIVELY managed**, growth-focused tech) → "Growth Tech / Large Cap"
   - **JGRO → JPMorgan Active Growth ETF (actively managed large-cap growth, combines two fundamental bottom-up approaches - JPMorgan Large Cap Growth + JPMorgan Growth Advantage strategies, ~100 stock positions, focus on companies with strong earnings growth potential, managed by Giri Devulapally and Felise Agranoff)** → "Large Cap Growth"
   - **GRNY → Fundstrat Granny Shots US Large Cap ETF (actively managed thematic equity strategy by Tom Lee, 20-50 large-cap stocks selected across 5-10 investment themes using top-down macro + bottom-up quantitative approach, equal-weighted positions, rebalanced quarterly)** → "Large Cap / Thematic"
   - SCHG → Schwab U.S. Large-Cap Growth ETF (**PASSIVE index**, tracks Dow Jones U.S. Large-Cap Growth) → "Growth / Large Cap"
   - FNCMX → Fidelity Nasdaq Composite **INDEX** Fund (**100% PASSIVE**, tracks Nasdaq Composite Index) → "Growth Tech / Nasdaq"
   - **OBMCX → Oberweis Micro-Cap Fund (ACTIVELY managed small-cap growth fund, NOT crypto! Sectors: Tech 28%, Industrials 24%, Healthcare 21%)** → "Small Cap Growth"
   - VOO → Vanguard S&P 500 ETF (**PASSIVE index**) → "Large Cap Blend"
   - IXJ → iShares Global Healthcare ETF (**PASSIVE index**, 100% healthcare sector) → "Healthcare"
   - CRWD → CrowdStrike: Cybersecurity stock → "Cybersecurity / Growth Tech"

2. **Group Into Themes:**
   Combine related positions into themes with total percentages:
   
   Example:
   "Growth/Tech Innovation: 35%
    ├─ JTEK: 12% (Active large-cap tech)
    ├─ SCHG: 10% (Passive large-cap growth)
    ├─ NET: 5% (Cloud/edge infrastructure)
    ├─ CRWD: 4% (Cybersecurity)
    └─ MSFT: 4% (Mega-cap tech)
    
    Digital Infrastructure/Crypto: 12%
    └─ IREN: 12% (Bitcoin mining / AI datacenters)
    
    Small Cap Growth: 5.4%
    └─ OBMCX: 5.4% (Oberweis Micro-Cap, NOT crypto!)"
    
   **CRITICAL - DO NOT GROUP OBMCX WITH CRYPTO:**
   - OBMCX is a DIVERSIFIED small-cap growth fund
   - It has Tech (28%), Industrials (24%), Healthcare (21%)
   - It does NOT have crypto/bitcoin mining exposure
   - DO NOT include OBMCX in "Digital Infrastructure" or "Crypto" themes
   - Place OBMCX in "Small Cap Growth" or similar theme

3. **SECTOR-LEVEL ANALYSIS (CRITICAL - DO NOT OVERSIMPLIFY):**
   
   **This is the most important step. You must analyze sector exposures at a granular level.**
   
   For EACH position, identify its SECTOR composition:
   - Individual stocks: 100% in their primary sector
   - ETFs: Research their actual sector breakdown (Technology, Financials, Healthcare, Consumer, Industrials, Energy, Utilities, Real Estate, Materials, Communication Services)
   
   **Example for JTEK (don't use made-up numbers - research actual allocations):**
   "JTEK sector breakdown (approximate):
    - Technology: 70%
    - Communication Services: 15%
    - Consumer Discretionary: 10%
    - Other: 5%"
   
   **Calculate TOTAL portfolio sector exposures:**
   Aggregate across all positions weighted by portfolio allocation
   
   Example calculation:
   "Technology exposure:
    - JTEK: 12% position × 70% tech = 8.4%
    - SCHG: 10% position × 50% tech = 5.0%
    - FNCMX: 8% position × 53% tech = 4.2%
    - NET: 5% position × 100% tech = 5.0%
    - MSFT: 4% position × 100% tech = 4.0%
    = Total Technology: 26.6%"
   
   "Healthcare exposure:
    - IXJ: 5% position × 100% healthcare = 5.0% (dedicated healthcare ETF)
    - SCHG: 10% position × 12% healthcare = 1.2%
    - JTEK: 12% position × 8% healthcare = 0.96%
    = Total Healthcare: 7.2%"
   
   **IMPORTANT:** 
   - IXJ (iShares Global Healthcare ETF) = 100% healthcare sector
   - Don't miss sector-specific ETFs like IXJ, XLV, XLF, XLE, etc.
   - Always include dedicated sector ETFs in sector calculations
   
   **Report ALL major sector exposures (>5%):**
   "Sector Breakdown:
    - Technology: 26.6% (overweight vs 20-25% typical)
    - Financials: 8.2%
    - Healthcare: 12.1%
    - Consumer Discretionary: 10.5%
    - Communication Services: 9.3%
    - Industrials: 6.8%
    - Energy: 2.1% (underweight vs 5-7% typical)
    - Other: 24.4%"
   
   **Identify sector-specific issues:**
   - Overweights: "Technology 26.6% is 6% above typical allocation - consider diversifying"
   - Underweights: "No Energy exposure - missing defensive/inflation hedge sector"
   - Missing sectors: "Zero Utilities/Real Estate - no income-generating defensive positions"
   - Concentrations: "Tech + Communication Services = 36% - significant concentration in growth sectors"

4. **Determine Risk Profile:**
   Based on portfolio composition:
   - 100% stocks = Aggressive
   - 80-90% stocks, 10-20% bonds = Moderate-Aggressive
   - 60-80% stocks, 20-40% bonds = Moderate
   - <60% stocks = Conservative
   
   Note any concentrations or single-stock risks.

5. **Identify (using both theme AND sector analysis):**
   - ✅ Strong themes (well-positioned areas)
   - ⚠️ Gaps (missing asset classes AND missing/underweight sectors)
   - 📍 Concentrations (>30% in one theme OR >25% in one sector)
   - 🔄 Overlaps (redundant positions doing same thing)
   - 💎 Quality (is JTEK better than ARKK? yes)
   - 🎯 Sector imbalances (Technology overweight? Missing Healthcare? No defensive sectors?)

` : `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
NO PORTFOLIO PROVIDED - NEED RISK ASSESSMENT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Since no portfolio was uploaded, you will need to:
1. Note that risk tolerance is unknown
2. Provide recommendations for MULTIPLE risk profiles
3. Let user choose their comfort level

Provide allocations for:
- **Aggressive** (100% stocks, young investor, high risk tolerance)
- **Moderate** (80/20 stocks/bonds, balanced approach)
- **Conservative** (60/40 stocks/bonds, capital preservation focus)
`}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 2: COMPREHENSIVE MARKET OUTLOOK ANALYSIS  
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**CRITICAL: First, identify which firm's outlook this is!**

Read the PDF and determine:
- Is this from JPMorgan (JPM)?
- Is this from Goldman Sachs (GS)?
- Is this from another firm?

**You MUST correctly identify the source and use it throughout your response.**
- If it's JPM LTCMA, say "JPM LTCMA" not "Goldman Sachs"
- If it's Goldman Sachs, say "Goldman Sachs" not "JPM"
- Always attribute views to the correct firm

Read the market outlook PDF thoroughly and extract:

1. **Main Thesis** (3-4 sentences, not oversimplified!)
   - What's the key macro narrative FROM THIS SPECIFIC PDF?
   - What are the main drivers STATED IN THE PDF?
   - What's the time horizon MENTIONED IN THE PDF?
   - What are the risks IDENTIFIED IN THE PDF?

2. **Specific Views FROM THE PDF:**
   - Which asset classes does THIS OUTLOOK overweight/underweight?
   - Geographic preferences stated IN THIS PDF (US vs International vs EM)?
   - Sector tilts mentioned IN THIS PDF (Tech? Financials? Energy?)?
   - Fixed income strategy FROM THIS PDF (duration, credit quality)?
   - Alternative assets mentioned IN THIS PDF?

3. **Key Themes FROM THE PDF:**
   Extract 4-6 specific actionable views DIRECTLY FROM THE PDF
   Examples FORMAT (but use actual content from PDF):
   - "JPM outlook: Overweight international equity due to narrowing earnings gap"
   - "GS outlook: Favor quality over value in current cycle"
   - "Firm's view: Add inflation protection via TIPS and commodities"
   - "Per PDF: Maintain equity exposure but increase diversification"
   
   **CRITICAL: Every view must be traceable to something IN THE PDF**
   **DO NOT make up generic recommendations - extract them from the PDF!**

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 3: PDF-DRIVEN RECOMMENDATIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**Your recommendations MUST be based on insights from the PDF, not generic advice!**

**ETF Selection Criteria (PRIORITY ORDER):**
1. **Expense Ratio** < 0.20% preferred, avoid >0.50% unless exceptional
2. **AUM** > $5B preferred for liquidity
3. **Track Record** - Active must justify fees with alpha
4. **Tax Efficiency** - ETFs > Mutual Funds

**Quality Examples:**
✅ SCHG, VUG (0.04%, huge AUM) - Excellent passive
✅ VXUS, VEA (0.05-0.07%, massive AUM) - International leaders  
✅ JGRO, AVUV (0.25-0.44%, strong active track record) - Justified active
❌ ARKK (0.75%, poor performance) - Avoid

${portfolioInfo.hasPortfolio ? `
**CRITICAL RULES FOR EXISTING PORTFOLIO:**

1. **Work WITHIN the existing portfolio value: $${portfolioInfo.totalValue.toLocaleString()}**
   - Recommendations MUST be cash-neutral (netCashRequired = 0)
   - Fund new positions by TRIMMING overweight positions
   - DO NOT require additional cash from the user
   
2. **Cash-Neutral Rebalancing Math:**
   
   Example:
   Current: $150k portfolio, want to add $15k VXUS
   
   ❌ WRONG (Requires cash):
   - ADD $15k VXUS
   - netCashRequired: $15,000
   
   ✅ CORRECT (Cash-neutral):
   - TRIM $10k from JTEK (from $18k to $8k)
   - TRIM $5k from SCHG (from $15k to $10k)
   - ADD $15k VXUS (from $12k to $27k)
   - netCashRequired: $0
   
   The dollar amounts MUST balance:
   Total TRIM amounts = Total ADD amounts

3. **Tax-Aware Recommendations:**
   - Selling positions (TRIM actions) triggers capital gains taxes
   - Avoid recommending large trims unless absolutely necessary for rebalancing
   - If trimming is needed, explain tax impact in the rationale
   - Be conservative with trim recommendations - only suggest when the PDF outlook clearly justifies it
   - **NEVER recommend consolidating similar positions (e.g., VOO to replace multiple holdings) unless user explicitly asks - the tax cost is too high**
   - **CRITICAL: You CANNOT suggest "add new cash" - you must work within the existing portfolio value**

4. **Portfolio-Aware Recommendations:**
   
   **MINIMUM REQUIREMENTS:**
   - Provide AT LEAST 6 distinct recommendations (not just 2-3)
   - **EVERY recommendation must tie back to a specific insight from the PDF**
   - Mix different types of changes based on what the PDF suggests:
     * Geographic diversification (ONLY if PDF recommends international)
     * Sector balance (ONLY sectors the PDF highlights as opportunities)
     * Asset class gaps (ONLY asset classes the PDF recommends adding)
     * Risk management (based on risks identified IN THE PDF)
     * Specific opportunities directly stated in the PDF outlook
   
   **Example of PDF-driven recommendations:**
   If PDF says "Overweight international due to valuation gap":
   → TRIM US equity, ADD international (VXUS, VEA)
   
   If PDF says "Healthcare attractive for defensive positioning":
   → ADD XLV or IXJ
   
   If PDF says "Add fixed income as rates stabilize":
   → TRIM equities, ADD BND or AGG
   
   **DO NOT make generic recommendations like "diversify into bonds" unless the PDF specifically recommends it!**
   
   **Example of GOOD variety (6+ recommendations):**
   1. TRIM JTEK $5k (reduce tech concentration)
   2. TRIM SCHG $3k (reduce large-cap growth overlap)
   3. ADD VXUS $8k (boost international from 8% to 15%)
   4. ADD XLV $5k (add missing healthcare sector)
   5. ADD BND $3k (introduce fixed income)
   6. ADD VTIP $2k (inflation protection via TIPS)
   Total: -$8k trims + $18k adds... wait this doesn't balance!
   7. TRIM FNCMX $10k (reduce Nasdaq concentration)
   Now: -$18k trims + $18k adds = $0 ✅
   
   **Example of BAD - too few/generic (only 4 recommendations):**
   1. TRIM JTEK $10k
   2. TRIM SCHG $5k
   3. ADD VXUS $15k
   4. ADD BND $5k
   (Too simple, only addresses 2 themes: international + bonds)
   
   ❌ BAD Example:
   "Buy 40% VTI, 30% VXUS, 20% BND, 10% commodities"
   (This ignores user's existing $150k portfolio!)
   
   ✅ GOOD Example:
   "Current portfolio: $150k, 47% tech/digital, 8% international
   
   Based on JPM outlook favoring diversification:
   
   TRIM (Reduce concentration):
   - Sell $5,000 of JTEK (from $18k to $13k)
   - Reduces tech from 12% to 8.7%
   
   ADD (Fill gaps):
   - Buy $10,000 of VXUS (from $12k to $22k)  
   - Increases international from 8% to 14.7%
   - Buy $5,000 of BND (new position)
   - Adds 3.3% fixed income for stability
   
   KEEP:
   - Maintain other positions
   
   Result: 
   - Same $150k total
   - Better diversification (43% tech, 15% intl, 3% bonds)
   - Aligned with JPM outlook"

3. **Respect User's Choices:**
   - If they own JTEK (active), they prefer active management
   - If they own individual stocks (NET, CRWD), they're comfortable with concentration
   - If they have IREN (crypto), they accept higher risk
   - Build on their strategy, don't replace it

4. **Size Appropriately:**
   - Don't suggest $50 trades (too small)
   - Don't suggest replacing 50% of portfolio (too aggressive)
   - Aim for 5-15% rebalancing moves
   - Prioritize highest-conviction changes

5. **SECTOR-BASED RECOMMENDATIONS (Use your sector analysis from Step 3):**
   
   Based on the sector breakdown you calculated:
   
   **If Technology is overweight (>25%):**
   - Consider adding sector-specific ETFs in underweight areas
   - Example: "Technology at 32% is overweight. Add XLF (Financials) or XLV (Healthcare) to balance."
   
   **If missing defensive sectors (Healthcare, Utilities, Consumer Staples):**
   - Recommend sector ETFs: XLV (Healthcare), XLU (Utilities), XLP (Consumer Staples)
   - Explain: "No healthcare exposure leaves portfolio vulnerable in downturns. XLV provides defensive positioning."
   
   **If Energy underweight (<5%) during inflation concerns:**
   - Consider XLE (Energy) or individual energy stocks
   - Tie to outlook: "JPM outlook notes inflation risks. Current 2% energy allocation below typical 5-7%."
   
   **Sector ETF Recommendations (when needed):**
   - XLF: Financials (0.10% ER, $50B AUM)
   - XLV: Healthcare (0.10% ER, $35B AUM)
   - XLE: Energy (0.10% ER, $30B AUM)
   - XLU: Utilities (0.10% ER, $18B AUM)
   - XLP: Consumer Staples (0.10% ER, $17B AUM)
   - XLI: Industrials (0.10% ER, $23B AUM)
   
   **IMPORTANT:** 
   - Only recommend sector ETFs if there's a clear gap or overweight
   - Explain WHY the sector matters based on the market outlook
   - Don't just say "diversify" - explain the specific sector role
   - If portfolio already has balanced sector exposure, SAY SO and don't recommend unnecessary sector funds
   - **USE SECTOR RECOMMENDATIONS to reach minimum 6 total recommendations**
   - Example: If you're adding international (1 rec) and bonds (1 rec), also add 2-3 sector-specific recommendations to reach 6+

` : `
**RECOMMENDATIONS FOR NEW PORTFOLIO:**

Since no existing portfolio, provide COMPLETE allocation suggestions for each risk profile:

**Very Aggressive Profile (100% stocks):**
- Total equity allocation: 100%
- No bonds
- Maximum growth potential
- Highest volatility
- 20+ year time horizon required
- Example: 50% US stocks (VTI), 30% International (VXUS), 20% Sectors/Themes

**Aggressive Profile (80% stocks / 20% bonds):**
- Equity allocation: 80%
- Bond allocation: 20%
- Growth-focused with modest downside protection
- 10-15 year time horizon
- Example: 45% US stocks, 25% International, 10% Sectors, 15% Investment Grade Bonds, 5% TIPS

**Moderate Profile (60% stocks / 40% bonds):**
- Equity allocation: 60%
- Bond allocation: 40%
- Balanced growth and stability
- Medium volatility tolerance
- 5-10 year time horizon
- Example: 35% US stocks, 15% International, 10% Dividend stocks, 30% Investment Grade Bonds, 10% Short-term bonds

**Conservative Profile (40% stocks / 60% bonds):**
- Equity allocation: 40%
- Bond allocation: 60%
- Capital preservation priority
- Income generation focus
- Low volatility requirement
- 3-5 year time horizon
- Example: 25% US stocks, 10% International, 5% Dividend stocks, 40% Investment Grade Bonds, 20% Short-term bonds/Money Market

For EACH profile, specify exact tickers and % allocations that sum to 100%.
CRITICAL: Bond allocations MUST match the percentages above (0%, 20%, 40%, 60%).
`}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CRITICAL MATH VERIFICATION FOR RECOMMENDATIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

BEFORE generating your JSON response, DO THIS CALCULATION:

STEP 1: List all TRIM recommendations with changeAmounts:
Example: TRIM JTEK: -$5,000

STEP 2: List all ADD recommendations with changeAmounts:
Example: ADD VXUS: +$10,000
        ADD BND: +$5,000

STEP 3: Add them ALL together:
(-$5,000) + (+$10,000) + (+$5,000) = +$10,000

STEP 4: Check if result = $0:
If +$10,000 ≠ $0 → YOU MUST FIX IT!

HOW TO FIX:
- If result is POSITIVE ($10,000): Add MORE trims
- If result is NEGATIVE (-$10,000): Add MORE adds

FINAL CHECK: Sum ALL changeAmounts = $0 ✅

**DO NOT PROCEED until this equals zero!**

Example WRONG:
TRIM JTEK: -$5,000
ADD VXUS: +$10,000
ADD BND: +$5,000
Total: $10,000 ❌ NOT ZERO!

Example CORRECT:
TRIM JTEK: -$5,000
TRIM SCHG: -$10,000  ← Added to balance
ADD VXUS: +$10,000
ADD BND: +$5,000
Total: $0 ✅ CORRECT!

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RESPONSE FORMAT (JSON ONLY)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**CRITICAL JSON FORMATTING RULES:**
1. Numbers must NOT have commas: Use 234312 NOT 234,312
2. All numbers must be valid JSON numbers (no formatting)
3. Use plain integers/decimals only

{
  ${portfolioInfo.hasPortfolio ? `"portfolioAnalysis": {
    "totalValue": ${portfolioInfo.totalValue},
    "riskProfile": "Aggressive/Moderate/Conservative based on composition",
    "sectorBreakdown": [
      {
        "sector": "Technology",
        "percentage": 26.6,
        "dollarValue": 39900,
        "assessment": "Overweight vs typical 20-25%. Concentrated in growth/software.",
        "sources": "JTEK (8.4%), SCHG (5%), NET (5%), MSFT (4%), other tech stocks (4.2%)"
      },
      {
        "sector": "Financials",
        "percentage": 8.2,
        "dollarValue": 12300,
        "assessment": "Slightly underweight vs typical 10-15%",
        "sources": "Embedded in broad ETFs, small bank holdings"
      }
      // Include all major sectors >5%, note missing sectors
    ],
    "fundClassification": {
      // **CRITICAL: Place funds in the CORRECT array based on their management style**
      // ACTIVE = Manager picks stocks (JTEK, OBMCX, ARKG, JGRO)
      // PASSIVE = Tracks an index (FNCMX, SCHG, VOO, VTI, VXUS, IXJ)
      // 
      // FNCMX MUST go in passiveFunds (it tracks Nasdaq Composite INDEX)
      // OBMCX MUST go in activeFunds (it's actively managed small-cap)
      
      "activeFunds": [
        {"ticker": "JTEK", "name": "JPMorgan U.S. Tech Leaders ETF", "reason": "Actively managed growth tech fund"},
        {"ticker": "OBMCX", "name": "Oberweis Micro-Cap Fund", "reason": "Actively managed small-cap growth fund"}
      ],
      "passiveFunds": [
        {"ticker": "SCHG", "name": "Schwab U.S. Large-Cap Growth ETF", "reason": "Tracks Dow Jones U.S. Large-Cap Growth Index"},
        {"ticker": "FNCMX", "name": "Fidelity Nasdaq Composite Index Fund", "reason": "Tracks Nasdaq Composite Index"}
      ],
      "individualStocks": ["IREN", "NET", "CRWD", "MSFT"]
    },
    "themes": [
      {
        "theme": "Growth/Tech Innovation",
        "percentage": 35,
        "dollarValue": 52500,
        "positions": "JTEK (12%, $18k), SCHG (10%, $15k), NET (5%, $7.5k), CRWD (4%, $6k), MSFT (4%, $6k)",
        "assessment": "Strong QQQ-equivalent exposure through mix of active ETF, passive index, and quality individual stocks. Well-diversified within tech theme.",
        "recommendation": "Maintain core allocation. Tech positioning is solid with mix of broad exposure (JTEK, SCHG) and quality individual names (NET, CRWD, MSFT). No need for additional QQQ or similar."
      }
      // ⚠️  CRITICAL: You MUST analyze and return themes. Group the portfolio holdings into 2-5 major investment themes.
      // Common themes: Growth/Tech, Value/Dividends, International, Fixed Income, Real Estate, Energy/Commodities, etc.
      // Calculate percentage and dollar value for each theme. List specific positions in each theme.
    ],
    "gaps": [
      "International equity at only 8% ($12k) - typical allocation 20-40%",
      "Zero fixed income allocation - adds volatility without downside protection",
      "No Healthcare sector exposure - missing defensive sector",
      "Energy sector at 2% vs typical 5-7% - underweight inflation hedge"
    ],
    "concentrations": [
      "Technology sector: 26.6% - overweight by 6% vs typical allocation",
      "Tech + Communication Services: 36% combined - significant growth sector concentration",
      "Single-stock IREN: 12% ($18k) - large position in volatile crypto/infrastructure play"
    ],
    "strengths": [
      "Quality selection within tech (JTEK over ARKK, NET/CRWD are leaders)",
      "Mix of active (JTEK) and passive (SCHG) shows thoughtful approach",
      "Individual stocks (NET, CRWD, MSFT) are high-quality businesses"
    ]
  }` : `"portfolioAnalysis": null`},
  ${!portfolioInfo.hasPortfolio ? `"proposedPortfolio": {
    "rationale": "3-4 sentence explanation of why this allocation makes sense given the outlook's key themes and market views",
    "allocation": [
      {
        "ticker": "VOO",
        "name": "Vanguard S&P 500 ETF",
        "assetClass": "US Large Cap Equity",
        "targetWeight": 40,
        "targetValue": 40000,
        "rationale": "Specific reason based on PDF outlook with page citation (Firm name, p. XX)"
      }
      // Add 8-12 holdings to create a diversified portfolio
      // Include: US equity, International equity, Bonds, Real Estate, Commodities, etc.
      // Each holding MUST have a rationale citing the PDF
    ],
    "totalValue": 100000,
    "expectedReturn": 8.5,
    "expectedVolatility": 12.3,
    "keyCharacteristics": [
      "Well-diversified across asset classes",
      "Aligns with PDF's bullish/bearish themes",
      "Appropriate risk level for current market environment"
    ]
  },
  "riskProfileNeeded": false` : `"riskProfileNeeded": false`},
  "summary": "Comprehensive 3-4 sentence summary capturing the main thesis, key drivers, outlook period, and primary risks. DO NOT oversimplify - include nuance and detail from the PDF.",
  "keyViews": [
    "Specific actionable view 1 with reasoning",
    "Specific actionable view 2 with reasoning",
    "Specific actionable view 3 with reasoning",
    "Specific actionable view 4 with reasoning"
  ],
  ${portfolioInfo.hasPortfolio ? `"recommendations": [
    // **━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━**
    // **STOP! BEFORE WRITING ANY RECOMMENDATIONS:**
    // **━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━**
    // 
    // CRITICAL: BOTH TRIMs AND ADDs MUST reference the PDF outlook WITH PAGE NUMBERS:
    //
    // ADD recommendations MUST include page citations AT THE END:
    // - "International diversification opportunities with narrowing earnings gap (JPM outlook, p. 45)"
    // - "Fixed income attractive at current yields (Goldman Sachs, p. 23)"
    // - "Healthcare provides defensive positioning in uncertain environment (JPM, p. 67)"
    //
    // TRIM recommendations should explain WHY based on PDF WITH PAGE NUMBER AT THE END:
    // - "Tech expected to underperform value amid rate normalization, reducing exposure (JPM, p. 34)"
    // - "Reducing overweight position in response to valuation concerns (Goldman Sachs, p. 56)"
    //
    // Format: End every rationale with "(Firm name, p. XX)"
    //
    // Examples:
    // ❌ WRONG: "Reduce tech concentration" (no PDF reference, no page)
    // ❌ WRONG: "Per JPM outlook (p. 34) expecting tech underperformance..." (page at beginning)
    // ❌ WRONG: "Add healthcare for defensive positioning (HSBC, p. 5)" (if healthcare NOT on page 5!)
    // ✅ CORRECT: "Tech expected to underperform value amid rate normalization, reducing concentrated position (JPM outlook, p. 34)"
    //
    // ❌ WRONG: "Add bonds for diversification" (no PDF reference, no page)
    // ❌ WRONG: "JPM outlook recommends fixed income" (no page number)
    // ❌ WRONG: "Add international equity for diversification (HSBC, p. 12)" (if PDF doesn't emphasize international!)
    // ✅ CORRECT: "Fixed income attractive at 4.5% yields as rates stabilize. BND offers broad exposure at minimal cost (JPM outlook, p. 45)"
    // ✅ CORRECT: "Financials positioned to benefit from rate environment and economic resilience (HSBC outlook, p. 8)"
    //
    // If you don't have enough TRIMs to balance the math, it's OK - the backend will
    // auto-generate additional TRIMs from largest positions. Focus on strategic TRIMs
    // that align with the PDF outlook and INCLUDE PAGE NUMBERS AT THE END.
    //
    // DO THIS MATH FIRST (write it out):
    // 
    // Portfolio Value: $${portfolioInfo.totalValue}
    // 
    // My planned TRIMs (from PDF outlook):
    // - TRIM [ticker]: -$___ (because PDF says...)
    // - TRIM [ticker]: -$___ (because PDF says...)
    // Total TRIMs: -$___
    // 
    // My planned ADDs (from PDF outlook):
    // - ADD [ticker]: +$___ (because PDF recommends...)
    // - ADD [ticker]: +$___ (because PDF recommends...)
    // Total ADDs: +$___
    // 
    // BALANCE CHECK: TRIMs + ADDs = ?
    // If NOT $0 → That's OK! Backend will auto-generate more TRIMs to balance.
    //            Just make sure YOUR TRIMs reference the PDF.
    // 
    // Only AFTER checking that each recommendation references the PDF, write the JSON below.
    // **━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━**
    
    {
      "action": "TRIM",
      "ticker": "JTEK",
      "currentAmount": 18000,
      "newAmount": 13000,
      "changeAmount": -5000,
      "currentPercent": 12,
      "newPercent": 8.7,
      "rationale": "Tech expected to underperform value amid rate normalization, reducing concentrated position. JTEK remains core holding at more prudent 8.7% allocation (JPM outlook, p. 34)"
    },
    {
      "action": "ADD",
      "ticker": "VXUS",
      "name": "Vanguard Total International Stock ETF",
      "currentAmount": 12000,
      "newAmount": 22000,
      "changeAmount": 10000,
      "currentPercent": 8,
      "newPercent": 14.7,
      "rationale": "Narrowing US/international earnings gap and structural improvements overseas create opportunity. VXUS (0.07% ER, $85B AUM) provides broad international exposure (JPM outlook, p. 45)"
    },
    {
      "action": "ADD",
      "ticker": "BND",
      "name": "Vanguard Total Bond Market ETF",
      "currentAmount": 0,
      "newAmount": 5000,
      "changeAmount": 5000,
      "currentPercent": 0,
      "newPercent": 3.3,
      "rationale": "Fixed income attractive at 4.5% yields as interest rates stabilize. BND (0.03% ER, $115B AUM) offers broad bond market exposure at minimal cost (JPM outlook, p. 23)"
    }
  ],
  "netCashRequired": 0` : `"recommendations": {
    "veryAggressive": [
      {"ticker": "VTI", "allocation": 50, "rationale": "..."},
      {"ticker": "VXUS", "allocation": 30, "rationale": "..."}
    ],
    "aggressive": [
      {"ticker": "VTI", "allocation": 40, "rationale": "..."},
      {"ticker": "VXUS", "allocation": 30, "rationale": "..."}
    ],
    "moderate": [
      {"ticker": "VTI", "allocation": 35, "rationale": "..."},
      {"ticker": "BND", "allocation": 20, "rationale": "..."}
    ],
    "conservative": [
      {"ticker": "BND", "allocation": 40, "rationale": "..."}
    ]
  },`},
  "expectedImpact": {
    "portfolioValue": ${portfolioInfo.totalValue || 'N/A'},
    "riskLevel": "Based on stock/bond allocation after recommendations",
    "expectedReturn": "Calculate weighted average return using asset allocations from your recommendations and the LTCMA return assumptions from THE PDF YOU READ (use the correct firm name - JPM, Goldman Sachs, etc.). Show the math: 'Based on [FIRM NAME] LTCMA: X% US equity (Y% return) + Z% International (W% return) + ... = A% blended return'",
    "volatilityChange": "Calculate based on adding diversification and bonds. Provide specific estimate.",
    "diversificationScore": "Rate 1-10 based on: geographic diversification, asset class mix, sector balance"
  }
}

**RESPOND WITH ONLY THE JSON. NO OTHER TEXT.**`
              }
            ]
          }
        ]
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        }
      }
    );

    console.log('✅ Claude API Response Received');

    // Extract text response
    const aiResponse = response.data.content.find(c => c.type === 'text')?.text || '';
    
    console.log('📝 Raw AI Response (first 500 chars):', aiResponse.substring(0, 500));
    
    // Parse JSON from response
    const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('❌ Could not find JSON in AI response');
      console.error('Full response:', aiResponse);
      throw new Error('Could not parse JSON from AI response - no JSON object found');
    }

    // Clean the JSON string - remove commas from numbers (e.g., 234,312 -> 234312)
    // This fixes Claude's habit of formatting large numbers with commas
    let cleanedJson = jsonMatch[0];
    cleanedJson = cleanedJson.replace(/:\s*(\d{1,3}(,\d{3})+)/g, (match, num) => {
      return ': ' + num.replace(/,/g, '');
    });
    
    console.log('🧹 Cleaned JSON (first 500 chars):', cleanedJson.substring(0, 500));

    let analysisData;
    try {
      analysisData = JSON.parse(cleanedJson);
    } catch (parseError) {
      console.error('❌ JSON Parse Error:', parseError.message);
      console.error('Cleaned JSON (first 1000 chars):', cleanedJson.substring(0, 1000));
      console.error('Original JSON (first 1000 chars):', jsonMatch[0].substring(0, 1000));
      throw new Error(`Failed to parse JSON: ${parseError.message}`);
    }
    
    // Validate response structure
    if (!analysisData || typeof analysisData !== 'object') {
      throw new Error('Invalid response format from AI');
    }
    
    // Ensure required fields exist
    if (!analysisData.summary) {
      analysisData.summary = 'Analysis completed';
    }
    if (!analysisData.keyViews) {
      analysisData.keyViews = [];
    }
    if (!analysisData.recommendations) {
      analysisData.recommendations = [];
    }
    
    // Log what we got
    console.log('📊 Parsed Analysis Data:', {
      hasPortfolioAnalysis: !!analysisData.portfolioAnalysis,
      hasRecommendations: !!analysisData.recommendations,
      recommendationsType: Array.isArray(analysisData.recommendations) ? 'array' : typeof analysisData.recommendations,
      recommendationsLength: Array.isArray(analysisData.recommendations) ? analysisData.recommendations.length : 'N/A'
    });
    
    // VALIDATE: Check that recommendations are cash-neutral
    if (Array.isArray(analysisData.recommendations) && analysisData.recommendations.length > 0) {
      // FIRST: Fix FNCMX misclassification (HARD OVERRIDE)
      if (analysisData.portfolioAnalysis?.fundClassification) {
        const classification = analysisData.portfolioAnalysis.fundClassification;
        
        // Check if FNCMX is in activeFunds (WRONG!)
        if (classification.activeFunds) {
          const fncmxInActive = classification.activeFunds.find(f => f.ticker === 'FNCMX');
          if (fncmxInActive) {
            console.warn(`⚠️  CRITICAL ERROR: FNCMX classified as ACTIVE (WRONG!)`);
            console.warn(`   Force-fixing: Moving FNCMX to passiveFunds`);
            
            // Remove from active
            classification.activeFunds = classification.activeFunds.filter(f => f.ticker !== 'FNCMX');
            
            // Add to passive if not already there
            if (!classification.passiveFunds) classification.passiveFunds = [];
            const fncmxInPassive = classification.passiveFunds.find(f => f.ticker === 'FNCMX');
            if (!fncmxInPassive) {
              classification.passiveFunds.push({
                ticker: 'FNCMX',
                name: 'Fidelity Nasdaq Composite Index Fund',
                reason: 'Tracks Nasdaq Composite Index (PASSIVE index fund)'
              });
            }
            
            console.log(`   ✅ FNCMX corrected to PASSIVE`);
          }
        }
      }
      
      // SECOND: Remove invalid ADD recommendations (negative amounts)
      const invalidAdds = analysisData.recommendations.filter(r => 
        r.action === 'ADD' && r.changeAmount < 0
      );
      
      if (invalidAdds.length > 0) {
        console.warn(`⚠️  WARNING: Found ${invalidAdds.length} invalid ADD recommendations with negative amounts!`);
        invalidAdds.forEach(add => {
          console.warn(`   ${add.ticker}: changeAmount = $${add.changeAmount.toLocaleString()} (should be positive)`);
        });
        
        // Remove invalid ADDs
        analysisData.recommendations = analysisData.recommendations.filter(r => 
          !(r.action === 'ADD' && r.changeAmount < 0)
        );
        
        console.log(`   ✅ Removed ${invalidAdds.length} invalid recommendations`);
      }
      
      // THIRD: Check minimum count
      if (analysisData.recommendations.length < 6) {
        console.warn(`⚠️  WARNING: Only ${analysisData.recommendations.length} recommendations provided (minimum 6 requested)`);
      } else {
        console.log(`✅ Recommendation count: ${analysisData.recommendations.length}`);
      }
      
      // VALIDATE: Check if recommendations reference the PDF/outlook in their rationales
      console.log('\n📋 Validating PDF-based recommendations:');
      
      const pdfKeywords = ['jpm', 'jpmorgan', 'goldman', 'sachs', 'outlook', 'ltcma', 'forecast', 
                           'per pdf', 'according to', 'highlights', 'recommends', 'suggests',
                           'identifies', 'views', 'expects', 'projects', 'anticipates'];
      
      // Validate ADD recommendations
      console.log('\n  📈 ADD Recommendations:');
      const addRecommendations = analysisData.recommendations.filter(r => r.action === 'ADD');
      let suspiciousAdds = 0;
      let missingPageAdds = 0;
      
      addRecommendations.forEach(rec => {
        const rationale = (rec.rationale || '').toLowerCase();
        const hasPdfReference = pdfKeywords.some(keyword => rationale.includes(keyword));
        const hasPageCitation = /\(p\.\s*\d+\)|\(page\s*\d+\)/i.test(rec.rationale || '');
        
        if (!hasPdfReference && !rationale.includes('auto-generated')) {
          console.warn(`   ⚠️  SUSPICIOUS: ${rec.ticker} - Rationale doesn't reference PDF`);
          console.warn(`      "${rec.rationale.substring(0, 80)}..."`);
          suspiciousAdds++;
        } else if (rationale.includes('auto-generated')) {
          console.log(`   🔧 ${rec.ticker}: Auto-generated`);
        } else if (!hasPageCitation) {
          console.warn(`   ⚠️  MISSING PAGE: ${rec.ticker} - No page citation (e.g., "p. 45")`);
          console.warn(`      "${rec.rationale.substring(0, 80)}..."`);
          missingPageAdds++;
        } else {
          console.log(`   ✅ ${rec.ticker}: PDF-referenced with page citation`);
        }
      });
      
      // Validate TRIM recommendations
      console.log('\n  📉 TRIM Recommendations:');
      const trimRecommendations = analysisData.recommendations.filter(r => r.action === 'TRIM');
      let suspiciousTrims = 0;
      let missingPageTrims = 0;
      let autoGeneratedTrims = 0;
      
      trimRecommendations.forEach(rec => {
        const rationale = (rec.rationale || '').toLowerCase();
        const hasPdfReference = pdfKeywords.some(keyword => rationale.includes(keyword));
        const isAutoGenerated = rationale.includes('auto-generated');
        const hasPageCitation = /\(p\.\s*\d+\)|\(page\s*\d+\)/i.test(rec.rationale || '');
        
        if (isAutoGenerated) {
          console.log(`   🔧 ${rec.ticker}: Auto-generated (funding mechanism)`);
          autoGeneratedTrims++;
        } else if (!hasPdfReference) {
          console.warn(`   ⚠️  SUSPICIOUS: ${rec.ticker} - Rationale doesn't reference PDF`);
          console.warn(`      "${rec.rationale.substring(0, 80)}..."`);
          suspiciousTrims++;
        } else if (!hasPageCitation) {
          console.warn(`   ⚠️  MISSING PAGE: ${rec.ticker} - No page citation (e.g., "p. 45")`);
          console.warn(`      "${rec.rationale.substring(0, 80)}..."`);
          missingPageTrims++;
        } else {
          console.log(`   ✅ ${rec.ticker}: PDF-referenced with page citation`);
        }
      });
      
      // Summary
      console.log('\n  📊 Validation Summary:');
      if (suspiciousAdds > 0) {
        console.warn(`   ⚠️  ${suspiciousAdds} ADDs may not be from PDF (generic advice)`);
      }
      if (missingPageAdds > 0) {
        console.warn(`   ⚠️  ${missingPageAdds} ADDs missing page citations`);
      }
      if (suspiciousAdds === 0 && missingPageAdds === 0) {
        console.log(`   ✅ All ADDs reference the PDF outlook with page numbers`);
      }
      
      if (suspiciousTrims > 0) {
        console.warn(`   ⚠️  ${suspiciousTrims} TRIMs may not be from PDF (generic advice)`);
      }
      if (missingPageTrims > 0) {
        console.warn(`   ⚠️  ${missingPageTrims} TRIMs missing page citations`);
      }
      if (suspiciousTrims === 0 && missingPageTrims === 0 && autoGeneratedTrims === 0) {
        console.log(`   ✅ All TRIMs reference the PDF outlook with page numbers`);
      } else if (suspiciousTrims === 0 && missingPageTrims === 0) {
        console.log(`   ✅ All non-auto-generated TRIMs reference the PDF outlook with page numbers`);
      }
      
      if (autoGeneratedTrims > 0) {
        console.log(`   🔧 ${autoGeneratedTrims} TRIMs auto-generated to achieve cash neutrality`);
      }
      
      // FOURTH: AGGRESSIVE CASH-NEUTRAL ENFORCEMENT
      let totalChange = analysisData.recommendations.reduce((sum, rec) => sum + (rec.changeAmount || 0), 0);
      
      console.log('💰 Cash Neutrality Check:');
      analysisData.recommendations.forEach(rec => {
        if (rec.changeAmount) {
          console.log(`  ${rec.action} ${rec.ticker}: ${rec.changeAmount > 0 ? '+' : ''}$${rec.changeAmount.toLocaleString()}`);
        }
      });
      console.log(`  ━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`  Total: $${totalChange.toLocaleString()}`);
      
      if (Math.abs(totalChange) > 0.01) {
        console.warn(`⚠️  NOT CASH NEUTRAL! Net: $${totalChange.toLocaleString()}`);
        console.warn(`   🔧 AUTO-GENERATING TRIMs TO FUND ALL ADDs...`);
        
        // STRATEGY: Always keep the ADD recommendations (those are strategic)
        // Generate TRIMs from the portfolio to fund them
        
        const shortfall = totalChange; // Positive = need more TRIM, Negative = need less TRIM
        
        if (shortfall > 0.01) {
          // Need MORE TRIMs to fund the ADDs
          console.log(`   Need $${shortfall.toLocaleString()} in additional TRIMs to fund ADDs`);
          
          if (portfolioData && portfolioData.length > 0) {
            // Calculate how much of each position is already being trimmed
            const portfolioPositions = portfolioData
              .map(pos => ({
                ticker: pos.ticker,
                value: pos.value,
                percentOfPortfolio: (pos.value / portfolioInfo.totalValue * 100),
                alreadyTrimmed: analysisData.recommendations
                  .filter(r => r.action === 'TRIM' && r.ticker === pos.ticker)
                  .reduce((sum, r) => sum + Math.abs(r.changeAmount), 0)
              }))
              .map(pos => ({
                ...pos,
                availableToTrim: pos.value - pos.alreadyTrimmed,
                hasExistingTrim: pos.alreadyTrimmed > 0
              }))
              .filter(pos => pos.availableToTrim > 100); // Must have at least $100 available
            
            // INTELLIGENT SORTING: Prioritize positions that align with outlook
            portfolioPositions.sort((a, b) => {
              // Priority 1: Positions already being trimmed (Claude identified these as overweight)
              if (a.hasExistingTrim && !b.hasExistingTrim) return -1;
              if (!a.hasExistingTrim && b.hasExistingTrim) return 1;
              
              // Priority 2: Larger positions (more overweight = higher priority to trim)
              // A position that's 20% of portfolio should be trimmed before one that's 5%
              if (a.percentOfPortfolio > 15 && b.percentOfPortfolio < 10) return -1;
              if (a.percentOfPortfolio < 10 && b.percentOfPortfolio > 15) return 1;
              
              // Priority 3: Largest available to trim (default)
              return b.availableToTrim - a.availableToTrim;
            });
            
            console.log(`\n   📊 INTELLIGENT TRIM SELECTION (sorted by priority):`);
            console.log(`   Priority: Existing TRIMs > Large positions (>15%) > Available amount\n`);
            portfolioPositions.slice(0, 5).forEach((pos, idx) => {
              const priorityReason = pos.hasExistingTrim 
                ? '(already trimming - align with outlook)' 
                : pos.percentOfPortfolio > 15 
                  ? `(${pos.percentOfPortfolio.toFixed(1)}% - concentrated position)` 
                  : '(available balance)';
              console.log(`     ${idx + 1}. ${pos.ticker}: $${pos.availableToTrim.toLocaleString()} available ${priorityReason}`);
            });
            
            let remaining = shortfall;
            let trimsGenerated = 0;
            
            // Generate TRIMs from prioritized positions
            for (const pos of portfolioPositions) {
              if (remaining <= 0.01) break;
              if (pos.availableToTrim <= 0) continue;
              
              // Trim up to 70% of the available amount
              // For positions already being trimmed, we can be more aggressive (they're overweight per outlook)
              const trimPercentage = pos.hasExistingTrim ? 0.8 : 0.7; // 80% if already trimming, 70% otherwise
              const maxTrim = pos.availableToTrim * trimPercentage;
              const trimAmount = Math.min(remaining, maxTrim);
              
              if (trimAmount < 50) continue; // Skip if less than $50
              
              const reason = pos.hasExistingTrim 
                ? 'aligns with existing TRIM recommendation from outlook' 
                : pos.percentOfPortfolio > 15 
                  ? `reduces concentrated position (${pos.percentOfPortfolio.toFixed(1)}% of portfolio)` 
                  : 'from available balance';
              
              console.log(`   🔨 AUTO-TRIM ${pos.ticker}: -$${trimAmount.toLocaleString()} (${reason})`);
              
              // Check if there's already a TRIM for this ticker
              const existingTrim = analysisData.recommendations.find(
                r => r.action === 'TRIM' && r.ticker === pos.ticker
              );
              
              if (existingTrim) {
                // CONSOLIDATE: Increase the existing TRIM instead of creating duplicate
                console.log(`   ↪️  Consolidating with existing ${pos.ticker} TRIM`);
                console.log(`      Original: -$${Math.abs(existingTrim.changeAmount).toLocaleString()} → New: -$${(Math.abs(existingTrim.changeAmount) + trimAmount).toLocaleString()}`);
                
                // Update the existing TRIM
                existingTrim.changeAmount -= trimAmount;
                existingTrim.newAmount -= trimAmount;
                existingTrim.newPercent = ((existingTrim.newAmount / portfolioInfo.totalValue * 100).toFixed(1));
                
                // Update rationale to note it was increased for balance
                if (!existingTrim.rationale.includes('(increased to fund')) {
                  existingTrim.rationale += ` (increased to fund ADD recommendations)`;
                }
              } else {
                // Add new TRIM recommendation (no existing one)
                const newCurrentAmount = pos.value - pos.alreadyTrimmed;
                analysisData.recommendations.push({
                  action: 'TRIM',
                  ticker: pos.ticker,
                  currentAmount: newCurrentAmount,
                  newAmount: newCurrentAmount - trimAmount,
                  changeAmount: -trimAmount,
                  currentPercent: (newCurrentAmount / portfolioInfo.totalValue * 100).toFixed(1),
                  newPercent: ((newCurrentAmount - trimAmount) / portfolioInfo.totalValue * 100).toFixed(1),
                  rationale: `Auto-generated to fund ADD recommendations (${reason}). Total funding needed: $${shortfall.toLocaleString()}`
                });
              }
              
              remaining -= trimAmount;
              trimsGenerated++;
            }
            
            if (remaining > 0.01) {
              console.warn(`   ⚠️  Could only generate $${(shortfall - remaining).toLocaleString()} in TRIMs (need $${remaining.toLocaleString()} more)`);
              console.warn(`   Portfolio may not have enough liquid positions to trim`);
              analysisData.netCashRequired = remaining;
            } else {
              const consolidated = trimsGenerated - analysisData.recommendations.filter(r => r.action === 'TRIM' && r.rationale.includes('Auto-generated')).length;
              if (consolidated > 0) {
                console.log(`   ✅ CONSOLIDATED ${consolidated} existing TRIMs, GENERATED ${trimsGenerated - consolidated} new TRIMs`);
              } else {
                console.log(`   ✅ GENERATED ${trimsGenerated} new TRIMs`);
              }
              console.log(`   💰 Total: $${shortfall.toLocaleString()} - ADDs fully funded by TRIMs - Balance: $0`);
              analysisData.netCashRequired = 0;
            }
          } else {
            console.error(`   ❌ No portfolio data available to generate TRIMs`);
            analysisData.netCashRequired = shortfall;
          }
          
        } else if (shortfall < -0.01) {
          // Have TOO MUCH TRIM (this is rare but possible)
          // Reduce existing TRIMs to balance
          const excessTrim = Math.abs(shortfall);
          console.log(`   Have $${excessTrim.toLocaleString()} excess TRIM - reducing TRIMs...`);
          
          const trims = analysisData.recommendations
            .filter(r => r.action === 'TRIM' && r.changeAmount < 0)
            .sort((a, b) => a.changeAmount - b.changeAmount); // Most negative first
          
          let remaining = excessTrim;
          
          for (const trim of trims) {
            if (remaining <= 0.01) break;
            
            const currentTrimAmount = Math.abs(trim.changeAmount);
            const reductionAmount = Math.min(remaining, currentTrimAmount);
            
            console.log(`   Reducing ${trim.ticker} TRIM: -$${currentTrimAmount.toLocaleString()} → -$${(currentTrimAmount - reductionAmount).toLocaleString()}`);
            
            trim.changeAmount += reductionAmount; // Make less negative
            trim.newAmount += reductionAmount;
            remaining -= reductionAmount;
            
            if (Math.abs(trim.changeAmount) < 0.01) {
              console.log(`   Removing ${trim.ticker} TRIM (reduced to $0)`);
              analysisData.recommendations = analysisData.recommendations.filter(r => r !== trim);
            }
          }
          
          if (remaining < 0.01) {
            console.log(`   ✅ Reduced TRIMs to match ADDs - Balance: $0`);
            analysisData.netCashRequired = 0;
          } else {
            console.warn(`   ⚠️  Still have $${remaining.toLocaleString()} excess TRIM`);
            analysisData.netCashRequired = -remaining;
          }
        }
        
        // Recalculate final total
        totalChange = analysisData.recommendations.reduce((sum, rec) => sum + (rec.changeAmount || 0), 0);
        
        console.log(`\n   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        console.log(`   📊 FINAL BALANCE CHECK:`);
        console.log(`   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        
        const finalTrims = analysisData.recommendations.filter(r => r.action === 'TRIM');
        const finalAdds = analysisData.recommendations.filter(r => r.action === 'ADD');
        
        const totalTrims = finalTrims.reduce((sum, r) => sum + r.changeAmount, 0);
        const totalAdds = finalAdds.reduce((sum, r) => sum + r.changeAmount, 0);
        
        console.log(`   TRIMs (${finalTrims.length}): $${totalTrims.toLocaleString()}`);
        console.log(`   ADDs (${finalAdds.length}): +$${totalAdds.toLocaleString()}`);
        console.log(`   NET: $${totalChange.toLocaleString()}`);
        console.log(`   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        
        if (Math.abs(totalChange) < 0.01) {
          console.log(`   ✅ CASH NEUTRAL - Ready to send to user`);
        } else {
          console.warn(`   ⚠️  Still off by $${totalChange.toLocaleString()}`);
        }
        
      } else {
        console.log(`  ✅ Cash neutral verified (Claude got it right!)`);
        analysisData.netCashRequired = 0;
      }
    }
    
    console.log('📈 Analysis Complete');

    // Cache the outlook analysis for future use
    if (!cachedOutlook) {
      // Only cache if this was a new analysis
      await cacheOutlook(pdfHash, analysisData);
      console.log('💾 Outlook cached to Upstash Redis (permanent)');
    }

    // Send successful response
    const cacheStats = await getCacheStats();
    res.json({
      success: true,
      data: analysisData,
      cached: !!cachedOutlook,
      cache_stats: cacheStats,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error in PDF analysis:', error.message);
    console.error('❌ Error stack:', error.stack);
    console.error('❌ Error details:', {
      name: error.name,
      code: error.code,
      response: error.response ? {
        status: error.response.status,
        statusText: error.response.statusText,
        headers: error.response.headers,
        data: error.response.data
      } : 'No response'
    });
    
    // Log the full Anthropic error if available
    if (error.response?.data?.error) {
      console.error('❌ Anthropic Error Details:', JSON.stringify(error.response.data.error, null, 2));
    }
    
    // Determine user-friendly error message
    let userMessage = 'An error occurred while analyzing your PDF.';
    let errorType = 'UNKNOWN_ERROR';
    
    // File size errors
    if (error.message?.includes('File too large') || error.code === 'LIMIT_FILE_SIZE') {
      userMessage = 'PDF file is too large. Maximum file size is 15MB. Please try a smaller file or compress your PDF.';
      errorType = 'FILE_TOO_LARGE';
    }
    // Rate limit errors
    else if (error.response?.status === 429) {
      userMessage = 'Too many requests. Please wait a few minutes and try again.';
      errorType = 'RATE_LIMIT';
    }
    // API errors
    else if (error.response?.status >= 500) {
      userMessage = 'Our AI service is temporarily unavailable. Please try again in a few minutes.';
      errorType = 'API_ERROR';
    }
    // PDF parsing errors
    else if (error.message?.includes('parse') || error.message?.includes('PDF')) {
      userMessage = 'Unable to read this PDF. The file may be corrupted, password-protected, or in an unsupported format. Please try a different file.';
      errorType = 'PDF_PARSE_ERROR';
    }
    // JSON parsing errors
    else if (error.message?.includes('JSON')) {
      userMessage = 'AI response was invalid. This is a temporary issue - please try again.';
      errorType = 'INVALID_RESPONSE';
    }
    // Network errors
    else if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
      userMessage = 'Unable to connect to AI service. Please check your internet connection and try again.';
      errorType = 'NETWORK_ERROR';
    }
    
    // Send user-friendly error response
    res.status(error.response?.status || 500).json({
      success: false,
      error: userMessage,
      errorType: errorType,
      technicalDetails: process.env.NODE_ENV === 'development' ? error.message : undefined,
      timestamp: new Date().toISOString()
    });
  }
});

// ==================== FINANCIAL STATEMENT PARSER ENDPOINT ====================
/**
 * Parse financial statements from PDFs using Claude AI
 * Accepts 3 PDFs: income statement, balance sheet, cash flow
 * Caches results permanently by combined hash
 */
app.post('/api/parse-financials', upload.fields([
  { name: 'income', maxCount: 1 },
  { name: 'balance', maxCount: 1 },
  { name: 'cashFlow', maxCount: 1 }
]), async (req, res) => {
  try {
    console.log('📊 Financial Statement Parse Request Received');
    
    // Validate files
    if (!req.files || !req.files.income || !req.files.balance || !req.files.cashFlow) {
      return res.status(400).json({
        success: false,
        error: 'All three financial statements required (income, balance, cashFlow)'
      });
    }
    
    const incomeFile = req.files.income[0];
    const balanceFile = req.files.balance[0];
    const cashFlowFile = req.files.cashFlow[0];
    
    console.log(`📄 Files received:`);
    console.log(`   Income: ${incomeFile.originalname} (${(incomeFile.size / 1024).toFixed(2)} KB)`);
    console.log(`   Balance: ${balanceFile.originalname} (${(balanceFile.size / 1024).toFixed(2)} KB)`);
    console.log(`   Cash Flow: ${cashFlowFile.originalname} (${(cashFlowFile.size / 1024).toFixed(2)} KB)`);
    
    // Calculate hashes
    const incomeHash = getPdfHash(incomeFile.buffer);
    const balanceHash = getPdfHash(balanceFile.buffer);
    const cashFlowHash = getPdfHash(cashFlowFile.buffer);
    
    console.log(`🔑 Statement hashes calculated`);
    
    // Check cache
    const cachedFinancials = await getCachedFinancials(incomeHash, balanceHash, cashFlowHash);
    
    if (cachedFinancials) {
      console.log('✅ CACHE HIT - Using cached financial data');
      console.log(`💰 Cost saved: ~$0.30`);
      
      return res.json({
        success: true,
        data: cachedFinancials,
        cached: true,
        cache_source: 'Upstash Redis (permanent)',
        timestamp: new Date().toISOString()
      });
    }
    
    console.log('❌ CACHE MISS - Parsing PDFs with Claude AI...');
    
    // Parse PDFs to extract text
    const incomeText = await pdfParse(incomeFile.buffer);
    const balanceText = await pdfParse(balanceFile.buffer);
    const cashFlowText = await pdfParse(cashFlowFile.buffer);
    
    console.log(`📖 PDF text extracted:`);
    console.log(`   Income: ${incomeText.numpages} pages, ${incomeText.text.length} chars`);
    console.log(`   Balance: ${balanceText.numpages} pages, ${balanceText.text.length} chars`);
    console.log(`   Cash Flow: ${cashFlowText.numpages} pages, ${cashFlowText.text.length} chars`);
    
    // Hybrid approach: Send full text if small, use smart finder if large
    const processText = (text, keywords, statementName) => {
      const MAX_SMALL_PDF = 100000; // 100k chars = small enough to send entire thing
      const MAX_SECTION_SIZE = 150000; // 150k chars = maximum section size
      
      if (text.length <= MAX_SMALL_PDF) {
        console.log(`   📄 ${statementName}: Small PDF, sending entire text (${text.length} chars)`);
        return text;
      }
      
      console.log(`   🔍 ${statementName}: Large PDF, using smart section finder...`);
      
      // Smart section finder for large PDFs
      const lowerText = text.toLowerCase();
      let bestStart = 0;
      let bestScore = 0;
      
      // Search for sections with high keyword density
      const chunkSize = 30000;
      for (let i = 0; i < text.length; i += chunkSize / 2) {
        const chunk = text.substring(i, Math.min(i + chunkSize, text.length));
        const lowerChunk = chunk.toLowerCase();
        let score = 0;
        keywords.forEach(kw => {
          const matches = (lowerChunk.match(new RegExp(kw, 'gi')) || []).length;
          score += matches;
        });
        if (score > bestScore) {
          bestScore = score;
          bestStart = i;
        }
      }
      
      // Return up to MAX_SECTION_SIZE chars starting from best position
      const sectionText = text.substring(bestStart, Math.min(bestStart + MAX_SECTION_SIZE, text.length));
      console.log(`      Found best section at position ${bestStart.toLocaleString()}, extracting ${sectionText.length} chars`);
      return sectionText;
    };
    
    // Process each statement with hybrid approach
    const incomeSection = processText(incomeText.text, [
      'revenue', 'net sales', 'net income', 'earnings', 'operating income', 
      'cost of revenue', 'gross profit', 'consolidated statements of operations'
    ], 'Income Statement');
    
    const balanceSection = processText(balanceText.text, [
      'total assets', 'total liabilities', 'stockholders equity', 'current assets',
      'cash and cash equivalents', 'total debt', 'consolidated balance sheets'
    ], 'Balance Sheet');
    
    const cashFlowSection = processText(cashFlowText.text, [
      'operating activities', 'cash flow', 'investing activities', 'financing activities',
      'free cash flow', 'capital expenditure', 'consolidated statements of cash flows'
    ], 'Cash Flow Statement');
    
    const totalChars = incomeSection.length + balanceSection.length + cashFlowSection.length;
    console.log(`📊 Total text to send to Claude: ${totalChars.toLocaleString()} chars (~${Math.round(totalChars / 4)} tokens)`);
    
    // Prepare Claude extraction prompt with detailed examples
    const extractionPrompt = `You are a financial data extraction expert analyzing 10-K filings or annual reports.

**YOUR TASK:**
Extract financial data from the three statement sections and return structured JSON data.

**CRITICAL UNIT CONVERSION:**
- Most 10-Ks show amounts "in thousands" or "in millions"
- You MUST convert to actual dollars
- Example: If statement shows "Revenue: 391,035" and header says "in millions" → revenue = 391035000000
- Example: If statement shows "Cash: 29,965" and header says "in thousands" → cash = 29965000

**REAL EXAMPLE - APPLE 2024 10-K:**
Income Statement header: "in millions except per share amounts"
Shows: Revenue $391,035
Correct JSON: "revenue": 391035000000

Balance Sheet header: "in millions"
Shows: Total Assets $364,980
Correct JSON: "totalAssets": 364980000000

Cash Flow Statement header: "in millions"  
Shows: Operating Cash Flow $118,254
Correct JSON: "operatingCashFlow": 118254000000

**EXTRACTION STRATEGY:**
1. Find the unit indicator (look for "in thousands", "in millions", "in billions")
2. Locate the consolidated statements (not segment data)
3. **CRITICAL: Look for the FULL TABLE with MULTIPLE YEAR COLUMNS**
   - Financial statements in 10-Ks show data in a TABLE with years as COLUMN HEADERS
   - The table is HORIZONTAL - years go across the top
   - Typical format:
     
     Consolidated Balance Sheets (in millions):
     
     ASSETS                          2024      2023      2022
     Current assets:
       Cash                          29,965    29,965    23,646
       Accounts receivable           33,410    29,508    28,184
       Total current assets         128,261   143,566   135,405
     
   - You see 3 year columns above (2024, 2023, 2022)
   - Some 10-Ks show 5 years, some show 3 years, some show 2 years
   - **Extract EVERY year column you see** - do not stop after the first column!

4. **HOW TO FIND ALL YEARS:**
   - Look for year numbers across the TOP of the table (2024, 2023, 2022, 2021, 2020)
   - These appear BEFORE the line items start
   - Count how many year columns exist
   - Extract data for EACH column

5. **VERIFICATION:**
   - After extracting, count your arrays
   - If you only have 1 entry but see multiple year headers, YOU MISSED DATA
   - Go back and extract ALL columns

6. For each year, find the specific line items
7. Convert to actual dollars using the unit multiplier

**INCOME STATEMENT SECTION (extracted from PDF):**
${incomeSection}

**BALANCE SHEET SECTION (extracted from PDF):**
${balanceSection}

**CASH FLOW STATEMENT SECTION (extracted from PDF):**
${cashFlowSection}

**REQUIRED JSON OUTPUT:**
{
  "companyName": "Company Inc.",
  "fiscalYearEnd": "December 31" or "September 30" etc,
  "currencyUnits": "thousands" or "millions" or "billions",
  "income": [
    {
      "date": "2024-12-31",
      "revenue": 391035000000,
      "costOfRevenue": 214137000000,
      "grossProfit": 176898000000,
      "researchDevelopment": 31370000000,
      "sellingGeneralAdmin": 26097000000,
      "operatingExpenses": 57467000000,
      "operatingIncome": 119431000000,
      "interestExpense": 3933000000,
      "otherIncomeExpense": 382000000,
      "incomeBeforeTax": 116380000000,
      "incomeTaxExpense": 19300000000,
      "netIncome": 96995000000,
      "eps": 6.43,
      "epsdiluted": 6.43,
      "sharesOutstanding": 15074000000,
      "sharesOutstandingDiluted": 15074000000
    }
    // ... up to 5 years, newest first
  ],
  "balance": [
    {
      "date": "2024-12-31",
      "totalCurrentAssets": 128261000000,
      "cashAndCashEquivalents": 29965000000,
      "shortTermInvestments": 35228000000,
      "accountsReceivable": 33410000000,
      "inventory": 6838000000,
      "otherCurrentAssets": 22820000000,
      "totalNonCurrentAssets": 236719000000,
      "propertyPlantEquipment": 42117000000,
      "goodwill": 0,
      "intangibleAssets": 0,
      "longTermInvestments": 91156000000,
      "otherNonCurrentAssets": 103446000000,
      "totalAssets": 364980000000,
      "totalCurrentLiabilities": 133001000000,
      "accountsPayable": 58146000000,
      "shortTermDebt": 10945000000,
      "otherCurrentLiabilities": 63910000000,
      "totalNonCurrentLiabilities": 139862000000,
      "longTermDebt": 95281000000,
      "deferredTaxLiabilities": 16739000000,
      "otherNonCurrentLiabilities": 27842000000,
      "totalLiabilities": 272863000000,
      "totalDebt": 106226000000,
      "netDebt": 76261000000,
      "commonStock": 82219000000,
      "retainedEarnings": 18287000000,
      "treasuryStock": -10289000000,
      "otherEquity": 2000000000,
      "totalStockholdersEquity": 92117000000
    }
    // ... up to 5 years
  ],
  "cashFlow": [
    {
      "date": "2024-12-31",
      "netIncome": 96995000000,
      "depreciationAmortization": 11519000000,
      "stockBasedCompensation": 11688000000,
      "deferredIncomeTax": 0,
      "changeInWorkingCapital": -1322000000,
      "accountsReceivableChange": -3103000000,
      "inventoryChange": 1028000000,
      "accountsPayableChange": 4054000000,
      "otherWorkingCapitalChange": -3301000000,
      "otherNonCashItems": 98000000,
      "operatingCashFlow": 118254000000,
      "capitalExpenditure": -9447000000,
      "acquisitions": 0,
      "purchasesOfInvestments": -44671000000,
      "salesOfInvestments": 60844000000,
      "otherInvestingActivities": -1307000000,
      "investingCashFlow": 5419000000,
      "dividendsPaid": -15025000000,
      "commonStockIssued": 0,
      "commonStockRepurchased": -94949000000,
      "debtIssued": 5977000000,
      "debtRepaid": -10977000000,
      "otherFinancingActivities": -5182000000,
      "financingCashFlow": -120156000000,
      "netCashFlow": 3517000000,
      "freeCashFlow": 108807000000
    }
    // ... up to 5 years
  ]
}

**CRITICAL VALIDATION RULES:**
1. Revenue should be > $1 billion for most public companies (check if conversion is correct)
2. Total Assets should equal Total Liabilities + Total Equity (they must balance!)
3. Free Cash Flow = Operating Cash Flow - Capital Expenditure (must calculate correctly)
4. Net Debt = Total Debt - Cash (must calculate)
5. EPS should be dollars per share (typically $1-$50 range for most companies)
6. All dates must be YYYY-MM-DD format
7. Sort arrays by date DESC (newest first)

**IF YOU'RE UNSURE ABOUT UNITS:**
- Look for phrases like "dollars in thousands", "in millions", "amounts in billions"
- Check if numbers seem too small (e.g., Apple revenue shown as 391 = wrong, should be 391B)
- Public companies usually have revenue in billions, not thousands

**FIELD CALCULATION NOTES:**
- totalDebt = shortTermDebt + longTermDebt
- netDebt = totalDebt - cashAndCashEquivalents
- freeCashFlow = operatingCashFlow - capitalExpenditure
- operatingExpenses = researchDevelopment + sellingGeneralAdmin + other operating
- If a field is not in the statements, use null

Return ONLY the JSON object. No markdown, no code blocks, no explanations.`;

    console.log('🤖 Calling Claude API for extraction...');
    
    // Call Claude API
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-sonnet-4-20250514',
        max_tokens: 8000, // Increased for more comprehensive extraction
        messages: [
          {
            role: 'user',
            content: extractionPrompt
          }
        ]
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        }
      }
    );
    
    console.log('✅ Claude API Response Received');
    
    // Parse response
    let financialData;
    try {
      const responseText = response.data.content[0].text;
      
      // Remove markdown code blocks if present
      const cleanedText = responseText
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();
      
      financialData = JSON.parse(cleanedText);
      
      console.log('✅ Financial data parsed successfully');
      console.log(`   Company: ${financialData.companyName}`);
      console.log(`   Income statements: ${financialData.income?.length || 0} years`);
      if (financialData.income && financialData.income.length > 0) {
        console.log(`      Years: ${financialData.income.map(y => y.date).join(', ')}`);
      }
      console.log(`   Balance sheets: ${financialData.balance?.length || 0} years`);
      if (financialData.balance && financialData.balance.length > 0) {
        console.log(`      Years: ${financialData.balance.map(y => y.date).join(', ')}`);
      }
      console.log(`   Cash flows: ${financialData.cashFlow?.length || 0} years`);
      if (financialData.cashFlow && financialData.cashFlow.length > 0) {
        console.log(`      Years: ${financialData.cashFlow.map(y => y.date).join(', ')}`);
      }
      
      // Validation checks
      const warnings = [];
      
      // Check if we got enough years (most 10-Ks show 3-5 years)
      if (financialData.income && financialData.income.length < 3) {
        warnings.push(`⚠️  Only ${financialData.income.length} year(s) of income statement data - expected 3-5 years. Claude may have missed columns.`);
      }
      if (financialData.balance && financialData.balance.length < 3) {
        warnings.push(`⚠️  Only ${financialData.balance.length} year(s) of balance sheet data - expected 3-5 years. Claude may have missed columns.`);
      }
      if (financialData.cashFlow && financialData.cashFlow.length < 3) {
        warnings.push(`⚠️  Only ${financialData.cashFlow.length} year(s) of cash flow data - expected 3-5 years. Claude may have missed columns.`);
      }
      
      if (financialData.income && financialData.income[0]) {
        const latestIncome = financialData.income[0];
        
        // Check if revenue seems too small (likely wrong unit conversion)
        if (latestIncome.revenue && latestIncome.revenue < 1000000) {
          warnings.push(`⚠️  Revenue seems very small: $${latestIncome.revenue.toLocaleString()} - check unit conversion`);
        }
        
        // Check if net income is null/zero
        if (!latestIncome.netIncome || latestIncome.netIncome === 0) {
          warnings.push(`⚠️  Net income is ${latestIncome.netIncome} - may be extraction error`);
        }
        
        // Check EPS range
        if (latestIncome.eps && (latestIncome.eps > 1000 || latestIncome.eps < 0.01)) {
          warnings.push(`⚠️  EPS seems unusual: $${latestIncome.eps} - check extraction`);
        }
      }
      
      if (financialData.balance && financialData.balance[0]) {
        const latestBalance = financialData.balance[0];
        
        // Check if total assets seems too small
        if (latestBalance.totalAssets && latestBalance.totalAssets < 1000000) {
          warnings.push(`⚠️  Total assets seems very small: $${latestBalance.totalAssets.toLocaleString()} - check unit conversion`);
        }
        
        // Check if balance sheet balances
        if (latestBalance.totalAssets && latestBalance.totalLiabilities && latestBalance.totalStockholdersEquity) {
          const calculated = latestBalance.totalLiabilities + latestBalance.totalStockholdersEquity;
          const diff = Math.abs(latestBalance.totalAssets - calculated);
          const percentDiff = (diff / latestBalance.totalAssets) * 100;
          
          if (percentDiff > 1) {
            warnings.push(`⚠️  Balance sheet doesn't balance: Assets=${latestBalance.totalAssets.toLocaleString()}, L+E=${calculated.toLocaleString()}, diff=${percentDiff.toFixed(2)}%`);
          }
        }
      }
      
      if (financialData.cashFlow && financialData.cashFlow[0]) {
        const latestCF = financialData.cashFlow[0];
        
        // Check if FCF is null/zero
        if (!latestCF.freeCashFlow || latestCF.freeCashFlow === 0) {
          warnings.push(`⚠️  Free cash flow is ${latestCF.freeCashFlow} - may be extraction error`);
        }
        
        // Check if operating cash flow seems wrong
        if (!latestCF.operatingCashFlow || latestCF.operatingCashFlow === 0) {
          warnings.push(`⚠️  Operating cash flow is ${latestCF.operatingCashFlow} - may be extraction error`);
        }
      }
      
      if (warnings.length > 0) {
        console.log('\n⚠️  VALIDATION WARNINGS:');
        warnings.forEach(w => console.log(`   ${w}`));
        console.log('   → Review extracted data for accuracy\n');
      } else {
        console.log('✅ All validation checks passed');
      }
      
    } catch (parseError) {
      console.error('❌ Failed to parse Claude response:', parseError.message);
      console.error('Response text:', response.data.content[0].text.substring(0, 500));
      
      return res.status(500).json({
        success: false,
        error: 'Failed to parse financial data from PDFs. Please ensure PDFs are readable financial statements.',
        details: parseError.message
      });
    }
    
    // Validate data
    if (!financialData.income || !financialData.balance || !financialData.cashFlow) {
      return res.status(400).json({
        success: false,
        error: 'Incomplete financial data extracted. Please ensure PDFs contain complete financial statements.',
        extracted: {
          income: !!financialData.income,
          balance: !!financialData.balance,
          cashFlow: !!financialData.cashFlow
        }
      });
    }
    
    // Cache the result
    await cacheFinancials(incomeHash, balanceHash, cashFlowHash, financialData);
    
    // Return success
    res.json({
      success: true,
      data: financialData,
      cached: false,
      processing_time: 'Parsed with Claude AI',
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Error in financial statement parsing:', error.message);
    console.error('❌ Error stack:', error.stack);
    
    // Log detailed error information
    console.error('❌ Error details:', {
      name: error.name,
      code: error.code,
      response: error.response ? {
        status: error.response.status,
        statusText: error.response.statusText,
        data: error.response.data
      } : 'No response'
    });
    
    res.status(error.response?.status || 500).json({
      success: false,
      error: error.message || 'Failed to parse financial statements',
      timestamp: new Date().toISOString()
    });
  }
});

// ==================== STOCK DATA ENDPOINT ====================
app.get('/api/stock/:ticker', async (req, res) => {
  console.log('🎯 STOCK ENDPOINT HIT!'); // Immediate confirmation
  
  const { ticker } = req.params;
  const FMP_API_KEY = process.env.FMP_API_KEY;

  console.log(`\n📈 Stock Data Request: ${ticker}`);
  console.log(`   FMP_API_KEY present: ${FMP_API_KEY ? 'YES' : 'NO'}`);

  if (!FMP_API_KEY) {
    console.error('❌ FMP_API_KEY not found in environment variables');
    console.error('   Make sure you have a .env file with FMP_API_KEY=your_key');
    return res.status(500).json({
      success: false,
      error: 'FMP_API_KEY not configured. Create a .env file in the backend directory with your Financial Modeling Prep API key.'
    });
  }

  try {
    const baseUrl = 'https://financialmodelingprep.com/stable';
    console.log(`   Fetching from FMP Stable API...`);

    // Fetch all data in parallel - Using exact endpoint names from FMP docs
    const [profileRes, quoteRes, incomeRes, balanceRes, cashFlowRes] = await Promise.all([
      axios.get(`${baseUrl}/profile?symbol=${ticker}&apikey=${FMP_API_KEY}`),
      axios.get(`${baseUrl}/quote?symbol=${ticker}&apikey=${FMP_API_KEY}`),
      axios.get(`${baseUrl}/income-statement?symbol=${ticker}&limit=5&apikey=${FMP_API_KEY}`),
      axios.get(`${baseUrl}/balance-sheet-statement?symbol=${ticker}&limit=5&apikey=${FMP_API_KEY}`),
      axios.get(`${baseUrl}/cash-flow-statement?symbol=${ticker}&limit=5&apikey=${FMP_API_KEY}`)
    ]);

    const profile = profileRes.data[0];
    const quote = quoteRes.data[0];
    const income = incomeRes.data;
    const balance = balanceRes.data;
    const cashFlow = cashFlowRes.data;

    console.log(`   Profile: ${profile ? '✅' : '❌'}`);
    console.log(`   Quote: ${quote ? '✅' : '❌'}`);
    console.log(`   Income statements: ${income?.length || 0}`);
    console.log(`   Balance sheets: ${balance?.length || 0}`);
    console.log(`   Cash flows: ${cashFlow?.length || 0}`);
    
    // Log key quote data for debugging
    if (quote) {
      console.log(`   Price: $${quote.price}`);
      console.log(`   Shares Outstanding: ${quote.sharesOutstanding || 'MISSING'}`);
      console.log(`   Market Cap: $${quote.marketCap}`);
      console.log(`   EPS: ${quote.eps}`);
    }

    // Check if we got valid data
    if (!profile || !quote) {
      console.error(`❌ Missing data for ${ticker} - likely not available in free tier`);
      return res.status(404).json({
        success: false,
        error: `Stock "${ticker}" not found or not available in free tier. Try popular stocks like AAPL, MSFT, GOOGL, TSLA, NVDA, META, AMZN.`,
        useYahooFallback: true
      });
    }

    console.log(`✅ Stock data fetched successfully for ${ticker}`);

    // Calculate missing fields that FMP stable API doesn't provide
    const latestIncome = income && income.length > 0 ? income[0] : null;
    
    // Calculate shares outstanding from market cap / price
    const calculatedShares = quote.marketCap && quote.price 
      ? Math.round(quote.marketCap / quote.price)
      : null;
    
    // Get EPS from income statement
    const eps = latestIncome 
      ? (latestIncome.epsdiluted || latestIncome.eps || 0)
      : (quote.eps || 0);
    
    // Calculate P/E ratio
    const pe = eps && quote.price 
      ? (quote.price / eps)
      : (quote.pe || 0);
    
    console.log(`📊 Calculated metrics:`);
    console.log(`   Shares Outstanding: ${calculatedShares ? calculatedShares.toLocaleString() : 'N/A'}`);
    console.log(`   EPS: ${eps}`);
    console.log(`   P/E: ${pe.toFixed(2)}`);

    res.json({
      profile: {
        companyName: profile.companyName,
        symbol: ticker,
        price: quote.price,
        industry: profile.industry,
        sector: profile.sector,
        description: profile.description,
        ceo: profile.ceo,
        website: profile.website,
        image: profile.image
      },
      quote: {
        symbol: ticker,
        name: quote.name,
        price: quote.price,
        changesPercentage: quote.changesPercentage,
        change: quote.change,
        dayLow: quote.dayLow,
        dayHigh: quote.dayHigh,
        yearHigh: quote.yearHigh,
        yearLow: quote.yearLow,
        marketCap: quote.marketCap,
        priceAvg50: quote.priceAvg50,
        priceAvg200: quote.priceAvg200,
        volume: quote.volume,
        avgVolume: quote.avgVolume,
        open: quote.open,
        previousClose: quote.previousClose,
        eps: eps,  // Use calculated EPS
        pe: pe,    // Use calculated P/E
        earningsAnnouncement: quote.earningsAnnouncement,
        sharesOutstanding: calculatedShares  // Use calculated shares
      },
      income: income.map(item => ({
        date: item.date,
        revenue: item.revenue,
        costOfRevenue: item.costOfRevenue,
        grossProfit: item.grossProfit,
        grossProfitRatio: item.grossProfitRatio,
        operatingIncome: item.operatingIncome,
        operatingIncomeRatio: item.operatingIncomeRatio,
        netIncome: item.netIncome,
        netIncomeRatio: item.netIncomeRatio,
        eps: item.eps,
        epsdiluted: item.epsdiluted,
        ebitda: item.ebitda,
        ebitdaratio: item.ebitdaratio
      })),
      balance: balance.map(item => ({
        date: item.date,
        cashAndCashEquivalents: item.cashAndCashEquivalents,
        shortTermInvestments: item.shortTermInvestments,
        cashAndShortTermInvestments: item.cashAndShortTermInvestments,
        accountReceivables: item.netReceivables,
        inventory: item.inventory,
        totalCurrentAssets: item.totalCurrentAssets,
        propertyPlantEquipmentNet: item.propertyPlantEquipmentNet,
        goodwill: item.goodwill,
        intangibleAssets: item.intangibleAssets,
        totalAssets: item.totalAssets,
        accountPayables: item.accountPayables,
        shortTermDebt: item.shortTermDebt,
        totalCurrentLiabilities: item.totalCurrentLiabilities,
        longTermDebt: item.longTermDebt,
        totalDebt: item.totalDebt,
        totalLiabilities: item.totalLiabilities,
        commonStock: item.commonStock,
        retainedEarnings: item.retainedEarnings,
        totalStockholdersEquity: item.totalStockholdersEquity,
        totalEquity: item.totalEquity
      })),
      cashFlow: cashFlow.map(item => ({
        date: item.date,
        operatingCashFlow: item.operatingCashFlow,
        capitalExpenditure: item.capitalExpenditure,
        freeCashFlow: item.freeCashFlow,
        netChangeInCash: item.netChangeInCash
      }))
    });

  } catch (error) {
    console.error(`❌ Error fetching ${ticker}:`);
    console.error(`   Message: ${error.message}`);
    console.error(`   Status: ${error.response?.status}`);
    console.error(`   Data: ${JSON.stringify(error.response?.data)}`);
    
    // Check if it's a 404 from FMP (premium stock)
    if (error.response?.status === 404) {
      return res.status(404).json({
        success: false,
        error: `Stock "${ticker}" not found or requires premium FMP subscription. Try: AAPL, MSFT, GOOGL, TSLA, NVDA, META, AMZN`,
        fmpStatus: 404
      });
    }

    // Check if it's a 402 (payment required - premium only)
    if (error.response?.status === 402) {
      return res.status(503).json({
        success: false,
        error: `"${ticker}" requires premium FMP subscription`,
        fmpStatus: 402,
        useYahooFallback: true
      });
    }

    // Check if it's a 401 (invalid API key)
    if (error.response?.status === 401) {
      return res.status(401).json({
        success: false,
        error: 'Invalid FMP API key. Check your .env file.'
      });
    }

    res.status(500).json({
      success: false,
      error: `Failed to fetch stock data: ${error.message}`
    });
  }
});

// ==================== SECTOR LOOKUP ENDPOINT ====================
app.post('/api/lookup-sector', async (req, res) => {
  try {
    const { ticker, description } = req.body;
    
    if (!ticker) {
      return res.status(400).json({ error: 'Ticker required' });
    }
    
    const tickerUpper = ticker.toUpperCase();
    console.log(`🔍 Sector lookup request for: ${tickerUpper}`);
    
    // Check cache first
    if (cacheEnabled && redis) {
      try {
        const cacheKey = `sector_${tickerUpper}`;
        const cached = await redis.get(cacheKey);
        
        if (cached) {
          const parsed = JSON.parse(cached);
          console.log(`✅ CACHE HIT - Sector for ${tickerUpper}: ${parsed.sector}`);
          return res.json({
            ticker: tickerUpper,
            sector: parsed.sector,
            allocation: parsed.allocation,
            cached: true
          });
        }
      } catch (cacheError) {
        console.warn('⚠️  Cache read error:', cacheError.message);
      }
    }
    
    console.log(`❌ CACHE MISS - Looking up ${tickerUpper} with Claude API...`);
    
    // Use Claude API with web search to find sector
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        tools: [
          {
            type: 'web_search_20250305',
            name: 'web_search'
          }
        ],
        messages: [
          {
            role: 'user',
            content: `Search the web for information about ticker "${tickerUpper}" ${description ? `(${description})` : ''}.

Determine:
1. If it's a stock, ETF, or mutual fund
2. What sector(s) it belongs to: Technology, Healthcare, Financials, Consumer Discretionary, Consumer Staples, Industrials, Energy, Utilities, Real Estate, Materials, Communication Services, Fixed Income, or Other
3. If it's an ETF or fund, find the sector allocation breakdown

CRITICAL: Respond with ONLY valid JSON. No explanations, no markdown, no preamble. Just the JSON object.

Format:
{
  "ticker": "${tickerUpper}",
  "type": "stock" or "etf" or "fund",
  "sector": "Primary Sector",
  "allocation": {"Technology": 30, "Healthcare": 20}
}

For stocks: Put 100 in one sector.
For ETFs/funds: Provide percentage breakdown.
For bond funds: Use "Fixed Income": 100`
          }
        ]
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        }
      }
    );
    
    // Extract text from response
    const textContent = response.data.content
      .filter(item => item.type === 'text')
      .map(item => item.text)
      .join('\n');
    
    console.log(`📄 Claude response for ${tickerUpper}:`, textContent.substring(0, 200));
    
    // Parse JSON response - handle various formats
    let result;
    try {
      let jsonText = textContent;
      
      // Remove markdown code blocks
      jsonText = jsonText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
      
      // Try to extract JSON object if there's explanatory text
      const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonText = jsonMatch[0];
      }
      
      // Parse the JSON
      result = JSON.parse(jsonText);
      console.log(`✅ Parsed JSON for ${tickerUpper}:`, result);
    } catch (parseError) {
      console.error('❌ Failed to parse Claude response:', parseError.message);
      console.error('   Full response:', textContent);
      
      // Try to extract sector from text if JSON parsing fails
      let extractedSector = 'Other';
      const sectorKeywords = {
        'Technology': /technology|tech|software|semiconductor|internet/i,
        'Healthcare': /healthcare|health|pharma|biotech|medical/i,
        'Financials': /financial|bank|insurance|investment/i,
        'Consumer Discretionary': /consumer discretionary|retail|e-commerce|automotive/i,
        'Energy': /energy|oil|gas|petroleum/i,
        'Fixed Income': /bond|fixed income|treasury|debt/i,
      };
      
      for (const [sector, regex] of Object.entries(sectorKeywords)) {
        if (regex.test(textContent)) {
          extractedSector = sector;
          break;
        }
      }
      
      result = {
        ticker: tickerUpper,
        type: 'stock',
        sector: extractedSector,
        allocation: { [extractedSector]: 100 }
      };
    }
    
    // Validate and normalize
    if (!result.sector) {
      result.sector = 'Other';
    }
    if (!result.allocation) {
      result.allocation = { [result.sector]: 100 };
    }
    
    // Cache the result (permanent)
    if (cacheEnabled && redis) {
      try {
        const cacheKey = `sector_${tickerUpper}`;
        await redis.set(cacheKey, JSON.stringify({
          sector: result.sector,
          allocation: result.allocation,
          type: result.type,
          cached_at: new Date().toISOString()
        }));
        console.log(`💾 Cached sector info for ${tickerUpper}: ${result.sector}`);
      } catch (cacheError) {
        console.warn('⚠️  Cache write error:', cacheError.message);
      }
    }
    
    res.json({
      ticker: tickerUpper,
      sector: result.sector,
      allocation: result.allocation,
      type: result.type,
      cached: false
    });
    
  } catch (error) {
    console.error('❌ Sector lookup error:', error.message);
    res.status(500).json({
      error: 'Sector lookup failed',
      details: error.message
    });
  }
});

// ==================== CACHED LEARNING ENDPOINT ====================
// Save user corrections to improve accuracy for all users
app.post('/api/cache-asset-class', async (req, res) => {
  console.log(`📥 POST /api/cache-asset-class`);
  
  try {
    const { ticker, assetClass, votes = 1 } = req.body;
    
    if (!ticker || !assetClass) {
      return res.status(400).json({ error: 'Missing ticker or assetClass' });
    }
    
    const tickerUpper = ticker.toUpperCase();
    console.log(`📚 Caching asset class: ${tickerUpper} → ${assetClass}`);
    
    if (!cacheEnabled || !redis) {
      console.log('⚠️  Redis not available, skipping cache');
      return res.json({ success: false, message: 'Cache not available' });
    }
    
    const cacheKey = `learned_asset_class:${tickerUpper}`;
    
    // Get existing data to track votes
    let existingData = null;
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        existingData = JSON.parse(cached);
      }
    } catch (err) {
      console.log('   No existing cached data');
    }
    
    // Track voting for this asset class
    const data = {
      ticker: tickerUpper,
      assetClass: assetClass,
      votes: existingData && existingData.assetClass === assetClass 
        ? existingData.votes + votes 
        : votes,
      last_updated: new Date().toISOString(),
      first_seen: existingData?.first_seen || new Date().toISOString()
    };
    
    await redis.set(cacheKey, JSON.stringify(data));
    
    console.log(`✅ Cached: ${tickerUpper} → ${assetClass} (${data.votes} vote${data.votes > 1 ? 's' : ''})`);
    
    res.json({
      success: true,
      ticker: tickerUpper,
      assetClass: assetClass,
      votes: data.votes
    });
    
  } catch (error) {
    console.error('❌ Cache asset class error:', error.message);
    res.status(500).json({
      error: 'Failed to cache asset class',
      details: error.message
    });
  }
});

// Get learned asset class (check community corrections)
app.get('/api/get-learned-asset-class/:ticker', async (req, res) => {
  const ticker = req.params.ticker.toUpperCase();
  console.log(`📥 GET /api/get-learned-asset-class/${ticker}`);
  
  try {
    if (!cacheEnabled || !redis) {
      return res.json({ found: false });
    }
    
    const cacheKey = `learned_asset_class:${ticker}`;
    const cached = await redis.get(cacheKey);
    
    if (cached) {
      const data = JSON.parse(cached);
      console.log(`✅ Found learned: ${ticker} → ${data.assetClass} (${data.votes} votes)`);
      res.json({
        found: true,
        ticker: ticker,
        assetClass: data.assetClass,
        votes: data.votes,
        confidence: data.votes >= 3 ? 'high' : data.votes >= 2 ? 'medium' : 'low'
      });
    } else {
      res.json({ found: false });
    }
  } catch (error) {
    console.error('❌ Get learned asset class error:', error.message);
    res.json({ found: false, error: error.message });
  }
});

// ==================== AUTHENTICATION MIDDLEWARE ====================
const requireAuth = (req, res, next) => {
  console.log(`🔒 Auth check - Session exists: ${!!req.session}, isAdmin: ${req.session?.isAdmin}`);
  if (req.session && req.session.isAdmin) {
    console.log('✅ Auth passed');
    return next();
  }
  console.log('❌ Auth failed - returning 401');
  res.status(401).json({ error: 'Unauthorized. Please log in.' });
};

// ==================== ADMIN AUTHENTICATION ====================
app.post('/api/admin/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    // Get credentials from environment variables
    const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
    const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme123';
    
    // Hash the provided password for comparison
    const hashedPassword = crypto.createHash('sha256').update(password).digest('hex');
    const storedPasswordHash = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest('hex');
    
    if (username === ADMIN_USERNAME && hashedPassword === storedPasswordHash) {
      req.session.isAdmin = true;
      req.session.username = username;
      req.session.loginTime = new Date().toISOString();
      
      console.log(`✅ Admin login successful: ${username}`);
      
      res.json({
        success: true,
        message: 'Login successful',
        username: username
      });
    } else {
      console.log(`❌ Failed login attempt: ${username}`);
      res.status(401).json({
        success: false,
        error: 'Invalid credentials'
      });
    }
  } catch (error) {
    console.error('❌ Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.post('/api/admin/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Logout failed' });
    }
    res.json({ success: true, message: 'Logged out successfully' });
  });
});

app.get('/api/admin/check', (req, res) => {
  if (req.session && req.session.isAdmin) {
    res.json({
      authenticated: true,
      username: req.session.username,
      loginTime: req.session.loginTime
    });
  } else {
    res.json({ authenticated: false });
  }
});

// ==================== TEST ENDPOINTS ====================
// Manual test endpoint to verify activity tracking
app.post('/api/test/track-activity', async (req, res) => {
  try {
    console.log('🧪 TEST: Manual activity tracking called');
    
    if (!cacheEnabled || !redis) {
      return res.json({ success: false, error: 'Redis not available' });
    }
    
    const testUserId = 'test_user_manual';
    const testSessionId = 'test_session_manual';
    const nowTimestamp = Date.now().toString();
    
    // Add to hash
    await redis.hset('active_sessions_hash', testSessionId, nowTimestamp);
    console.log(`✅ TEST: Added session to hash`);
    
    // Verify it was added
    const allSessions = await redis.hgetall('active_sessions_hash');
    console.log(`✅ TEST: All sessions in hash:`, allSessions);
    
    res.json({
      success: true,
      testSessionId,
      nowTimestamp,
      allSessions
    });
    
  } catch (error) {
    console.error('❌ TEST: Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Test endpoint to check what's in the hash
app.get('/api/test/check-sessions', requireAuth, async (req, res) => {
  try {
    console.log('🧪 TEST: Checking sessions in Redis');
    
    if (!cacheEnabled || !redis) {
      return res.json({ error: 'Redis not available' });
    }
    
    const sessions = await redis.hgetall('active_sessions_hash');
    console.log('✅ TEST: Sessions found:', sessions);
    
    const thirtyMinutesAgo = Date.now() - (30 * 60 * 1000);
    let activeCount = 0;
    
    if (sessions) {
      for (const [sessionKey, timestampStr] of Object.entries(sessions)) {
        const timestamp = parseInt(timestampStr);
        const age = Date.now() - timestamp;
        const isActive = timestamp >= thirtyMinutesAgo;
        
        console.log(`  Session: ${sessionKey.substring(0, 20)}... - Age: ${Math.floor(age/1000)}s - Active: ${isActive}`);
        
        if (isActive) activeCount++;
      }
    }
    
    res.json({
      totalSessions: sessions ? Object.keys(sessions).length : 0,
      activeSessions: activeCount,
      thirtyMinutesAgo,
      now: Date.now(),
      sessions
    });
    
  } catch (error) {
    console.error('❌ TEST: Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ==================== USER ACTIVITY TRACKING ====================
// Track user sessions and activity
app.post('/api/analytics/activity', async (req, res) => {
  try {
    const {
      userId,
      sessionId,
      action, // 'visit', 'upload', 'analyze', etc.
      timestamp
    } = req.body;
    
    console.log(`📊 Activity tracking: user=${userId?.substring(0, 12)}..., action=${action}`);
    
    if (!cacheEnabled || !redis) {
      console.log('⚠️  Redis not available - analytics disabled');
      return res.json({ success: false, message: 'Analytics storage not available' });
    }
    
    const anonymousId = userId || `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const sessionKey = sessionId || `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Track active session (expires after 30 minutes)
    const activeSessionKey = `active_session:${sessionKey}`;
    await redis.set(activeSessionKey, JSON.stringify({
      userId: anonymousId,
      lastSeen: timestamp || new Date().toISOString(),
      action: action || 'visit'
    }));
    await redis.expire(activeSessionKey, 30 * 60); // 30 minutes
    
    // Add to active sessions hash (for live user count)
    // Store as hash: sessionKey -> timestamp
    const nowTimestamp = Date.now().toString();
    await redis.hset('active_sessions_hash', sessionKey, nowTimestamp);
    
    console.log(`✅ Session tracked: ${activeSessionKey}`);
    
    // Track user activity by time period
    const now = new Date(timestamp || Date.now());
    const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
    const weekStr = `${now.getFullYear()}-W${String(Math.ceil((now - new Date(now.getFullYear(), 0, 1)) / (7 * 24 * 60 * 60 * 1000))).padStart(2, '0')}`;
    const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const yearStr = `${now.getFullYear()}`;
    
    // Add user to daily active users set
    await redis.sadd(`active_users:day:${dateStr}`, anonymousId);
    await redis.expire(`active_users:day:${dateStr}`, 60 * 60 * 24 * 90); // 90 days
    
    // Add user to weekly active users set
    await redis.sadd(`active_users:week:${weekStr}`, anonymousId);
    await redis.expire(`active_users:week:${weekStr}`, 60 * 60 * 24 * 365); // 1 year
    
    // Add user to monthly active users set
    await redis.sadd(`active_users:month:${monthStr}`, anonymousId);
    await redis.expire(`active_users:month:${monthStr}`, 60 * 60 * 24 * 365); // 1 year
    
    // Add user to yearly active users set
    await redis.sadd(`active_users:year:${yearStr}`, anonymousId);
    await redis.expire(`active_users:year:${yearStr}`, 60 * 60 * 24 * 365 * 3); // 3 years
    
    console.log(`✅ User added to time-based sets: ${dateStr}, ${weekStr}, ${monthStr}, ${yearStr}`);
    
    res.json({ 
      success: true,
      sessionId: sessionKey,
      userId: anonymousId
    });
    
  } catch (error) {
    console.error('❌ Activity tracking error:', error.message);
    console.error('Stack:', error.stack);
    res.status(500).json({ error: 'Activity tracking failed' });
  }
});

// Get live users count
app.get('/api/analytics/live-users', requireAuth, async (req, res) => {
  console.log('🎯 LIVE USERS ENDPOINT CALLED');
  try {
    if (!cacheEnabled || !redis) {
      console.log('⚠️  Redis not available for live users');
      return res.json({ liveUsers: 0 });
    }
    
    console.log('🔍 Checking Redis for active sessions...');
    
    try {
      // Get all sessions from hash
      const sessions = await redis.hgetall('active_sessions_hash');
      
      console.log(`📊 Got sessions from Redis:`, sessions);
      
      if (!sessions || Object.keys(sessions).length === 0) {
        console.log(`👥 Live users check: 0 active sessions (hash empty)`);
        return res.json({ liveUsers: 0, timestamp: new Date().toISOString() });
      }
      
      // Filter sessions active in last 30 minutes
      const thirtyMinutesAgo = Date.now() - (30 * 60 * 1000);
      let activeCount = 0;
      const expiredSessions = [];
      
      for (const [sessionKey, timestampStr] of Object.entries(sessions)) {
        const timestamp = parseInt(timestampStr);
        if (timestamp >= thirtyMinutesAgo) {
          activeCount++;
        } else {
          expiredSessions.push(sessionKey);
        }
      }
      
      // Clean up expired sessions (don't await, do in background)
      if (expiredSessions.length > 0) {
        redis.hdel('active_sessions_hash', ...expiredSessions).catch(err => 
          console.log('Could not clean expired sessions:', err.message)
        );
      }
      
      console.log(`👥 Live users check: ${activeCount} active sessions (${expiredSessions.length} expired, ${Object.keys(sessions).length} total)`);
      
      res.json({ 
        liveUsers: activeCount,
        timestamp: new Date().toISOString()
      });
      
    } catch (innerError) {
      console.error('❌ Live users inner error:', innerError.message);
      return res.json({ liveUsers: 0, error: innerError.message });
    }
    
  } catch (error) {
    console.error('❌ Live users error:', error.message);
    console.error('Stack:', error.stack);
    res.json({ liveUsers: 0, error: error.message });
  }
});

// Get user activity stats by time period
app.get('/api/analytics/user-stats', requireAuth, async (req, res) => {
  try {
    if (!cacheEnabled || !redis) {
      return res.json({ error: 'Analytics not available' });
    }
    
    const now = new Date();
    
    // Today
    const today = now.toISOString().split('T')[0];
    const todayUsers = await redis.scard(`active_users:day:${today}`) || 0;
    
    // This week
    const thisWeek = `${now.getFullYear()}-W${String(Math.ceil((now - new Date(now.getFullYear(), 0, 1)) / (7 * 24 * 60 * 60 * 1000))).padStart(2, '0')}`;
    const weekUsers = await redis.scard(`active_users:week:${thisWeek}`) || 0;
    
    // This month
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const monthUsers = await redis.scard(`active_users:month:${thisMonth}`) || 0;
    
    // This year
    const thisYear = `${now.getFullYear()}`;
    const yearUsers = await redis.scard(`active_users:year:${thisYear}`) || 0;
    
    // Get last 30 days of daily users
    const dailyStats = [];
    for (let i = 29; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      const count = await redis.scard(`active_users:day:${dateStr}`) || 0;
      dailyStats.push({
        date: dateStr,
        users: count
      });
    }
    
    // Get last 12 weeks of weekly users
    const weeklyStats = [];
    for (let i = 11; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - (i * 7));
      const weekStr = `${date.getFullYear()}-W${String(Math.ceil((date - new Date(date.getFullYear(), 0, 1)) / (7 * 24 * 60 * 60 * 1000))).padStart(2, '0')}`;
      const count = await redis.scard(`active_users:week:${weekStr}`) || 0;
      weeklyStats.push({
        week: weekStr,
        users: count
      });
    }
    
    // Get last 12 months of monthly users
    const monthlyStats = [];
    for (let i = 11; i >= 0; i--) {
      const date = new Date();
      date.setMonth(date.getMonth() - i);
      const monthStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const count = await redis.scard(`active_users:month:${monthStr}`) || 0;
      monthlyStats.push({
        month: monthStr,
        users: count
      });
    }
    
    res.json({
      current: {
        today: todayUsers,
        week: weekUsers,
        month: monthUsers,
        year: yearUsers
      },
      daily: dailyStats,
      weekly: weeklyStats,
      monthly: monthlyStats
    });
    
  } catch (error) {
    console.error('❌ User stats error:', error.message);
    res.status(500).json({ error: 'User stats fetch failed' });
  }
});

// ==================== ANALYTICS ENDPOINT ====================
// Log portfolio uploads for admin dashboard
app.post('/api/analytics/upload', async (req, res) => {
  try {
    const {
      userId,
      portfolioSize,
      positionCount,
      totalValue,
      expectedReturn,
      expectedVolatility,
      topAssetClasses,
      timestamp
    } = req.body;
    
    console.log(`📊 Portfolio Upload Analytics:`);
    console.log(`   User ID: ${userId || 'anonymous'}`);
    console.log(`   Total Value: $${totalValue?.toLocaleString()}`);
    console.log(`   Positions: ${positionCount}`);
    console.log(`   Expected Return: ${expectedReturn?.toFixed(2)}%`);
    console.log(`   Risk: ${expectedVolatility?.toFixed(2)}%`);
    
    if (!cacheEnabled || !redis) {
      return res.json({ success: false, message: 'Analytics storage not available' });
    }
    
    // Generate anonymous user ID if not provided
    const anonymousId = userId || `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Store analytics event
    const analyticsKey = `analytics:upload:${Date.now()}:${anonymousId}`;
    const analyticsData = {
      userId: anonymousId,
      portfolioSize,
      positionCount,
      totalValue,
      expectedReturn,
      expectedVolatility,
      topAssetClasses,
      timestamp: timestamp || new Date().toISOString(),
      ip: req.ip || req.connection.remoteAddress
    };
    
    await redis.set(analyticsKey, JSON.stringify(analyticsData));
    await redis.expire(analyticsKey, 60 * 60 * 24 * 90); // 90 days
    
    // Also add to daily summary
    const today = new Date().toISOString().split('T')[0];
    const summaryKey = `analytics:daily:${today}`;
    
    let summary = { uploads: 0, totalVolume: 0, avgSize: 0, users: new Set() };
    try {
      const existing = await redis.get(summaryKey);
      if (existing) {
        summary = JSON.parse(existing);
        summary.users = new Set(summary.users);
      }
    } catch (err) {
      // New summary
    }
    
    summary.uploads += 1;
    summary.totalVolume += totalValue || 0;
    summary.avgSize = summary.totalVolume / summary.uploads;
    summary.users.add(anonymousId);
    
    const summaryToSave = {
      ...summary,
      users: Array.from(summary.users),
      userCount: summary.users.size
    };
    
    await redis.set(summaryKey, JSON.stringify(summaryToSave));
    await redis.expire(summaryKey, 60 * 60 * 24 * 365); // 1 year
    
    console.log(`✅ Analytics saved: ${analyticsKey}`);
    
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Analytics error:', error.message);
    res.status(500).json({ error: 'Analytics logging failed' });
  }
});

// Get analytics dashboard (admin only - requires authentication)
app.get('/api/analytics/dashboard', requireAuth, async (req, res) => {
  try {
    if (!cacheEnabled || !redis) {
      return res.json({ error: 'Analytics not available' });
    }
    
    // Get last 30 days of daily summaries
    const summaries = [];
    for (let i = 0; i < 30; i++) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      const key = `analytics:daily:${dateStr}`;
      
      try {
        const data = await redis.get(key);
        if (data) {
          const parsed = JSON.parse(data);
          summaries.push({ date: dateStr, ...parsed });
        }
      } catch (err) {
        // Skip
      }
    }
    
    // Calculate totals
    const totals = {
      totalUploads: summaries.reduce((sum, s) => sum + (s.uploads || 0), 0),
      totalVolume: summaries.reduce((sum, s) => sum + (s.totalVolume || 0), 0),
      uniqueUsers: new Set(summaries.flatMap(s => s.users || [])).size,
      avgPortfolioSize: 0
    };
    
    if (totals.totalUploads > 0) {
      totals.avgPortfolioSize = totals.totalVolume / totals.totalUploads;
    }
    
    res.json({
      summaries: summaries.reverse(), // Oldest to newest
      totals,
      period: '30 days'
    });
    
  } catch (error) {
    console.error('❌ Dashboard error:', error.message);
    res.status(500).json({ error: 'Dashboard fetch failed' });
  }
});

// 404 handler - MUST BE LAST!
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// ==================== SERVER START ====================
app.listen(PORT, () => {
  console.log(`
  ╔═══════════════════════════════════════════════╗
  ║   Investment Dashboard API Server            ║
  ║                                               ║
  ║   🚀 Server running on port ${PORT}             ║
  ║   📍 http://localhost:${PORT}                   ║
  ║   🏥 Health: http://localhost:${PORT}/health    ║
  ║                                               ║
  ║   Endpoints:                                  ║
  ║   POST /api/analyze-pdf                       ║
  ║   POST /api/parse-financials                  ║
  ║   GET  /api/stock/:ticker                     ║
  ╚═══════════════════════════════════════════════╝
  `);
  
  // Test pdf-parse is working
  console.log('📚 PDF Parser Check:');
  console.log(`   Type: ${typeof pdfParse}`);
  if (typeof pdfParse !== 'function') {
    console.error('   ❌ WARNING: pdf-parse is not a function!');
    console.error('   Financial statement upload will NOT work!');
    console.error('   Run: cd backend && npm uninstall pdf-parse && npm install pdf-parse@1.1.1');
  } else {
    console.log('   ✅ pdf-parse ready');
  }
});

module.exports = app;
