// src/handlers/orderPaymentHandler.js
const midtransClient = require('midtrans-client');
const { db } = require('../services/firebaseService');
const { v4: uuidv4 } = require('uuid');
const logger = {
  info: (...args) => console.log('[INFO]', ...args),
  error: (...args) => console.error('[ERROR]', ...args),
  warn: (...args) => console.warn('[WARN]', ...args),
  debug: (...args) => {
    if (process.env.NODE_ENV !== 'production') {
      console.debug('[DEBUG]', ...args);
    }
  }
};

// Inisialisasi Midtrans Snap dengan error handling
let snap;
try {
  snap = new midtransClient.Snap({
    isProduction: process.env.MIDTRANS_IS_PRODUCTION === 'true',
    serverKey: process.env.MIDTRANS_SERVER_KEY,
    clientKey: process.env.MIDTRANS_CLIENT_KEY,
  });
  logger.info('Midtrans Snap client initialized successfully');
} catch (initError) {
  logger.error('Failed to initialize Midtrans client:', initError);
  process.exit(1); // Keluar jika inisialisasi gagal
}

// Helper function untuk validasi input
// ORDER HANDLERS
const createOrderHandler = async (request, h) => {
  const startTime = Date.now();
  const requestId = uuidv4();
  
  try {
    logger.info(`[${requestId}] Starting order creation`, { payload: request.payload });

    const payload = request.payload;
    
    // Validasi input dasar
    const validationErrors = validateOrderInput(payload);
    if (validationErrors.length > 0) {
      logger.warn(`[${requestId}] Validation failed`, { errors: validationErrors });
      return h.response({
        status: 'fail',
        message: 'Validation error',
        errors: validationErrors
      }).code(400);
    }

    const {
      userId,
      carts,
      alamat,
      ongkir,
      paymentMethod,
      totalPrice,
      deliveryMethod,
    } = payload;

    // Validasi carts - kompatibel dengan productId dan buketId
    const invalidCartItems = carts.filter(cart => 
      (!cart.productId && !cart.buketId) || 
      !cart.quantity || 
      !cart.price ||
      typeof cart.quantity !== 'number' ||
      typeof cart.price !== 'number'
    );
    
    if (invalidCartItems.length > 0) {
      logger.warn(`[${requestId}] Invalid cart items found`, { invalidCartItems });
      return h.response({
        status: 'fail',
        message: 'Data keranjang tidak valid',
        errors: invalidCartItems.map((item, index) => ({
          itemIndex: index,
          problems: [
            ...(!item.productId && !item.buketId ? ['Missing product identifier'] : []),
            ...(!item.quantity ? ['Missing quantity'] : []),
            ...(!item.price ? ['Missing price'] : []),
            ...(typeof item.quantity !== 'number' ? ['Quantity must be a number'] : []),
            ...(typeof item.price !== 'number' ? ['Price must be a number'] : [])
          ]
        }))
      }).code(400);
    }

    const orderId = `ORDER-${uuidv4()}`;
    logger.debug(`[${requestId}] Generated order ID: ${orderId}`);

    // Persiapkan data order
    const orderData = {
      orderId,
      userId,
      deliveryMethod,
      alamat: deliveryMethod === 'delivery' ? alamat : null,
      ongkir: deliveryMethod === 'delivery' ? ongkir : 0,
      paymentMethod,
      totalPrice,
      carts: carts.map(cart => ({
        // Identifier produk
        productId: cart.productId || cart.buketId, // Gunakan productId jika ada, fallback ke buketId
        buketId: cart.buketId, // Simpan juga buketId asli
        
        // Data utama
        quantity: cart.quantity,
        price: cart.price,
        totalPrice: cart.price * cart.quantity,
        
        // Informasi produk
        name: cart.name || 'Unknown Product',
        imageUrl: cart.imageUrl || cart.image || null,
        
        // Data tambahan dari cart
        ...(cart.size && { size: cart.size }),
        ...(cart.basePrice && { basePrice: cart.basePrice }),
        ...(cart.customMaterials && { customMaterials: cart.customMaterials }),
        ...(cart.requestDate && { requestDate: cart.requestDate }),
        ...(cart.orderNote && { orderNote: cart.orderNote }),
      })),
      status: paymentMethod === 'cod' ? 'pending' : 'menunggu pembayaran',
      createdAt: new Date().toISOString(),
      midtrans_status: paymentMethod === 'cod' ? null : 'pending',
      updatedAt: new Date().toISOString(),
    };

    logger.debug(`[${requestId}] Saving order to Firestore`, { orderId });
    await db.collection('orders').doc(orderId).set(orderData);

    // Hapus cart items yang sudah diproses
    try {
      logger.debug(`[${requestId}] Deleting processed cart items for user ${userId}`);
      const cartQuery = db.collection('carts')
        .where('userId', '==', userId)
        .where('buketId', 'in', carts.map(c => c.buketId));
      
      const cartSnapshot = await cartQuery.get();
      const batch = db.batch();
      
      cartSnapshot.forEach(doc => {
        logger.debug(`[${requestId}] Deleting cart item ${doc.id}`);
        batch.delete(doc.ref);
      });
      
      await batch.commit();
      logger.info(`[${requestId}] Deleted ${cartSnapshot.size} cart items`);
    } catch (cartError) {
      logger.error(`[${requestId}] Failed to delete cart items`, { 
        error: cartError.message,
        stack: cartError.stack 
      });
      // Tidak mengembalikan error karena order sudah berhasil dibuat
    }

    // Proses pembayaran untuk metode transfer
    if (paymentMethod === 'transfer') {
      try {
        logger.debug(`[${requestId}] Creating Midtrans transaction`);
        
        const parameter = {
          transaction_details: {
            order_id: orderId,
            gross_amount: totalPrice,
          },
          customer_details: {
            first_name: userId, // Anda bisa menambahkan data customer lebih lengkap
            email: `${userId}@customers.example.com`, // Contoh email
          },
          payment_type: 'bank_transfer',
          bank_transfer: {
            bank: 'bca', // Default bank, bisa diubah berdasarkan input
          },
        };

        const transaction = await snap.createTransaction(parameter);
        logger.info(`[${requestId}] Midtrans transaction created`, { 
          transactionId: transaction.transaction_id,
          orderId,
          paymentUrl: transaction.redirect_url 
        });

        // Update order dengan data transaksi
        await db.collection('orders').doc(orderId).update({
          paymentData: {
            transactionId: transaction.transaction_id,
            paymentUrl: transaction.redirect_url,
            status: 'pending',
          },
          updatedAt: new Date().toISOString(),
        });

        return h.response({
          status: 'success',
          message: 'Order dan pembayaran berhasil dibuat',
          data: {
            orderId,
            paymentData: transaction,
          },
        }).code(201);
      } catch (midtransError) {
        logger.error(`[${requestId}] Midtrans transaction failed`, {
          error: midtransError.message,
          midtransResponse: midtransError.ApiResponse,
          stack: midtransError.stack
        });

        // Update order status untuk mencerminkan kegagalan pembayaran
        await db.collection('orders').doc(orderId).update({
          status: 'pembayaran gagal',
          midtrans_status: 'error',
          paymentError: midtransError.ApiResponse?.error_messages || midtransError.message,
          updatedAt: new Date().toISOString(),
        });

        return h.response({
          status: 'error',
          message: 'Pembayaran gagal diproses',
          error: process.env.NODE_ENV === 'development' ? 
            (midtransError.ApiResponse?.error_messages || midtransError.message) : 
            undefined,
        }).code(502);
      }
    }

    const responseTime = Date.now() - startTime;
    logger.info(`[${requestId}] Order created successfully`, { 
      orderId,
      responseTime: `${responseTime}ms`,
      paymentMethod
    });

    return h.response({
      status: 'success',
      message: 'Order berhasil dibuat',
      data: { 
        orderId,
        paymentMethod,
        ...(paymentMethod === 'cod' && { 
          instructions: 'Pembayaran akan dilakukan saat barang diterima' 
        })
      },
    }).code(201);
  } catch (error) {
    logger.error(`[${requestId}] Order creation failed`, {
      error: error.message,
      stack: error.stack,
      payload: request.payload
    });
    
    return h.response({ 
      status: 'error', 
      message: 'Gagal membuat order',
      ...(process.env.NODE_ENV === 'development' && {
        error: error.message,
        stack: error.stack
      })
    }).code(500);
  }
};

