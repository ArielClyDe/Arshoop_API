// src/handlers/orderPaymentHandler.js
const midtransClient = require('midtrans-client');
const { db } = require('../services/firebaseService');
const { v4: uuidv4 } = require('uuid');

// Enhanced logger with error tracking
const midtransClient = require('midtrans-client');

// Inisialisasi Snap
const snap = new midtransClient.Snap({
  isProduction: process.env.MIDTRANS_IS_PRODUCTION === 'true',
  serverKey: process.env.MIDTRANS_SERVER_KEY,
  clientKey: process.env.MIDTRANS_CLIENT_KEY
});

const createOrderHandler = async (req, res) => {
  try {
    const { totalPrice, orderItems } = req.body;
    const userId = req.user._id;

    // Validasi order items
    if (!orderItems || orderItems.length === 0) {
      return res.status(400).json({ message: 'Order items are required' });
    }

    // Validasi harga
    if (!totalPrice || totalPrice <= 0) {
      return res.status(400).json({ message: 'Total price must be greater than zero' });
    }

    // Hitung ongkir tetap Rp10.000
    const shippingCost = 10000;
    const midtransAmount = Math.round(Number(totalPrice) + shippingCost);

    // Buat order ID unik
    const orderId = `ORDER-${Date.now()}-${userId.toString().substring(0, 8)}`;

    // Payload Snap API (semua metode pembayaran aktif)
    const parameter = {
      transaction_details: {
        order_id: orderId,
        gross_amount: midtransAmount
      },
      customer_details: {
        first_name: `Customer-${userId.toString().substring(0, 8)}`,
        email: `${userId.toString().substring(0, 8)}@customer.com`,
        phone: '08123456789'
      }
      // Kalau mau aktifkan metode tertentu saja, tambahkan:
      // enabled_payments: ['bca_va', 'bni_va', 'gopay', 'shopeepay']
    };

    // Buat transaksi Snap
    const transaction = await snap.createTransaction(parameter);

    // Validasi hasil
    if (!transaction || !transaction.token || !transaction.redirect_url) {
      throw new Error('Midtrans Snap did not return a valid transaction');
    }

    // Kirim respons ke frontend
    res.status(200).json({
      message: 'Order created successfully',
      snapToken: transaction.token,
      redirectUrl: transaction.redirect_url,
      orderId
    });

  } catch (paymentError) {
    console.error('Midtrans API Error:', paymentError.ApiResponse || paymentError.message || paymentError);
    res.status(500).json({
      message: 'Midtrans Validation Failed',
      error: paymentError.ApiResponse || paymentError.message || 'Unknown error'
    });
  }
};

module.exports = { createOrderHandler };



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
    logger.error(`[${requestId}] Error fetching orders`, error);
    
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
    logger.error(`[${requestId}] Error fetching order details`, error);
    
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
    logger.error(`[${requestId}] Failed to update status`, error);
    
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
    
    const validPaymentTypes = ['bank_transfer', 'qris', 'gopay'];
    if (!validPaymentTypes.includes(paymentType)) {
      logger.warn(`[${requestId}] Invalid payment type`, { paymentType });
      return h.response({
        status: 'fail',
        message: 'Jenis pembayaran tidak valid',
        validPaymentTypes
      }).code(400);
    }

    const doc = await db.collection('orders').doc(orderId).get();
    if (!doc.exists) {
      logger.warn(`[${requestId}] Order not found`);
      return h.response({
        status: 'fail',
        message: 'Order tidak ditemukan',
      }).code(404);
    }

    const orderData = doc.data();
    
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

    if (paymentType === 'bank_transfer') {
      parameter.bank_transfer = {
        bank: bank || 'bca',
      };
    }

    logger.debug(`[${requestId}] Creating Midtrans transaction`);
    const transaction = await snap.createTransaction(parameter);
    logger.info(`[${requestId}] Payment transaction created`);

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
      logger.error(`[${requestId}] Failed to update order status`, updateError);
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

    const statusMap = {
      'capture': 'dibayar',
      'settlement': 'dibayar',
      'pending': 'menunggu pembayaran',
      'deny': 'ditolak',
      'expire': 'expired',
      'cancel': 'dibatalkan'
    };

    const newStatus = statusMap[transaction_status] || transaction_status;
    
    const updateData = {
      status: newStatus,
      midtrans_status: transaction_status,
      fraud_status,
      updatedAt: new Date().toISOString(),
    };

    if (transaction_status === 'settlement' || transaction_status === 'capture') {
      updateData.payment_time = notification.settlement_time || new Date().toISOString();
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