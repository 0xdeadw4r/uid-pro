
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
