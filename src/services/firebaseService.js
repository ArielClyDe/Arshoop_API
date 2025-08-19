// services/firebaseService.js
const admin = require('firebase-admin');
require('dotenv').config();

/** Hapus kutip yang kebawa di env (mis. "abc" -> abc) */
function dequote(v) {
  return typeof v === 'string' ? v.replace(/^['"]+|['"]+$/g, '') : v;
}

/** Bangun credential dari env (support 1 var JSON atau 3 var terpisah) */
function buildCredentialFromEnv() {
  // 1) Satu ENV JSON (FIREBASE_SERVICE_ACCOUNT)
  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (rawJson) {
    const parsed = JSON.parse(dequote(rawJson));
    if (parsed.private_key) {
      parsed.private_key = dequote(parsed.private_key).replace(/\\n/g, '\n');
    }
    return admin.credential.cert(parsed);
  }

  // 2) Tiga ENV terpisah
  const projectId   = dequote(process.env.FIREBASE_PROJECT_ID);
  const clientEmail = dequote(process.env.FIREBASE_CLIENT_EMAIL);
  let privateKey    = process.env.FIREBASE_PRIVATE_KEY;

  if (typeof privateKey === 'string') {
    privateKey = dequote(privateKey).replace(/\\n/g, '\n');
  }

  if (projectId && clientEmail && privateKey) {
    return admin.credential.cert({ projectId, clientEmail, privateKey });
  }

  // 3) Fallback ke Application Default Credentials (jika diset di env)
  return admin.credential.applicationDefault();
}

let app;
if (!admin.apps.length) {
  try {
    app = admin.initializeApp({
      credential: buildCredentialFromEnv(),
      storageBucket: dequote(process.env.FIREBASE_STORAGE_BUCKET) || undefined,
    });
    // ✅ log SETELAH initializeApp
    console.log('[FIREBASE] initialized projectId =', admin.app().options.projectId || '(unknown)');
  } catch (e) {
    console.error('[FIREBASE] initializeApp failed:', e);
    throw e; // fail fast biar kelihatan di Railway
  }
} else {
  app = admin.app();
}

const db = admin.firestore();
// Supaya update() tidak error saat ada undefined di payload
try { db.settings({ ignoreUndefinedProperties: true }); } catch {}

module.exports = { admin, db };
