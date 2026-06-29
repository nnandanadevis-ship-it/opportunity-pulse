/**
 * ══════════════════════════════════════════════════════════════
 *  OPPORTUNITY PULSE — MongoDB Schema Reference
 *  Database: opportunity_pulse
 *  Collections: users, opportunities
 * ══════════════════════════════════════════════════════════════
 *
 * This file documents the schema. The actual models are in server.js.
 * Run this file standalone to inspect the schema: node db/schema.js
 */

// ── Collection: users ──────────────────────────────────────────
// 
// {
//   _id:             ObjectId (auto),
//   email:           String (unique, lowercase, required),
//   password:        String (bcrypt hashed, null for OAuth users),
//   firstName:       String,
//   lastName:        String,
//   profileComplete: Boolean (false until onboarding done),
//   profile: {
//     first:        String,
//     last:         String,
//     year:         String,     // "3rd Year"
//     degree:       String,     // "B.Tech CSE"
//     college:      String,
//     city:         String,
//     completeness: Number,     // 0–100
//     skills:       [String],   // ["Python", "React", ...]
//     avatar:       String,     // base64 data URL
//     location:     String,     // "remote" | "india" | "us" | "other"
//     sources:      [String],   // ["Unstop", "LinkedIn", ...]
//   },
//   linkedinId:      String (LinkedIn sub/uid),
//   linkedinToken:   String (OAuth access token — SENSITIVE),
//   createdAt:       Date,
//   updatedAt:       Date,
//   lastLogin:       Date
// }

// ── Collection: opportunities ──────────────────────────────────
//
// {
//   _id:          ObjectId (auto),
//   id:           String (unique, e.g. "devfolio-horizon-25"),
//   event_name:   String,
//   source:       String,       // "Devfolio" | "Unstop" | "LinkedIn" | ...
//   source_color: String,       // hex colour for UI dot
//   category:     String,       // "hackathon" | "internship" | "scholarship" | "event"
//   icon:         String,       // emoji
//   icon_bg:      String,       // hex background colour
//   deadline:     String,       // human-readable "Apr 20, 2025"
//   deadline_date:Date,         // machine-readable (used for day calc)
//   days:         Number,       // auto-computed: days until deadline
//   reward:       String,       // "₹1,00,000" or null
//   reward_raw:   Number,       // numeric prize value in INR
//   stipend:      String,       // "₹8,000/month" or null
//   remote:       Boolean,
//   new_today:    Boolean,      // true if added within last 24h
//   match:        Number,       // 0–100 profile match score
//   eligibility:  String,
//   apply_link:   String,
//   description:  String,
//   tags:         [String],     // ["hackathon","prize","remote","new","stipend",...]
//   fetchedAt:    Date,         // when data was last refreshed from source
//   source_raw:   Mixed,        // raw API response (for debugging)
//   createdAt:    Date,
//   updatedAt:    Date
// }

// ── Indexes (created automatically by Mongoose) ────────────────
//
// users:         email (unique)
// opportunities: id (unique), category, deadline_date, source

// ── MongoDB Shell commands ─────────────────────────────────────
//
// # Connect
// mongosh "mongodb://127.0.0.1:27017/opportunity_pulse"
//
// # List collections
// show collections
//
// # Count opportunities
// db.opportunities.countDocuments()
//
// # Find hackathons closing soon
// db.opportunities.find({ category: "hackathon", days: { $lte: 7 } }).sort({ days: 1 })
//
// # Find all users (no passwords)
// db.users.find({}, { password: 0, linkedinToken: 0 })
//
// # Delete all opportunities (to force re-seed)
// db.opportunities.deleteMany({})
//
// # Drop entire database
// db.dropDatabase()

console.log('Schema reference file — see comments above.');
console.log('Collections: users, opportunities');
console.log('To connect: mongosh "mongodb://127.0.0.1:27017/opportunity_pulse"');
