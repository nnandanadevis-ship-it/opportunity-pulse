# 🎯 Opportunity Pulse v2.0
### AI Student Discovery Portal — Real-time opportunities, LinkedIn OAuth, MongoDB

---

## ✨ What's New in v2.0

| Feature | Status |
|---|---|
| **Login page** (email + LinkedIn OAuth) | ✅ Added |
| **Persistent sessions** (no re-login on refresh) | ✅ JWT in localStorage |
| **Real MongoDB database** | ✅ mongoose + auto-seed |
| **Live data fetching** (Devfolio, Unstop, Internshala) | ✅ Real API calls |
| **LinkedIn OAuth 2.0** | ✅ Full flow |
| **Dynamic calendar** (real dates, not hardcoded) | ✅ Fixed |
| **Real-time countdown** (days auto-calculated) | ✅ Server-side |
| **Auto-refresh every 6 hours** | ✅ node-cron |
| **Error handling** (skeleton loaders, banners, toasts) | ✅ Full |
| **Rate limiting & security headers** | ✅ helmet + express-rate-limit |
| **Offline fallback** (seed data when server unreachable) | ✅ |

---

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- MongoDB 6+ (local or Atlas)

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
# Edit .env with your values
```

### 3. Start MongoDB (local)
```bash
# macOS (Homebrew)
brew services start mongodb-community

# Ubuntu/Debian
sudo systemctl start mongod

# Windows
net start MongoDB
```

### 4. Run the server
```bash
# Development (auto-restart)
npm run dev

# Production
npm start
```

### 5. Open browser
```
http://localhost:3000
```

The server will:
1. Connect to MongoDB
2. Seed 9 initial opportunities (if DB is empty)
3. Start fetching live data from Devfolio, Unstop, Internshala
4. Schedule auto-refresh every 6 hours

---

## 🔐 LinkedIn OAuth Setup

To enable "Continue with LinkedIn":

1. Go to [LinkedIn Developer Portal](https://www.linkedin.com/developers/apps)
2. Create a new app → Add **"Sign In with LinkedIn using OpenID Connect"** product
3. Copy **Client ID** and **Client Secret**
4. Set redirect URI: `http://localhost:3000/api/auth/linkedin/callback`
5. Add to your `.env`:
```
LINKEDIN_CLIENT_ID=your_client_id
LINKEDIN_CLIENT_SECRET=your_client_secret
LINKEDIN_REDIRECT_URI=http://localhost:3000/api/auth/linkedin/callback
```

---

## 🌐 MongoDB Atlas (Cloud Database)

For production, use MongoDB Atlas (free tier available):

1. Create account at [mongodb.com/atlas](https://www.mongodb.com/cloud/atlas)
2. Create a free cluster
3. Get connection string
4. Update `.env`:
```
MONGODB_URI=mongodb+srv://<user>:<pass>@cluster0.xxxxx.mongodb.net/opportunity_pulse
```

---

## 📡 API Endpoints

### Auth
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/auth/register` | Register with email + password |
| `POST` | `/api/auth/login` | Login with email + password |
| `GET`  | `/api/auth/verify` | Verify JWT token |
| `GET`  | `/api/auth/linkedin` | Start LinkedIn OAuth |
| `GET`  | `/api/auth/linkedin/callback` | LinkedIn OAuth callback |

### Opportunities
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET`  | `/api/opportunities` | Get all opportunities (auto-computes days) |
| `POST` | `/api/opportunities/refresh` | Manually trigger data refresh |

### User
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET`  | `/api/user/profile` | Get user profile |
| `PUT`  | `/api/user/profile` | Update user profile |
| `GET`  | `/api/linkedin/jobs` | Fetch LinkedIn job recommendations (OAuth required) |

### System
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET`  | `/api/health` | Health check + DB status |

---

## 🗄️ Database

**Database:** `opportunity_pulse`  
**Collections:** `users`, `opportunities`

### Useful MongoDB commands
```js
// Connect
mongosh "mongodb://127.0.0.1:27017/opportunity_pulse"

// Count opportunities
db.opportunities.countDocuments()

// Find hackathons closing in 7 days
db.opportunities.find({ category: "hackathon", days: { $lte: 7 } }).sort({ days: 1 })

// Force re-seed (delete all opportunities)
db.opportunities.deleteMany({})

// View users (without passwords)
db.users.find({}, { password: 0, linkedinToken: 0 })
```

---

## 🔄 How Data Flows

```
User logs in (email or LinkedIn OAuth)
       ↓
JWT token stored in localStorage
       ↓
Dashboard loads → GET /api/opportunities
       ↓
Server queries MongoDB (with auto-computed days)
       ↓
node-cron refreshes data every 6h from:
  ├── Devfolio public API
  ├── Unstop public API  
  ├── Internshala API
  └── LinkedIn Jobs API (OAuth users)
```

---

## 🛡️ Security

- Passwords: bcrypt (12 rounds)
- Sessions: JWT (7-day expiry)
- Rate limiting: 20 auth requests / 15 min
- Headers: helmet (XSS, CSRF, etc.)
- Input validation: server-side
- OAuth: CSRF state parameter

**Never commit your `.env` file.**

---

## 📁 Project Structure

```
opportunity-pulse/
├── public/
│   └── index.html          ← Frontend (single HTML file)
├── db/
│   └── schema.js           ← MongoDB schema documentation
├── server.js               ← Express + MongoDB + all routes
├── package.json
├── .env.example            ← Environment template
└── README.md
```

---

## 🐞 Troubleshooting

**"Could not reach server"** in the dashboard:
→ Make sure `node server.js` is running on port 3000

**MongoDB connection failed:**
→ Check MongoDB is running: `mongod --version` then `brew services start mongodb-community`

**LinkedIn OAuth not working:**
→ Check LINKEDIN_CLIENT_ID / SECRET in `.env`, and that the redirect URI matches exactly

**"Token expired" on refresh:**
→ Increase `JWT_EXPIRES` in `.env` (default: `7d`)

**No opportunities showing:**
→ Hit `POST /api/opportunities/refresh` or restart server (auto-seeds on empty DB)
