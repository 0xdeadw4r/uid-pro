const mongoose = require('mongoose');

const packageConfigSchema = new mongoose.Schema({
  configKey: {
    type: String,
    required: true,
    unique: true,
    default: 'main_packages'
  },
  
  // UID Packages
  uidPackages: {
    type: Map,
    of: {
      name: String,
      hours: Number,
      credits: Number,
      price: Number,
      popular: { type: Boolean, default: false }
    },
    default: new Map([
      ['1day', { name: '1 Day', hours: 24, credits: 1, price: 0.50, popular: false }],
      ['3days', { name: '3 Days', hours: 72, credits: 3, price: 1.30, popular: true }],
      ['7days', { name: '7 Days', hours: 168, credits: 5, price: 2.33, popular: false }],
      ['14days', { name: '14 Days', hours: 336, credits: 10, price: 3.50, popular: false }],
      ['30days', { name: '30 Days', hours: 720, credits: 15, price: 5.20, popular: false }]
    ])
  },
  
  // Aimkill Packages
  aimkillPackages: {
    type: Map,
    of: {
      days: Number,
      credits: Number,
      display: String,
      price: Number
    },
    default: new Map([
      ['1day', { days: 1, credits: 1, display: '1 Day', price: 2.99 }],
      ['3day', { days: 3, credits: 3, display: '3 Days', price: 7.99 }],
      ['7day', { days: 7, credits: 7, display: '7 Days', price: 14.99 }],
      ['15day', { days: 15, credits: 15, display: '15 Days', price: 29.99 }],
      ['30day', { days: 30, credits: 30, display: '30 Days', price: 49.99 }],
      ['lifetime', { days: 365, credits: 100, display: 'Lifetime (1 Year)', price: 99.99 }]
    ])
  },
  
  updatedAt: {
    type: Date,
    default: Date.now
  },
  updatedBy: {
    type: String,
    default: 'system'
  }
});

packageConfigSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('PackageConfig', packageConfigSchema);
