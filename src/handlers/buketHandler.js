// handlers/buketHandler.js
const { nanoid } = require('nanoid');
const { db } = require('../services/firebaseService');
const cloudinary = require('../services/cloudinaryService');
const streamifier = require('streamifier');

// =========================
// Helper: hitung base price
// =========================
const calculateBasePriceBySize = async (materialsBySize) => {
  const basePrice = {};

  for (const size in materialsBySize) {
    const materialList = materialsBySize[size];
    let total = 0;

    for (const item of materialList) {
      const materialSnapshot = await db.collection('materials').doc(item.materialId).get();

      if (!materialSnapshot.exists) {
        throw new Error(`Material dengan ID ${item.materialId} tidak ditemukan.`);
      }

      const materialData = materialSnapshot.data();
      const price = materialData.price || 0;
      total += price * (item.quantity || 0);
    }

    basePrice[size] = total;
  }

  return basePrice;
};

// ==============
// CREATE BUKET
// ==============
const createBuketHandler = async (request, h) => {
  const {
    name,
    description,
    type,
    category,
    requires_photo,
    is_customizable,
    processing_time,
    service_price
  } = request.payload;

  const image = request.payload.image;
  const materialsBySizeRaw = request.payload.materialsBySize;

  let buffer;
  try {
    buffer = await new Promise((resolve, reject) => {
      const chunks = [];
      image.on('data', (chunk) => chunks.push(chunk));
      image.on('end', () => resolve(Buffer.concat(chunks)));
      image.on('error', reject);
    });
  } catch (err) {
    return h.response({
      status: 'fail',
      message: 'Gagal membaca gambar dari request',
      error: err.message,
    }).code(400);
  }

  // Upload ke Cloudinary
  let imageUrl;
  try {
    const uploadStream = () =>
      new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: 'buket', resource_type: 'image' },
          (error, result) => (error ? reject(error) : resolve(result))
        );
        streamifier.createReadStream(buffer).pipe(stream);
      });

    const result = await uploadStream();
    imageUrl = result.secure_url;
  } catch (err) {
    return h.response({
      status: 'fail',
      message: 'Gagal upload gambar ke Cloudinary',
      error: err.message,
    }).code(500);
  }

  try {
    let parsedMaterials;
    try {
      parsedMaterials = JSON.parse(materialsBySizeRaw);
    } catch (parseErr) {
      return h.response({
        status: 'fail',
        message: 'Format materialsBySize tidak valid JSON',
        error: parseErr.message,
      }).code(400);
    }

    const base_price_by_size = await calculateBasePriceBySize(parsedMaterials);
    const total_price_by_size = {};

    for (const size in base_price_by_size) {
      total_price_by_size[size] = base_price_by_size[size] + parseInt(service_price || 0);
    }

    const buketId = nanoid(16);
    const newBuket = {
      buketId,
      name,
      ...(description !== undefined && { description }),
      type,
      category,
      requires_photo: requires_photo === 'true' || requires_photo === true,
      is_customizable: is_customizable === 'true' || is_customizable === true,
      processing_time: parseInt(processing_time),
      service_price: parseInt(service_price),
      image_url: imageUrl,
      materialsBySize: parsedMaterials,
      base_price_by_size,
      total_price_by_size,
      // field agregat review (diinisialisasi)
      rating_count: 0,
      rating_sum: 0,
      created_at: new Date().toISOString(),
    };

    await db.collection('buket').doc(buketId).set(newBuket);

    return h.response({
      status: 'success',
      message: 'Buket berhasil dibuat',
      data: newBuket,
    }).code(201);
  } catch (error) {
    return h.response({
      status: 'fail',
      message: 'Gagal menyimpan buket ke database',
      error: error.message,
    }).code(500);
  }
};

