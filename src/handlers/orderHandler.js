const { db } = require('../services/firebaseService');

// Membuat order dari cart (satu atau semua)
const createOrderHandler = async (request, h) => {
  const { userId, cartId } = request.payload;

  try {
    let carts = [];

    // Ambil satu cart jika ada cartId
    if (cartId) {
      const cartDoc = await db.collection('carts').doc(cartId).get();
      if (!cartDoc.exists) {
        return h.response({ status: 'fail', message: 'Cart tidak ditemukan' }).code(404);
      }
      carts.push({ id: cartDoc.id, ...cartDoc.data() });
    } else {
      // Ambil semua cart milik user jika tidak ada cartId
      const snapshot = await db.collection('carts').where('userId', '==', userId).get();
      snapshot.forEach((doc) => {
        carts.push({ id: doc.id, ...doc.data() });
      });
    }

    if (carts.length === 0) {
      return h.response({ status: 'fail', message: 'Cart kosong' }).code(400);
    }

    const createdOrders = [];

    for (const cart of carts) {
      const { buketId, size, quantity, customMaterials = [], servicePrice = 0 } = cart;

      // Ambil data buket
      const buketDoc = await db.collection('buket').doc(buketId).get();
      if (!buketDoc.exists) continue;
      const buketData = buketDoc.data();

      const materialsBySize = buketData.materialsBySize?.[size] || [];

      // Ambil data default material
      const defaultMaterials = [];
      for (const item of materialsBySize) {
        const materialDoc = await db.collection('materials').doc(item.materialId).get();
        if (materialDoc.exists) {
          const materialData = materialDoc.data();
          defaultMaterials.push({
            materialId: item.materialId,
            name: materialData.name || '',
            price: materialData.price || 0,
            quantity: item.quantity * quantity,
          });
        }
      }

      // Ambil data custom material
      const customMaterialDetails = [];
      for (const item of customMaterials) {
        const materialDoc = await db.collection('materials').doc(item.materialId).get();
        if (materialDoc.exists) {
          const materialData = materialDoc.data();
          customMaterialDetails.push({
            materialId: item.materialId,
            name: materialData.name || '',
            price: materialData.price || 0,
            quantity: item.quantity,
          });
        }
      }

      // Gabungkan semua bahan
      const allMaterials = [...defaultMaterials, ...customMaterialDetails];
      const materialsTotal = allMaterials.reduce((sum, item) => sum + item.price * item.quantity, 0);
      const totalPrice = materialsTotal + servicePrice;

      // Simpan ke koleksi orders
      const orderRef = db.collection('orders').doc();
      const orderId = orderRef.id;

      const newOrder = {
        orderId,
        userId,
        buketId,
        size,
        quantity,
        servicePrice,
        totalPrice,
        status: 'pending',
        createdAt: new Date().toISOString(),
      };

      await orderRef.set(newOrder);

      // Simpan detail bahan ke order_materials
      const batch = db.batch();
      allMaterials.forEach((material) => {
        const orderMaterialRef = db.collection('order_materials').doc();
        batch.set(orderMaterialRef, {
          orderId,
          materialId: material.materialId,
          quantity: material.quantity,
          price: material.price,
        });
      });
      await batch.commit();

      // Tambahkan order ke response
      createdOrders.push({
        orderId,
        servicePrice,
        totalPrice,
        materials: allMaterials,
      });

      // Hapus cart setelah order dibuat
      await db.collection('carts').doc(cart.id).delete();
    }

    return h.response({
      status: 'success',
      message: 'Order berhasil dibuat',
      data: createdOrders,
    }).code(201);

  } catch (err) {
    console.error(err);
    return h.response({ status: 'fail', message: 'Gagal membuat order' }).code(500);
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
