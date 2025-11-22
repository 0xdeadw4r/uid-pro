
const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
    productKey: {
        type: String,
        required: true,
        unique: true
    },
    displayName: {
        type: String,
        required: true
    },
    description: {
        type: String,
        default: ''
    },
    isActive: {
        type: Boolean,
        default: true
    },
    packages: {
        type: Map,
        of: {
            display: String,
            days: Number,
            hours: Number,
            credits: Number,
            price: Number,
            popular: Boolean
        },
        default: {}
    },
    // GenzAuth API Configuration
    genzauthSellerKey: {
        type: String,
        default: ''
    },
    // HWID Reset Permission
    allowHwidReset: {
        type: Boolean,
        default: false
    },
    // Maximum free HWID resets (before requiring payment)
    maxFreeHwidResets: {
        type: Number,
        default: 5
    },
    // Price for HWID reset after free limit
    hwidResetPrice: {
        type: Number,
        default: 0
    },
    // Download Link
    downloadLink: {
        type: String,
        default: ''
    },
    // Setup Video Link
    setupVideoLink: {
        type: String,
        default: ''
    },
    // Guest Video Link
    guestVideoLink: {
        type: String,
        default: ''
    },
    // Announcements/News
    announcements: {
        type: String,
        default: ''
    },
    settings: {
        type: Map,
        of: mongoose.Schema.Types.Mixed,
        default: {}
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    },
    createdBy: {
        type: String,
        required: true
    }
});

productSchema.pre('save', function(next) {
    this.updatedAt = new Date();
    next();
});

module.exports = mongoose.model('Product', productSchema);
