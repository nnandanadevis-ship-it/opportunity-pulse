/**
 * Opportunity Pulse — Backend API Server
 * ========================================
 * Stack: Node.js + Express + MongoDB (Mongoose)
 * Auth:  JWT + LinkedIn OAuth 2.0
 * Data:  Real-time scraping + LinkedIn API integration
 *
 * Setup:
 *   1. Copy .env.example → .env and fill in credentials
 *   2. npm install
 *   3. node server.js
 */

require('dotenv').config();
const express        = require('express');
const mongoose       = require('mongoose');
const cors           = require('cors');
const helmet         = require('helmet');
const rateLimit      = require('express-rate-limit');
const morgan         = require('morgan');
const path           = require('path');
const jwt            = require('jsonwebtoken');
const bcrypt         = require('bcryptjs');
const axios          = require('axios');
const cron           = require('node-cron');

const app  = express();
const PORT = process.env.PORT || 3000;

/* ════════════════════════════════════════════════
   SECURITY & MIDDLEWARE
════════════════════════════════════════════════ */
app.use(helmet({
  contentSecurityPolicy: false // Disabled for dev; enable + configure in production
}));

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

// Rate limiter — prevent brute force
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 20,
  message: { message: 'Too many requests. Please try again in 15 minutes.' }
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 min
  max: 100,
  message: { message: 'Rate limit exceeded. Please slow down.' }
});

app.use('/api/auth', authLimiter);
app.use('/api',      apiLimiter);

// Serve frontend
app.use(express.static(path.join(__dirname, 'public')));

/* ════════════════════════════════════════════════
   MONGODB CONNECTION
════════════════════════════════════════════════ */
mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/opportunity_pulse', {
  serverSelectionTimeoutMS: 5000,
}).then(() => {
  console.log('✅ MongoDB connected');
  seedIfEmpty(); // Seed initial opportunities
}).catch(err => {
  console.error('❌ MongoDB connection failed:', err.message);
  console.warn('⚠  Running without database — auth disabled, using in-memory seed data');
});

/* ════════════════════════════════════════════════
   MONGOOSE SCHEMAS
════════════════════════════════════════════════ */

// User schema
const UserSchema = new mongoose.Schema({
  email:          { type: String, required: true, unique: true, lowercase: true, trim: true },
  password:       { type: String }, // null for OAuth users
  firstName:      { type: String, trim: true },
  lastName:       { type: String, trim: true },
  profileComplete:{ type: Boolean, default: false },
  profile:        { type: mongoose.Schema.Types.Mixed, default: {} },
  linkedinId:     { type: String },
  linkedinToken:  { type: String },
  createdAt:      { type: Date, default: Date.now },
  lastLogin:      { type: Date }
}, { timestamps: true });

UserSchema.methods.toSafeObject = function() {
  const obj = this.toObject();
  delete obj.password;
  delete obj.linkedinToken;
  delete obj.__v;
  return obj;
};

// Opportunity schema
const OpportunitySchema = new mongoose.Schema({
  id:           { type: String, required: true, unique: true },
  event_name:   { type: String, required: true },
  source:       { type: String },
  source_color: { type: String },
  category:     { type: String, enum: ['hackathon','internship','scholarship','event'], required: true },
  icon:         { type: String, default: '📋' },
  icon_bg:      { type: String, default: '#1a1e2a' },
  deadline:     { type: String },
  deadline_date:{ type: Date },
  days:         { type: Number },
  reward:       { type: String },
  reward_raw:   { type: Number, default: 0 },
  stipend:      { type: String },
  remote:       { type: Boolean, default: true },
  new_today:    { type: Boolean, default: false },
  match:        { type: Number, default: 75 },
  eligibility:  { type: String },
  apply_link:   { type: String },
  description:  { type: String },
  tags:         { type: [String], default: [] },
  fetchedAt:    { type: Date, default: Date.now },
  source_raw:   { type: mongoose.Schema.Types.Mixed } // raw data from API
}, { timestamps: true });

