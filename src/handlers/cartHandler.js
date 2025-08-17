'use strict';

const { db } = require('../services/firebaseService');
const { nanoid } = require('nanoid');

// --- helper: ekstrak url gambar dari note lama (legacy) ---
const extractPhotoUrls = (note = '') => {
  if (!note) return { cleaned: '', urls: [] };

  const urlRegex = /(https?:\/\/\S+)/gi;
  const all = note.match(urlRegex) || [];

  // ambil hanya link gambar / cloudinary
  const urls = all.filter((u) =>
    /\.(jpg|jpeg|png|webp|gif)$/i.test(u) ||
    u.toLowerCase().includes('res.cloudinary.com')
  );

  // bersihkan url dari note
  const cleaned = note
    .replace(urlRegex, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();

  return { cleaned, urls };
};

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
    totalPrice = 0,
    // ✅ field baru (opsional)
    photoUrls = []
  } = request.payload || {};

  const created_at = new Date().toISOString();

  try {
    // validasi buket ada
    const buketDoc = await db.collection('buket').doc(buketId).get();
    if (!buketDoc.exists) {
      return h.response({ status: 'fail', message: 'Buket tidak ditemukan' }).code(404);
    }

    // ambil service price untuk buket
    const buketData = buketDoc.data();
    const servicePrice = buketData.service_price || 0;

    // pisahkan url yang nyangkut di catatan (legacy)
    const { cleaned, urls } = extractPhotoUrls(orderNote || '');
    const fromPayload = Array.isArray(photoUrls) ? photoUrls : [];
    const finalPhotoUrls = [...new Set([...fromPayload, ...urls])];

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
      orderNote: cleaned || orderNote || '',
      totalPrice,
      photoUrls: finalPhotoUrls,
      created_at,
      updated_at: created_at,
    });

    await docRef.update({ cartId: docRef.id });

    return h
      .response({
        status: 'success',
        message: 'Item ditambahkan ke keranjang',
        data: { cartId: docRef.id },
      })
      .code(201);
  } catch (err) {
    console.error('[CART] add error:', err);
    return h
      .response({ status: 'fail', message: 'Gagal menambahkan ke keranjang' })
      .code(500);
  }
};

// Hapus item dari cart
const deleteCartItemHandler = async (request, h) => {
  const { cartId } = request.params;

  try {
    await db.collection('carts').doc(cartId).delete();
    return h.response({ status: 'success', message: 'Item dihapus dari keranjang' }).code(200);
  } catch (err) {
    console.error('[CART] delete error:', err);
    return h.response({ status: 'fail', message: 'Gagal menghapus item keranjang' }).code(500);
  }
};