// GET ALL ORDERS HANDLER
const getAllOrdersHandler = async (request, h) => {
  const { userId } = request.query;
  const requestId = uuidv4();
  
  try {
    logger.info(`[${requestId}] Fetching orders for user ${userId}`);
    
    // Dapatkan semua order untuk user, diurutkan berdasarkan tanggal terbaru
    const snapshot = await db.collection('orders')
      .where('userId', '==', userId)
      .orderBy('createdAt', 'desc')
      .get();
    
    const orders = snapshot.docs.map(doc => ({
      orderId: doc.id,
      ...doc.data(),
      // Format tanggal untuk response
      createdAt: formatDate(doc.data().createdAt),
      updatedAt: doc.data().updatedAt ? formatDate(doc.data().updatedAt) : null,
    }));
    
    logger.info(`[${requestId}] Found ${orders.length} orders for user ${userId}`);
    
    return h.response({ 
      status: 'success', 
      data: orders,
      meta: {
        total: orders.length,
        returned: orders.length
      }
    }).code(200);
  } catch (error) {
    logger.error(`[${requestId}] Error fetching orders`, {
      userId,
      error: error.message,
      stack: error.stack
    });
    
    return h.response({ 
      status: 'fail', 
      message: 'Gagal mengambil data order',
      ...(process.env.NODE_ENV === 'development' && {
        error: error.message
      })
    }).code(500);
  }
};