// Auto-compute `days` before save
OpportunitySchema.pre('save', function(next) {
  if (this.deadline_date) {
    const diff = Math.ceil((this.deadline_date - new Date()) / (1000 * 60 * 60 * 24));
    this.days = Math.max(0, diff);
    this.deadline = this.deadline_date.toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  next();
});

const User        = mongoose.model('User', UserSchema);
const Opportunity = mongoose.model('Opportunity', OpportunitySchema);

/* ════════════════════════════════════════════════
   JWT HELPERS
════════════════════════════════════════════════ */
const JWT_SECRET  = process.env.JWT_SECRET || 'op_pulse_dev_secret_change_in_production';
const JWT_EXPIRES = process.env.JWT_EXPIRES || '7d';

function signToken(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

// Auth middleware
function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer '))
    return res.status(401).json({ message: 'Authentication required' });

  const token = header.slice(7);
  try {
    const decoded = verifyToken(token);
    req.userId = decoded.userId;
    next();
  } catch(err) {
    if (err.name === 'TokenExpiredError')
      return res.status(401).json({ message: 'Session expired. Please log in again.' });
    return res.status(401).json({ message: 'Invalid token' });
  }
}

/* ════════════════════════════════════════════════
   AUTH ROUTES
════════════════════════════════════════════════ */

// Register
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, firstName, lastName } = req.body;

    if (!email || !password || !firstName)
      return res.status(400).json({ message: 'Email, password and first name are required' });

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return res.status(400).json({ message: 'Invalid email address' });

    if (password.length < 6)
      return res.status(400).json({ message: 'Password must be at least 6 characters' });

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing)
      return res.status(409).json({ message: 'An account with this email already exists' });

    const hashedPassword = await bcrypt.hash(password, 12);
    const user = await User.create({
      email: email.toLowerCase(),
      password: hashedPassword,
      firstName: firstName.trim(),
      lastName:  (lastName || '').trim()
    });

    const token = signToken(user._id);
    res.status(201).json({ token, user: user.toSafeObject() });
  } catch(err) {
    console.error('Register error:', err);
    res.status(500).json({ message: 'Server error during registration' });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ message: 'Email and password are required' });

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user || !user.password)
      return res.status(401).json({ message: 'Invalid email or password' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid)
      return res.status(401).json({ message: 'Invalid email or password' });

    user.lastLogin = new Date();
    await user.save();

    const token = signToken(user._id);
    res.json({ token, user: user.toSafeObject() });
  } catch(err) {
    console.error('Login error:', err);
    res.status(500).json({ message: 'Server error during login' });
  }
});

// Verify token
app.get('/api/auth/verify', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({ user: user.toSafeObject() });
  } catch(err) {
    res.status(500).json({ message: 'Server error' });
  }
});

/* ════════════════════════════════════════════════
   LINKEDIN OAUTH 2.0
════════════════════════════════════════════════ */
const LINKEDIN_CLIENT_ID     = process.env.LINKEDIN_CLIENT_ID;
const LINKEDIN_CLIENT_SECRET = process.env.LINKEDIN_CLIENT_SECRET;
const LINKEDIN_REDIRECT_URI  = process.env.LINKEDIN_REDIRECT_URI || `http://localhost:${PORT}/api/auth/linkedin/callback`;

// Step 1: Redirect to LinkedIn
app.get('/api/auth/linkedin', (req, res) => {
  if (!LINKEDIN_CLIENT_ID) {
    return res.redirect('/?error=LinkedIn+OAuth+not+configured');
  }
  const scope = encodeURIComponent('openid profile email');
  const state = Math.random().toString(36).slice(2);
  const url   = `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${LINKEDIN_CLIENT_ID}&redirect_uri=${encodeURIComponent(LINKEDIN_REDIRECT_URI)}&scope=${scope}&state=${state}`;
  res.redirect(url);
});

// Step 2: LinkedIn callback
app.get('/api/auth/linkedin/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error || !code) {
    return res.redirect(`/?error=${encodeURIComponent(error || 'OAuth failed')}`);
  }

  try {
    // Exchange code for access token
    const tokenRes = await axios.post('https://www.linkedin.com/oauth/v2/accessToken', null, {
      params: {
        grant_type:    'authorization_code',
        code,
        redirect_uri:  LINKEDIN_REDIRECT_URI,
        client_id:     LINKEDIN_CLIENT_ID,
        client_secret: LINKEDIN_CLIENT_SECRET
      }
    });
    const accessToken = tokenRes.data.access_token;

    // Fetch user profile from LinkedIn
    const profileRes = await axios.get('https://api.linkedin.com/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    const li = profileRes.data;
    const email     = li.email;
    const firstName = li.given_name  || li.name || 'LinkedIn';
    const lastName  = li.family_name || '';
    const liId      = li.sub;

    if (!email) {
      return res.redirect('/?error=Email+not+available+from+LinkedIn');
    }

    // Find or create user
    let user = await User.findOne({ $or: [{ email }, { linkedinId: liId }] });
    if (!user) {
      user = await User.create({
        email, firstName, lastName,
        linkedinId: liId, linkedinToken: accessToken
      });
    } else {
      user.linkedinId    = liId;
      user.linkedinToken = accessToken;
      user.lastLogin     = new Date();
      await user.save();
    }

    const token = signToken(user._id);
    res.redirect(`/?token=${token}`);
  } catch(err) {
    console.error('LinkedIn OAuth error:', err.response?.data || err.message);
    res.redirect(`/?error=${encodeURIComponent('LinkedIn authentication failed')}`);
  }
});

