// handlers/buketHandler.js
const { nanoid } = require('nanoid');
const { db } = require('../services/firebaseService');
const cloudinary = require('../services/cloudinaryService');
const streamifier = require('streamifier');

/* ------------------------------ UTILITIES ------------------------------ */
// Hitung total base price per size dari daftar material
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

// Cek apakah user punya order completed yang berisi buket ini
const hasCompletedOrderForBuket = async (userId, buketId) => {
  // Asumsi koleksi orders: { userId, status, items: [{ buketId, qty, ... }] }
  const snap = await db
    .collection('orders')
    .where('userId', '==', userId)
    .where('status', '==', 'completed')
    .get();

  for (const doc of snap.docs) {
    const items = doc.data().items || [];
    if (items.some((it) => it.buketId === buketId)) return true;
  }
  return false;
};

// Update agregat rating (count, sum, avg) dalam transaksi
const applyAggregate = async (buketId, deltaCount, deltaSum) => {
  await db.runTransaction(async (tx) => {
    const ref = db.collection('buket').doc(buketId);
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error('Buket tidak ditemukan');

    const data = snap.data();
    const rating_count = (data.rating_count || 0) + deltaCount;
    const rating_sum = (data.rating_sum || 0) + deltaSum;
    const rating_avg = rating_count > 0 ? +(rating_sum / rating_count).toFixed(2) : 0;

    tx.update(ref, {
      rating_count,
      rating_sum,
      rating_avg,
      updated_at: new Date().toISOString(),
    });
  });
};

/* ------------------------------ BUKET CRUD ----------------------------- */
// CREATE
const createBuketHandler = async (request, h) => {
  const {
    name,
    description,
    type,
    category,
    requires_photo,
    is_customizable,
    processing_time,
    service_price,
  } = request.payload;

  const image = request.payload.image;
  const materialsBySizeRaw = request.payload.materialsBySize;

  // Baca stream -> buffer
  let buffer;
  try {
    buffer = await new Promise((resolve, reject) => {
      const chunks = [];
      image.on('data', (chunk) => chunks.push(chunk));
      image.on('end', () => resolve(Buffer.concat(chunks)));
      image.on('error', reject);
    });
  } catch (err) {
    return h
      .response({
        status: 'fail',
        message: 'Gagal membaca gambar dari request',
        error: err.message,
      })
      .code(400);
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
    return h
      .response({
        status: 'fail',
        message: 'Gagal upload gambar ke Cloudinary',
        error: err.message,
      })
      .code(500);
  }

  try {
    let parsedMaterials;
    try {
      parsedMaterials = JSON.parse(materialsBySizeRaw);
    } catch (parseErr) {
      return h
        .response({
          status: 'fail',
          message: 'Format materialsBySize tidak valid JSON',
          error: parseErr.message,
        })
        .code(400);
    }

    const base_price_by_size = await calculateBasePriceBySize(parsedMaterials);
    const total_price_by_size = {};
    for (const size in base_price_by_size) {
      total_price_by_size[size] =
        base_price_by_size[size] + parseInt(service_price || 0);
    }

    const buketId = nanoid(16);
    const nowISO = new Date().toISOString();
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
      created_at: nowISO,
      // Init agregat review
      rating_sum: 0,
      rating_count: 0,
      rating_avg: 0,
    };

    await db.collection('buket').doc(buketId).set(newBuket);

    return h
      .response({
        status: 'success',
        message: 'Buket berhasil dibuat',
        data: newBuket,
      })
      .code(201);
  } catch (error) {
    return h
      .response({
        status: 'fail',
        message: 'Gagal menyimpan buket ke database',
        error: error.message,
      })
      .code(500);
  }
};

// GET ALL
const getAllBuketHandler = async (request, h) => {
  try {
    const snapshot = await db.collection('buket').get();

    const bukets = snapshot.docs.map((doc) => {
      const data = doc.data();
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
        // Agregat review untuk card list
        rating_avg: data.rating_avg || 0,
        rating_count: data.rating_count || 0,
      };
    });

    return h.response({ status: 'success', data: bukets }).code(200);
  } catch (error) {
    return h
      .response({
        status: 'error',
        message: 'Gagal mengambil data buket',
      })
      .code(500);
  }
};

