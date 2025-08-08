const { db } = require('../services/firebaseService');
const midtransClient = require('midtrans-client');

// Midtrans Snap Client
const snap = new midtransClient.Snap({
    isProduction: false, // true jika live
    serverKey: process.env.MIDTRANS_SERVER_KEY || "",
});

const core = new midtransClient.CoreApi({
    isProduction: false,
    serverKey: process.env.MIDTRANS_SERVER_KEY || "",
    clientKey: process.env.MIDTRANS_CLIENT_KEY || "",
});

// ======== BUAT ORDER ========
// ======== BUAT ORDER ========
const createOrderHandler = async (request, h) => {
    try {
        const {
            userId,
            carts,
            alamat,
            ongkir = 0,
            paymentMethod,
            totalPrice, // ini nggak lagi jadi patokan gross_amount
            deliveryMethod,
            customer
        } = request.payload;

        if (!userId || !carts || carts.length === 0) {
            return h.response({ status: 'fail', message: 'Data order tidak lengkap' }).code(400);
        }

        // Buat Order ID unik
        const orderId = `ORDER-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

        // Hitung item_details yang sudah include custom material
        const itemDetails = carts.map(item => {
            const customMaterialTotal = item.customMaterials?.reduce((sum, m) =>
                sum + (m.price * m.quantity), 0
            ) || 0;

            return {
                id: item.buketId,
                price: item.basePrice + customMaterialTotal,
                quantity: item.quantity,
                name: item.name
            };
        });

        // Tambahkan ongkir
        if (ongkir) {
            itemDetails.push({
                id: "ONGKIR",
                price: ongkir,
                quantity: 1,
                name: "Ongkos Kirim"
            });
        }

        // Hitung gross_amount langsung dari item_details
        const grossAmount = itemDetails.reduce((sum, item) =>
            sum + (item.price * item.quantity), 0
        );

        const orderData = {
            orderId,
            userId,
            carts,
            alamat,
            ongkir,
            totalPrice: grossAmount, // simpan hasil hitungan beneran
            paymentMethod,
            deliveryMethod,
            status: paymentMethod === 'midtrans' ? 'pending' : 'waiting_payment',
            createdAt: new Date().toISOString(),
        };

        let midtransToken = null;
        let midtransRedirectUrl = null;

        // Jika pembayaran Midtrans
        if (paymentMethod === 'midtrans') {
            const midtransParams = {
                transaction_details: {
                    order_id: orderId,
                    gross_amount: grossAmount, // aman, sama dengan total item_details
                },
                customer_details: {
                    first_name: customer?.name || "User",
                    email: customer?.email || "user@example.com",
                    phone: customer?.phone || "",
                    shipping_address: { address: alamat },
                },
                item_details: itemDetails
            };

            const transaction = await snap.createTransaction(midtransParams);
            midtransToken = transaction.token;
            midtransRedirectUrl = transaction.redirect_url;
        }

        // Simpan order ke Firestore
        await db.collection('orders').doc(orderId).set({
            ...orderData,
            midtransToken,
            midtransRedirectUrl,
        });

        return h.response({
            status: 'success',
            message: 'Order berhasil dibuat',
            data: { orderId, midtransToken, midtransRedirectUrl }
        }).code(201);

    } catch (error) {
        console.error('Error createOrderHandler:', error);
        return h.response({ status: 'fail', message: error.message }).code(500);
    }
};


// ======== NOTIFIKASI MIDTRANS ========
const midtransNotificationHandler = async (request, h) => {
    try {
        const notification = request.payload;
        const statusResponse = await core.transaction.notification(notification);

        const orderId = statusResponse.order_id;
        const transactionStatus = statusResponse.transaction_status;
        const fraudStatus = statusResponse.fraud_status;

        let newStatus = 'pending';

        if (transactionStatus === 'capture') {
            newStatus = fraudStatus === 'accept' ? 'paid' : 'challenge';
        } else if (transactionStatus === 'settlement') {
            newStatus = 'paid';
        } else if (transactionStatus === 'pending') {
            newStatus = 'pending';
        } else if (['deny', 'cancel', 'expire'].includes(transactionStatus)) {
            newStatus = 'failed';
        } else if (transactionStatus === 'refund') {
            newStatus = 'refunded';
        }

        await db.collection('orders').doc(orderId).update({
            status: newStatus,
            updatedAt: new Date().toISOString(),
            midtransStatus: statusResponse
        });

        return h.response({ success: true, message: 'Notifikasi diproses' }).code(200);

    } catch (error) {
        console.error('Error midtransNotificationHandler:', error);
        return h.response({ success: false, message: error.message }).code(500);
    }
};

module.exports = {
    createOrderHandler,
    midtransNotificationHandler
};
