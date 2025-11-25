const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const resellerSchema = new mongoose.Schema({
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
    email: {
        type: String,
        required: false,
        default: ''
    },
    credits: {
        type: Number,
        default: 0
    },
    genzauthSellerKey: {
        type: String,
        default: ''
    },
    assignedProducts: [{
        type: String
    }],
    isActive: {
        type: Boolean,
        default: true
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
    },
    totalClientsCreated: {
        type: Number,
        default: 0
    },
    lastLogin: {
        type: Date,
        default: null
    }
});

resellerSchema.pre('save', async function (next) {
    if (this.isModified('password')) {
        this.password = await bcrypt.hash(this.password, 10);
    }
    this.updatedAt = Date.now();
    next();
});

resellerSchema.methods.comparePassword = async function (candidatePassword) {
    return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('Reseller', resellerSchema);
