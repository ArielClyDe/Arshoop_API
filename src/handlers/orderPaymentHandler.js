// src/handlers/orderPaymentHandler.js
const midtransClient = require('midtrans-client');
const { db } = require('../services/firebaseService');
const { v4: uuidv4 } = require('uuid');

// Logger
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

// Midtrans Snap Initialization
let snap;
try {
  snap = new midtransClient.Snap({
    isProduction: process.env.MIDTRANS_IS_PRODUCTION === 'true',
    serverKey: process.env.MIDTRANS_SERVER_KEY,
    clientKey: process.env.MIDTRANS_CLIENT_KEY,
  });
  logger.info('Midtrans client initialized');
} catch (error) {
  logger.error('Failed to initialize Midtrans:', error);
  process.exit(1);
}

// Helper Functions
const validateOrderInput = (payload) => {
  const errors = [];
  
  if (!payload.userId) errors.push('userId is required');
  if (!payload.carts || payload.carts.length === 0) errors.push('carts cannot be empty');
  if (!payload.paymentMethod) errors.push('paymentMethod is required');
  if (!['delivery', 'pickup'].includes(payload.deliveryMethod)) {
    errors.push('deliveryMethod must be either "delivery" or "pickup"');
  }
  
  if (payload.deliveryMethod === 'delivery') {
    if (!payload.alamat) errors.push('alamat is required for delivery');
    if (typeof payload.ongkir !== 'number' || payload.ongkir < 0) {
      errors.push('ongkir must be a positive number');
    }
  }

  return errors;
};

const validateCartItems = (carts) => {
  return carts.filter(cart => {
    const missingBuketId = !cart.buketId;
    const invalidQuantity = typeof cart.quantity !== 'number' || cart.quantity <= 0;
    const invalidPrice = typeof cart.totalPrice !== 'number' || cart.totalPrice <= 0;
    
    return missingBuketId || invalidQuantity || invalidPrice;
  });
};

const mapCartItems = (carts) => {
  return carts.map(cart => ({
    cartId: cart.cartId,
    buketId: cart.buketId,
    quantity: cart.quantity,
    totalPrice: cart.totalPrice,
    name: cart.name || 'Buket Tanpa Nama',
    imageUrl: cart.imageUrl || null,
    size: cart.size || null,
    basePrice: cart.basePrice || 0,
    servicePrice: cart.servicePrice || 0,
    customMaterials: cart.customMaterials || [],
    requestDate: cart.requestDate || null,
    orderNote: cart.orderNote || ''
  }));
};