// GET DETAIL (tanpa bahan)
const getBuketDetail = async (request, h) => {
  const { buketId } = request.params;
  const { size = 'small' } = request.query;

  try {
    const buketDoc = await db.collection('buket').doc(buketId).get();
    if (!buketDoc.exists) {
      return h
        .response({ status: 'fail', message: 'Buket tidak ditemukan.' })
        .code(404);
    }

    const buketData = buketDoc.data();
    const selectedSize = size.toLowerCase();
    const selectedMaterials = buketData.materialsBySize?.[selectedSize] || [];

    let totalPrice = 0;
    for (const item of selectedMaterials) {
      const materialDoc = await db
        .collection('materials')
        .doc(item.materialId)
        .get();
      if (!materialDoc.exists) continue;
      const materialData = materialDoc.data();
      totalPrice += (materialData.price || 0) * (item.quantity || 0);
    }
    const totalBuketPrice = totalPrice + (buketData.service_price || 0);

    return h
      .response({
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
          // Agregat review untuk halaman detail
          rating_avg: buketData.rating_avg || 0,
          rating_count: buketData.rating_count || 0,
        },
      })
      .code(200);
  } catch (error) {
    console.error(error);
    return h.response({ message: 'Terjadi kesalahan.' }).code(500);
  }
};

// UPDATE
const updateBuketHandler = async (request, h) => {
  const { buketId } = request.params;
  const updateData = request.payload;

  try {
    await db.collection('buket').doc(buketId).update({
      ...updateData,
      updated_at: new Date().toISOString(),
    });

    return h
      .response({
        status: 'success',
        message: 'Buket berhasil diperbarui',
      })
      .code(200);
  } catch (error) {
    return h
      .response({
        status: 'fail',
        message: 'Gagal memperbarui buket',
      })
      .code(500);
  }
};

// UPDATE IMAGE (multipart)
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
          (error, result) => (error ? reject(error) : resolve(result)
          )
        );
        streamifier.createReadStream(buffer).pipe(stream);
      });

    const result = await uploadStream();

    await db.collection('buket').doc(buketId).update({
      image_url: result.secure_url,
      updated_at: new Date().toISOString(),
    });

    return h
      .response({
        status: 'success',
        message: 'Gambar diperbarui',
        image_url: result.secure_url,
      })
      .code(200);
  } catch (err) {
    console.error(err);
    return h
      .response({
        status: 'fail',
        message: 'Gagal memperbarui gambar',
        error: err.message,
      })
      .code(500);
  }
};

// DELETE
const deleteBuketHandler = async (request, h) => {
  const { buketId } = request.params;

  try {
    await db.collection('buket').doc(buketId).delete();
    return h
      .response({
        status: 'success',
        message: 'Buket berhasil dihapus',
      })
      .code(200);
  } catch (error) {
    return h
      .response({
        status: 'fail',
        message: 'Gagal menghapus buket',
      })
      .code(500);
  }
};

/* ------------------------------ REVIEWS API ---------------------------- */
// POST /buket/{buketId}/reviews
const createReviewHandler = async (request, h) => {
  const { buketId } = request.params;
  const { rating, comment } = request.payload;

  // Ambil userId dari JWT (request.auth.credentials.userId)
  // atau fallback header x-user-id untuk testing
  const userId = request.auth?.credentials?.userId || request.headers['x-user-id'];
  if (!userId) {
    return h.response({ status: 'fail', message: 'Unauthorized' }).code(401);
  }

  // Pastikan user pernah menyelesaikan pesanan untuk buket ini
  const allowed = await hasCompletedOrderForBuket(userId, buketId);
  if (!allowed) {
    return h
      .response({
        status: 'fail',
        message: 'Anda hanya bisa mereview setelah pesanan selesai.',
      })
      .code(403);
  }

  // Satu user hanya 1 review per buket
  const existSnap = await db
    .collection('buket')
    .doc(buketId)
    .collection('reviews')
    .where('userId', '==', userId)
    .limit(1)
    .get();
  if (!existSnap.empty) {
    return h
      .response({
        status: 'fail',
        message: 'Anda sudah memberi review untuk buket ini.',
      })
      .code(409);
  }

  const reviewId = nanoid(16);
  const nowISO = new Date().toISOString();
  const reviewData = {
    reviewId,
    userId,
    rating: Number(rating),
    comment: (comment || '').toString().trim(),
    created_at: nowISO,
    updated_at: nowISO,
  };

  try {
    await db
      .collection('buket')
      .doc(buketId)
      .collection('reviews')
      .doc(reviewId)
      .set(reviewData);

    await applyAggregate(buketId, +1, Number(rating));

    return h.response({ status: 'success', data: reviewData }).code(201);
  } catch (e) {
    console.error(e);
    return h
      .response({ status: 'error', message: 'Gagal menyimpan review' })
      .code(500);
  }
};