// Helper function untuk format tanggal
function formatDate(dateString) {
  const options = { 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  };
  return new Date(dateString).toLocaleDateString('id-ID', options);
}

// PAYMENT HANDLERS
const chargePaymentHandler = async (request, h) => {
  const { orderId, paymentType, bank } = request.payload;
  const requestId = uuidv4();
  
  try {
    logger.info(`[${requestId}] Processing payment charge`, { 
      orderId, 
      paymentType,
      bank
    });

    // Validasi input
    if (!['bank_transfer', 'qris', 'gopay'].includes(paymentType)) {
      logger.warn(`[${requestId}] Invalid payment type`, { paymentType });
      return h.response({
        status: 'fail',
        message: 'Jenis pembayaran tidak valid',
        validTypes: ['bank_transfer', 'qris', 'gopay']
      }).code(400);
    }

    // Dapatkan data order
    const orderDoc = await db.collection('orders').doc(orderId).get();
    if (!orderDoc.exists) {
      logger.warn(`[${requestId}] Order not found`, { orderId });
      return h.response({
        status: 'fail',
        message: 'Order tidak ditemukan',
      }).code(404);
    }

    const orderData = orderDoc.data();
    logger.debug(`[${requestId}] Order details`, { 
      totalPrice: orderData.totalPrice,
      userId: orderData.userId
    });

    const parameter = {
      transaction_details: {
        order_id: orderId,
        gross_amount: orderData.totalPrice,
      },
      customer_details: {
        user_id: orderData.userId,
      },
      payment_type: paymentType,
    };

    // Tambahkan parameter khusus berdasarkan jenis pembayaran
    if (paymentType === 'bank_transfer') {
      parameter.bank_transfer = {
        bank: bank || 'bca',
      };
    }

    logger.debug(`[${requestId}] Sending request to Midtrans`, { parameter });
    const transaction = await snap.createTransaction(parameter);
    logger.info(`[${requestId}] Midtrans response received`, {
      transactionId: transaction.transaction_id,
      paymentType
    });

    // Update order
    await db.collection('orders').doc(orderId).update({
      paymentMethod: paymentType,
      midtrans_status: 'pending',
      updatedAt: new Date().toISOString(),
    });

    return h.response({
      status: 'success',
      message: 'Transaksi berhasil dibuat',
      data: {
        ...transaction,
        orderId,
        paymentMethod: paymentType,
      },
    }).code(200);
  } catch (error) {
    logger.error(`[${requestId}] Payment processing failed`, {
      orderId,
      error: error.message,
      midtransError: error.ApiResponse?.error_messages || undefined,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });

    // Coba update order status jika error
    try {
      await db.collection('orders').doc(orderId).update({
        midtrans_status: 'error',
        updatedAt: new Date().toISOString(),
      });
    } catch (updateError) {
      logger.error(`[${requestId}] Failed to update order status after payment failure`, {
        orderId,
        error: updateError.message
      });
    }

    return h.response({
      status: 'error',
      message: 'Gagal memproses pembayaran',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
      midtransError: error.ApiResponse?.error_messages || undefined,
    }).code(500);
  }
};

