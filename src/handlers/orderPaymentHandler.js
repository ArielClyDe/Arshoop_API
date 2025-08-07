// src/handlers/orderPaymentHandler.js
const midtransClient = require('midtrans-client');
const { db } = require('../services/firebaseService');
const { v4: uuidv4 } = require('uuid');

// Inisialisasi Snap
const snap = new midtransClient.Snap({
  isProduction: process.env.MIDTRANS_IS_PRODUCTION === 'true',
  serverKey: process.env.MIDTRANS_SERVER_KEY,
  clientKey: process.env.MIDTRANS_CLIENT_KEY
});

// CREATE ORDER
const createOrderHandler = async (req, res) => {
  try {
    const { totalPrice, orderItems } = req.body;
    const userId = req.user._id;

    if (!orderItems || orderItems.length === 0) {
      return res.status(400).json({ message: 'Order items are required' });
    }
    if (!totalPrice || totalPrice <= 0) {
      return res.status(400).json({ message: 'Total price must be greater than zero' });
    }

    const shippingCost = 10000;
    const midtransAmount = Math.round(Number(totalPrice) + shippingCost);
    const orderId = `ORDER-${Date.now()}-${userId.toString().substring(0, 8)}`;

    const parameter = {
      transaction_details: { order_id: orderId, gross_amount: midtransAmount },
      customer_details: {
        first_name: `Customer-${userId.toString().substring(0, 8)}`,
        email: `${userId.toString().substring(0, 8)}@customer.com`,
        phone: '08123456789'
      }
    };

    const transaction = await snap.createTransaction(parameter);

    if (!transaction?.token || !transaction?.redirect_url) {
      throw new Error('Midtrans Snap did not return a valid transaction');
    }

    res.status(200).json({
      message: 'Order created successfully',
      snapToken: transaction.token,
      redirectUrl: transaction.redirect_url,
      orderId
    });
  } catch (error) {
    console.error('Midtrans API Error:', error.ApiResponse || error.message);
    res.status(500).json({
      message: 'Midtrans Validation Failed',
      error: error.ApiResponse || error.message || 'Unknown error'
    });
  }
};

// GET ALL ORDERS
const getAllOrdersHandler = async (request, h) => {
  const { userId } = request.query;
  try {
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

    return h.response({ status: 'success', data: orders, meta: { total: orders.length } }).code(200);
  } catch (error) {
    console.error('Error fetching orders:', error);
    return h.response({ status: 'fail', message: 'Gagal mengambil data order' }).code(500);
  }
};

// GET ORDER DETAIL
const getOrderDetailHandler = async (request, h) => {
  const { orderId } = request.params;
  try {
    const doc = await db.collection('orders').doc(orderId).get();
    if (!doc.exists) {
      return h.response({ status: 'fail', message: 'Order tidak ditemukan' }).code(404);
    }

    const orderData = doc.data();
    return h.response({
      status: 'success',
      data: {
        orderId,
        ...orderData,
        createdAt: new Date(orderData.createdAt).toLocaleString('id-ID'),
        updatedAt: orderData.updatedAt ? 
          new Date(orderData.updatedAt).toLocaleString('id-ID') : null,
        totalItems: orderData.carts.reduce((sum, item) => sum + item.quantity, 0),
      }
    }).code(200);
  } catch (error) {
    console.error('Error fetching order details:', error);
    return h.response({ status: 'error', message: 'Gagal mengambil detail order' }).code(500);
  }
};

// UPDATE ORDER STATUS
const updateOrderStatusHandler = async (request, h) => {
  const { orderId } = request.params;
  const { status } = request.payload;
  try {
    const doc = await db.collection('orders').doc(orderId).get();
    if (!doc.exists) {
      return h.response({ status: 'fail', message: 'Order tidak ditemukan' }).code(404);
    }

    const validStatuses = ['pending', 'processing', 'shipped', 'delivered', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return h.response({ status: 'fail', message: 'Status tidak valid', validStatuses }).code(400);
    }

    await db.collection('orders').doc(orderId).update({ 
      status,
      updatedAt: new Date().toISOString() 
    });

    return h.response({ status: 'success', message: 'Status berhasil diperbarui' }).code(200);
  } catch (error) {
    console.error('Failed to update order status:', error);
    return h.response({ status: 'error', message: 'Gagal memperbarui status' }).code(500);
  }
};

// CHARGE PAYMENT
const chargePaymentHandler = async (request, h) => {
  const { orderId, paymentType, bank } = request.payload;
  try {
    const validPaymentTypes = ['bank_transfer', 'qris', 'gopay'];
    if (!validPaymentTypes.includes(paymentType)) {
      return h.response({ status: 'fail', message: 'Jenis pembayaran tidak valid', validPaymentTypes }).code(400);
    }

    const doc = await db.collection('orders').doc(orderId).get();
    if (!doc.exists) {
      return h.response({ status: 'fail', message: 'Order tidak ditemukan' }).code(404);
    }

    const orderData = doc.data();
    const parameter = {
      transaction_details: { order_id: orderId, gross_amount: orderData.totalPrice },
      customer_details: {
        first_name: `Customer-${orderData.userId.substring(0, 8)}`,
        email: `${orderData.userId.substring(0, 8)}@customer.com`,
      },
      payment_type: paymentType,
    };

    if (paymentType === 'bank_transfer') {
      parameter.bank_transfer = { bank: bank || 'bca' };
    }

    const transaction = await snap.createTransaction(parameter);

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
    console.error('Payment processing failed:', error);
    await db.collection('orders').doc(orderId).update({
      midtrans_status: 'error',
      paymentError: error.ApiResponse?.error_messages || error.message,
      updatedAt: new Date().toISOString(),
    });
    return h.response({ status: 'error', message: 'Gagal memproses pembayaran' }).code(500);
  }
};

// MIDTRANS NOTIFICATION
const handleMidtransNotification = async (request, h) => {
  const notification = request.payload;
  try {
    const { order_id, transaction_status, fraud_status } = notification;
    const orderRef = db.collection('orders').doc(order_id);
    const doc = await orderRef.get();
    if (!doc.exists) {
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
    return h.response({ message: 'Notifikasi berhasil diproses' }).code(200);
  } catch (error) {
    console.error('Notification handling failed:', error);
    return h.response({ error: 'Terjadi kesalahan saat memproses notifikasi' }).code(500);
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
