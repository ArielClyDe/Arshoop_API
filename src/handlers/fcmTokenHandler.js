// handlers/fcmTokenHandler.js
const { db, admin } = require('../services/firebaseService');

async function saveFcmTokenHandler(request, h) {
  const { userId } = request.params;
  const { token } = request.payload || {};
  if (!token) return h.response({ status:'fail', message:'token required' }).code(400);

  console.log('[FCM] SAVE token for user=', userId, 'len=', token.length);

  await db.collection('user_fcm_tokens').doc(userId).set(
    {
      tokens: admin.firestore.FieldValue.arrayUnion(token),
      updated_at: new Date().toISOString(),
    },
    { merge: true }
  );

  return h.response({ status: 'success' }).code(200);
}

async function deleteFcmTokenHandler(request, h) {
  const { userId } = request.params;
  const { token } = request.payload || {};
  if (!token) return h.response({ status:'fail', message:'token required' }).code(400);

  console.log('[FCM] DELETE token for user=', userId);

  await db.collection('user_fcm_tokens').doc(userId).set(
    {
      tokens: admin.firestore.FieldValue.arrayRemove(token),
      updated_at: new Date().toISOString(),
    },
    { merge: true }
  );

  return h.response({ status: 'success' }).code(200);
}

module.exports = { saveFcmTokenHandler, deleteFcmTokenHandler };
