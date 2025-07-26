const db = require('../config/firebase');

const addBuket = async (buketData) => {
  const buketRef = db.collection('buket');
  const docRef = await buketRef.add(buketData);
  return docRef;
};

// Tambahkan nanti getAll, getById, delete, update, dst.

module.exports = {
  addBuket,
};
