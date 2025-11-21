const mongoose = require('mongoose');

const clientSchema = new mongoose.Schema({
    // Client Login Credentials
    username: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true
    },
    password: {
        type: String,
        required: true
    },

    // Product Reference
    productKey: {
        type: String,
        required: false,
        default: 'UID_BYPASS'
    },

    // Legacy Product Type (for backward compatibility)
    productType: {
        type: String,
        enum: ['AIMKILL', 'UID_BYPASS'],
        required: false
    },

    // Assigned Aimkill Account (for HWID reset)
    assignedUsername: {
        type: String,
        required: false,
        trim: true
    },

    // Assigned UID
    assignedUid: {
        type: String,
        required: false,
        trim: true
    },

    // Custom download link (overrides product default)
    customDownloadLink: {
        type: String,
        default: ''
    },

    // Status
    isActive: {
        type: Boolean,
        default: true
    },

    // Metadata
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },

    lastLogin: {
        type: Date,
        default: null
    },

    lastHwidReset: {
        type: Date,
        default: null
    },

    hwidResetCount: {
        type: Number,
        default: 0
    },

    notes: {
        type: String,
        default: ''
    }
}, {
    timestamps: true
});

// Method to get download link (custom overrides product default)
clientSchema.methods.getDownloadLink = async function() {
    if (this.customDownloadLink) {
        return this.customDownloadLink;
    }
    
    const Product = require('./Product');
    const product = await Product.findOne({ productKey: this.productKey });
    return product ? product.downloadLink : '';
};

module.exports = mongoose.model('Client', clientSchema);