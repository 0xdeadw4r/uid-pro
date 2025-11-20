const mongoose = require('mongoose');

const invoiceSchema = new mongoose.Schema({
    invoiceNumber: {
        type: String,
        required: true,
        unique: true
    },
    username: {
        type: String,
        required: true
    },
    type: {
        type: String,
        enum: ['credit_purchase', 'uid_creation', 'refund'],
        required: true
    },
    amount: {
        type: Number,
        required: true
    },
    credits: {
        type: Number,
        default: 0
    },
    packageName: String,
    uid: String,
    status: {
        type: String,
        enum: ['paid', 'pending', 'cancelled'],
        default: 'paid'
    },
    paymentMethod: {
        type: String,
        default: 'admin_credit'
    },
    billingAddress: {
        name: String,
        email: String,
        phone: String,
        address: String,
        city: String,
        state: String,
        country: String,
        zipCode: String
    },
    subtotal: Number,
    tax: Number,
    taxRate: {
        type: Number,
        default: 18
    },
    total: Number,
    currency: {
        type: String,
        default: 'INR'
    },
    notes: String,
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('Invoice', invoiceSchema);