// =============
// GET ALL
// =============
const getAllBuketHandler = async (request, h) => {
  try {
    const snapshot = await db.collection('buket').get();

    const bukets = snapshot.docs.map(doc => {
      const data = doc.data();
      const ratingCount = data.rating_count || 0;
      const ratingSum = data.rating_sum || 0;
      const ratingAvg = ratingCount > 0 ? Number((ratingSum / ratingCount).toFixed(2)) : 0;

      return {
        buketId: data.buketId,
        name: data.name,
        category: data.category,
        image_url: data.image_url,
        is_customizable: data.is_customizable,
        processing_time: data.processing_time,
        requires_photo: data.requires_photo,
        type: data.type,
        service_price: data.service_price,
        base_price_by_size: data.base_price_by_size,
        total_price_by_size: data.total_price_by_size,
        created_at: data.created_at,
        rating: {
          average: ratingAvg,
          count: ratingCount
        }
      };
    });

    return h.response({
      status: 'success',
      data: bukets
    }).code(200);
  } catch (error) {
    return h.response({
      status: 'error',
      message: 'Gagal mengambil data buket'
    }).code(500);
  }
};

// =======================
// GET DETAIL (with rating)
// =======================
const getBuketDetail = async (request, h) => {
  const { buketId } = request.params;
  const { size = 'small' } = request.query;

  try {
    const buketDoc = await db.collection('buket').doc(buketId).get();
    if (!buketDoc.exists) {
      return h.response({ status: 'fail', message: 'Buket tidak ditemukan.' }).code(404);
    }

    const buketData = buketDoc.data();
    const selectedSize = String(size).toLowerCase();
    const selectedMaterials = buketData.materialsBySize?.[selectedSize] || [];

    let totalPrice = 0;

    for (const item of selectedMaterials) {
      const materialDoc = await db.collection('materials').doc(item.materialId).get();
      if (!materialDoc.exists) continue;

      const materialData = materialDoc.data();
      const total = (materialData.price || 0) * (item.quantity || 0);
      totalPrice += total;
    }

    const totalBuketPrice = totalPrice + (buketData.service_price || 0);

    const ratingCount = buketData.rating_count || 0;
    const ratingSum = buketData.rating_sum || 0;
    const ratingAvg = ratingCount > 0 ? Number((ratingSum / ratingCount).toFixed(2)) : 0;

    return h.response({
      status: 'success',
      data: {
        buketId: buketDoc.id,
        name: buketData.name,
        image_url: buketData.image_url,
        size: selectedSize,
        category: buketData.category,
        price: totalBuketPrice,
        base_price: totalPrice,
        service_price: buketData.service_price,
        processing_time: buketData.processing_time,
        is_customizable: buketData.is_customizable,
        requires_photo: buketData.requires_photo,
        type: buketData.type,
        created_at: buketData.created_at,

        base_price_by_size: buketData.base_price_by_size,
        total_price_by_size: buketData.total_price_by_size,
        materialsBySize: buketData.materialsBySize,

        rating: {
          average: ratingAvg,
          count: ratingCount
        }
      }
    }).code(200);

  } catch (error) {
    console.error(error);
    return h.response({ message: 'Terjadi kesalahan.' }).code(500);
  }
};

// ==============
// UPDATE BUKET
// ==============
const updateBuketHandler = async (request, h) => {
  const { buketId } = request.params;
  const updateData = request.payload;

  try {
    await db.collection('buket').doc(buketId).update({
      ...updateData,
      updated_at: new Date().toISOString()
    });

    return h.response({
      status: 'success',
      message: 'Buket berhasil diperbarui'
    }).code(200);
  } catch (error) {
    return h.response({
      status: 'fail',
      message: 'Gagal memperbarui buket'
    }).code(500);
  }
};

