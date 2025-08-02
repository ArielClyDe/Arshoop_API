const { db } = require('../services/firebaseService');

// Tambahkan item ke cart
const addToCartHandler = async (request, h) => {
  const {
    userId,
    buketId,
    name,
    imageUrl,
    size,
    quantity,
    basePrice = 0,
    customMaterials = [],
    requestDate = null,
    orderNote = '',
    totalPrice = 0
  } = request.payload;

  const created_at = new Date().toISOString();

  try {
    const buketDoc = await db.collection('buket').doc(buketId).get();
    if (!buketDoc.exists) {
      return h.response({
        status: 'fail',
        message: 'Buket tidak ditemukan',
      }).code(404);
    }

    const buketData = buketDoc.data();
    const servicePrice = buketData.service_price || 0;

    const docRef = await db.collection('carts').add({
      userId,
      buketId,
      name,
      imageUrl,
      size,
      quantity,
      basePrice,
      customMaterials,
      servicePrice,
      requestDate,
      orderNote,
      totalPrice,
      created_at,
    });

    await docRef.update({ cartId: docRef.id });

    return h.response({
      status: 'success',
      message: 'Item ditambahkan ke keranjang',
      data: { cartId: docRef.id },
    }).code(201);
  } catch (err) {
    console.error(err);
    return h.response({
      status: 'fail',
      message: 'Gagal menambahkan ke keranjang',
    }).code(500);
  }
};



// Hapus item dari cart
const deleteCartItemHandler = async (request, h) => {
  const { cartId } = request.params;

  try {
    await db.collection('carts').doc(cartId).delete();
    return h.response({
      status: 'success',
      message: 'Item dihapus dari keranjang',
    }).code(200);
  } catch (err) {
    console.error(err);
    return h.response({
      status: 'fail',
      message: 'Gagal menghapus item keranjang',
    }).code(500);
  }
};

// Ambil semua cart milik user
const getCartByUserHandler = async (request, h) => {
  const { userId } = request.params;

  try {
    const cartsSnapshot = await db.collection('carts').where('userId', '==', userId).get();
    if (cartsSnapshot.empty) {
      return h.response({ carts: [], totalPrice: 0 }).code(200);
    }

    const carts = [];
    let grandTotal = 0;

    for (const doc of cartsSnapshot.docs) {
      const cartData = doc.data();
      const { buketId, size, quantity, customMaterials = [], servicePrice = 0 } = cartData;

      const buketDoc = await db.collection('buket').doc(buketId).get();
      if (!buketDoc.exists) continue;

      const buketData = buketDoc.data();
      const materials = buketData.materialsBySize?.[size] || [];

      let singleItemTotal = 0;
      const buketMaterials = [];

      // Hitung bahan dari buket
      for (const item of materials) {
        const materialDoc = await db.collection('materials').doc(item.materialId).get();
        if (materialDoc.exists) {
          const materialData = materialDoc.data();
          const totalMaterialPrice = materialData.price * item.quantity;
          singleItemTotal += totalMaterialPrice;

          buketMaterials.push({
            materialId: item.materialId,
            name: materialData.name,
            price: materialData.price,
            quantity: item.quantity,
            total: totalMaterialPrice,
          });
        }
      }

      // Hitung custom material
      const customMaterialDetails = [];
      for (const custom of customMaterials) {
        const customDoc = await db.collection('materials').doc(custom.materialId).get();
        if (customDoc.exists) {
          const customData = customDoc.data();
          const totalCustomPrice = customData.price * custom.quantity;
          singleItemTotal += totalCustomPrice;

          customMaterialDetails.push({
            materialId: custom.materialId,
            name: customData.name,
            price: customData.price,
            quantity: custom.quantity,
            total: totalCustomPrice,
          });
        }
      }

      const totalPrice = (singleItemTotal + servicePrice) * quantity;
      grandTotal += totalPrice;

      carts.push({
        cartId: doc.id,
        ...cartData,
        buket: {
          buketId,
          name: buketData.name,
          image_url: buketData.image_url,
          size,
          category: buketData.category,
          processing_time: buketData.processing_time,
          is_customizable: buketData.is_customizable,
          requires_photo: buketData.requires_photo,
          type: buketData.type,
        },
        servicePrice,
        buketMaterials,
        customMaterialDetails,
        totalPrice,
      });
    }

    return h.response({
      status: 'success',
      data: carts,
      totalPrice: grandTotal,
    }).code(200);

  } catch (error) {
    console.error('Error fetching carts:', error);
    return h.response({
      status: 'fail',
      message: 'Gagal mengambil data cart',
      error: error.message,
    }).code(500);
  }
};

// Update item di cart
const updateCartItemHandler = async (request, h) => {
  const { cartId } = request.params;
  const { size, quantity, customMaterials } = request.payload;

  try {
    const cartRef = db.collection('carts').doc(cartId);
    const cartSnap = await cartRef.get();

    if (!cartSnap.exists) {
      return h.response({
        status: 'fail',
        message: 'Item cart tidak ditemukan',
      }).code(404);
    }

    const updateData = {};
    if (size) updateData.size = size;
    if (quantity !== undefined) updateData.quantity = quantity;
    if (customMaterials) updateData.customMaterials = customMaterials;

    await cartRef.update(updateData);

    return h.response({
      status: 'success',
      message: 'Item keranjang berhasil diperbarui',
    }).code(200);
  } catch (err) {
    console.error(err);
    return h.response({
      status: 'fail',
      message: 'Gagal memperbarui item keranjang',
    }).code(500);
  }
};

module.exports = {
  addToCartHandler,
  getCartByUserHandler,
  deleteCartItemHandler,
  updateCartItemHandler,
};
