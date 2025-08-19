// services/firebaseService.js
const admin = require('firebase-admin');
require('dotenv').config();

/** Hilangkan kutip yang kebawa di env (mis. "abc" -> abc) */
function dequote(v) {
  return typeof v === 'string' ? v.replace(/^['"]+|['"]+$/g, '') : v;
}

function buildCredentialFromEnv() {
  // Opsi A: FULL JSON di env (jika suatu saat kamu pindah ke ini)
  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (rawJson) {
    const parsed = JSON.parse(dequote(rawJson));
    if (parsed.private_key) {
      parsed.private_key = dequote(parsed.private_key).replace(/\\n/g, '\n');
    }
    return { cred: admin.credential.cert(parsed), projectId: parsed.project_id };
  }

  // Opsi B: Trio var terpisah (PUNYA KAMU SEKARANG)
  const projectId   = dequote(process.env.FIREBASE_PROJECT_ID);
  const clientEmail = dequote(process.env.FIREBASE_CLIENT_EMAIL);
  let privateKey    = process.env.FIREBASE_PRIVATE_KEY;
  if (typeof privateKey === 'string') privateKey = dequote(privateKey).replace(/\\n/g, '\n');

  if (projectId && clientEmail && privateKey) {
    return {
      cred: admin.credential.cert({ projectId, clientEmail, privateKey }),
      projectId,
    };
  }

  // Opsi C: ADC fallback (jarang dipakai di Railway)
  return { cred: admin.credential.applicationDefault(), projectId: process.env.GOOGLE_CLOUD_PROJECT };
}

let app;
if (!admin.apps.length) {
  try {
    const { cred, projectId } = buildCredentialFromEnv();

    // 👉 set projectId EXPLISIT di options supaya .options.projectId tidak (unknown)
    app = admin.initializeApp({
      credential: cred,
      projectId: projectId, // <— penting
      // storageBucket: dequote(process.env.FIREBASE_STORAGE_BUCKET) || undefined, // kalau perlu bucket
    });

    const pid = admin.app().options.projectId || projectId || '(unknown)';
    console.log('[FIREBASE] initialized projectId =', pid);
  } catch (e) {
    console.error('[FIREBASE] initializeApp failed:', e);
    throw e;
  }
} else {
  app = admin.app();
}

const db = admin.firestore();
try { db.settings({ ignoreUndefinedProperties: true }); } catch {}

module.exports = { admin, db };