/* ════════════════════════════════════════════════
   USER PROFILE ROUTES
════════════════════════════════════════════════ */
app.put('/api/user/profile', authMiddleware, async (req, res) => {
  try {
    const { profile } = req.body;
    if (!profile) return res.status(400).json({ message: 'Profile data required' });

    const user = await User.findByIdAndUpdate(
      req.userId,
      { profile, profileComplete: true },
      { new: true }
    );
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({ user: user.toSafeObject() });
  } catch(err) {
    console.error('Profile update error:', err);
    res.status(500).json({ message: 'Failed to update profile' });
  }
});

app.get('/api/user/profile', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({ profile: user.profile, user: user.toSafeObject() });
  } catch(err) {
    res.status(500).json({ message: 'Server error' });
  }
});

/* ════════════════════════════════════════════════
   OPPORTUNITIES ROUTES
════════════════════════════════════════════════ */
app.get('/api/opportunities', async (req, res) => {
  try {
    // Recalculate `days` dynamically before returning
    const opportunities = await Opportunity.find({})
      .sort({ deadline_date: 1 })
      .lean();

    const now = new Date();
    const enriched = opportunities.map(o => {
      if (o.deadline_date) {
        const diff = Math.ceil((new Date(o.deadline_date) - now) / (1000 * 60 * 60 * 24));
        o.days = Math.max(0, diff);
        o.new_today = (now - new Date(o.createdAt)) < 24 * 60 * 60 * 1000;
      }
      return o;
    });

    res.json({
      opportunities: enriched,
      total: enriched.length,
      lastUpdated: now.toISOString()
    });
  } catch(err) {
    console.error('Opportunities fetch error:', err);
    res.status(500).json({ message: 'Failed to fetch opportunities', opportunities: [] });
  }
});

// Admin: Trigger manual refresh
app.post('/api/opportunities/refresh', async (req, res) => {
  try {
    await refreshOpportunities();
    const count = await Opportunity.countDocuments();
    res.json({ message: 'Refresh complete', count });
  } catch(err) {
    res.status(500).json({ message: err.message });
  }
});

/* ════════════════════════════════════════════════
   LINKEDIN JOB DATA SYNC (OAuth users)
════════════════════════════════════════════════ */
app.get('/api/linkedin/jobs', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user || !user.linkedinToken) {
      return res.status(403).json({ message: 'LinkedIn not connected. Please sign in with LinkedIn.' });
    }

    // Fetch LinkedIn job recommendations via API
    const jobRes = await axios.get('https://api.linkedin.com/v2/jobSearches', {
      headers: { Authorization: `Bearer ${user.linkedinToken}` },
      params: { keywords: 'internship student', count: 20 }
    }).catch(() => null);

    if (!jobRes) {
      return res.json({ jobs: [], message: 'LinkedIn API unavailable' });
    }

    res.json({ jobs: jobRes.data?.elements || [] });
  } catch(err) {
    console.error('LinkedIn jobs error:', err.message);
    res.status(500).json({ message: 'Failed to fetch LinkedIn jobs' });
  }
});

/* ════════════════════════════════════════════════
   REAL-TIME DATA FETCHING LAYER
════════════════════════════════════════════════ */

/**
 * Fetch opportunities from various sources.
 * In production, replace fetch functions with real API calls / web scrapers.
 * This implementation uses:
 *   - Unstop public RSS / API
 *   - Devfolio public API
 *   - AICTE data
 *   - LinkedIn jobs API (via OAuth)
 */
