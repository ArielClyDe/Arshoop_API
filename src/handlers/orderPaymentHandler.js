// src/handlers/orderPaymentHandler.js
const midtransClient = require('midtrans-client');
const { db } = require('../services/firebaseService');
const { v4: uuidv4 } = require('uuid');

// Enhanced logger with error tracking
const logger = {
  info: (...args) => console.log('[INFO]', ...args),
  error: (context, error) => {
    console.error('[ERROR]', {
      timestamp: new Date().toISOString(),
      context,
      error: {
        message: error.message,
        stack: error.stack,
        ...(error.ApiResponse && { apiResponse: error.ApiResponse }),
        ...(error.rawHttpClientData && { httpData: error.rawHttpClientData })
      }
    });
  },
  warn: (...args) => console.warn('[WARN]', ...args),
  debug: (...args) => {
    if (process.env.NODE_ENV !== 'production') {
      console.debug('[DEBUG]', ...args);
    }
  }
};

// Midtrans Snap Initialization with enhanced config
let snap;
const initializeMidtrans = () => {
  try {
    // Log config without exposing full keys
    logger.info('Initializing Midtrans client', {
      env: {
        isProduction: process.env.MIDTRANS_IS_PRODUCTION,
        serverKeyPrefix: process.env.MIDTRANS_SERVER_KEY?.substring(0, 6) + '...',
        clientKeyPrefix: process.env.MIDTRANS_CLIENT_KEY?.substring(0, 6) + '...'
      }
    });

    if (!process.env.MIDTRANS_SERVER_KEY || !process.env.MIDTRANS_CLIENT_KEY) {
      throw new Error('Midtrans credentials not configured');
    }

    snap = new midtransClient.Snap({
      isProduction: process.env.MIDTRANS_IS_PRODUCTION === 'true',
      serverKey: process.env.MIDTRANS_SERVER_KEY,
      clientKey: process.env.MIDTRANS_CLIENT_KEY,
      requestOptions: {
        timeout: 15000,
        proxy: false
      }
    });

    logger.info('Midtrans client initialized successfully');
  } catch (error) {
    logger.error('Midtrans initialization failed', error);
    process.exit(1);
  }
};

initializeMidtrans();

// Helper function to safely update Firestore
const safeFirestoreUpdate = async (docRef, data) => {
  const cleanData = Object.entries(data).reduce((acc, [key, value]) => {
    if (value !== undefined) acc[key] = value;
    return acc;
  }, {});

  await docRef.update(cleanData);
};

// Modified createOrderHandler with enhanced Midtrans error handling
const createOrderHandler = async (request, h) => {
  const startTime = Date.now();
  const requestId = uuidv4();
  
  try {
    logger.info(`[${requestId}] Order creation started`);

    // 1. Validate request payload exists
    if (!request.payload) {
      const error = new Error('Request payload is missing');
      error.code = 'MISSING_PAYLOAD';
      throw error;
    }

    const payload = request.payload;

    // 2. Input validation
    const validationErrors = validateOrderInput(payload);
    if (validationErrors.length > 0) {
      const error = new Error('Order validation failed');
      error.code = 'VALIDATION_ERROR';
      error.details = validationErrors;
      throw error;
    }

    const { userId, carts, alamat, ongkir, paymentMethod, deliveryMethod } = payload;

    // 3. Cart items validation
    const invalidCartItems = validateCartItems(carts);
    if (invalidCartItems.length > 0) {
      const error = new Error('Invalid cart items');
      error.code = 'INVALID_CART_ITEMS';
      error.details = invalidCartItems;
      throw error;
    }

    // 4. Calculate total price with safe rounding
    const subtotal = carts.reduce((sum, cart) => {
      const price = Number(cart.totalPrice) || 0;
      if (isNaN(price)) {
        throw new Error(`Invalid price for cart item ${cart.cartId}`);
      }
      return sum + price;
    }, 0);

    const shippingCost = deliveryMethod === 'delivery' ? Math.round(Number(ongkir) || 0) : 0;
    const totalPrice = Math.round(subtotal + shippingCost);

    // 5. Create order ID and prepare order data
    const orderId = `ORDER-${uuidv4()}`;
    const orderData = {
      orderId,
      userId,
      deliveryMethod,
      alamat: deliveryMethod === 'delivery' ? alamat : null,
      ongkir: shippingCost,
      paymentMethod,
      totalPrice,
      servicePrice: carts.reduce((sum, cart) => sum + (Number(cart.servicePrice) || 0), 0),
      carts: mapCartItems(carts),
      status: paymentMethod === 'cod' ? 'pending' : 'menunggu pembayaran',
      createdAt: new Date().toISOString(),
      midtrans_status: paymentMethod === 'cod' ? null : 'pending',
      updatedAt: new Date().toISOString(),
    };

    // 6. Save to Firestore
    await db.collection('orders').doc(orderId).set(orderData);
    logger.info(`[${requestId}] Order saved successfully`);

    // 7. Clean up carts (with error suppression)
    try {
      const cartIds = carts.map(c => c.cartId).filter(Boolean);
      if (cartIds.length > 0) {
        const batch = db.batch();
        cartIds.forEach(id => batch.delete(db.collection('carts').doc(id)));
        await batch.commit();
      }
    } catch (cartError) {
      logger.warn(`[${requestId}] Cart cleanup failed`, { error: cartError.message });
    }

    // 8. Process payment for transfer method
    if (paymentMethod === 'transfer') {
      try {
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
          bank_transfer: { bank: 'bca' },
        };

        const transaction = await snap.createTransaction(parameter);
        
        if (!transaction?.transaction_id || !transaction?.redirect_url) {
          throw new Error('Invalid Midtrans response: missing transaction data');
        }

        await safeFirestoreUpdate(db.collection('orders').doc(orderId), {
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
        const errorDetails = {
          code: midtransError.httpStatusCode || 'MIDTRANS_ERROR',
          message: midtransError.message,
          response: midtransError.ApiResponse
        };

        await safeFirestoreUpdate(db.collection('orders').doc(orderId), {
          status: 'payment_failed',
          midtrans_status: 'error',
          paymentError: errorDetails.message.substring(0, 200),
          updatedAt: new Date().toISOString(),
        });

        return h.response({
          status: 'error',
          message: 'Pembayaran gagal diproses',
          error: process.env.NODE_ENV === 'development' ? errorDetails : undefined,
        }).code(502);
      }
    }

    // 9. Success response for COD orders
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
    // Enhanced error handling
    const errorResponse = {
      status: 'error',
      message: 'Gagal membuat order',
      errorId: requestId,
      timestamp: new Date().toISOString(),
    };

    if (process.env.NODE_ENV === 'development') {
      errorResponse.debug = {
        message: error.message,
        type: error.name,
        code: error.code,
        ...(error.details && { details: error.details })
      };
    }

    logger.error(`[${requestId}] Order creation failed`, {
      error: {
        message: error.message,
        stack: error.stack,
        code: error.code,
      },
      payloadSummary: request.payload ? {
        userId: request.payload.userId,
        itemCount: request.payload.carts?.length,
        paymentMethod: request.payload.paymentMethod
      } : null
    });

    return h.response(errorResponse).code(500);
  }
};

// ... (other handlers remain the same with enhanced error logging)

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