const handleMidtransNotification = async (request, h) => {
  const notification = request.payload;
  const signatureKey = request.headers['x-callback-signature'];
  const requestId = uuidv4();

  try {
    logger.info(`[${requestId}] Received Midtrans notification`, {
      orderId: notification.order_id,
      transactionStatus: notification.transaction_status,
      fraudStatus: notification.fraud_status,
    });

    // Validasi signature (opsional tapi direkomendasikan)
    if (process.env.VERIFY_MIDTRANS_SIGNATURE === 'true') {
      const isValid = snap.transaction.notification(notification);
      if (!isValid) {
        logger.warn(`[${requestId}] Invalid Midtrans signature`, { signatureKey });
        return h.response({ message: 'Signature tidak valid' }).code(403);
      }
    }

    const { transaction_status, order_id, fraud_status } = notification;
    const orderRef = db.collection('orders').doc(order_id);
    const orderSnap = await orderRef.get();

    if (!orderSnap.exists) {
      logger.warn(`[${requestId}] Order not found`, { orderId: order_id });
      return h.response({ message: 'Order tidak ditemukan' }).code(404);
    }

    // Mapping status Midtrans ke status aplikasi
    const statusMap = {
      'capture': 'dibayar',
      'settlement': 'dibayar',
      'pending': 'menunggu pembayaran',
      'deny': 'ditolak',
      'expire': 'expired',
      'cancel': 'dibatalkan'
    };

    const newStatus = statusMap[transaction_status] || transaction_status;
    logger.debug(`[${requestId}] Updating order status`, {
      from: orderSnap.data().status,
      to: newStatus
    });

    // Update order
    const updateData = {
      status: newStatus,
      midtrans_status: transaction_status,
      fraud_status,
      updatedAt: new Date().toISOString(),
    };

    // Jika pembayaran berhasil, tambahkan payment_time
    if (transaction_status === 'settlement' || transaction_status === 'capture') {
      updateData.payment_time = notification.settlement_time || new Date().toISOString();
    }

    await orderRef.update(updateData);
    logger.info(`[${requestId}] Order updated successfully`, { orderId: order_id, newStatus });

    return h.response({ message: 'Notifikasi diproses' }).code(200);
  } catch (error) {
    logger.error(`[${requestId}] Notification handling failed`, {
      error: error.message,
      notification,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });

    return h.response({ 
      error: 'Internal Server Error',
      requestId // Untuk debugging
    }).code(500);
  }
};

module.exports = {
  createOrderHandler,
  getAllOrdersHandler,
  getOrderDetailHandler,
  updateOrderStatusHandler,
  chargePaymentHandler,
  handleMidtransNotification,
};