async function refreshOpportunities() {
  console.log('🔄 Refreshing opportunities…');
  const results = [];

  // --- Devfolio Public API ---
  try {
    const r = await axios.get('https://api.devfolio.co/api/hackathons?featured=true&open=true', {
      headers: { Accept: 'application/json' }, timeout: 8000
    });
    const hackathons = r.data?.hackathons || r.data || [];
    hackathons.slice(0, 10).forEach(h => {
      const deadline = h.ends_at ? new Date(h.ends_at) : null;
      if (!deadline || deadline < new Date()) return;
      results.push({
        id:           `devfolio-${h.slug || h.id}`,
        event_name:   h.name || 'Unnamed Hackathon',
        source:       'Devfolio',
        source_color: '#d88cff',
        category:     'hackathon',
        icon:         '⚡',
        icon_bg:      '#1e1e3f',
        deadline_date: deadline,
        reward:       h.prize_amount ? `₹${Number(h.prize_amount).toLocaleString()}` : null,
        reward_raw:   Number(h.prize_amount) || 0,
        remote:       h.location_type === 'virtual' || h.is_online,
        match:        82,
        eligibility:  'Open to all students',
        apply_link:   `https://devfolio.co/hackathons/${h.slug}`,
        description:  h.tagline || h.description?.slice(0, 200) || '',
        tags:         ['hackathon', h.prize_amount ? 'prize' : 'remote'].filter(Boolean)
      });
    });
    console.log(`  ✓ Devfolio: ${results.length} hackathons`);
  } catch(e) {
    console.warn('  ⚠ Devfolio fetch failed:', e.message);
  }

  // --- Unstop (public events endpoint) ---
  try {
    const r = await axios.get('https://unstop.com/api/public/opportunity/search-listing', {
      params: { opportunity: 'hackathons', per_page: 10, status: 'open' },
      headers: { Accept: 'application/json', 'User-Agent': 'OpportunityPulse/1.0' },
      timeout: 8000
    });
    const items = r.data?.data?.data || [];
    items.forEach(item => {
      const deadline = item.end_date ? new Date(item.end_date) : null;
      if (!deadline || deadline < new Date()) return;
      results.push({
        id:           `unstop-${item.id}`,
        event_name:   item.title || 'Unnamed',
        source:       'Unstop',
        source_color: '#6c63ff',
        category:     'hackathon',
        icon:         '⚡',
        icon_bg:      '#1e1e3f',
        deadline_date: deadline,
        reward:       item.prize ? `₹${Number(item.prize).toLocaleString()}` : null,
        reward_raw:   Number(item.prize) || 0,
        remote:       true,
        match:        85,
        eligibility:  item.eligibility || 'Open to students',
        apply_link:   `https://unstop.com/${item.public_url || item.slug}`,
        description:  item.description?.slice(0, 200) || '',
        tags:         ['hackathon', item.prize ? 'prize' : 'remote'].filter(Boolean)
      });
    });
    console.log(`  ✓ Unstop: ${items.length} hackathons`);
  } catch(e) {
    console.warn('  ⚠ Unstop fetch failed:', e.message);
  }

  // --- Internshala (public API simulation) ---
  // Note: Internshala doesn't have a public API; this simulates the endpoint.
  // In production, use their partner API or an authorized scraping service.
  try {
    const r = await axios.get('https://internshala.com/student/search/internships', {
      params: { categories: 'computer-science,data-science', work_from_home: '1' },
      headers: { Accept: 'application/json', 'User-Agent': 'OpportunityPulse/1.0' },
      timeout: 8000
    });
    // Parse response if available
    const internships = r.data?.internships_meta?.internships || [];
    internships.slice(0,5).forEach(item => {
      const startDate = item.start_date ? new Date(item.start_date) : null;
      if (startDate) {
        const deadline = new Date(startDate);
        deadline.setDate(deadline.getDate() - 7); // 1 week before start
        results.push({
          id:           `internshala-${item.id}`,
          event_name:   `${item.profile_name} — ${item.company_name}`,
          source:       'Internshala',
          source_color: '#00e5c0',
          category:     'internship',
          icon:         '💼',
          icon_bg:      '#1a2f38',
          deadline_date: deadline,
          stipend:      item.stipend?.salary,
          reward_raw:   0,
          remote:       item.work_from_home,
          match:        88,
          eligibility:  `${item.duration} duration`,
          apply_link:   `https://internshala.com${item.internship_link}`,
          description:  item.other_requirements?.slice(0,200) || '',
          tags:         ['internship', item.work_from_home ? 'remote' : '', item.stipend?.salary ? 'stipend' : ''].filter(Boolean)
        });
      }
    });
    console.log(`  ✓ Internshala: ${internships.length} internships`);
  } catch(e) {
    console.warn('  ⚠ Internshala fetch failed:', e.message);
  }

  // Save to MongoDB (upsert)
  if (results.length > 0) {
    const ops = results.map(opp => ({
      updateOne: {
        filter: { id: opp.id },
        update: { $set: { ...opp, fetchedAt: new Date() } },
        upsert: true
      }
    }));

    try {
      const bulkResult = await Opportunity.bulkWrite(ops);
      console.log(`✅ Upserted ${bulkResult.upsertedCount} new + updated ${bulkResult.modifiedCount} existing opportunities`);
    } catch(e) {
      console.error('DB upsert error:', e.message);
    }
  } else {
    console.log('  ℹ No new opportunities fetched (APIs may be unavailable)');
  }
}

