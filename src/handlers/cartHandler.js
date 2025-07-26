const firebaseService = require('../services/firebaseService');

// Handler untuk menambahkan item ke cart
const addToCartHandler = async (request, h) => {
  const { userId, buketId, size, quantity, customMaterials = [] } = request.payload;

  const created_at = new Date().toISOString();

  try {
    // Tambahkan dulu dokumen tanpa cartId
    const docRef = await firebaseService.db.collection('carts').add({
      userId,
      buketId,
      size,
      quantity,
      customMaterials,
      created_at,
    });

    // Update kembali dokumen dengan cartId-nya
    await docRef.update({ cartId: docRef.id });

    return h.response({
      status: 'success',
      message: 'Item ditambahkan ke keranjang',
      data: { cartId: docRef.id }
    }).code(201);
  } catch (err) {
    console.error(err);
    return h.response({
      status: 'fail',
      message: 'Gagal menambahkan ke keranjang'
    }).code(500);
  }
};


// Handler untuk menghapus item dari cart
const deleteCartItemHandler = async (request, h) => {
  const { cartId } = request.params;

  try {
    await firebaseService.db.collection('carts').doc(cartId).delete();
    return h.response({
      status: 'success',
      message: 'Item dihapus dari keranjang'
    }).code(200);
  } catch (err) {
    console.error(err);
    return h.response({
      status: 'fail',
      message: 'Gagal menghapus item keranjang'
    }).code(500);
  }
};

// Handler untuk mendapatkan semua cart milik user
const getCartByUserHandler = async (request, h) => {
  const { userId } = request.params;
  console.log('👉 userId param:', userId);

  try {
    const cartsSnapshot = await firebaseService.db
      .collection('carts')
      .where('userId', '==', userId)
      .get();

    console.log('📦 Total dokumen ditemukan:', cartsSnapshot.size);

    const carts = [];

    for (const doc of cartsSnapshot.docs) {
      console.log('🔎 Dokumen ditemukan:', doc.id, doc.data());
      const cartData = doc.data();
      const { buketId, size, quantity = 1, customMaterials = [] } = cartData;

      // Ambil detail buket
      const buketDoc = await firebaseService.db.collection('buket').doc(buketId).get();
      if (!buketDoc.exists) {
        console.log(`🚫 Buket tidak ditemukan: ${buketId}`);
        continue;
      }
      const buketData = buketDoc.data();
      const materialsForSize = buketData.materialsBySize?.[size] || [];

      // Ambil detail bahan utama
      const buketMaterials = [];
      for (const item of materialsForSize) {
        const matDoc = await firebaseService.db.collection('materials').doc(item.materialId).get();
        if (matDoc.exists) {
          const matData = matDoc.data();
          buketMaterials.push({
            materialId: item.materialId,
            name: matData.name,
            price: matData.price,
            quantity: item.quantity,
            total: item.quantity * matData.price
          });
        }
      }

      // Ambil detail bahan tambahan (customMaterials)
      const customMaterialDetails = [];
      for (const cm of customMaterials) {
        const matDoc = await firebaseService.db.collection('materials').doc(cm.materialId).get();
        if (matDoc.exists) {
          const matData = matDoc.data();
          customMaterialDetails.push({
            materialId: cm.materialId,
            name: matData.name,
            price: matData.price,
            quantity: cm.quantity,
            total: cm.quantity * matData.price
          });
        }
      }

      // Hitung total
      const singleItemTotal = [...buketMaterials, ...customMaterialDetails]
        .reduce((sum, item) => sum + item.total, 0);

      const totalPrice = singleItemTotal * quantity;

      carts.push({
        cartId: doc.id, // tambahkan cartId di level atas
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
          type: buketData.type
        },
        buketMaterials,
        customMaterialDetails,
        totalPrice
      });
    }

    return h.response({
      status: 'success',
      data: carts
    }).code(200);

  } catch (err) {
    console.error(err);
    return h.response({
      status: 'fail',
      message: 'Gagal mengambil data keranjang'
    }).code(500);
  }
};
// Handler untuk mengupdate item di cart
const updateCartItemHandler = async (request, h) => {
  const { cartId } = request.params;
  const { size, quantity, customMaterials } = request.payload;

  try {
    const cartRef = firebaseService.db.collection('carts').doc(cartId);
    const cartSnap = await cartRef.get();

    if (!cartSnap.exists) {
      return h.response({
        status: 'fail',
        message: 'Item cart tidak ditemukan'
      }).code(404);
    }

    const updateData = {};
    if (size) updateData.size = size;
    if (quantity !== undefined) updateData.quantity = quantity;
    if (customMaterials) updateData.customMaterials = customMaterials;

    await cartRef.update(updateData);

    return h.response({
      status: 'success',
      message: 'Item keranjang berhasil diperbarui'
    }).code(200);
  } catch (err) {
    console.error(err);
    return h.response({
      status: 'fail',
      message: 'Gagal memperbarui item keranjang'
    }).code(500);
  }
};


module.exports = {
  addToCartHandler,
  getCartByUserHandler,
  deleteCartItemHandler,
  updateCartItemHandler
};
