
const mongoose = require('mongoose');

const apiConfigSchema = new mongoose.Schema({
  configKey: {
    type: String,
    required: true,
    unique: true,
    default: 'main_config'
  },
  baseUrl: {
    type: String,
    default: ''
  },
  apiKey: {
    type: String,
    default: ''
  },
  genzauthSellerKey: {
    type: String,
    default: ''
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

apiConfigSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('ApiConfig', apiConfigSchema);