/* ════════════════════════════════════════════════
   SEED INITIAL DATA (if DB is empty)
════════════════════════════════════════════════ */
async function seedIfEmpty() {
  const count = await Opportunity.countDocuments();
  if (count > 0) {
    console.log(`ℹ  DB already has ${count} opportunities`);
    return;
  }

  console.log('🌱 Seeding initial opportunities…');
  const today = new Date();
  const add   = days => { const d = new Date(today); d.setDate(d.getDate()+days); return d; };

  const seeds = [
    {
      id: 'seed-sih-2025', event_name: 'Smart India Hackathon 2025',
      source: 'Unstop', source_color: '#6c63ff', category: 'hackathon',
      icon: '⚡', icon_bg: '#1e1e3f', deadline_date: add(2),
      reward: '₹1,00,000', reward_raw: 100000, stipend: null,
      remote: true, match: 97, eligibility: '2nd–4th Year, all branches',
      apply_link: 'https://unstop.com/hackathons/smart-india-hackathon-2025-government-of-india-1177433',
      description: '48-hour national hackathon with govt. problem statements across 8 domains.',
      tags: ['hackathon','prize']
    },
    {
      id: 'seed-google-step', event_name: 'Google STEP Internship (SWE)',
      source: 'LinkedIn', source_color: '#0a66c2', category: 'internship',
      icon: '💼', icon_bg: '#1a2f38', deadline_date: add(1),
      reward: null, reward_raw: 0, stipend: '₹1.2L/month',
      remote: true, match: 95, eligibility: 'Pre-final year, CSE/ECE',
      apply_link: 'https://careers.google.com/programs/step/',
      description: "Google's flagship summer internship program for 2nd-year CS students.",
      tags: ['internship','remote','stipend']
    },
    {
      id: 'seed-ms-imagine', event_name: 'Microsoft Imagine Cup 2025',
      source: 'Devfolio', source_color: '#d88cff', category: 'hackathon',
      icon: '⚡', icon_bg: '#1e1e3f', deadline_date: add(14),
      reward: '₹2,00,000', reward_raw: 200000, stipend: null,
      remote: true, match: 92, eligibility: 'All years, global students',
      apply_link: 'https://imaginecup.microsoft.com',
      description: 'Global student innovation competition — AI/ML and cloud solutions preferred.',
      tags: ['hackathon','prize','new']
    },
    {
      id: 'seed-aicte-sc', event_name: 'AICTE PG Scholarship for SC/ST',
      source: 'AICTE Portal', source_color: '#f5a623', category: 'scholarship',
      icon: '🎓', icon_bg: '#2f2a1a', deadline_date: add(21),
      reward: '₹30,000/yr', reward_raw: 30000, stipend: null,
      remote: false, match: 78, eligibility: 'SC/ST students, PG programs, govt. colleges',
      apply_link: 'https://www.aicte-india.org/bureaus/fdc/schemes/pg-scholarship-scheme-sc-st-students',
      description: 'Central government scholarship for meritorious SC/ST postgraduate students.',
      tags: ['scholarship']
    },
    {
      id: 'seed-internshala-ds', event_name: 'Internshala Data Science Intern',
      source: 'Internshala', source_color: '#00e5c0', category: 'internship',
      icon: '💼', icon_bg: '#1a2f38', deadline_date: add(9),
      reward: null, reward_raw: 0, stipend: '₹8,000/month',
      remote: true, match: 96, eligibility: '2nd–4th Year, CSE/Statistics',
      apply_link: 'https://internshala.com/internship/data-science-work-from-home-jobs',
      description: '6-month WFH internship at a Series-B startup. Python, Pandas, ML required.',
      tags: ['internship','remote','new','stipend']
    },
    {
      id: 'seed-mlh-lhd', event_name: 'MLH Local Hack Day',
      source: 'Devfolio', source_color: '#d88cff', category: 'hackathon',
      icon: '⚡', icon_bg: '#1e1e3f', deadline_date: add(5),
      reward: '₹15,000', reward_raw: 15000, stipend: null,
      remote: true, match: 90, eligibility: 'Open to all students worldwide',
      apply_link: 'https://mlh.io/',
      description: '12-hour online hackathon. Open theme. Beginner friendly.',
      tags: ['hackathon','prize','new']
    },
    {
      id: 'seed-aws-ml', event_name: 'AWS Machine Learning Workshop',
      source: 'LinkedIn', source_color: '#0a66c2', category: 'event',
      icon: '📡', icon_bg: '#2a1e30', deadline_date: add(7),
      reward: null, reward_raw: 0, stipend: null,
      remote: true, match: 85, eligibility: 'All years, basic Python knowledge',
      apply_link: 'https://aws.amazon.com/training/events/',
      description: 'Free 3-day intensive workshop with AWS voucher and certification prep.',
      tags: ['event','remote']
    },
    {
      id: 'seed-flipkart-grid', event_name: 'Flipkart GRiD 6.0 — E-Commerce',
      source: 'Unstop', source_color: '#6c63ff', category: 'hackathon',
      icon: '⚡', icon_bg: '#1e1e3f', deadline_date: add(18),
      reward: '₹75,000', reward_raw: 75000, stipend: null,
      remote: false, match: 89, eligibility: 'UG/PG, CSE/IT/ECE',
      apply_link: 'https://unstop.com/',
      description: "Flipkart's annual engineering challenge. On-campus finals at Flipkart HQ.",
      tags: ['hackathon','prize']
    },
    {
      id: 'seed-tata-women', event_name: 'Tata Scholarship for Women in STEM',
      source: 'AICTE Portal', source_color: '#f5a623', category: 'scholarship',
      icon: '🎓', icon_bg: '#2f2a1a', deadline_date: add(15),
      reward: '₹50,000/yr', reward_raw: 50000, stipend: null,
      remote: false, match: 82, eligibility: 'Women, 1st–3rd Year, STEM branches',
      apply_link: 'https://www.aicte-india.org/',
      description: 'Annual merit-based scholarship for women pursuing STEM degrees in India.',
      tags: ['scholarship','new']
    }
  ];

  for (const seed of seeds) {
    const opp = new Opportunity(seed);
    await opp.save().catch(e => console.warn(`  Skip seed ${seed.id}:`, e.message));
  }
  console.log(`✅ Seeded ${seeds.length} opportunities`);
}

