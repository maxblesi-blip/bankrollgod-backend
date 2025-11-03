// models/User.js - erweitert um Profile-Settings
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  first_name: { type: String },
  last_name: { type: String },
  nickname: { type: String },                    // ← NEU für Display-Name
  profilePublic: { type: Boolean, default: false },     // ← NEU
  showStats: { type: Boolean, default: true },          // ← NEU
  allowMessages: { type: Boolean, default: true },      // ← NEU
  dataSharing: { type: Boolean, default: false },       // ← NEU
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now }
});