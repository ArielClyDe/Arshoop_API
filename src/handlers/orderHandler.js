const { db } = require('../services/firebaseService');
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
      deliveryMethod, // <-- tambahkan
    } = request.payload;

    // Validasi dasar
    if (!userId || !carts || carts.length === 0 || !paymentMethod || !totalPrice || !deliveryMethod) {
      return h.response({ status: 'fail', message: 'Data tidak lengkap' }).code(400);
    }

    // Validasi khusus jika delivery
    if (deliveryMethod === 'delivery' && (!alamat || !ongkir)) {
      return h.response({ status: 'fail', message: 'Alamat dan ongkir wajib untuk pengiriman' }).code(400);
    }

    const orderId = uuidv4();

    const orderData = {
      orderId,
      userId,
      deliveryMethod,
      alamat: deliveryMethod === 'delivery' ? alamat : null,
      ongkir: deliveryMethod === 'delivery' ? ongkir : 0,
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


// GET /orders
const getAllOrdersHandler = async (request, h) => {
  const { userId } = request.query;
  try {
    const snapshot = await db.collection('orders').where('userId', '==', userId).get();
    const orders = snapshot.docs.map((doc) => ({ orderId: doc.id, ...doc.data() }));
    return h.response({ status: 'success', data: orders }).code(200);
  } catch (error) {
    console.error('Error fetching orders:', error);
    return h.response({ status: 'fail', message: 'Gagal mengambil data order' }).code(500);
  }
};

// GET /orders/{orderId}
const getOrderDetailHandler = async (request, h) => {
  const { orderId } = request.params;
  try {
    const orderDoc = await db.collection('orders').doc(orderId).get();
    if (!orderDoc.exists) {
      return h.response({ status: 'fail', message: 'Order tidak ditemukan' }).code(404);
    }
    const orderData = orderDoc.data();
    return h.response({ status: 'success', data: { orderId, ...orderData } }).code(200);
  } catch (error) {
    return h.response({ status: 'error', message: 'Gagal mengambil detail order' }).code(500);
  }
};

// PUT /orders/{orderId}/status
const updateOrderStatusHandler = async (request, h) => {
  const { orderId } = request.params;
  const { status } = request.payload;

  try {
    await db.collection('orders').doc(orderId).update({ status });
    return h.response({ status: 'success', message: 'Status berhasil diupdate' }).code(200);
  } catch (error) {
    return h.response({ status: 'error', message: 'Gagal update status' }).code(500);
  }
};

module.exports = {
  createOrderHandler,
  getAllOrdersHandler,
  getOrderDetailHandler,
  updateOrderStatusHandler,
};


