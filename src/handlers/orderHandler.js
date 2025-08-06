const { db } = require('../service/firebase');
const { v4: uuidv4 } = require('uuid');


const createOrderHandler = async (request, h) => {
  try {
    const {
      userId,
      carts,
      alamat,
      ongkir,
      paymentMethod,
      totalPrice,
    } = request.payload;

    if (!userId || !carts || carts.length === 0 || !alamat || !paymentMethod || !totalPrice) {
      return h.response({ status: 'fail', message: 'Data tidak lengkap' }).code(400);
    }

    const orderId = uuidv4();

    const orderData = {
      orderId,
      userId,
      alamat,
      ongkir,
      paymentMethod,
      totalPrice,
      carts,
      status: paymentMethod === 'cod' ? 'pending' : 'waiting_payment',
      createdAt: new Date().toISOString(),
    };

    await db.collection('orders').doc(orderId).set(orderData);

    // Hapus semua cart user
    const cartSnapshot = await db.collection('carts').where('userId', '==', userId).get();
    const batch = db.batch();
    cartSnapshot.forEach(doc => batch.delete(doc.ref));
    await batch.commit();

    return h.response({
      status: 'success',
      message: 'Order berhasil dibuat',
      data: { orderId },
    }).code(201);
  } catch (error) {
    console.error('Gagal membuat order:', error);
    return h.response({ status: 'error', message: 'Gagal membuat order' }).code(500);
  }
};

module.exports = {
  createOrderHandler,
  // tambahkan handler lainnya jika ada
};


