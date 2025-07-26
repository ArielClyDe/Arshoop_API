const admin = require('firebase-admin');
require('dotenv').config();

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    }),
  });
}

const db = admin.firestore();

// Fungsi untuk menambahkan buket ke koleksi 'buket'
const addBuket = async (buketData) => {
  const buketRef = db.collection('buket');
  const docRef = await buketRef.add(buketData);
  return docRef;
};

// Fungsi untuk menambahkan material ke koleksi 'materials'
const addMaterial = async (materialData) => {
  const materialRef = db.collection('materials');
  const docRef = await materialRef.add(materialData);
  return docRef;
};

// FUngsi cart
const addToCart = async (userId, item) => {
  const docRef = await db.collection('carts').add({
    userId,
    ...item,
    createdAt: new Date(),
  });
  return docRef;
};

const getCartByUser = async (userId) => {
  const snapshot = await db.collection('carts').where('userId', '==', userId).get();
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
};

const deleteCartItem = async (cartId) => {
  await db.collection('carts').doc(cartId).delete();
};

module.exports = {
  db,
  addBuket,
  addMaterial,
  addToCart,
  getCartByUser,
  deleteCartItem
};