// GET /buket/{buketId}/reviews?limit=&after=
const listReviewsHandler = async (request, h) => {
  const { buketId } = request.params;
  const { limit = 10, after } = request.query;

  try {
    let query = db
      .collection('buket')
      .doc(buketId)
      .collection('reviews')
      .orderBy('created_at', 'desc')
      .limit(Number(limit));

    if (after) {
      const cursorDoc = await db
        .collection('buket')
        .doc(buketId)
        .collection('reviews')
        .doc(after)
        .get();
      if (cursorDoc.exists) {
        query = query.startAfter(cursorDoc);
      }
    }

    const snap = await query.get();
    const reviews = snap.docs.map((d) => d.data());
    const nextCursor = snap.docs.length ? snap.docs[snap.docs.length - 1].id : null;

    return h.response({ status: 'success', data: { reviews, nextCursor } }).code(200);
  } catch (e) {
    console.error(e);
    return h
      .response({ status: 'error', message: 'Gagal mengambil review' })
      .code(500);
  }
};

// PUT /buket/{buketId}/reviews/{reviewId}
const updateReviewHandler = async (request, h) => {
  const { buketId, reviewId } = request.params;
  const { rating, comment } = request.payload;

  const userId = request.auth?.credentials?.userId || request.headers['x-user-id'];
  if (!userId) return h.response({ status: 'fail', message: 'Unauthorized' }).code(401);

  const ref = db.collection('buket').doc(buketId).collection('reviews').doc(reviewId);
  const snap = await ref.get();
  if (!snap.exists) return h.response({ status: 'fail', message: 'Review tidak ditemukan' }).code(404);

  const data = snap.data();
  if (data.userId !== userId) return h.response({ status: 'fail', message: 'Forbidden' }).code(403);

  try {
    const oldRating = Number(data.rating);
    const newRating = rating != null ? Number(rating) : oldRating;

    await ref.update({
      rating: newRating,
      comment: comment != null ? comment.toString().trim() : data.comment,
      updated_at: new Date().toISOString(),
    });

    if (newRating !== oldRating) {
      await applyAggregate(buketId, 0, newRating - oldRating);
    }

    return h.response({ status: 'success', message: 'Review diperbarui' }).code(200);
  } catch (e) {
    console.error(e);
    return h
      .response({ status: 'error', message: 'Gagal memperbarui review' })
      .code(500);
  }
};

// DELETE /buket/{buketId}/reviews/{reviewId}
const deleteReviewHandler = async (request, h) => {
  const { buketId, reviewId } = request.params;

  const userId = request.auth?.credentials?.userId || request.headers['x-user-id'];
  if (!userId) return h.response({ status: 'fail', message: 'Unauthorized' }).code(401);

  const ref = db.collection('buket').doc(buketId).collection('reviews').doc(reviewId);
  const snap = await ref.get();
  if (!snap.exists) return h.response({ status: 'fail', message: 'Review tidak ditemukan' }).code(404);

  const data = snap.data();
  if (data.userId !== userId) return h.response({ status: 'fail', message: 'Forbidden' }).code(403);

  try {
    await ref.delete();
    await applyAggregate(buketId, -1, -Number(data.rating));
    return h.response({ status: 'success', message: 'Review dihapus' }).code(200);
  } catch (e) {
    console.error(e);
    return h
      .response({ status: 'error', message: 'Gagal menghapus review' })
      .code(500);
  }
};

module.exports = {
  // Buket
  createBuketHandler,
  getAllBuketHandler,
  getBuketDetail,
  updateBuketHandler,
  deleteBuketHandler,
  updateBuketImageHandler,
  // Reviews
  createReviewHandler,
  listReviewsHandler,
  updateReviewHandler,
  deleteReviewHandler,
};