// ORDER HANDLERS
const createOrderHandler = async (request, h) => {
  const startTime = Date.now();
  const requestId = uuidv4();
  
  try {
    logger.info(`[${requestId}] Order creation started`);

    const payload = request.payload;
    const validationErrors = validateOrderInput(payload);
    
    if (validationErrors.length > 0) {
      logger.warn(`[${requestId}] Validation failed`, { errors: validationErrors });
      return h.response({
        status: 'fail',
        message: 'Data tidak valid',
        errors: validationErrors
      }).code(400);
    }

    const { userId, carts, alamat, ongkir, paymentMethod, deliveryMethod } = payload;

    // Validasi cart items
    const invalidCartItems = validateCartItems(carts);
    if (invalidCartItems.length > 0) {
      logger.warn(`[${requestId}] Invalid cart items`, { count: invalidCartItems.length });
      return h.response({
        status: 'fail',
        message: 'Item keranjang tidak valid',
        errors: invalidCartItems.map(item => ({
          cartId: item.cartId,
          missingFields: [
            ...(!item.buketId ? ['buketId'] : []),
            ...(typeof item.quantity !== 'number' || item.quantity <= 0 ? ['quantity'] : []),
            ...(typeof item.totalPrice !== 'number' || item.totalPrice <= 0 ? ['totalPrice'] : [])
          ]
        }))
      }).code(400);
    }

    // Hitung total price dari cart items + ongkir (jika delivery)
    const totalPrice = carts.reduce((sum, cart) => sum + cart.totalPrice, 0) + 
                      (deliveryMethod === 'delivery' ? ongkir : 0);

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
      servicePrice: carts.reduce((sum, cart) => sum + (cart.servicePrice || 0), 0),
      carts: mapCartItems(carts),
      status: paymentMethod === 'cod' ? 'pending' : 'menunggu pembayaran',
      createdAt: new Date().toISOString(),
      midtrans_status: paymentMethod === 'cod' ? null : 'pending',
      updatedAt: new Date().toISOString(),
    };

    // Simpan order ke Firestore
    logger.debug(`[${requestId}] Saving order to Firestore`);
    await db.collection('orders').doc(orderId).set(orderData);
    logger.info(`[${requestId}] Order saved successfully`);

    // Hapus cart items yang sudah diproses
    try {
      logger.debug(`[${requestId}] Deleting processed cart items`);
      const cartIds = carts.map(c => c.cartId).filter(Boolean);
      
      if (cartIds.length > 0) {
        const batch = db.batch();
        cartIds.forEach(id => {
          batch.delete(db.collection('carts').doc(id));
        });
        await batch.commit();
        logger.info(`[${requestId}] Deleted ${cartIds.length} cart items`);
      }
    } catch (cartError) {
      logger.error(`[${requestId}] Failed to delete cart items`, { error: cartError.message });
      // Lanjutkan karena order sudah berhasil dibuat
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
            first_name: `Customer-${userId.substring(0, 8)}`,
            email: `${userId.substring(0, 8)}@customer.com`,
            phone: '08123456789',
          },
          payment_type: 'bank_transfer',
          bank_transfer: {
            bank: 'bca',
          },
        };

        const transaction = await snap.createTransaction(parameter);
        logger.info(`[${requestId}] Midtrans transaction created`, { 
          transactionId: transaction.transaction_id 
        });

        // Update order dengan data pembayaran
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
            paymentUrl: transaction.redirect_url,
            transactionId: transaction.transaction_id,
          },
        }).code(201);
      } catch (midtransError) {
        logger.error(`[${requestId}] Midtrans transaction failed`, {
          error: midtransError.message,
          response: midtransError.ApiResponse
        });

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
            'Terjadi kesalahan saat memproses pembayaran',
        }).code(502);
      }
    }

    logger.info(`[${requestId}] Order created successfully`, { 
      responseTime: `${Date.now() - startTime}ms` 
    });

    return h.response({
      status: 'success',
      message: 'Order berhasil dibuat',
      data: { 
        orderId,
        ...(paymentMethod === 'cod' && { 
          instructions: 'Pembayaran dilakukan saat barang diterima' 
        })
      },
    }).code(201);
  } catch (error) {
    logger.error(`[${requestId}] Order creation failed`, {
      error: error.message,
      stack: error.stack
    });
    
    return h.response({ 
      status: 'error', 
      message: 'Gagal membuat order',
      ...(process.env.NODE_ENV === 'development' && { error: error.message })
    }).code(500);
  }
};

// GET ALL ORDERS HANDLER
const getAllOrdersHandler = async (request, h) => {
  const { userId } = request.query;
  const requestId = uuidv4();
  
  try {
    logger.info(`[${requestId}] Fetching orders for user ${userId}`);
    
    const snapshot = await db.collection('orders')
      .where('userId', '==', userId)
      .orderBy('createdAt', 'desc')
      .get();
    
    const orders = snapshot.docs.map(doc => ({
      orderId: doc.id,
      ...doc.data(),
      // Format tanggal untuk response
      createdAt: new Date(doc.data().createdAt).toLocaleString('id-ID'),
      updatedAt: doc.data().updatedAt ? 
        new Date(doc.data().updatedAt).toLocaleString('id-ID') : null,
    }));
    
    logger.info(`[${requestId}] Found ${orders.length} orders`);
    
    return h.response({ 
      status: 'success', 
      data: orders,
      meta: {
        total: orders.length,
      }
    }).code(200);
  } catch (error) {
    logger.error(`[${requestId}] Error fetching orders`, {
      error: error.message
    });
    
    return h.response({ 
      status: 'fail', 
      message: 'Gagal mengambil data order',
      ...(process.env.NODE_ENV === 'development' && { error: error.message })
    }).code(500);
  }
};