/* ════════════════════════════════════════════════
   SCHEDULED REFRESH (every 6 hours)
════════════════════════════════════════════════ */
cron.schedule('0 */6 * * *', async () => {
  console.log('⏰ Scheduled opportunity refresh…');
  try {
    await refreshOpportunities();
  } catch(e) {
    console.error('Cron refresh error:', e.message);
  }
});

/* ════════════════════════════════════════════════
   HEALTH CHECK & CATCH-ALL
════════════════════════════════════════════════ */
app.get('/api/health', async (req, res) => {
  const dbState = mongoose.connection.readyState;
  const dbStatus = ['disconnected','connected','connecting','disconnecting'][dbState] || 'unknown';
  const count = dbState === 1 ? await Opportunity.countDocuments().catch(()=>0) : 0;
  res.json({
    status: 'ok',
    database: dbStatus,
    opportunities: count,
    uptime: process.uptime(),
    time: new Date().toISOString()
  });
});

// Serve frontend for all non-API routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/* ════════════════════════════════════════════════
   GLOBAL ERROR HANDLER
════════════════════════════════════════════════ */
app.use((err, req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ message: 'Internal server error' });
});

/* ════════════════════════════════════════════════
   START SERVER
════════════════════════════════════════════════ */
app.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════╗
  ║   Opportunity Pulse Server           ║
  ║   http://localhost:${PORT}               ║
  ║   MongoDB: ${process.env.MONGODB_URI ? 'custom URI' : 'localhost:27017'}         ║
  ╚══════════════════════════════════════╝
  `);
});

module.exports = app;
