const { db } = require('../services/firebaseService');

// Membuat order dari cart (satu atau semua)
const createOrderHandler = async (request, h) => {
  const { userId, cartIds = [] } = request.payload;
  const created_at = new Date().toISOString();
  const orders = [];

  try {
    const cartSnapshot = await db.collection('carts')
      .where('userId', '==', userId)
      .get();

    const carts = [];
    cartSnapshot.forEach((doc) => {
      if (cartIds.length === 0 || cartIds.includes(doc.id)) {
        carts.push({ cartId: doc.id, ...doc.data() });
      }
    });

    if (carts.length === 0) {
      return h.response({
        status: 'fail',
        message: 'Cart tidak ditemukan',
      }).code(404);
    }

    for (const cart of carts) {
      let { buket, buketId, servicePrice = 0, buketMaterials = [], customMaterialDetails = [], quantity = 1 } = cart;

// Ambil buket dari Firestore kalau buket tidak tersedia
if (!buket && buketId) {
  const buketDoc = await db.collection('bukets').doc(buketId).get();
  if (buketDoc.exists) {
    buket = buketDoc.data();
  } else {
    console.warn(`Buket tidak ditemukan untuk ID: ${buketId}`);
    continue; // Skip order ini, atau kamu bisa throw error juga
  }
}


      const materials = [];

      // Template materials
      for (const item of buketMaterials) {
        materials.push({
          materialId: item.materialId,
          name: item.name,
          price: item.price,
          quantity: item.quantity,
          total: item.price * item.quantity,
          type: 'template'
        });
      }

      // Custom materials
      for (const item of customMaterialDetails) {
        materials.push({
          materialId: item.materialId,
          name: item.name,
          price: item.price,
          quantity: item.quantity,
          total: item.price * item.quantity,
          type: 'custom'
        });
      }

      const materialTotal = materials.reduce((sum, item) => sum + item.total, 0);
      const totalPrice = materialTotal + servicePrice;

      const newOrderRef = db.collection('orders').doc();
      const orderData = {
        orderId: newOrderRef.id,
        userId,
        cartId: cart.cartId,
        buketId: cart.buketId,
        buket,
        materials,
        quantity,
        servicePrice,
        totalPrice,
        created_at,
      };

      await newOrderRef.set(orderData);
      await db.collection('carts').doc(cart.cartId).delete(); // Hapus cart setelah dipesan

      orders.push({
        orderId: newOrderRef.id,
        servicePrice,
        totalPrice,
        materials,
      });
    }

    return h.response({
      status: 'success',
      message: 'Order berhasil dibuat',
      data: orders,
    }).code(201);

  } catch (error) {
    console.error('Gagal membuat order:', error);
    return h.response({
      status: 'fail',
      message: 'Gagal membuat order',
    }).code(500);
  }
};

// Menampilkan semua order milik user
const getOrdersByUserHandler = async (request, h) => {
  const { userId } = request.params;

  try {
    const snapshot = await db.collection('orders')
      .where('userId', '==', userId)
      .orderBy('createdAt', 'desc')
      .get();

    const orders = [];

    for (const doc of snapshot.docs) {
      const order = doc.data();

      const buketDoc = await db.collection('buket').doc(order.buketId).get();
      order.buket = buketDoc.exists ? { buketId: buketDoc.id, ...buketDoc.data() } : null;

      const materialsSnapshot = await db.collection('order_materials')
        .where('orderId', '==', order.orderId)
        .get();

      order.materials = [];

      for (const matDoc of materialsSnapshot.docs) {
        const { materialId, quantity, price } = matDoc.data();
        const materialDetailDoc = await db.collection('materials').doc(materialId).get();
        const name = materialDetailDoc.exists ? materialDetailDoc.data().name : 'Unknown';

        order.materials.push({
          materialId,
          name,
          quantity,
          price,
          total: quantity * price,
        });
      }

      orders.push(order);
    }

    return h.response({
      status: 'success',
      data: orders,
    });
  } catch (err) {
    console.error('Error in getOrdersByUserHandler:', err.message);
    return h.response({ status: 'fail', message: 'Gagal mengambil order: ' + err.message }).code(500);
  }
};

// Update status order
const updateOrderStatusHandler = async (request, h) => {
  const { orderId } = request.params;
  const { status } = request.payload;

  try {
    const orderRef = db.collection('orders').doc(orderId);
    const doc = await orderRef.get();

    if (!doc.exists) {
      return h.response({ status: 'fail', message: 'Order tidak ditemukan' }).code(404);
    }

    await orderRef.update({ status });

    return h.response({
      status: 'success',
      message: `Status order diperbarui menjadi '${status}'`,
    });
  } catch (err) {
    console.error(err);
    return h.response({ status: 'fail', message: 'Gagal memperbarui status order' }).code(500);
  }
};

// Menampilkan detail satu order
const getOrderByIdHandler = async (request, h) => {
  const { orderId } = request.params;

  try {
    const orderDoc = await db.collection('orders').doc(orderId).get();
    if (!orderDoc.exists) {
      return h.response({ status: 'fail', message: 'Order tidak ditemukan' }).code(404);
    }

    const order = orderDoc.data();

    const buketDoc = await db.collection('buket').doc(order.buketId).get();
    order.buket = buketDoc.exists ? { buketId: buketDoc.id, ...buketDoc.data() } : null;

    const materialsSnapshot = await db.collection('order_materials')
      .where('orderId', '==', orderId)
      .get();

    order.materials = [];
    for (const matDoc of materialsSnapshot.docs) {
      const { materialId, quantity, price } = matDoc.data();
      const materialDetailDoc = await db.collection('materials').doc(materialId).get();
      const name = materialDetailDoc.exists ? materialDetailDoc.data().name : 'Unknown';

      order.materials.push({
        materialId,
        name,
        quantity,
        price,
        total: quantity * price,
      });
    }

    return h.response({
      status: 'success',
      data: order,
    });

  } catch (err) {
    console.error('Error in getOrderByIdHandler:', err.message);
    return h.response({
      status: 'fail',
      message: 'Gagal mengambil detail order',
    }).code(500);
  }
};

module.exports = {
  createOrderHandler,
  getOrdersByUserHandler,
  updateOrderStatusHandler,
  getOrderByIdHandler
};