// GET ORDER DETAIL HANDLER
const getOrderDetailHandler = async (request, h) => {
  const { orderId } = request.params;
  const requestId = uuidv4();
  
  try {
    logger.info(`[${requestId}] Fetching order details`);
    
    const doc = await db.collection('orders').doc(orderId).get();
    
    if (!doc.exists) {
      logger.warn(`[${requestId}] Order not found`);
      return h.response({ 
        status: 'fail', 
        message: 'Order tidak ditemukan' 
      }).code(404);
    }
    
    const orderData = doc.data();
    
    // Format response
    const responseData = {
      orderId,
      ...orderData,
      createdAt: new Date(orderData.createdAt).toLocaleString('id-ID'),
      updatedAt: orderData.updatedAt ? 
        new Date(orderData.updatedAt).toLocaleString('id-ID') : null,
      totalItems: orderData.carts.reduce((sum, item) => sum + item.quantity, 0),
    };
    
    logger.info(`[${requestId}] Order details retrieved`);
    
    return h.response({ 
      status: 'success', 
      data: responseData 
    }).code(200);
  } catch (error) {
    logger.error(`[${requestId}] Error fetching order details`, {
      error: error.message
    });
    
    return h.response({ 
      status: 'error', 
      message: 'Gagal mengambil detail order',
      ...(process.env.NODE_ENV === 'development' && { error: error.message })
    }).code(500);
  }
};

// UPDATE ORDER STATUS HANDLER
const updateOrderStatusHandler = async (request, h) => {
  const { orderId } = request.params;
  const { status } = request.payload;
  const requestId = uuidv4();
  
  try {
    logger.info(`[${requestId}] Updating order status`);
    
    const doc = await db.collection('orders').doc(orderId).get();
    
    if (!doc.exists) {
      logger.warn(`[${requestId}] Order not found`);
      return h.response({ 
        status: 'fail', 
        message: 'Order tidak ditemukan' 
      }).code(404);
    }
    
    const validStatuses = ['pending', 'processing', 'shipped', 'delivered', 'cancelled'];
    if (!validStatuses.includes(status)) {
      logger.warn(`[${requestId}] Invalid status`, { status });
      return h.response({
        status: 'fail',
        message: 'Status tidak valid',
        validStatuses
      }).code(400);
    }
    
    await db.collection('orders').doc(orderId).update({ 
      status,
      updatedAt: new Date().toISOString() 
    });
    
    logger.info(`[${requestId}] Order status updated`);
    
    return h.response({ 
      status: 'success', 
      message: 'Status berhasil diperbarui' 
    }).code(200);
  } catch (error) {
    logger.error(`[${requestId}] Failed to update status`, {
      error: error.message
    });
    
    return h.response({ 
      status: 'error', 
      message: 'Gagal memperbarui status',
      ...(process.env.NODE_ENV === 'development' && { error: error.message })
    }).code(500);
  }
};