// Ambil semua cart milik user
const getCartByUserHandler = async (request, h) => {
  const { userId } = request.params;

  try {
    const snap = await db.collection('carts').where('userId', '==', userId).get();
    if (snap.empty) {
      return h.response({ status: 'success', data: [], totalPrice: 0 }).code(200);
    }

    const carts = [];
    let grandTotal = 0;

    for (const doc of snap.docs) {
      const cartData = doc.data();
      const {
        buketId,
        size,
        quantity,
        customMaterials = [],
        servicePrice = 0,
      } = cartData;

      // --- normalisasi photoUrls (migrasi dari note bila perlu) ---
      let photoUrls = Array.isArray(cartData.photoUrls) ? cartData.photoUrls : [];
      if (!photoUrls.length && (cartData.orderNote || '').includes('http')) {
        const { cleaned, urls } = extractPhotoUrls(cartData.orderNote);
        photoUrls = urls;
        cartData.orderNote = cleaned || '';
        // best-effort update ke DB (abaikan error)
        try {
          await db.collection('carts').doc(doc.id).update({
            orderNote: cartData.orderNote,
            photoUrls,
            updated_at: new Date().toISOString(),
          });
        } catch (_) {}
      }

      // --- hitung ulang komposisi & total ---
      const buketDoc = await db.collection('buket').doc(buketId).get();
      if (!buketDoc.exists) continue;

      const buketData = buketDoc.data() || {};
      const materials = (buketData.materialsBySize?.[size]) || [];

      let singleItemTotal = 0;
      const buketMaterials = [];

      // komposisi dasar
      for (const item of materials) {
        const materialDoc = await db.collection('materials').doc(item.materialId).get();
        if (!materialDoc.exists) continue;
        const materialData = materialDoc.data();
        const totalMaterialPrice = (materialData.price || 0) * (item.quantity || 0);
        singleItemTotal += totalMaterialPrice;

        buketMaterials.push({
          materialId: item.materialId,
          name: materialData.name,
          price: materialData.price || 0,
          quantity: item.quantity || 0,
          total: totalMaterialPrice,
        });
      }

      // custom material
      const customMaterialDetails = [];
      for (const cm of customMaterials) {
        const customDoc = await db.collection('materials').doc(cm.materialId).get();
        if (!customDoc.exists) continue;
        const m = customDoc.data();
        const totalCustomPrice = (m.price || 0) * (cm.quantity || 0);
        singleItemTotal += totalCustomPrice;

        customMaterialDetails.push({
          materialId: cm.materialId,
          name: m.name,
          price: m.price || 0,
          quantity: cm.quantity || 0,
          total: totalCustomPrice,
        });
      }

      const totalPrice = (singleItemTotal + servicePrice) * (quantity || 1);
      grandTotal += totalPrice;

      carts.push({
        cartId: doc.id,
        ...cartData,
        // normalisasi properti yang dikembalikan
        photoUrls,
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

    return h.response({ status: 'success', data: carts, totalPrice: grandTotal }).code(200);
  } catch (error) {
    console.error('[CART] list error:', error);
    return h
      .response({ status: 'fail', message: 'Gagal mengambil data cart', error: error.message })
      .code(500);
  }
};

// Update item di cart
const updateCartItemHandler = async (request, h) => {
  const { cartId } = request.params;
  const {
    size,
    quantity,
    customMaterials,
    requestDate,
    orderNote,
    totalPrice,
    // ✅ field baru: boleh dikirim untuk REPLACE seluruh daftar foto
    photoUrls
  } = request.payload || {};

  try {
    const cartRef = db.collection('carts').doc(cartId);
    const cartSnap = await cartRef.get();

    if (!cartSnap.exists) {
      return h.response({ status: 'fail', message: 'Item cart tidak ditemukan' }).code(404);
    }

    const old = cartSnap.data() || {};
    const toUpdate = {};

    if (size) toUpdate.size = size;
    if (typeof quantity === 'number') toUpdate.quantity = quantity;
    if (Array.isArray(customMaterials)) toUpdate.customMaterials = customMaterials;
    if (requestDate !== undefined) toUpdate.requestDate = requestDate;
    if (totalPrice !== undefined) toUpdate.totalPrice = totalPrice;

    // --- handle note + legacy url ---
    let finalNote = (orderNote !== undefined) ? orderNote : (old.orderNote || '');

    // URL yang nyangkut di note payload → bersihkan & ambil url-nya
    let urlsFromNote = [];
    if (orderNote && orderNote.includes('http')) {
      const { cleaned, urls } = extractPhotoUrls(orderNote);
      finalNote = cleaned || '';
      urlsFromNote = urls;
    }

    // === REPLACE semantics ===
    // jika client mengirim photoUrls → pakai itu sebagai basis,
    // kalau tidak → pakai yang lama dari DB
    let merged = Array.isArray(photoUrls)
      ? [...photoUrls]
      : Array.isArray(old.photoUrls)
        ? [...old.photoUrls]
        : [];

    // tetap gabungkan dengan url hasil ekstraksi dari note (jika ada)
    if (urlsFromNote.length) merged.push(...urlsFromNote);

    // unique
    if (merged.length) merged = [...new Set(merged)];

    toUpdate.orderNote = finalNote;
    toUpdate.photoUrls = merged;
    toUpdate.updated_at = new Date().toISOString();


    await cartRef.update(toUpdate);

    return h.response({ status: 'success', message: 'Item keranjang berhasil diperbarui' }).code(200);
  } catch (err) { 
    console.error('[CART] update error:', err);
    return h.response({ status: 'fail', message: 'Gagal memperbarui item keranjang' }).code(500);
  }
};

module.exports = {
  addToCartHandler,
  getCartByUserHandler,
  deleteCartItemHandler,
  updateCartItemHandler,
};
