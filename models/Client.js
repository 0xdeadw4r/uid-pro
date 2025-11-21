const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

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

    // Product Type
    productType: {
        type: String,
        enum: ['AIMKILL', 'UID_BYPASS'],
        required: true
    },

    // Assigned Aimkill Account (for HWID reset - only for AIMKILL product type)
    assignedUsername: {
        type: String,
        required: function() {
            return this.productType === 'AIMKILL';
        },
        trim: true
    },

    // Assigned UID (for UID_BYPASS product type)
    assignedUid: {
        type: String,
        required: function() {
            return this.productType === 'UID_BYPASS';
        },
        trim: true
    },

    // Download Links (managed by admins)
    downloadLinks: {
        aimkill: {
            type: String,
            default: ''
        },
        uidBypass: {
            type: String,
            default: ''
        }
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

// Hash client password before saving
clientSchema.pre('save', async function(next) {
    if (!this.isModified('password')) return next();

    try {
        const salt = await bcrypt.genSalt(10);
        this.password = await bcrypt.hash(this.password, salt);
        next();
    } catch (error) {
        next(error);
    }
});

// Method to compare password
clientSchema.methods.comparePassword = async function(candidatePassword) {
    try {
        return await bcrypt.compare(candidatePassword, this.password);
    } catch (error) {
        throw error;
    }
};


// Method to get download link based on product type
clientSchema.methods.getDownloadLink = function() {
    if (this.productType === 'AIMKILL') {
        return this.downloadLinks.aimkill;
    } else if (this.productType === 'UID_BYPASS') {
        return this.downloadLinks.uidBypass;
    }
    return '';
};

module.exports = mongoose.model('Client', clientSchema);