// PAYMENT HANDLERS
const chargePaymentHandler = async (request, h) => {
  const { orderId, paymentType, bank } = request.payload;
  const requestId = uuidv4();
  
  try {
    logger.info(`[${requestId}] Processing payment charge`);
    
    // Validasi jenis pembayaran
    const validPaymentTypes = ['bank_transfer', 'qris', 'gopay'];
    if (!validPaymentTypes.includes(paymentType)) {
      logger.warn(`[${requestId}] Invalid payment type`, { paymentType });
      return h.response({
        status: 'fail',
        message: 'Jenis pembayaran tidak valid',
        validPaymentTypes
      }).code(400);
    }

    // Dapatkan data order
    const doc = await db.collection('orders').doc(orderId).get();
    if (!doc.exists) {
      logger.warn(`[${requestId}] Order not found`);
      return h.response({
        status: 'fail',
        message: 'Order tidak ditemukan',
      }).code(404);
    }

    const orderData = doc.data();
    
    // Siapkan parameter Midtrans
    const parameter = {
      transaction_details: {
        order_id: orderId,
        gross_amount: orderData.totalPrice,
      },
      customer_details: {
        first_name: `Customer-${orderData.userId.substring(0, 8)}`,
        email: `${orderData.userId.substring(0, 8)}@customer.com`,
      },
      payment_type: paymentType,
    };

    // Tambahkan parameter khusus
    if (paymentType === 'bank_transfer') {
      parameter.bank_transfer = {
        bank: bank || 'bca',
      };
    }

    logger.debug(`[${requestId}] Creating Midtrans transaction`);
    const transaction = await snap.createTransaction(parameter);
    logger.info(`[${requestId}] Payment transaction created`);

    // Update order
    await db.collection('orders').doc(orderId).update({
      paymentMethod: paymentType,
      midtrans_status: 'pending',
      paymentData: {
        transactionId: transaction.transaction_id,
        paymentUrl: transaction.redirect_url,
        status: 'pending',
      },
      updatedAt: new Date().toISOString(),
    });

    return h.response({
      status: 'success',
      message: 'Pembayaran berhasil diproses',
      data: {
        paymentUrl: transaction.redirect_url,
        transactionId: transaction.transaction_id,
        paymentType,
      },
    }).code(200);
  } catch (error) {
    logger.error(`[${requestId}] Payment processing failed`, {
      error: error.message,
      response: error.ApiResponse
    });

    try {
      await db.collection('orders').doc(orderId).update({
        midtrans_status: 'error',
        paymentError: error.ApiResponse?.error_messages || error.message,
        updatedAt: new Date().toISOString(),
      });
    } catch (updateError) {
      logger.error(`[${requestId}] Failed to update order status`, {
        error: updateError.message
      });
    }

    return h.response({
      status: 'error',
      message: 'Gagal memproses pembayaran',
      ...(process.env.NODE_ENV === 'development' && {
        error: error.message,
        midtransError: error.ApiResponse?.error_messages
      })
    }).code(500);
  }
};

// MIDTRANS NOTIFICATION HANDLER
const handleMidtransNotification = async (request, h) => {
  const notification = request.payload;
  const requestId = uuidv4();

  try {
    logger.info(`[${requestId}] Received payment notification`, {
      orderId: notification.order_id,
      status: notification.transaction_status
    });

    // Validasi signature jika diperlukan
    if (process.env.VERIFY_MIDTRANS_SIGNATURE === 'true') {
      const isValid = snap.transaction.notification(notification);
      if (!isValid) {
        logger.warn(`[${requestId}] Invalid signature`);
        return h.response({ message: 'Signature tidak valid' }).code(403);
      }
    }

    const { order_id, transaction_status, fraud_status } = notification;
    const orderRef = db.collection('orders').doc(order_id);
    const doc = await orderRef.get();

    if (!doc.exists) {
      logger.warn(`[${requestId}] Order not found`);
      return h.response({ message: 'Order tidak ditemukan' }).code(404);
    }

    // Mapping status
    const statusMap = {
      'capture': 'dibayar',
      'settlement': 'dibayar',
      'pending': 'menunggu pembayaran',
      'deny': 'ditolak',
      'expire': 'expired',
      'cancel': 'dibatalkan'
    };

    const newStatus = statusMap[transaction_status] || transaction_status;
    
    // Data update
    const updateData = {
      status: newStatus,
      midtrans_status: transaction_status,
      fraud_status,
      updatedAt: new Date().toISOString(),
    };

    // Tambahkan payment time jika pembayaran berhasil
    if (transaction_status === 'settlement' || transaction_status === 'capture') {
      updateData.payment_time = notification.settlement_time || new Date().toISOString();
      
      // Update payment data
      updateData.paymentData = {
        ...(doc.data().paymentData || {}),
        status: 'completed',
        settlementTime: updateData.payment_time
      };
    }

    await orderRef.update(updateData);
    logger.info(`[${requestId}] Order status updated`, { newStatus });

    return h.response({ message: 'Notifikasi berhasil diproses' }).code(200);
  } catch (error) {
    logger.error(`[${requestId}] Notification handling failed`, {
      error: error.message,
      notification
    });

    return h.response({ 
      error: 'Terjadi kesalahan saat memproses notifikasi',
      ...(process.env.NODE_ENV === 'development' && { details: error.message })
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