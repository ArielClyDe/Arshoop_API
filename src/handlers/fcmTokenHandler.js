// handlers/fcmTokenHandler.js
const { admin, db } = require('../services/firebaseService');

// POST /users/{userId}/fcm-tokens
async function saveFcmTokenHandler(request, h) {
  const { userId } = request.params;
  const { token } = request.payload || {};
  if (!token) {
    return h.response({ status: 'fail', message: 'token required' }).code(400);
  }

  await db.collection('user_fcm_tokens').doc(userId).set(
    {
      tokens: admin.firestore.FieldValue.arrayUnion(token),
      updated_at: new Date().toISOString(),
    },
    { merge: true }
  );

  return h.response({ status: 'success' }).code(200);
}

// DELETE /users/{userId}/fcm-tokens
async function deleteFcmTokenHandler(request, h) {
  const { userId } = request.params;
  const { token } = request.payload || {};
  if (!token) {
    return h.response({ status: 'fail', message: 'token required' }).code(400);
  }

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
