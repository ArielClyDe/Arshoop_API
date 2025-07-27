// src/handlers/testHandler.js
const { db } = require('../services/firebaseService');

const testFirebaseHandler = async (request, h) => {
  try {
    const snapshot = await db.collection('test').limit(1).get();
    const data = snapshot.docs.map(doc => doc.data());
    return h.response({
      status: 'success',
      message: 'Firebase terhubung!',
      data
    });
  } catch (error) {
    return h.response({
      status: 'fail',
      message: `Gagal koneksi Firebase: ${error.message}`,
    }).code(500);
  }
};

module.exports = { testFirebaseHandler };