// ===========================
// UPDATE GAMBAR KHUSUS
// ===========================
const updateBuketImageHandler = async (request, h) => {
  const { buketId } = request.params;
  const image = request.payload.image;

  try {
    const buffer = await new Promise((resolve, reject) => {
      const chunks = [];
      image.on('data', (c) => chunks.push(c));
      image.on('end', () => resolve(Buffer.concat(chunks)));
      image.on('error', reject);
    });

    const uploadStream = () =>
      new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: 'buket', resource_type: 'image' },
          (error, result) => (error ? reject(error) : resolve(result))
        );
        streamifier.createReadStream(buffer).pipe(stream);
      });

    const result = await uploadStream();

    await db.collection('buket').doc(buketId).update({
      image_url: result.secure_url,
      updated_at: new Date().toISOString()
    });

    return h
      .response({
        status: 'success',
        message: 'Gambar diperbarui',
        image_url: result.secure_url
      })
      .code(200);

  } catch (err) {
    console.error(err);
    return h
      .response({ status: 'fail', message: 'Gagal memperbarui gambar', error: err.message })
      .code(500);
  }
};

// =============
// DELETE BUKET
// =============
const deleteBuketHandler = async (request, h) => {
  const { buketId } = request.params;

  try {
    await db.collection('buket').doc(buketId).delete();

    return h.response({
      status: 'success',
      message: 'Buket berhasil dihapus'
    }).code(200);
  } catch (error) {
    return h.response({
      status: 'fail',
      message: 'Gagal menghapus buket'
    }).code(500);
  }
};

// ============================
// REVIEWS: CREATE & LIST
// ============================
const createReviewHandler = async (request, h) => {
  const { buketId } = request.params;
  const { reviewer_name, rating, comment } = request.payload;

  try {
    // pastikan buket ada
    const buketRef = db.collection('buket').doc(buketId);
    const buketSnap = await buketRef.get();
    if (!buketSnap.exists) {
      return h.response({ status: 'fail', message: 'Buket tidak ditemukan.' }).code(404);
    }

    const reviewId = nanoid(16);
    const reviewData = {
      reviewId,
      buketId,
      reviewer_name,
      rating: Number(rating),
      ...(comment ? { comment } : {}),
      created_at: new Date().toISOString()
    };

    // transaksi: tulis review + update agregat di dokumen buket
    await db.runTransaction(async (t) => {
      const reviewRef = buketRef.collection('reviews').doc(reviewId);
      t.set(reviewRef, reviewData);

      const current = (await t.get(buketRef)).data() || {};
      const nextCount = (current.rating_count || 0) + 1;
      const nextSum = (current.rating_sum || 0) + Number(rating);
      t.update(buketRef, {
        rating_count: nextCount,
        rating_sum: nextSum,
        updated_at: new Date().toISOString()
      });
    });

    return h.response({
      status: 'success',
      message: 'Review berhasil ditambahkan',
      data: reviewData
    }).code(201);
  } catch (error) {
    console.error(error);
    return h.response({
      status: 'fail',
      message: 'Gagal menambahkan review',
      error: error.message
    }).code(500);
  }
};

const getBuketReviewsHandler = async (request, h) => {
  const { buketId } = request.params;

  try {
    // cek buket
    const buketRef = db.collection('buket').doc(buketId);
    const buketSnap = await buketRef.get();
    if (!buketSnap.exists) {
      return h.response({ status: 'fail', message: 'Buket tidak ditemukan.' }).code(404);
    }

    const reviewsSnap = await buketRef.collection('reviews').orderBy('created_at', 'desc').get();
    const reviews = reviewsSnap.docs.map(d => d.data());

    // ringkasan rating (pakai field agregat di dokumen buket)
    const data = buketSnap.data();
    const count = data.rating_count || 0;
    const sum = data.rating_sum || 0;
    const avg = count > 0 ? Number((sum / count).toFixed(2)) : 0;

    return h.response({
      status: 'success',
      data: {
        summary: { average: avg, count },
        reviews
      }
    }).code(200);
  } catch (error) {
    console.error(error);
    return h.response({
      status: 'fail',
      message: 'Gagal mengambil review'
    }).code(500);
  }
};

module.exports = {
  // buket
  createBuketHandler,
  getAllBuketHandler,
  getBuketDetail,
  updateBuketHandler,
  deleteBuketHandler,
  updateBuketImageHandler,
  // reviews
  createReviewHandler,
  getBuketReviewsHandler
};
