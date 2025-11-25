require('dotenv').config();
const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const bodyParser = require('body-parser');
const path = require('path');
const mongoose = require('mongoose');
const axios = require('axios');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const PDFDocument = require('pdfkit');
const moment = require('moment');
const passport = require('./config/passport');
const { generateNetworkFingerprint, checkNetworkFingerprint } = require('./middleware/fingerprint');
const { notifyLogin, notifyUIDCreated, notifyUIDDeleted, notifyAdminAction, notifyCreditAdded } = require('./services/discordService');
const { restoreAllMembers, addUserToGuild, getRestorationStats } = require('./services/discordRestore');
const nowpayments = require('./services/nowpayments');
const keyauth = require('./services/keyauth');
const genzauth = require('./services/genzauth');

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 5000;

// Socket.IO setup
const http = require('http');
const socketIo = require('socket.io');
const server = http.createServer(app);
const io = socketIo(server);

// Chat Message Model (assuming this is created in a separate file, e.g., models/ChatMessage.js)
// If not, you would need to define it here or import it.
// For this example, we'll assume it exists and is imported like other models.
const ChatMessage = require('./models/ChatMessage');

// Socket.IO chat handlers
const connectedUsers = new Map(); // Track connected users by username

io.on('connection', (socket) => {
  console.log('User connected to chat:', socket.id);

  socket.on('join-chat', async (data) => {
    const { username, userType } = data;
    socket.username = username;
    socket.userType = userType;

    // Store socket reference
    connectedUsers.set(username, socket);

    console.log(`${username} (${userType}) joined chat`);

    // Notify all admins that a user is online
    connectedUsers.forEach((userSocket, user) => {
      if (userSocket.userType === 'admin') {
        userSocket.emit('user-online', { username, userType });
      }
    });
  });

  socket.on('chat_message', async (data) => {
    try {
      const { text, senderId, senderName, senderType } = data;

      console.log(`Chat message from ${senderName} (${senderType}): ${text}`);

      // Determine receiver based on sender type
      let receiverUsername = null;
      if (senderType === 'client') {
        // Client sending to admin - find first available admin
        const adminSocket = Array.from(connectedUsers.values()).find(s => s.userType === 'admin');
        receiverUsername = adminSocket ? adminSocket.username : 'admin';
      } else {
        // Admin sending to specific client
        receiverUsername = data.receiverUsername || senderId;
      }

      // Save message to database
      const chatMessage = await ChatMessage.create({
        senderUsername: senderName || socket.username,
        senderType: senderType,
        receiverUsername: receiverUsername,
        message: text,
        isRead: false
      });

      // Emit to sender (confirmation)
      socket.emit('chat_message', {
        text: text,
        senderId: senderId,
        senderName: senderName,
        senderType: senderType,
        timestamp: chatMessage.timestamp
      });

      // Emit to receiver if online
      if (senderType === 'client') {
        // Send to all admins
        connectedUsers.forEach((userSocket, user) => {
          if (userSocket.userType === 'admin' && userSocket.id !== socket.id) {
            userSocket.emit('chat_message', {
              text: text,
              senderId: senderId,
              senderName: senderName,
              senderType: senderType,
              timestamp: chatMessage.timestamp
            });
          }
        });
      } else {
        // Send to specific client
        const clientSocket = connectedUsers.get(receiverUsername);
        if (clientSocket && clientSocket.id !== socket.id) {
          clientSocket.emit('admin_message', {
            text: text,
            senderId: socket.username,
            senderName: socket.username,
            senderType: 'admin',
            timestamp: chatMessage.timestamp
          });
        }
      }
    } catch (error) {
      console.error('Send message error:', error);
      socket.emit('error', { message: 'Failed to send message' });
    }
  });

  socket.on('disconnect', () => {
    if (socket.username) {
      console.log(`${socket.username} disconnected from chat`);
      connectedUsers.delete(socket.username);

      // Notify admins
      connectedUsers.forEach((userSocket, user) => {
        if (userSocket.userType === 'admin') {
          userSocket.emit('user-offline', { username: socket.username });
        }
      });
    }
  });
});


app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    genzauth: process.env.GENZAUTH_SELLER_KEY ? 'configured' : 'not-configured',
    timestamp: new Date().toISOString()
  });
});

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
    });
    console.log('✅ MongoDB connected successfully');
    await initializeAdmin();
    await migrateUsers();
    await initializeApiConfig();
    await initializePackages();
    await initializeProducts();
  } catch (err) {
    console.error('❌ MongoDB connection error:', err.message);
  }
};

connectDB();

mongoose.connection.on('connected', () => {
  console.log('✅ MongoDB connected');
});

mongoose.connection.on('error', (err) => {
  console.error('⚠️ MongoDB error:', err.message);
});

mongoose.connection.on('disconnected', () => {
  console.log('⚠️ MongoDB disconnected');
  setTimeout(connectDB, 5000);
});

const User = require('./models/User');
const UID = require('./models/UID');
const Activity = require('./models/Activity');
const LoginHistory = require('./models/LoginHistory');
const Invoice = require('./models/Invoice');
const AimkillKey = require('./models/AimkillKey');
const ApiKey = require('./models/ApiKey');
const ApiConfig = require('./models/ApiConfig');
const PackageConfig = require('./models/PackageConfig');
const Product = require('./models/Product');

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

if (!process.env.SESSION_SECRET) {
  console.error('❌ FATAL: SESSION_SECRET environment variable is required for security!');
  console.error('❌ Application will not start without SESSION_SECRET');
  process.exit(1);
}

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGODB_URI,
    touchAfter: 24 * 3600
  }),
  cookie: {
    secure: false,
    maxAge: 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: 'lax',
    path: '/'
  },
  name: 'connect.sid',
  proxy: true,
  rolling: true
}));

app.use(passport.initialize());
app.use(passport.session());

const clientRoutes = require('./routes/client');
app.use('/client', clientRoutes);

const resellerRoutes = require('./routes/reseller');
app.use('/reseller', resellerRoutes);

app.use(['/dashboard', '/packages', '/admin', '/settings', '/security', '/invoices'], checkNetworkFingerprint);

async function initializeAdmin() {
  try {
    const adminExists = await User.findOne({ username: 'admin' });
    if (!adminExists) {
      if (!process.env.ADMIN_PASSWORD) {
        console.error('❌ FATAL: ADMIN_PASSWORD environment variable is required to create admin account!');
        console.error('❌ Set ADMIN_PASSWORD to a secure password before starting the application');
        process.exit(1);
      }

      await User.create({
        username: 'admin',
        password: process.env.ADMIN_PASSWORD,
        isAdmin: true,
        isSuperAdmin: true,
        isOwner: false,
        isLimitedAdmin: false,
        credits: 1000,
        whitelisted: true,
        isGuest: false,
        adminLevel: 'super',
        accountType: 'UID_MANAGER',
        allowGuestFreeUID: true,
        allowGuestFreeAimkill: false,
        guestPassMaxDuration: '1day'
      });
      console.log('✅ Admin user created (username: admin)');
    }
  } catch (error) {
    console.error('⚠️ Error creating admin:', error.message);
  }
}

async function initializeApiConfig() {
  try {
    let config = await ApiConfig.findOne({ configKey: 'main_config' });

    if (!config) {
      config = await ApiConfig.create({
        configKey: 'main_config',
        baseUrl: process.env.BASE_URL || '',
        apiKey: process.env.API_KEY || ''
      });
      console.log('✅ API configuration initialized in MongoDB');
    } else {
      console.log('✅ API configuration loaded from MongoDB');
    }

    // Update runtime environment from MongoDB
    if (config.baseUrl) process.env.BASE_URL = config.baseUrl;
    if (config.apiKey) process.env.API_KEY = config.apiKey;
    if (config.genzauthSellerKey) process.env.GENZAUTH_SELLER_KEY = config.genzauthSellerKey;

    return config;
  } catch (error) {
    console.error('⚠️ Error initializing API config:', error.message);
  }
}

async function getApiConfig() {
  try {
    let config = await ApiConfig.findOne({ configKey: 'main_config' });
    if (!config) {
      config = await initializeApiConfig();
    }
    return config;
  } catch (error) {
    console.error('Error getting API config:', error);
    return null;
  }
}

async function initializePackages() {
  try {
    let config = await PackageConfig.findOne({ configKey: 'main_packages' });

    if (!config) {
      config = await PackageConfig.create({
        configKey: 'main_packages'
      });
      console.log('✅ Package configuration initialized in MongoDB');
    } else {
      console.log('✅ Package configuration loaded from MongoDB');
    }

    return config;
  } catch (error) {
    console.error('⚠️ Error initializing package config:', error.message);
  }
}

async function initializeProducts() {
  try {
    const productCount = await Product.countDocuments({});

    if (productCount === 0) {
      // Create default products
      await Product.create([
        {
          productKey: 'UID_BYPASS',
          displayName: 'UID Bypass',
          description: 'Create and manage UID bypass accounts',
          isActive: true,
          createdBy: 'system',
          announcements: '',
          packages: new Map(Object.entries({
            '1day': { display: '1 Day', hours: 24, days: 1, credits: 1, price: 0.50 },
            '3days': { display: '3 Days', hours: 72, days: 3, credits: 3, price: 1.30, popular: true },
            '7days': { display: '7 Days', hours: 168, days: 7, credits: 5, price: 2.33 },
            '14days': { display: '14 Days', hours: 336, days: 14, credits: 10, price: 3.50 },
            '30days': { display: '30 Days', hours: 720, days: 30, credits: 15, price: 5.20 }
          }))
        },
        {
          productKey: 'AIMKILL',
          displayName: 'Aimkill',
          description: 'Create Aimkill user accounts',
          isActive: true,
          createdBy: 'system',
          announcements: '',
          packages: new Map(Object.entries({
            '1day': { display: '1 Day', days: 1, credits: 3, price: 2.99 },
            '3day': { display: '3 Days', days: 3, credits: 8, price: 7.99 },
            '7day': { display: '7 Days', days: 7, credits: 15, price: 14.99 },
            '15day': { display: '15 Days', days: 15, credits: 30, price: 29.99 },
            '30day': { display: '30 Days', days: 30, credits: 50, price: 49.99 },
            'lifetime': { display: 'Lifetime (1 Year)', days: 365, credits: 100, price: 99.99 }
          }))
        },
        {
          productKey: 'SILENT_AIM',
          displayName: 'Silent Aim',
          description: 'Silent Aim product for clients',
          isActive: true,
          createdBy: 'system',
          announcements: '',
          allowHwidReset: false,
          downloadLink: '',
          packages: new Map()
        }
      ]);
      console.log('✅ Default products initialized');
    } else {
      // Ensure SILENT_AIM product exists and has announcements field
      const silentAimExists = await Product.findOne({ productKey: 'SILENT_AIM' });
      if (!silentAimExists) {
        await Product.create({
          productKey: 'SILENT_AIM',
          displayName: 'Silent Aim',
          description: 'Silent Aim product for clients',
          isActive: true,
          createdBy: 'system',
          announcements: '',
          allowHwidReset: false,
          downloadLink: '',
          packages: new Map()
        });
        console.log('✅ SILENT_AIM product created');
      } else if (!silentAimExists.announcements) {
        // Add announcements field if missing
        silentAimExists.announcements = '';
        await silentAimExists.save();
        console.log('✅ SILENT_AIM product updated with announcements field');
      }
      console.log('✅ Products loaded from MongoDB');
    }
  } catch (error) {
    console.error('⚠️ Error initializing products:', error.message);
  }
}

async function getPackages() {
  try {
    let config = await PackageConfig.findOne({ configKey: 'main_packages' });
    if (!config) {
      config = await initializePackages();
    }

    // Convert Map to Object for easier use
    const uidPackages = {};
    const aimkillPackages = {};

    if (config.uidPackages) {
      config.uidPackages.forEach((value, key) => {
        uidPackages[key] = value;
      });
    }

    if (config.aimkillPackages) {
      config.aimkillPackages.forEach((value, key) => {
        aimkillPackages[key] = value;
      });
    }

    return { uid: uidPackages, aimkill: aimkillPackages };
  } catch (error) {
    console.error('Error getting packages:', error);
    return { uid: {}, aimkill: {} };
  }
}

async function migrateUsers() {
  try {
    const result = await User.updateMany(
      { isOwner: { $exists: false } },
      {
        $set: {
          isOwner: false,
          accountType: 'UID_MANAGER',
          allowGuestFreeUID: true,
          allowGuestFreeAimkill: false
        }
      }
    );
    if (result.modifiedCount > 0) {
      console.log(`✅ Migrated ${result.modifiedCount} users with Owner and AccountType fields`);
    }
  } catch (error) {
    console.error('⚠️ Migration error:', error.message);
  }
}

async function logActivity(username, type, description) {
  try {
    await Activity.create({ username, type, description });
    await Activity.cleanup();
  } catch (error) {
    console.error('Activity log error:', error.message);
  }
}

async function logLoginAttempt(username, success, ip = 'unknown') {
  try {
    await LoginHistory.create({ username, success, ip });
  } catch (error) {
    console.error('Login history error:', error.message);
  }
}

function calculateTimeLeft(expiresAt) {
  const now = new Date();
  const expires = new Date(expiresAt);
  const diff = expires - now;

  if (diff <= 0) return 'Expired';

  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  if (hours > 24) {
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
  }

  return `${hours}h ${minutes}m`;
}

function generateBackupCodes() {
  const codes = [];
  for (let i = 0; i < 10; i++) {
    const code = Math.random().toString(36).substring(2, 10).toUpperCase();
    codes.push(code);
  }
  return codes;
}

async function generateInvoiceNumber() {
  try {
    const lastInvoice = await Invoice.findOne().sort({ createdAt: -1 }).exec();

    let nextNumber = 1;
    if (lastInvoice && lastInvoice.invoiceNumber) {
      const lastNumberPart = lastInvoice.invoiceNumber.split('-').pop();
      nextNumber = parseInt(lastNumberPart) + 1;
    }

    const year = new Date().getFullYear();
    return `INV-${year}-${String(nextNumber).padStart(6, '0')}`;
  } catch (error) {
    console.error('Invoice number generation error:', error);
    const timestamp = Date.now();
    return `INV-${new Date().getFullYear()}-${String(timestamp).slice(-6)}`;
  }
}

// Legacy PACKAGES constant - now loaded from database
let PACKAGES = {
  '1day': { name: '1 Day', hours: 24, credits: 1, price: 0.50 },
  '3days': { name: '3 Days', hours: 72, credits: 3, price: 1.30, popular: true },
  '7days': { name: '7 Days', hours: 168, credits: 5, price: 2.33 },
  '14days': { name: '14 Days', hours: 336, credits: 10, price: 3.50 },
  '30days': { name: '30 Days', hours: 720, credits: 15, price: 5.20 }
};

function requireAuth(req, res, next) {
  if (req.session.user) {
    next();
  } else {
    res.redirect('/login');
  }
}

function requireAdmin(req, res, next) {
  if (req.session.user && (req.session.user.isAdmin || req.session.user.isSuperAdmin || req.session.user.isOwner)) {
    next();
  } else {
    res.status(403).json({ error: 'Admin access required' });
  }
}

function requireSuperAdminOnly(req, res, next) {
  if (req.session.user && req.session.user.isSuperAdmin) {
    next();
  } else {
    res.status(403).json({ error: 'Super Admin access required' });
  }
}

function requireMainSuperAdmin(req, res, next) {
  if (req.session.user && req.session.user.username === 'admin') {
    next();
  } else {
    res.status(403).json({ error: 'Only the main super admin can perform this action' });
  }
}

async function checkUserPaused(req, res, next) {
  if (req.session.user && !req.session.user.isAdmin && !req.session.user.isOwner) {
    try {
      const user = await User.findOne({ username: req.session.user.username });
      if (user && user.isPaused) {
        req.session.destroy();
        return res.status(403).json({
          error: 'Your account has been paused. Please contact administrator.'
        });
      }
    } catch (err) {
      console.error('Check pause error:', err);
    }
  }
  next();
}

async function require2FAForUID(req, res, next) {
  if (req.session.user && !req.session.user.isAdmin && !req.session.user.isOwner) {
    try {
      const user = await User.findOne({ username: req.session.user.username });

      if (user.isGuest) {
        return next();
      }

      if (!user.twoFactorEnabled) {
        return res.status(403).json({
          error: '2FA Required: Two-Factor Authentication must be enabled to create UIDs. Please enable it in Security settings.',
          requires2FA: true
        });
      }
    } catch (err) {
      console.error('2FA check error:', err);
    }
  }
  next();
}

async function checkGuestFreeUID(req, res, next) {
  if (req.session.user && req.session.user.isGuest) {
    try {
      const admin = await User.findOne({ username: 'admin' });
      if (admin && !admin.allowGuestFreeUID) {
        return res.status(403).json({
          error: 'Free UID creation is currently disabled by administrator'
        });
      }

      if (admin && admin.requireSocialVerification) {
        const user = await User.findOne({ username: req.session.user.username });
        if (!user.youtubeSubscribed || !user.instagramFollowed) {
          return res.status(403).json({
            error: 'Please subscribe to YouTube and follow on Instagram first',
            requiresSocial: true
          });
        }
      }
    } catch (error) {
      console.error('Error checking guest UID setting:', error);
    }
  }
  next();
}

async function checkGuestFreeAimkill(req, res, next) {
  if (req.session.user && req.session.user.isGuest) {
    try {
      const admin = await User.findOne({ username: 'admin' });
      if (admin && !admin.allowGuestFreeAimkill) {
        return res.status(403).json({
          error: 'Free Aimkill key creation is currently disabled by administrator'
        });
      }

      if (admin && admin.requireSocialVerification) {
        const user = await User.findOne({ username: req.session.user.username });
        if (!user.youtubeSubscribed || !user.instagramFollowed) {
          return res.status(403).json({
            error: 'Please subscribe to YouTube and follow on Instagram first',
            requiresSocial: true
          });
        }
      }
    } catch (error) {
      console.error('Error checking guest Aimkill setting:', error);
    }
  }
  next();
}

// [AUTHROUTES - Already in your file, keeping all of them]
app.get('/auth/discord', passport.authenticate('discord'));

app.get('/auth/discord/callback',
  passport.authenticate('discord', { failureRedirect: '/login' }),
  async (req, res) => {
    try {
      const ip = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;
      const user = await User.findById(req.user._id);

      if (!user.isGuest && !user.isAdmin && !user.isOwner && !user.networkFingerprint) {
        const fingerprint = generateNetworkFingerprint(req);
        user.networkFingerprint = fingerprint;
        user.fingerprintLockedAt = new Date();
        await user.save();
        console.log(`🔒 Network fingerprint locked for ${user.username}`);
      }

      req.session.user = {
        username: user.username,
        isAdmin: user.isAdmin,
        isSuperAdmin: user.isSuperAdmin,
        isOwner: user.isOwner,
        isGuest: user.isGuest,
        accountType: user.accountType
      };

      await logActivity(user.username, 'discord-auth', 'Authenticated via Discord OAuth');
      await logLoginAttempt(user.username, true, ip);
      await notifyLogin(user.username, ip, user.isAdmin || user.isOwner, true);

      res.redirect('/dashboard');
    } catch (error) {
      console.error('Discord callback error:', error);
      res.redirect('/login?error=discord_auth_failed');
    }
  }
);

app.get('/', (req, res) => {
  if (req.session.user) {
    res.redirect('/dashboard');
  } else {
    res.redirect('/login');
  }
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'login.html'));
});

app.get('/register', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'register.html'));
});

app.get('/dashboard', requireAuth, async (req, res) => {
  try {
    const user = await User.findOne({ username: req.session.user.username });
    if (user && user.isGuest) {
      return res.sendFile(path.join(__dirname, 'views', 'guest-dashboard.html'));
    }
    res.sendFile(path.join(__dirname, 'views', 'dashboard.html'));
  } catch (error) {
    res.sendFile(path.join(__dirname, 'views', 'dashboard.html'));
  }
});

app.get('/packages', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'packages.html'));
});

app.get('/admin', requireAuth, requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'admin.html'));
});

app.get('/settings', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'settings.html'));
});

app.get('/security', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'security.html'));
});

app.get('/invoices', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'invoices.html'));
});

app.get('/aimkill-packages', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'aimkill-packages.html'));
});

app.get('/chat', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'chat.html'));
});

app.post('/api/register', async (req, res) => {
  const { username, password, isGuest } = req.body;
  const ip = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  try {
    const existingUser = await User.findOne({ username: username.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({ error: 'Username already taken' });
    }

    const guestStatus = isGuest === true || isGuest === 'true';

    await User.create({
      username: username.toLowerCase(),
      password: password,
      isAdmin: false,
      isSuperAdmin: false,
      isOwner: false,
      isLimitedAdmin: false,
      adminLevel: 'none',
      credits: guestStatus ? 0 : 10,
      isGuest: guestStatus,
      guestPassUsed: false,
      whitelisted: true,
      accountType: 'UID_MANAGER'
    });

    await logActivity(username, 'registration', guestStatus ? 'New guest account created' : 'New account created');
    await logLoginAttempt(username, true, ip);
    await notifyAdminAction(username, guestStatus ? 'New Registration' : 'New Registration', username);

    res.json({
      success: true,
      message: guestStatus ? 'Guest account created successfully!' : 'Account created successfully',
      isGuest: guestStatus
    });
  } catch (error) {
    console.error('Registration error:', error.message);
    res.status(500).json({ error: 'Registration failed: ' + error.message });
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password, token } = req.body;
  const ip = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;

  try {
    const user = await User.findOne({ username: username.toLowerCase() });

    if (!user) {
      await logLoginAttempt(username, false, ip);
      await notifyLogin(username, ip, false, false);
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    if (user.password !== password) {
      user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;
      user.lastFailedLogin = new Date();
      await user.save();
      await logLoginAttempt(username, false, ip);
      await notifyLogin(username, ip, false, false);
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    if (user.isPaused && !user.isAdmin && !user.isOwner) {
      await logLoginAttempt(username, false, ip);
      await notifyLogin(username, ip, user.isAdmin || user.isOwner, false);
      return res.status(403).json({ error: 'Your account has been paused. Please contact administrator.' });
    }

    if (user.accountLocked && !user.isAdmin && !user.isOwner) {
      await logLoginAttempt(username, false, ip);
      return res.status(403).json({ error: `Account locked: ${user.lockReason || 'Security reasons'}` });
    }

    if (!user.isAdmin && !user.isGuest && !user.isOwner && !user.networkFingerprint) {
      const fingerprint = generateNetworkFingerprint(req);
      user.networkFingerprint = fingerprint;
      user.fingerprintLockedAt = new Date();
      await user.save();
      console.log(`🔒 Network fingerprint locked for ${username}`);
    }

    if (!user.isAdmin && !user.isGuest && !user.isOwner && user.networkFingerprint) {
      const currentFingerprint = generateNetworkFingerprint(req);
      if (user.networkFingerprint !== currentFingerprint) {
        await logLoginAttempt(username, false, ip);
        await logActivity(username, 'security', `Login attempt from different device/browser - fingerprint mismatch`);
        await notifyLogin(username, ip, false, false);
        return res.status(403).json({
          error: 'Device/Browser lock detected. Your account is locked to a different device or browser. This can happen after browser updates. Contact admin to reset your device lock.',
          networkLocked: true
        });
      }
    }

    if (user.twoFactorEnabled && !user.isGuest) {
      if (!token) {
        return res.status(200).json({
          requires2FA: true,
          message: 'Please enter your 2FA code'
        });
      }

      const verified = speakeasy.totp.verify({
        secret: user.twoFactorSecret,
        encoding: 'base32',
        token: token,
        window: 2
      });

      let usedBackupCode = false;
      if (!verified && user.backupCodes && user.backupCodes.includes(token)) {
        user.backupCodes = user.backupCodes.filter(code => code !== token);
        await user.save();
        usedBackupCode = true;
      } else if (!verified) {
        await logLoginAttempt(username, false, ip);
        await notifyLogin(username, ip, user.isAdmin || user.isOwner, false);
        return res.status(401).json({ error: 'Invalid 2FA code' });
      }

      if (usedBackupCode) {
        await logActivity(username, 'security', 'Used backup code for login');
      }
    }

    user.failedLoginAttempts = 0;
    user.lastLoginAt = new Date();
    user.lastLoginIP = ip;
    await user.save();

    await logLoginAttempt(username, true, ip);
    await logActivity(username, 'login', `Logged in successfully from IP: ${ip}`);
    await notifyLogin(username, ip, user.isAdmin || user.isOwner, true);

    req.session.user = {
      username: user.username,
      isAdmin: user.isAdmin,
      isSuperAdmin: user.isSuperAdmin,
      isOwner: user.isOwner,
      isGuest: user.isGuest,
      accountType: user.accountType
    };

    req.session.save((err) => {
      if (err) {
        console.error('Session save error:', err);
        return res.status(500).json({ error: 'Session error' });
      }
      res.json({
        success: true,
        username: user.username,
        isAdmin: user.isAdmin,
        isSuperAdmin: user.isSuperAdmin,
        isOwner: user.isOwner,
        isGuest: user.isGuest,
        accountType: user.accountType
      });
    });
  } catch (error) {
    console.error('Login error:', error.message);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/api/user', requireAuth, async (req, res) => {
  try {
    const user = await User.findOne({ username: req.session.user.username });
    res.json({
      username: user.username,
      isAdmin: user.isAdmin,
      isSuperAdmin: user.isSuperAdmin,
      isOwner: user.isOwner,
      isGuest: user.isGuest,
      credits: user.credits,
      discordVerified: user.discordVerified,
      youtubeSubscribed: user.youtubeSubscribed,
      instagramFollowed: user.instagramFollowed,
      guestPassUsed: user.guestPassUsed,
      guestPassType: user.guestPassType,
      twoFactorEnabled: user.twoFactorEnabled,
      adminLevel: user.adminLevel,
      accountType: user.accountType
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// [2FAROUTES - All included]
app.post('/api/2fa/setup', requireAuth, async (req, res) => {
  try {
    const user = await User.findOne({ username: req.session.user.username });

    if (user.twoFactorEnabled) {
      return res.status(400).json({ error: '2FA is already enabled' });
    }

    const secret = speakeasy.generateSecret({
      name: `UID Manager (${user.username})`,
      length: 32
    });

    const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);

    user.twoFactorSecret = secret.base32;
    await user.save();

    res.json({
      success: true,
      secret: secret.base32,
      qrCode: qrCodeUrl
    });
  } catch (error) {
    console.error('2FA setup error:', error.message);
    res.status(500).json({ error: 'Failed to setup 2FA' });
  }
});

app.post('/api/2fa/verify', requireAuth, async (req, res) => {
  const { token } = req.body;

  try {
    const user = await User.findOne({ username: req.session.user.username });

    if (!user.twoFactorSecret) {
      return res.status(400).json({ error: 'Please setup 2FA first' });
    }

    const verified = speakeasy.totp.verify({
      secret: user.twoFactorSecret,
      encoding: 'base32',
      token: token,
      window: 2
    });

    if (!verified) {
      return res.status(400).json({ error: 'Invalid verification code' });
    }

    const backupCodes = generateBackupCodes();

    user.twoFactorEnabled = true;
    user.backupCodes = backupCodes;
    user.twoFactorEnabledAt = new Date();
    await user.save();

    await logActivity(user.username, 'security', 'Enabled two-factor authentication');
    await notifyAdminAction(user.username, 'Enabled 2FA', 'Security');

    res.json({
      success: true,
      message: '2FA enabled successfully',
      backupCodes: backupCodes
    });
  } catch (error) {
    console.error('2FA verify error:', error.message);
    res.status(500).json({ error: 'Failed to enable 2FA' });
  }
});

app.post('/api/2fa/disable', requireAuth, async (req, res) => {
  const { password, token } = req.body;

  try {
    const user = await User.findOne({ username: req.session.user.username });

    if (!user.twoFactorEnabled) {
      return res.status(400).json({ error: '2FA is not enabled' });
    }

    if (user.password !== password) {
      return res.status(401).json({ error: 'Incorrect password' });
    }

    const verified = speakeasy.totp.verify({
      secret: user.twoFactorSecret,
      encoding: 'base32',
      token: token,
      window: 2
    });

    if (!verified) {
      return res.status(400).json({ error: 'Invalid 2FA code' });
    }

    user.twoFactorEnabled = false;
    user.twoFactorSecret = null;
    user.backupCodes = [];
    await user.save();

    await logActivity(user.username, 'security', 'Disabled two-factor authentication');
    await notifyAdminAction(user.username, 'Disabled 2FA', 'Security');

    res.json({
      success: true,
      message: '2FA disabled successfully'
    });
  } catch (error) {
    console.error('2FA disable error:', error.message);
    res.status(500).json({ error: 'Failed to disable 2FA' });
  }
});

app.get('/api/2fa/status', requireAuth, async (req, res) => {
  try {
    const user = await User.findOne({ username: req.session.user.username });

    res.json({
      enabled: user.twoFactorEnabled,
      hasBackupCodes: user.backupCodes && user.backupCodes.length > 0
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get 2FA status' });
  }
});

app.get('/api/packages', requireAuth, async (req, res) => {
  try {
    const user = await User.findOne({ username: req.session.user.username });
    const packages = await getPackages();
    const uidPackages = packages.uid;

    if (user.isGuest) {
      // Get admin-configured max duration
      const adminUser = await User.findOne({ username: 'admin' });
      const maxDuration = adminUser?.guestPassMaxDuration || '1day';

      // Filter packages based on max allowed duration
      const allowedDurations = ['1day', '3days', '7days', '15days', '30days'];
      const maxDurationIndex = allowedDurations.indexOf(maxDuration);

      const guestPackages = {};
      allowedDurations.slice(0, maxDurationIndex + 1).forEach(duration => {
        if (uidPackages[duration]) {
          guestPackages[duration] = uidPackages[duration];
        }
      });

      return res.json(guestPackages);
    }

    res.json(uidPackages);
  } catch (error) {
    console.error('Error fetching packages:', error);
    res.json(PACKAGES);
  }
});

app.get('/api/aimkill-packages', requireAuth, async (req, res) => {
  try {
    const user = await User.findOne({ username: req.session.user.username });
    const packages = await getPackages();
    const aimkillPackages = packages.aimkill;

    if (user.isGuest) {
      // Get admin-configured max duration
      const adminUser = await User.findOne({ username: 'admin' });
      const maxDuration = adminUser?.guestPassMaxDuration || '1day';

      // Convert maxDuration to match Aimkill package keys (e.g., '3days' -> '3day')
      const maxDurationKey = maxDuration.replace('days', 'day');

      // Get max duration in days for comparison
      const maxDurationPackage = aimkillPackages[maxDurationKey];

      let maxDays;
      if (!maxDurationPackage) {
        console.error(`Guest max duration '${maxDuration}' not found in Aimkill packages. Computing max days from configured value.`);

        // Parse duration string to extract numeric days (supports formats like "1day", "3days", "10days", etc.)
        const match = maxDuration.match(/^(\d+)days?$/);
        if (!match) {
          console.error(`Invalid guestPassMaxDuration format: ${maxDuration}`);
          return res.status(400).json({
            error: 'Guest pass configuration error. Please contact administrator to fix the duration settings.'
          });
        }

        maxDays = parseInt(match[1], 10);
      } else {
        maxDays = maxDurationPackage.days;
      }

      // Validate maxDays is a finite number
      if (typeof maxDays !== 'number' || !isFinite(maxDays) || maxDays <= 0) {
        console.error(`Invalid maxDays computed: ${maxDays}`);
        return res.status(400).json({
          error: 'Guest pass configuration error. Please contact administrator to fix the duration settings.'
        });
      }

      // Filter packages based on max allowed days (only include packages with valid numeric days)
      const guestPackages = {};
      Object.keys(aimkillPackages).forEach(packageKey => {
        const pkg = aimkillPackages[packageKey];
        if (pkg && typeof pkg.days === 'number' && isFinite(pkg.days) && pkg.days > 0 && pkg.days <= maxDays) {
          guestPackages[packageKey] = pkg;
        }
      });

      // Ensure we're not returning empty packages
      if (Object.keys(guestPackages).length === 0) {
        console.error('No Aimkill packages qualify for guest max duration');
        return res.status(400).json({
          error: 'No Aimkill packages are currently available for guest users. Please contact administrator.'
        });
      }

      return res.json(guestPackages);
    }

    res.json(aimkillPackages);
  } catch (error) {
    console.error('Error fetching Aimkill packages:', error);
    res.status(500).json({ error: 'Failed to fetch packages' });
  }
});

app.post('/api/create-uid', requireAuth, checkGuestFreeUID, checkUserPaused, require2FAForUID, async (req, res) => {
  const { uid, packageId } = req.body;
  const username = req.session.user.username;

  const packages = await getPackages();
  const selectedPackage = packages.uid[packageId];
  if (!selectedPackage) {
    return res.status(400).json({ error: 'Invalid package' });
  }

  try {
    const user = await User.findOne({ username });

    if (user.isGuest) {
      if (!user.discordVerified) {
        return res.status(403).json({
          error: 'Discord verification required. Please authorize with Discord to create UIDs.',
          requiresDiscord: true,
          discordAuthUrl: '/auth/discord'
        });
      }

      if (user.guestPassUsed) {
        return res.status(403).json({
          error: 'Guest pass already used. Contact admin to upgrade your account for more UIDs.',
          guestPassUsed: true
        });
      }

      // Get admin-configured max duration
      const adminUser = await User.findOne({ username: 'admin' });
      const maxDuration = adminUser?.guestPassMaxDuration || '1day';

      // Validate guest is using allowed duration
      const allowedDurations = ['1day', '3days', '7days', '15days', '30days'];
      const maxDurationIndex = allowedDurations.indexOf(maxDuration);
      const requestedDurationIndex = allowedDurations.indexOf(packageId);

      if (requestedDurationIndex === -1 || requestedDurationIndex > maxDurationIndex) {
        return res.status(403).json({
          error: `Guests can only use up to ${maxDuration.replace('days', ' Days').replace('day', ' Day')}.`,
          guestOnly: true,
          maxAllowedDuration: maxDuration
        });
      }

      console.log(`✅ Guest user ${username} using free pass`);
    } else {
      if (user.credits < selectedPackage.credits) {
        return res.status(400).json({
          error: 'Insufficient credits',
          required: selectedPackage.credits,
          current: user.credits
        });
      }
    }

    const existingUID = await UID.findOne({ uid });
    if (existingUID) {
      return res.status(400).json({ error: 'UID already exists' });
    }

    const apiUrl = `${process.env.BASE_URL}?api=${process.env.API_KEY}&action=create&uid=${uid}&duration=${selectedPackage.hours}`;
    await axios.post(apiUrl, {}, { timeout: 10000 });

    if (user.isGuest) {
      user.guestPassUsed = true;
      user.guestPassType = packageId;
      user.guestPassExpiresAt = new Date(Date.now() + selectedPackage.hours * 60 * 60 * 1000);
      await user.save();
    } else {
      user.credits -= selectedPackage.credits;
      await user.save();
    }

    const expiresAt = new Date(Date.now() + selectedPackage.hours * 60 * 60 * 1000);
    await UID.create({
      uid,
      duration: selectedPackage.hours,
      createdBy: username,
      expiresAt,
      status: 'active'
    });

    if (!user.isGuest) {
      const creditValue = 10;
      const subtotal = selectedPackage.credits * creditValue;
      const tax = subtotal * 0.18;
      const total = subtotal + tax;

      await Invoice.create({
        invoiceNumber: await generateInvoiceNumber(),
        username,
        type: 'uid_creation',
        amount: subtotal,
        credits: selectedPackage.credits,
        packageName: selectedPackage.name,
        uid,
        subtotal,
        tax,
        taxRate: 18,
        total,
        status: 'paid',
        paymentMethod: 'credit_deduction',
        notes: `UID created with ${selectedPackage.name} package`
      });
    }

    await logActivity(username, 'uid-create', user.isGuest ? `Guest used free pass: ${uid}` : `Created UID ${uid} with ${selectedPackage.name} package`);
    await notifyUIDCreated(username, uid, selectedPackage.name, user.isGuest ? 0 : selectedPackage.credits);

    res.json({
      success: true,
      uid,
      package: selectedPackage.name,
      creditsUsed: user.isGuest ? 0 : selectedPackage.credits,
      creditsRemaining: user.credits,
      isGuest: user.isGuest,
      guestPassUsed: user.guestPassUsed
    });
  } catch (error) {
    console.error('UID creation error:', error.message);
    res.status(500).json({ error: error.response?.data?.message || 'Failed to create UID' });
  }
});

app.post('/api/delete-uid', requireAuth, checkUserPaused, async (req, res) => {
  const { uid } = req.body;
  const username = req.session.user.username;
  const isAdmin = req.session.user.isAdmin || req.session.user.isOwner;

  if (!uid) {
    return res.status(400).json({ error: 'UID is required' });
  }

  try {
    const user = await User.findOne({ username });

    if (user.isGuest && !isAdmin) {
      return res.status(403).json({
        error: 'Guest users cannot delete UIDs. Contact admin for assistance.',
        isGuest: true
      });
    }

    if (!isAdmin && !user.twoFactorEnabled) {
      return res.status(403).json({
        error: '2FA Required: Two-Factor Authentication must be enabled to delete UIDs.',
        requires2FA: true
      });
    }

    const uidRecord = await UID.findOne({ uid });
    if (!uidRecord) {
      return res.status(404).json({ error: 'UID not found' });
    }

    if (!isAdmin && uidRecord.createdBy !== username) {
      return res.status(403).json({
        error: 'You can only delete UIDs that you created.',
        ownership: false
      });
    }

    const apiUrl = `${process.env.BASE_URL}?api=${process.env.API_KEY}&action=delete&uid=${uid}`;
    await axios.post(apiUrl, {}, { timeout: 10000 });

    await UID.deleteOne({ uid });
    await logActivity(username, 'uid-delete', `Deleted UID ${uid}`);
    await notifyUIDDeleted(username, uid);

    res.json({
      success: true,
      message: `UID ${uid} deleted successfully`
    });
  } catch (error) {
    console.error('UID deletion error:', error.message);
    res.status(500).json({
      error: error.response?.data?.message || 'Failed to delete UID'
    });
  }
});

app.get('/api/admin/uids', requireAuth, requireAdmin, async (req, res) => {
  try {
    const uids = await UID.find().sort({ createdAt: -1 });

    const uidsWithStatus = uids.map(uid => {
      const uidObj = uid.toObject();
      uidObj.status = uid.updateStatus();
      uidObj.timeLeft = calculateTimeLeft(uid.expiresAt);
      return uidObj;
    });

    await logActivity(req.session.user.username, 'uid-list', 'Viewed UID list');

    res.json({
      success: true,
      uids: uidsWithStatus
    });
  } catch (error) {
    console.error('UID list error:', error.message);
    res.json({
      success: false,
      error: 'Failed to fetch UID list',
      uids: []
    });
  }
});

app.get('/api/admin/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const currentUser = await User.findOne({ username: req.session.user.username });

    let users;
    if (currentUser.isOwner && !currentUser.isSuperAdmin) {
      users = await User.find({
        isAdmin: false,
        isSuperAdmin: false,
        isOwner: false,
        isLimitedAdmin: false
      })
        .select('username credits isPaused whitelistedIP isGuest discordVerified guestPassUsed networkFingerprint accountType')
        .sort({ createdAt: -1 });
    } else {
      users = await User.find()
        .select('username credits isPaused whitelistedIP isGuest discordVerified guestPassUsed networkFingerprint isAdmin isSuperAdmin isOwner adminLevel accountType')
        .sort({ createdAt: -1 });
    }

    res.json(users);
  } catch (error) {
    console.error('Get users error:', error.message);
    res.status(500).json([]);
  }
});

app.post('/api/admin/give-credits', requireAuth, requireAdmin, async (req, res) => {
  const { username, amount } = req.body;

  try {
    const user = await User.findOne({ username: username.toLowerCase() });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    user.credits += amount;
    await user.save();

    const subtotal = amount * 10;
    const tax = subtotal * 0.18;
    const total = subtotal + tax;

    const invoice = await Invoice.create({
      invoiceNumber: await generateInvoiceNumber(),
      username: user.username,
      type: 'credit_purchase',
      amount: subtotal,
      credits: amount,
      subtotal,
      tax,
      taxRate: 18,
      total,
      status: 'paid',
      paymentMethod: 'admin_credit',
      notes: `Credits added by administrator`
    });

    await logActivity(req.session.user.username, 'credit', `Gave ${amount} credits to ${username} - Invoice: ${invoice.invoiceNumber}`);
    await notifyCreditAdded(req.session.user.username, username, amount, user.credits);

    res.json({
      success: true,
      newBalance: user.credits,
      invoiceNumber: invoice.invoiceNumber
    });
  } catch (error) {
    console.error('Give credits error:', error);
    res.status(500).json({ error: 'Failed to add credits' });
  }
});

app.post('/api/admin/create-account', requireAuth, requireAdmin, async (req, res) => {
  const { username, password, isAdmin, isOwner, isGuest, accountType, credits } = req.body;

  console.log('📝 Creating account:', { username, isAdmin, isOwner, isGuest, accountType, credits });

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  try {
    const existingUser = await User.findOne({ username: username.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }

    const currentUser = await User.findOne({ username: req.session.user.username });
    const guestStatus = isGuest === true || isGuest === 'true';
    const ownerStatus = isOwner === true || isOwner === 'true';
    const adminStatus = isAdmin === true || isAdmin === 'true';

    // Only main super admin (username: admin) can create admin or owner accounts
    if ((ownerStatus || adminStatus) && req.session.user.username !== 'admin') {
      return res.status(403).json({
        error: 'Only the main super admin can create admin or owner accounts'
      });
    }

    const acctType = accountType && (accountType === 'AIMKILL' || accountType === 'UID_MANAGER')
      ? accountType
      : 'UID_MANAGER';

    const initialCredits = parseInt(credits) || (acctType === 'AIMKILL' ? 50 : 10);

    console.log('✅ Account Type Set:', acctType, 'Credits:', initialCredits);

    let newUserData = {
      username: username.toLowerCase(),
      password,
      isGuest: guestStatus,
      credits: initialCredits,
      whitelisted: true,
      accountType: acctType
    };

    // Determine role based on checkboxes
    if (ownerStatus) {
      // Creating an Owner account
      newUserData.isAdmin = false;
      newUserData.isSuperAdmin = false;
      newUserData.isOwner = true;
      newUserData.isLimitedAdmin = false;
      newUserData.adminLevel = 'owner';
      newUserData.credits = 5000;
    } else if (adminStatus) {
      // Creating an Admin account
      newUserData.isAdmin = true;
      newUserData.isSuperAdmin = true;
      newUserData.isOwner = false;
      newUserData.isLimitedAdmin = false;
      newUserData.adminLevel = 'super';
      newUserData.credits = 1000;
    } else {
      // Creating a regular user
      newUserData.isAdmin = false;
      newUserData.isSuperAdmin = false;
      newUserData.isOwner = false;
      newUserData.isLimitedAdmin = false;
      newUserData.adminLevel = 'none';
    }

    const newUser = await User.create(newUserData);

    console.log('✅ User created:', newUser.username, 'Role:', newUser.adminLevel, 'Account Type:', newUser.accountType);

    const roleText = guestStatus ? 'Guest' : (ownerStatus ? 'Owner' : (adminStatus ? 'Admin' : 'Regular'));
    const acctTypeText = acctType === 'AIMKILL' ? 'Aimkill' : 'UID Manager';

    await logActivity(req.session.user.username, 'admin', `Created account for ${username} (${roleText} - ${acctTypeText})`);
    await notifyAdminAction(req.session.user.username, 'Created Account', `${username} (${roleText} - ${acctTypeText})`);

    res.json({
      success: true,
      message: `${acctTypeText} account ${username} created successfully with ${newUserData.credits} credits`,
      accountType: acctType,
      credits: newUserData.credits,
      username: newUser.username,
      role: roleText
    });
  } catch (error) {
    console.error('❌ Create account error:', error.message);
    res.status(500).json({ error: 'Failed to create account: ' + error.message });
  }
});

app.post('/api/admin/create-owner', requireAuth, requireSuperAdminOnly, async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  try {
    const existingUser = await User.findOne({ username: username.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }

    await User.create({
      username: username.toLowerCase(),
      password,
      isAdmin: false,
      isSuperAdmin: false,
      isOwner: true,
      isLimitedAdmin: false,
      adminLevel: 'owner',
      isGuest: false,
      credits: 5000,
      whitelisted: true,
      accountType: 'UID_MANAGER'
    });

    await logActivity(req.session.user.username, 'admin', `Created Owner account: ${username}`);
    await notifyAdminAction(req.session.user.username, 'Created Owner Account', username);

    res.json({ success: true, message: `Owner "${username}" created successfully` });
  } catch (error) {
    console.error('Create owner error:', error.message);
    res.status(500).json({ error: 'Failed to create owner: ' + error.message });
  }
});

app.post('/api/admin/pause-user', requireAuth, requireAdmin, async (req, res) => {
  const { username } = req.body;

  try {
    const user = await User.findOne({ username: username.toLowerCase() });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Prevent pausing the main super admin account
    if (username.toLowerCase() === 'admin') {
      return res.status(400).json({ error: 'Cannot pause the main super admin account' });
    }

    // Only main super admin can pause admin/owner accounts
    if (user.isAdmin || user.isOwner) {
      if (req.session.user.username !== 'admin') {
        return res.status(403).json({
          error: 'Only the main super admin can pause admin or owner accounts'
        });
      }
    }

    user.isPaused = !user.isPaused;
    user.pausedAt = user.isPaused ? new Date() : null;
    await user.save();

    const action = user.isPaused ? 'Paused User' : 'Resumed User';
    await logActivity(req.session.user.username, 'admin', `${action} ${username}`);
    await notifyAdminAction(req.session.user.username, action, username);

    res.json({
      success: true,
      isPaused: user.isPaused,
      message: `User ${username} ${user.isPaused ? 'paused' : 'resumed'} successfully`
    });
  } catch (error) {
    console.error('Pause user error:', error.message);
    res.status(500).json({ error: 'Failed to update user status' });
  }
});

app.post('/api/admin/delete-user', requireAuth, requireAdmin, async (req, res) => {
  const { username } = req.body;

  try {
    const user = await User.findOne({ username: username.toLowerCase() });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Prevent deleting the main super admin account
    if (username.toLowerCase() === 'admin') {
      return res.status(400).json({ error: 'Cannot delete the main super admin account' });
    }

    // Only main super admin (username: admin) can delete admin/owner accounts
    if (user.isAdmin || user.isOwner || user.isSuperAdmin) {
      if (req.session.user.username !== 'admin') {
        return res.status(403).json({
          error: 'Only the main super admin can delete admin or owner accounts'
        });
      }
    }

    await UID.deleteMany({ createdBy: username.toLowerCase() });
    await Activity.deleteMany({ username: username.toLowerCase() });
    await LoginHistory.deleteMany({ username: username.toLowerCase() });
    await Invoice.deleteMany({ username: username.toLowerCase() });
    await User.deleteOne({ username: username.toLowerCase() });

    await logActivity(req.session.user.username, 'admin', `Deleted user ${username} and all associated data`);
    await notifyAdminAction(req.session.user.username, 'Deleted User', username);

    res.json({
      success: true,
      message: `User ${username} deleted successfully`
    });
  } catch (error) {
    console.error('Delete user error:', error.message);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

app.post('/api/admin/delete-guest-bulk', requireAuth, requireAdmin, async (req, res) => {
  const { username } = req.body;

  try {
    const user = await User.findOne({ username: username.toLowerCase() });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!user.isGuest) {
      return res.status(400).json({ error: 'This user is not a guest. Use regular delete function.' });
    }

    const uidCount = await UID.countDocuments({ createdBy: username.toLowerCase() });
    const uids = await UID.find({ createdBy: username.toLowerCase() });

    for (const uidDoc of uids) {
      try {
        const apiUrl = `${process.env.BASE_URL}?api=${process.env.API_KEY}&action=delete&uid=${uidDoc.uid}`;
        await axios.post(apiUrl, {}, { timeout: 10000 });
        console.log(`✅ Deleted UID ${uidDoc.uid} from API`);
      } catch (error) {
        console.error(`⚠️ Failed to delete UID ${uidDoc.uid} from API:`, error.message);
      }
    }

    await UID.deleteMany({ createdBy: username.toLowerCase() });
    await Activity.deleteMany({ username: username.toLowerCase() });
    await LoginHistory.deleteMany({ username: username.toLowerCase() });
    await Invoice.deleteMany({ username: username.toLowerCase() });
    await User.deleteOne({ username: username.toLowerCase() });

    await logActivity(
      req.session.user.username,
      'admin',
      `Bulk deleted guest ${username} and ${uidCount} UIDs`
    );

    await notifyAdminAction(
      req.session.user.username,
      'Bulk Delete Guest',
      `${username} (${uidCount} UIDs deleted)`
    );

    res.json({
      success: true,
      message: `Guest ${username} and ${uidCount} UIDs deleted successfully`,
      uidsDeleted: uidCount
    });
  } catch (error) {
    console.error('Bulk delete error:', error.message);
    res.status(500).json({ error: 'Failed to bulk delete guest' });
  }
});

app.post('/api/admin/upgrade-guest', requireAuth, requireAdmin, async (req, res) => {
  const { username, credits } = req.body;

  try {
    const user = await User.findOne({ username: username.toLowerCase() });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!user.isGuest) {
      return res.status(400).json({ error: 'User is not a guest' });
    }

    user.upgradeToRegular(credits || 10);
    await user.save();

    await logActivity(req.session.user.username, 'admin', `Upgraded guest ${username} to regular user with ${credits} credits`);
    await notifyAdminAction(req.session.user.username, 'Upgraded Guest', `${username} → Regular User`);

    res.json({
      success: true,
      message: `${username} upgraded to regular user successfully`,
      credits: user.credits
    });
  } catch (error) {
    console.error('Upgrade guest error:', error);
    res.status(500).json({ error: 'Failed to upgrade guest' });
  }
});

app.get('/api/admin/guests', requireAuth, requireAdmin, async (req, res) => {
  try {
    const guests = await User.find({ isGuest: true })
      .select('username discordVerified guestPassUsed guestPassType createdAt')
      .sort({ createdAt: -1 });

    res.json(guests);
  } catch (error) {
    console.error('Get guests error:', error);
    res.status(500).json({ error: 'Failed to fetch guests' });
  }
});

app.get('/api/admin/ips', requireAuth, requireAdmin, async (req, res) => {
  try {
    const currentUser = await User.findOne({ username: req.session.user.username });

    let users;
    if (currentUser.isOwner && !currentUser.isSuperAdmin) {
      users = await User.find({
        isAdmin: false,
        isSuperAdmin: false,
        isOwner: false,
        isLimitedAdmin: false
      })
        .select('username whitelistedIP ipSetAt isPaused networkFingerprint fingerprintLockedAt')
        .sort({ createdAt: -1 });
    } else {
      users = await User.find()
        .select('username whitelistedIP ipSetAt isPaused networkFingerprint fingerprintLockedAt')
        .sort({ createdAt: -1 });
    }

    console.log(`✅ Fetched ${users.length} users with IPs`);
    res.json(users);
  } catch (error) {
    console.error('Get user IPs error:', error.message);
    res.status(500).json({ error: 'Failed to fetch user IPs' });
  }
});

app.post('/api/admin/reset-ip', requireAuth, requireAdmin, async (req, res) => {
  const { username } = req.body;

  try {
    const user = await User.findOne({ username: username.toLowerCase() });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.isAdmin || user.isOwner) {
      return res.status(400).json({ error: 'Cannot reset admin or owner IP' });
    }

    const oldIP = user.whitelistedIP;
    user.whitelistedIP = null;
    user.ipSetAt = null;
    await user.save();

    await logActivity(req.session.user.username, 'admin', `Reset IP whitelist for ${username} (was: ${oldIP})`);
    await notifyAdminAction(req.session.user.username, 'Reset IP', `${username} (${oldIP})`);

    res.json({
      success: true,
      message: `IP whitelist reset for ${username}. They can login from any IP on their next login.`,
      oldIP: oldIP
    });
  } catch (error) {
    console.error('Reset IP error:', error.message);
    res.status(500).json({ error: 'Failed to reset IP' });
  }
});

app.post('/api/admin/reset-network', requireAuth, requireAdmin, async (req, res) => {
  const { username } = req.body;

  try {
    const user = await User.findOne({ username: username.toLowerCase() });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.isAdmin || user.isOwner) {
      return res.status(400).json({ error: 'Cannot reset admin or owner network' });
    }

    user.resetNetworkFingerprint();
    await user.save();

    await logActivity(req.session.user.username, 'admin', `Reset network fingerprint for ${username}`);
    await notifyAdminAction(req.session.user.username, 'Reset Network Lock', username);

    res.json({
      success: true,
      message: `Network fingerprint reset for ${username}. They can login from any network on their next login.`
    });
  } catch (error) {
    console.error('Reset network error:', error);
    res.status(500).json({ error: 'Failed to reset network fingerprint' });
  }
});

app.post('/api/admin/restore-members', requireAuth, requireMainSuperAdmin, async (req, res) => {
  const { newGuildId, botToken } = req.body;

  if (!newGuildId || !botToken) {
    return res.status(400).json({ error: 'Guild ID and Bot Token required' });
  }

  try {
    const results = await restoreAllMembers(newGuildId, botToken);

    await logActivity(
      req.session.user.username,
      'admin',
      `Restored ${results.success} members to new server ${newGuildId}`
    );

    res.json({
      success: true,
      message: `Restoration complete: ${results.success}/${results.total} members added`,
      stats: results
    });
  } catch (error) {
    console.error('Restoration error:', error);
    res.status(500).json({ error: 'Failed to restore members' });
  }
});

app.post('/api/admin/add-to-guild', requireAuth, requireMainSuperAdmin, async (req, res) => {
  const { username, guildId, botToken } = req.body;

  try {
    const user = await User.findOne({ username: username.toLowerCase() });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const result = await addUserToGuild(user.discordId, guildId, botToken);

    if (result.success) {
      res.json({ success: true, message: `Added ${username} to server` });
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to add user to guild' });
  }
});

app.get('/api/admin/restoration-stats', requireAuth, requireMainSuperAdmin, async (req, res) => {
  try {
    const stats = await getRestorationStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

app.get('/api/invoices', requireAuth, async (req, res) => {
  try {
    const username = req.session.user.username;
    const isAdmin = req.session.user.isAdmin || req.session.user.isOwner;

    let query = {};
    if (!isAdmin) {
      query = { username };
    }

    const invoices = await Invoice.find(query)
      .sort({ createdAt: -1 })
      .limit(50);

    res.json(invoices);
  } catch (error) {
    console.error('Get invoices error:', error);
    res.status(500).json({ error: 'Failed to fetch invoices' });
  }
});

app.get('/api/invoice/:invoiceNumber/pdf', requireAuth, async (req, res) => {
  try {
    const { invoiceNumber } = req.params;
    const username = req.session.user.username;
    const isAdmin = req.session.user.isAdmin || req.session.user.isOwner;

    const invoice = await Invoice.findOne({ invoiceNumber });

    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    if (!isAdmin && invoice.username !== username) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const doc = new PDFDocument({ margin: 50 });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=Invoice-${invoiceNumber}.pdf`);

    doc.pipe(res);

    doc.fontSize(20).text('UID MANAGER', 50, 50);
    doc.fontSize(10).text('Professional UID Management System', 50, 75);
    doc.fontSize(10).text('EliteBlaze Development', 50, 90);
    doc.fontSize(10).text('support@uidmanager.com', 50, 105);

    doc.fontSize(20).text('INVOICE', 400, 50);
    doc.fontSize(12).text(invoiceNumber, 400, 75);
    doc.fontSize(10).text(`Date: ${moment(invoice.createdAt).format('DD MMM YYYY')}`, 400, 95);

    doc.moveTo(50, 130).lineTo(550, 130).stroke();

    doc.fontSize(12).text('BILL TO:', 50, 150);
    doc.fontSize(10)
      .text(invoice.billingAddress?.name || invoice.username, 50, 170)
      .text(invoice.billingAddress?.email || '', 50, 185)
      .text(invoice.billingAddress?.phone || '', 50, 200);

    doc.fontSize(12).text('INVOICE DETAILS:', 350, 150);
    doc.fontSize(10)
      .text(`Status: ${invoice.status.toUpperCase()}`, 350, 170)
      .text(`Payment Method: ${invoice.paymentMethod}`, 350, 185)
      .text(`Currency: ${invoice.currency}`, 350, 200);

    doc.moveTo(50, 230).lineTo(550, 230).stroke();

    const tableTop = 250;
    doc.fontSize(11).font('Helvetica-Bold');
    doc.text('Description', 50, tableTop);
    doc.text('Qty', 300, tableTop);
    doc.text('Rate', 380, tableTop);
    doc.text('Amount', 480, tableTop, { align: 'right' });

    doc.moveTo(50, tableTop + 15).lineTo(550, tableTop + 15).stroke();

    let y = tableTop + 25;
    doc.font('Helvetica').fontSize(10);

    let description = '';
    if (invoice.type === 'credit_purchase') {
      description = `Credit Purchase - ${invoice.credits} Credits`;
    } else if (invoice.type === 'uid_creation') {
      description = `UID Creation - ${invoice.packageName || 'Package'}\nUID: ${invoice.uid}`;
    } else if (invoice.type === 'refund') {
      description = `Refund - ${invoice.notes}`;
    }

    doc.text(description, 50, y);
    doc.text('1', 300, y);
    doc.text(`${invoice.currency} ${invoice.subtotal.toFixed(2)}`, 380, y);
    doc.text(`${invoice.currency} ${invoice.subtotal.toFixed(2)}`, 480, y, { align: 'right' });

    y += 80;
    doc.moveTo(50, y).lineTo(550, y).stroke();

    y += 15;
    doc.text('Subtotal:', 350, y);
    doc.text(`${invoice.currency} ${invoice.subtotal.toFixed(2)}`, 480, y, { align: 'right' });

    y += 20;
    doc.text(`Tax (${invoice.taxRate}%):`, 350, y);
    doc.text(`${invoice.currency} ${invoice.tax.toFixed(2)}`, 480, y, { align: 'right' });

    y += 20;
    doc.moveTo(350, y).lineTo(550, y).stroke();

    y += 15;
    doc.fontSize(12).font('Helvetica-Bold');
    doc.text('Total:', 350, y);
    doc.text(`${invoice.currency} ${invoice.total.toFixed(2)}`, 480, y, { align: 'right' });

    doc.fontSize(8).text('Thank you for your business!', 50, 700, { align: 'center' });
    doc.text('This is a computer-generated invoice and does not require a signature.', 50, 715, { align: 'center' });

    doc.end();

  } catch (error) {
    console.error('Generate PDF error:', error);
    res.status(500).json({ error: 'Failed to generate PDF' });
  }
});

app.get('/api/activity', requireAuth, async (req, res) => {
  try {
    const username = req.session.user.username;
    let query = {};

    if (!req.session.user.isAdmin && !req.session.user.isOwner) {
      query = { username };
    }

    const activities = await Activity.find(query)
      .sort({ timestamp: -1 })
      .limit(20);

    res.json(activities);
  } catch (error) {
    res.status(500).json([]);
  }
});

app.get('/api/login-history', requireAuth, async (req, res) => {
  try {
    const username = req.session.user.username;
    let query = {};

    if (!req.session.user.isAdmin && !req.session.user.isOwner) {
      query = { username };
    }

    const history = await LoginHistory.find(query)
      .sort({ timestamp: -1 })
      .limit(20);

    res.json(history);
  } catch (error) {
    res.status(500).json([]);
  }
});

app.get('/buy-credits', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'buy-credits.html'));
});

app.post('/api/payment/create', requireAuth, async (req, res) => {
  const { credits } = req.body;
  const username = req.session.user.username;

  if (!credits || credits < 1) {
    return res.status(400).json({ error: 'Invalid credit amount' });
  }

  const amountUSD = credits * 1;

  try {
    const orderId = `${username}-${Date.now()}`;

    const payment = await nowpayments.createPayment(
      amountUSD,
      orderId,
      username
    );

    await Invoice.create({
      invoiceNumber: await generateInvoiceNumber(),
      username,
      type: 'credit_purchase',
      amount: amountUSD,
      credits,
      status: 'pending',
      paymentMethod: 'crypto',
      currency: 'USDT',
      subtotal: amountUSD,
      tax: 0,
      taxRate: 0,
      total: amountUSD
    });

    await logActivity(username, 'payment', `Initiated crypto payment for ${credits} credits`);

    res.json({
      success: true,
      paymentId: payment.payment_id,
      payAddress: payment.pay_address,
      payAmount: payment.pay_amount,
      payCurrency: payment.pay_currency
    });
  } catch (error) {
    console.error('Payment error:', error);
    res.status(500).json({ error: 'Failed to create payment' });
  }
});

app.post('/api/payment/webhook', async (req, res) => {
  try {
    const { payment_id, payment_status } = req.body;

    if (payment_status === 'finished' || payment_status === 'confirmed') {
      const invoice = await Invoice.findOne({ invoiceNumber: payment_id.toString() });

      if (invoice && invoice.status === 'pending') {
        invoice.status = 'paid';
        await invoice.save();

        const user = await User.findOne({ username: invoice.username });
        user.credits += invoice.credits;
        await user.save();

        await logActivity(invoice.username, 'payment', `Payment confirmed: ${invoice.credits} credits added`);
        await notifyCreditAdded('Crypto Payment', invoice.username, invoice.credits, user.credits);

        console.log(`✅ Payment confirmed: ${invoice.credits} credits → ${invoice.username}`);
      }
    }

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: 'Failed' });
  }
});

app.get('/api/payment/status/:paymentId', requireAuth, async (req, res) => {
  try {
    const { paymentId } = req.params;

    const status = await nowpayments.getPaymentStatus(paymentId);
    const invoice = await Invoice.findOne({ invoiceNumber: paymentId.toString() });

    res.json({
      paymentStatus: status.payment_status,
      invoiceStatus: invoice ? invoice.status : 'not_found',
      credits: invoice ? invoice.credits : 0
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to check status' });
  }
});

app.get('/api/admin/api-config', requireAuth, requireMainSuperAdmin, async (req, res) => {
  try {
    const config = await getApiConfig();
    if (!config) {
      return res.status(500).json({ error: 'Failed to fetch config' });
    }
    res.json({
      baseUrl: config.baseUrl || '',
      apiKey: config.apiKey || ''
    });
  } catch (error) {
    console.error('Get API config error:', error.message);
    res.status(500).json({ error: 'Failed to fetch config' });
  }
});

app.post('/api/admin/api-config', requireAuth, requireMainSuperAdmin, async (req, res) => {
  try {
    const { baseUrl, apiKey } = req.body;

    let config = await ApiConfig.findOne({ configKey: 'main_config' });

    if (!config) {
      config = await ApiConfig.create({
        configKey: 'main_config',
        baseUrl: baseUrl || '',
        apiKey: apiKey || '',
        updatedBy: req.session.user.username
      });
    } else {
      config.baseUrl = baseUrl || '';
      config.apiKey = apiKey || '';
      config.updatedBy = req.session.user.username;
      await config.save();
    }

    // Update runtime environment variables immediately
    process.env.BASE_URL = baseUrl;
    process.env.API_KEY = apiKey;

    await logActivity(req.session.user.username, 'api-config-update', `Updated API configuration in MongoDB`);

    res.json({
      success: true,
      message: 'Configuration saved successfully and applied immediately'
    });
  } catch (error) {
    console.error('Save API config error:', error.message);
    res.status(500).json({ error: 'Failed to save config' });
  }
});

// Get GenzAuth configuration status
app.get('/api/admin/genzauth-config', requireAuth, requireMainSuperAdmin, async (req, res) => {
  try {
    const config = await getApiConfig();
    res.json({
      configured: !!(config && config.genzauthSellerKey)
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get configuration' });
  }
});

// Update GenzAuth seller key
app.post('/api/admin/genzauth-config', requireAuth, requireMainSuperAdmin, async (req, res) => {
  try {
    const { sellerKey } = req.body;

    if (!sellerKey || typeof sellerKey !== 'string') {
      return res.status(400).json({ error: 'Valid seller key is required' });
    }

    let config = await ApiConfig.findOne({ configKey: 'main_config' });

    if (!config) {
      config = await ApiConfig.create({
        configKey: 'main_config',
        genzauthSellerKey: sellerKey.trim(),
        updatedBy: req.session.user.username
      });
    } else {
      config.genzauthSellerKey = sellerKey.trim();
      config.updatedBy = req.session.user.username;
      await config.save();
    }

    // Update runtime environment variable immediately
    process.env.GENZAUTH_SELLER_KEY = sellerKey.trim();

    await logActivity(req.session.user.username, 'admin', 'Updated GenzAuth seller key in MongoDB');

    res.json({
      success: true,
      message: 'GenzAuth seller key updated successfully and applied immediately. No restart required.'
    });
  } catch (error) {
    console.error('Update GenzAuth config error:', error);
    res.status(500).json({ error: 'Failed to update configuration' });
  }
});

// Get package configuration
app.get('/api/admin/packages-config', requireAuth, requireAdmin, async (req, res) => {
  try {
    const config = await PackageConfig.findOne({ configKey: 'main_packages' });

    if (!config) {
      return res.status(404).json({ error: 'Package configuration not found' });
    }

    // Convert Maps to Objects
    const uidPackages = {};
    const aimkillPackages = {};

    config.uidPackages.forEach((value, key) => {
      uidPackages[key] = value;
    });

    config.aimkillPackages.forEach((value, key) => {
      aimkillPackages[key] = value;
    });

    res.json({
      uid: uidPackages,
      aimkill: aimkillPackages
    });
  } catch (error) {
    console.error('Get packages config error:', error);
    res.status(500).json({ error: 'Failed to fetch package configuration' });
  }
});

// Update package configuration
app.post('/api/admin/packages-config', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { uid, aimkill } = req.body;

    let config = await PackageConfig.findOne({ configKey: 'main_packages' });

    if (!config) {
      config = await PackageConfig.create({
        configKey: 'main_packages',
        updatedBy: req.session.user.username
      });
    }

    // Update UID packages if provided
    if (uid) {
      const uidMap = new Map();
      Object.keys(uid).forEach(key => {
        uidMap.set(key, uid[key]);
      });
      config.uidPackages = uidMap;
    }

    // Update Aimkill packages if provided
    if (aimkill) {
      const aimkillMap = new Map();
      Object.keys(aimkill).forEach(key => {
        aimkillMap.set(key, aimkill[key]);
      });
      config.aimkillPackages = aimkillMap;
    }

    config.updatedBy = req.session.user.username;
    await config.save();

    await logActivity(req.session.user.username, 'admin', 'Updated package configuration');

    res.json({
      success: true,
      message: 'Package configuration updated successfully'
    });
  } catch (error) {
    console.error('Update packages config error:', error);
    res.status(500).json({ error: 'Failed to update package configuration' });
  }
});

// Get all verified users (admin only)
app.get('/api/admin/verified-users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const verifiedUsers = await User.find({ discordVerified: true })
      .select('username discordUsername discordId discordVerified isGuest youtubeSubscribed instagramFollowed createdAt')
      .sort({ createdAt: -1 });

    const usersData = verifiedUsers.map(user => ({
      username: user.username,
      discordUsername: user.discordUsername,
      discordId: user.discordId,
      isGuest: user.isGuest,
      youtubeSubscribed: user.youtubeSubscribed || false,
      instagramFollowed: user.instagramFollowed || false,
      discordVerifiedAt: user.createdAt
    }));

    res.json({
      success: true,
      users: usersData,
      total: usersData.length
    });
  } catch (error) {
    console.error('Get verified users error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch verified users' });
  }
});

// Unverify single user (admin only)
app.post('/api/admin/unverify-user', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { username } = req.body;

    if (!username) {
      return res.status(400).json({ error: 'Username is required' });
    }

    const user = await User.findOne({ username: username.toLowerCase() });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    user.discordVerified = false;
    user.discordId = null;
    user.discordUsername = null;
    user.discordAvatar = null;
    user.discordAccessToken = null;
    user.discordRefreshToken = null;
    user.discordTokenExpiresAt = null;
    user.discordEmail = null;
    user.discordGuilds = [];
    await user.save();

    await logActivity(
      req.session.user.username,
      'admin',
      `Unverified Discord for user: ${username}`
    );

    await notifyAdminAction(
      req.session.user.username,
      'Unverified User',
      `${username} - Discord verification removed`
    );

    res.json({
      success: true,
      message: `${username} has been unverified successfully`
    });
  } catch (error) {
    console.error('Unverify user error:', error);
    res.status(500).json({ error: 'Failed to unverify user' });
  }
});

// Unverify all users (admin only)
app.post('/api/admin/unverify-all-users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await User.updateMany(
      { discordVerified: true },
      {
        $set: {
          discordVerified: false,
          discordId: null,
          discordUsername: null,
          discordAvatar: null,
          discordAccessToken: null,
          discordRefreshToken: null,
          discordTokenExpiresAt: null,
          discordEmail: null,
          discordGuilds: []
        }
      }
    );

    await logActivity(
      req.session.user.username,
      'admin',
      `Mass unverified ${result.modifiedCount} Discord users`
    );

    await notifyAdminAction(
      req.session.user.username,
      'Mass Unverify',
      `Removed Discord verification from ${result.modifiedCount} users`
    );

    res.json({
      success: true,
      count: result.modifiedCount,
      message: `Successfully unverified ${result.modifiedCount} users`
    });
  } catch (error) {
    console.error('Unverify all users error:', error);
    res.status(500).json({ error: 'Failed to unverify users' });
  }
});

// Unverify single user social media (admin only)
app.post('/api/admin/unverify-social', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { username } = req.body;

    if (!username) {
      return res.status(400).json({ error: 'Username is required' });
    }

    const user = await User.findOne({ username: username.toLowerCase() });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    user.youtubeSubscribed = false;
    user.instagramFollowed = false;
    user.socialVerifiedAt = null;
    await user.save();

    await logActivity(
      req.session.user.username,
      'admin',
      `Unverified social media for user: ${username}`
    );

    await notifyAdminAction(
      req.session.user.username,
      'Unverified Social Media',
      `${username} - YouTube/Instagram verification removed`
    );

    res.json({
      success: true,
      message: `${username} social media has been unverified successfully`
    });
  } catch (error) {
    console.error('Unverify social media error:', error);
    res.status(500).json({ error: 'Failed to unverify social media' });
  }
});

// Unverify all social media (admin only)
app.post('/api/admin/unverify-all-social', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await User.updateMany(
      { $or: [{ youtubeSubscribed: true }, { instagramFollowed: true }] },
      {
        $set: {
          youtubeSubscribed: false,
          instagramFollowed: false,
          socialVerifiedAt: null
        }
      }
    );

    await logActivity(
      req.session.user.username,
      'admin',
      `Mass unverified ${result.modifiedCount} social media verifications`
    );

    await notifyAdminAction(
      req.session.user.username,
      'Mass Unverify Social Media',
      `Removed social media verification from ${result.modifiedCount} users`
    );

    res.json({
      success: true,
      count: result.modifiedCount,
      message: `Successfully unverified social media for ${result.modifiedCount} users`
    });
  } catch (error) {
    console.error('Unverify all social media error:', error);
    res.status(500).json({ error: 'Failed to unverify social media' });
  }
});

// Get guest settings
app.get('/api/guest-settings', async (req, res) => {
  try {
    const adminUser = await User.findOne({ username: 'admin' });

    if (!adminUser) {
      return res.json({
        allowGuestFreeUID: true,
        allowGuestFreeAimkill: false,
        guestPassMaxDuration: '1day',
        requireSocialVerification: false,
        youtubeChannelUrl: '',
        instagramProfileUrl: '',
        guestVideoUrl: ''
      });
    }

    res.json({
      allowGuestFreeUID: adminUser.allowGuestFreeUID !== false,
      allowGuestFreeAimkill: adminUser.allowGuestFreeAimkill === true,
      guestPassMaxDuration: adminUser.guestPassMaxDuration || '1day',
      requireSocialVerification: adminUser.requireSocialVerification === true,
      youtubeChannelUrl: adminUser.youtubeChannelUrl || '',
      instagramProfileUrl: adminUser.instagramProfileUrl || '',
      guestVideoUrl: adminUser.guestVideoUrl || ''
    });
  } catch (error) {
    res.json({
      allowGuestFreeUID: true,
      allowGuestFreeAimkill: false,
      guestPassMaxDuration: '1day',
      requireSocialVerification: false,
      youtubeChannelUrl: '',
      instagramProfileUrl: '',
      guestVideoUrl: ''
    });
  }
});

// Admin update guest settings
app.post('/api/admin/guest-settings', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { allowGuestFreeUID, allowGuestFreeAimkill, guestPassMaxDuration, requireSocialVerification, youtubeChannelUrl, instagramProfileUrl, guestVideoUrl } = req.body;

    const admin = await User.findOne({ username: 'admin' });

    admin.allowGuestFreeUID = allowGuestFreeUID === true;
    admin.allowGuestFreeAimkill = allowGuestFreeAimkill === true;
    admin.requireSocialVerification = requireSocialVerification === true;

    // Only update URLs if new values are provided (non-empty)
    if (youtubeChannelUrl !== undefined && youtubeChannelUrl.trim() !== '') {
      admin.youtubeChannelUrl = youtubeChannelUrl;
    } else if (youtubeChannelUrl !== undefined && youtubeChannelUrl.trim() === '') {
      admin.youtubeChannelUrl = '';
    }

    if (instagramProfileUrl !== undefined && instagramProfileUrl.trim() !== '') {
      admin.instagramProfileUrl = instagramProfileUrl;
    } else if (instagramProfileUrl !== undefined && instagramProfileUrl.trim() === '') {
      admin.instagramProfileUrl = '';
    }

    if (guestVideoUrl !== undefined) {
      const trimmedUrl = (guestVideoUrl || '').trim();

      // Only update if a new URL is provided or explicitly cleared
      if (trimmedUrl !== '') {
        // Convert YouTube watch URLs to embed URLs
        let processedUrl = trimmedUrl;
        if (processedUrl.includes('youtube.com/watch?v=')) {
          const videoId = processedUrl.split('v=')[1]?.split('&')[0];
          if (videoId) {
            processedUrl = `https://www.youtube.com/embed/${videoId}`;
          }
        } else if (processedUrl.includes('youtu.be/')) {
          const videoId = processedUrl.split('youtu.be/')[1]?.split('?')[0];
          if (videoId) {
            processedUrl = `https://www.youtube.com/embed/${videoId}`;
          }
        }
        admin.guestVideoUrl = processedUrl;
      }
      // If empty string sent and field already has a value, keep the existing value
      // This allows other settings to be updated without erasing the video URL
    }

    if (guestPassMaxDuration && ['1day', '3days', '7days', '15days', '30days'].includes(guestPassMaxDuration)) {
      admin.guestPassMaxDuration = guestPassMaxDuration;
    }

    await admin.save();

    await logActivity(req.session.user.username, 'admin',
      `Updated guest settings: UID=${allowGuestFreeUID}, Aimkill=${allowGuestFreeAimkill}, MaxDuration=${guestPassMaxDuration}, SocialVerification=${requireSocialVerification}`);

    res.json({ success: true, message: 'Guest settings updated' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

// Admin manually verifies social media (no self-confirmation)
app.post('/api/admin/verify-social/:username', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { username } = req.params;
    const user = await User.findOne({ username });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    user.youtubeSubscribed = true;
    user.instagramFollowed = true;
    user.socialVerifiedAt = new Date();
    await user.save();

    await logActivity(req.session.user.username, 'admin', `Verified social media for user: ${username}`);

    res.json({ success: true, message: 'User social media verified' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to verify social media' });
  }
});

// Check social verification status
app.get('/api/guest/social-status', requireAuth, async (req, res) => {
  try {
    const user = await User.findOne({ username: req.session.user.username });
    const admin = await User.findOne({ username: 'admin' });

    res.json({
      required: admin.requireSocialVerification === true,
      verified: user.youtubeSubscribed && user.instagramFollowed,
      youtubeUrl: admin.youtubeChannelUrl || '',
      instagramUrl: admin.instagramProfileUrl || ''
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to check status' });
  }
});

// Automatically verify user subscription
app.post('/api/guest/notify-subscribed', requireAuth, async (req, res) => {
  try {
    const user = await User.findOne({ username: req.session.user.username });

    if (!user || !user.isGuest) {
      return res.status(403).json({ error: 'Only guest users can use this feature' });
    }

    if (user.youtubeSubscribed && user.instagramFollowed) {
      return res.json({
        success: true,
        message: 'You are already verified!',
        alreadyVerified: true
      });
    }

    user.youtubeSubscribed = true;
    user.instagramFollowed = true;
    user.socialVerifiedAt = new Date();
    await user.save();

    await logActivity(
      req.session.user.username,
      'guest',
      'Automatically verified social media - User confirmed subscription/follow'
    );

    res.json({
      success: true,
      message: 'Verification successful! You can now create free keys.',
      verified: true
    });
  } catch (error) {
    console.error('Error verifying subscription:', error);
    res.status(500).json({ error: 'Failed to verify subscription' });
  }
});

// Get guest social verification details
app.get('/api/guest-social-verification', requireAuth, async (req, res) => {
  try {
    const user = await User.findOne({ username: req.session.user.username });
    const admin = await User.findOne({ username: 'admin' });

    if (!admin || !admin.requireSocialVerification) {
      return res.json({
        isVerified: true,
        required: false
      });
    }

    res.json({
      isVerified: user.youtubeSubscribed && user.instagramFollowed,
      required: true,
      youtubeUrl: admin.youtubeChannelUrl || '',
      instagramUrl: admin.instagramProfileUrl || ''
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to check verification' });
  }
});

app.post('/api/aimkill/create-keys', requireAuth, checkGuestFreeAimkill, checkUserPaused, async (req, res) => {
  try {
    const user = await User.findOne({ username: req.session.user.username });

    // ALLOW GUESTS - Don't check account type for guests
    if (!user.isGuest && user.accountType !== 'AIMKILL') {
      return res.status(403).json({ error: 'Not an Aimkill account' });
    }

    // Check if it's a guest and validate
    if (user.isGuest) {
      if (!user.discordVerified) {
        return res.status(403).json({
          error: 'Discord verification required. Please authorize with Discord to create Aimkill keys.',
          requiresDiscord: true,
          discordAuthUrl: '/auth/discord'
        });
      }

      if (user.guestPassUsed) {
        return res.status(403).json({
          error: 'Guest pass already used. Contact admin to upgrade your account for more keys.',
          guestPassUsed: true
        });
      }

      // Check social media verification if required
      const adminUser = await User.findOne({ username: 'admin' });
      if (adminUser && adminUser.requireSocialVerification) {
        if (!user.youtubeSubscribed || !user.instagramFollowed) {
          return res.status(403).json({
            error: 'Please subscribe to YouTube and follow on Instagram first',
            requiresSocial: true
          });
        }
      }

      const { duration, quantity, durationName } = req.body;

      // Guests limited to 1 key
      if (quantity > 1) {
        return res.status(403).json({
          error: 'Guests can only create 1 key at a time',
          guestOnly: true
        });
      }

      // Get max duration from admin settings
      const maxDuration = adminUser?.guestPassMaxDuration || '1day';
      const maxDays = parseInt(maxDuration.match(/\d+/)?.[0]) || 1;
      const requestedDays = parseInt(duration) || 1;

      if (requestedDays > maxDays) {
        return res.status(403).json({
          error: `Guests can only create keys up to ${maxDays} day${maxDays > 1 ? 's' : ''}`,
          guestOnly: true,
          maxAllowedDuration: maxDuration
        });
      }

      console.log(`✅ Guest user ${req.session.user.username} using free pass for Aimkill key`);
    }

    const { duration, quantity, durationName } = req.body;

    const creditMap = {
      '1day': 1,
      '3day': 3,
      '7day': 7,
      '15day': 15,
      '30day': 30,
      'lifetime': 100
    };

    const creditsPerKey = creditMap[durationName] || 1;
    const totalCredits = creditsPerKey * quantity;
    const durationDays = parseInt(duration) || creditsPerKey;

    console.log(`📊 Credit calculation: ${quantity} keys × ${creditsPerKey} credits = ${totalCredits} total`);

    // Credit check for non-guests
    if (!user.isGuest && user.credits < totalCredits) {
      return res.status(400).json({
        error: `Insufficient credits. Need ${totalCredits}, have ${user.credits}`
      });
    }

    console.log(`🔑 Creating ${quantity} GenzAuth keys with duration ${durationDays}d`);

    const keys = [];
    const failedKeys = [];

    // Create keys via GenzAuth
    for (let i = 0; i < quantity; i++) {
      try {
        const result = await genzauth.createKey(durationDays, 1);

        if (result.success && result.key) {
          keys.push(result.key);
          console.log(`✅ Created GenzAuth key: ${result.key}`);

          // Store key in database (as key, not user)
          const expiresAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000);
          await AimkillKey.create({
            key: result.key,
            type: 'license_key',
            duration: durationDays,
            createdBy: req.session.user.username,
            expiresAt: expiresAt,
            status: 'active'
          });
        } else {
          console.error(`❌ Failed to create key ${i + 1}:`, result.message);
          failedKeys.push(i + 1);
        }
      } catch (error) {
        console.error(`❌ GenzAuth Error for key ${i + 1}:`, error.message);
        failedKeys.push(i + 1);
      }
    }

    if (keys.length === 0) {
      return res.status(500).json({
        error: 'Failed to create any keys. Check GenzAuth configuration.'
      });
    }

    // Calculate actual credits used based on keys created
    const actualCreditsUsed = keys.length * creditsPerKey;

    // Update user
    if (!user.isGuest) {
      user.credits -= actualCreditsUsed;
      console.log(`💳 Deducted ${actualCreditsUsed} credits. Remaining: ${user.credits}`);
    } else {
      user.guestPassUsed = true;
      user.guestPassType = durationName;
      user.guestPassExpiresAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000);
    }
    await user.save();

    const summary = failedKeys.length > 0
      ? `Created ${keys.length}/${quantity} keys. Failed: ${failedKeys.join(', ')}`
      : `Created ${quantity} keys successfully`;

    const logMsg = user.isGuest
      ? `Guest created ${keys.length} FREE Aimkill key(s)`
      : `Created ${keys.length} Aimkill key(s) for ${actualCreditsUsed} credits`;

    await logActivity(req.session.user.username, 'aimkill-keys-create', logMsg);

    res.json({
      success: true,
      keys,
      message: summary,
      created: keys.length,
      failed: failedKeys.length,
      creditsUsed: user.isGuest ? 0 : actualCreditsUsed,
      creditsRemaining: user.credits,
      isGuest: user.isGuest
    });
  } catch (error) {
    console.error('❌ Create Aimkill keys error:', error.message);
    res.status(500).json({ error: 'Failed to create keys: ' + error.message });
  }
});

app.post('/api/aimkill/create-user', requireAuth, checkGuestFreeAimkill, checkUserPaused, async (req, res) => {
  try {
    const user = await User.findOne({ username: req.session.user.username });

    if (!user.isGuest && user.accountType !== 'AIMKILL') {
      return res.status(403).json({ error: 'Not an Aimkill account' });
    }

    const { username, password, packageId } = req.body;

    if (!username || !password || !packageId) {
      return res.status(400).json({ error: 'Username, password, and package are required' });
    }

    const cleanUsername = username.trim();

    if (!cleanUsername.startsWith('DC')) {
      return res.status(400).json({ error: 'Username must start with "DC"' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    // Get package configuration
    const packages = await getPackages();
    const selectedPackage = packages.aimkill[packageId];

    if (!selectedPackage) {
      return res.status(400).json({ error: 'Invalid package selected' });
    }

    const duration = selectedPackage.days;
    const creditsRequired = selectedPackage.credits;

    // Check if API key already exists (not checking User collection)
    const existingApiKey = await ApiKey.findOne({ username: cleanUsername.toLowerCase() });
    if (existingApiKey) {
      return res.status(400).json({ error: 'Username already exists in API keys' });
    }

    // Check if it's a guest and validate
    if (user.isGuest) {
      if (!user.discordVerified) {
        return res.status(403).json({
          error: 'Discord verification required. Please authorize with Discord to create Aimkill accounts.',
          requiresDiscord: true,
          discordAuthUrl: '/auth/discord'
        });
      }

      if (user.guestPassUsed) {
        return res.status(403).json({
          error: 'Guest pass already used. Contact admin to upgrade your account.',
          guestPassUsed: true
        });
      }

      // Check social media verification if required
      const adminUser = await User.findOne({ username: 'admin' });
      if (adminUser && adminUser.requireSocialVerification) {
        if (!user.youtubeSubscribed || !user.instagramFollowed) {
          return res.status(403).json({
            error: 'Please subscribe to YouTube and follow on Instagram first',
            requiresSocial: true
          });
        }
      }

      // Get max duration from admin settings
      const maxDuration = adminUser?.guestPassMaxDuration || '1day';
      const maxDays = parseInt(maxDuration.match(/\d+/)?.[0]) || 1;

      if (duration > maxDays) {
        return res.status(403).json({
          error: `Guests can only create accounts up to ${maxDays} day${maxDays > 1 ? 's' : ''}`,
          guestOnly: true,
          maxAllowedDuration: maxDuration
        });
      }

      console.log(`✅ Guest user ${req.session.user.username} using free pass for Aimkill account`);
    }

    if (!user.isGuest && user.credits < creditsRequired) {
      return res.status(400).json({
        error: `Insufficient credits. Need ${creditsRequired}, have ${user.credits}`
      });
    }

    console.log(`👤 Creating Aimkill user account in GenzAuth API: ${cleanUsername}`);

    const apiResult = await genzauth.createUser(cleanUsername, password, duration);

    if (!apiResult.success) {
      console.error(`❌ GenzAuth API failed to create user:`, apiResult.error || apiResult.message);
      return res.status(500).json({
        error: `Failed to create account in GenzAuth API: ${apiResult.error || apiResult.message || 'Unknown error'}`
      });
    }

    console.log(`✅ GenzAuth API user created successfully: ${cleanUsername}`);

    console.log(`💾 Storing API-generated credentials in ApiKey collection: ${cleanUsername}`);

    // Store as API Key (NOT as a real user)
    const expiresAt = new Date(Date.now() + duration * 24 * 60 * 60 * 1000);
    const newApiKey = await ApiKey.create({
      username: cleanUsername.toLowerCase(),
      password: password,
      accountType: 'AIMKILL',
      duration: duration,
      createdBy: req.session.user.username,
      expiresAt: expiresAt,
      status: 'active'
    });

    console.log(`✅ API Key created in database (NOT stored as user): ${cleanUsername}`);

    if (!user.isGuest) {
      user.credits -= creditsRequired;
      console.log(`💳 Deducted ${creditsRequired} credits. Remaining: ${user.credits}`);
    } else {
      user.guestPassUsed = true;
      user.guestPassType = '1day';
      user.guestPassExpiresAt = new Date(Date.now() + duration * 24 * 60 * 60 * 1000);
    }
    await user.save();

    const logMsg = user.isGuest
      ? `Guest created FREE Aimkill API key: ${cleanUsername}`
      : `Created Aimkill API key: ${cleanUsername} for ${creditsRequired} credits`;

    await logActivity(req.session.user.username, 'aimkill-apikey-create', logMsg);

    res.json({
      success: true,
      message: `API credentials ${cleanUsername} created successfully (stored as API key, not user)`,
      username: cleanUsername,
      creditsUsed: user.isGuest ? 0 : creditsRequired,
      creditsRemaining: user.credits
    });
  } catch (error) {
    console.error('❌ Create Aimkill user error:', error.message);
    res.status(500).json({ error: 'Failed to create user: ' + error.message });
  }
});

app.post('/api/aimkill/delete-key', requireAuth, checkUserPaused, async (req, res) => {
  try {
    const { key } = req.body;
    const username = req.session.user.username;
    const isAdmin = req.session.user.isAdmin || req.session.user.isOwner;

    if (!key) {
      return res.status(400).json({ error: 'Key is required' });
    }

    const keyRecord = await AimkillKey.findOne({ key, type: 'license_key' });
    if (!keyRecord) {
      return res.status(404).json({ error: 'Key not found in database' });
    }

    if (!isAdmin && keyRecord.createdBy !== username) {
      return res.status(403).json({ error: 'You can only delete keys you created' });
    }

    try {
      const result = await genzauth.deleteKey(key);
      console.log(`✅ Deleted GenzAuth key: ${key}`);
    } catch (error) {
      console.error(`⚠️ Failed to delete key from GenzAuth:`, error.message);
    }

    await AimkillKey.deleteOne({ key, type: 'license_key' });
    await logActivity(username, 'aimkill-key-delete', `Deleted Aimkill key ${key}`);

    res.json({ success: true, message: 'Key deleted successfully' });
  } catch (error) {
    console.error('Delete Aimkill key error:', error.message);
    res.status(500).json({ error: 'Failed to delete key' });
  }
});

// Get all Aimkill user credentials (accounts)
app.get('/api/aimkill/user-keys', requireAuth, async (req, res) => {
  try {
    const username = req.session.user.username;
    const isAdmin = req.session.user.isAdmin || req.session.user.isOwner;

    let query = { accountType: 'AIMKILL' };
    if (!isAdmin) {
      query.createdBy = username;
    }

    const aimkillKeys = await ApiKey.find(query).sort({ createdAt: -1 });

    const keysWithStatus = aimkillKeys.map(key => {
      const keyObj = key.toObject();
      keyObj.status = key.updateStatus();
      keyObj.timeLeft = calculateTimeLeft(key.expiresAt);
      return keyObj;
    });

    res.json({
      success: true,
      keys: keysWithStatus
    });
  } catch (error) {
    console.error('Get Aimkill user accounts error:', error.message);
    res.status(500).json({ error: 'Failed to fetch Aimkill accounts' });
  }
});

// Get all Aimkill license keys only
app.get('/api/aimkill/license-keys', requireAuth, async (req, res) => {
  try {
    const username = req.session.user.username;
    const isAdmin = req.session.user.isAdmin || req.session.user.isOwner;

    let query = { type: 'license_key' };
    if (!isAdmin) {
      query.createdBy = username;
    }

    const licenseKeys = await AimkillKey.find(query).sort({ createdAt: -1 });

    const keysWithStatus = licenseKeys.map(key => {
      const keyObj = key.toObject();
      keyObj.status = key.updateStatus();
      keyObj.timeLeft = calculateTimeLeft(key.expiresAt);
      return keyObj;
    });

    res.json({
      success: true,
      keys: keysWithStatus
    });
  } catch (error) {
    console.error('Get Aimkill license keys error:', error.message);
    res.status(500).json({ error: 'Failed to fetch license keys' });
  }
});

// Delete single Aimkill user credential
app.post('/api/aimkill/delete-user-key', requireAuth, checkUserPaused, async (req, res) => {
  try {
    const { username: targetUsername } = req.body;
    const username = req.session.user.username;
    const isAdmin = req.session.user.isAdmin || req.session.user.isOwner;

    if (!targetUsername) {
      return res.status(400).json({ error: 'Username is required' });
    }

    // Check if API key exists (new system - stored in ApiKey collection)
    const apiKey = await ApiKey.findOne({ username: targetUsername.toLowerCase() });
    if (!apiKey) {
      return res.status(404).json({ error: 'Aimkill API account not found in database' });
    }

    if (!isAdmin && apiKey.createdBy !== username) {
      return res.status(403).json({ error: 'You can only delete accounts you created' });
    }

    console.log(`🗑️ Deleting Aimkill API account: ${targetUsername}`);

    // Delete from GenzAuth API first
    try {
      const apiResult = await genzauth.deleteUser(targetUsername);
      console.log(`✅ Deleted user from GenzAuth API: ${targetUsername}`);
    } catch (error) {
      console.error(`⚠️ Failed to delete from GenzAuth API:`, error.message);
      // Continue with database deletion even if API fails
    }

    // Delete from ApiKey database (new system - not from User collection)
    const keyDeleted = await ApiKey.deleteOne({ username: targetUsername.toLowerCase() });
    console.log(`✅ Deleted from ApiKey database: ${targetUsername} (${keyDeleted.deletedCount} records)`);

    await logActivity(username, 'aimkill-apikey-delete', `Deleted Aimkill API account: ${targetUsername}`);

    res.json({
      success: true,
      message: `Aimkill API account ${targetUsername} deleted successfully`
    });
  } catch (error) {
    console.error('Delete Aimkill user error:', error.message);
    res.status(500).json({ error: 'Failed to delete Aimkill account: ' + error.message });
  }
});

// Mass delete Aimkill user credentials
app.post('/api/aimkill/mass-delete-user-keys', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { usernames } = req.body;
    const username = req.session.user.username;

    if (!usernames || !Array.isArray(usernames) || usernames.length === 0) {
      return res.status(400).json({ error: 'Usernames array is required' });
    }

    let deleted = 0;
    let failed = 0;
    const errors = [];

    for (const targetUsername of usernames) {
      try {
        // Delete from GenzAuth API
        await genzauth.deleteUser(targetUsername);

        // Delete from ApiKey database (new system - not from User collection)
        await ApiKey.deleteOne({ username: targetUsername.toLowerCase() });

        deleted++;
        console.log(`✅ Mass deleted Aimkill API account: ${targetUsername}`);
      } catch (error) {
        failed++;
        console.error(`❌ Failed to delete ${targetUsername}:`, error.message);
      }
    }

    await logActivity(username, 'aimkill-mass-apikey-delete', `Mass deleted ${deleted} Aimkill API accounts, ${failed} failed`);

    res.json({
      success: true,
      message: `Deleted ${deleted} users successfully, ${failed} failed`,
      deleted,
      failed
    });
  } catch (error) {
    console.error('Mass delete Aimkill users error:', error.message);
    res.status(500).json({ error: 'Failed to mass delete Aimkill users' });
  }
});

app.get('/api/aimkill/packages', requireAuth, async (req, res) => {
  try {
    const packages = await getPackages();
    res.json(packages.aimkill);
  } catch (error) {
    console.error('Get Aimkill packages error:', error.message);
    res.status(500).json({ error: 'Failed to fetch packages' });
  }
});

app.post('/api/admin/update-account-type', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { username, accountType } = req.body;

    if (!['UID_MANAGER', 'AIMKILL'].includes(accountType)) {
      return res.status(400).json({ error: 'Invalid account type' });
    }

    const user = await User.findOneAndUpdate(
      { username: username.toLowerCase() },
      { accountType },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    await logActivity(req.session.user.username, 'account-type-update', `Changed ${username} account type to ${accountType}`);

    res.json({ message: 'Account type updated', user: { username: user.username, accountType: user.accountType } });
  } catch (error) {
    console.error('Update account type error:', error.message);
    res.status(500).json({ error: 'Failed to update account type' });
  }
});

app.get('/api/admin/stats', requireAuth, requireAdmin, async (req, res) => {
  try {
    const totalUsers = await User.countDocuments({});
    const totalAdmins = await User.countDocuments({ $or: [{ isAdmin: true }, { isOwner: true }] });
    const totalGuests = await User.countDocuments({ isGuest: true });
    const totalUIDs = await UID.countDocuments({});

    res.json({
      totalUsers,
      totalAdmins,
      totalGuests,
      totalUIDs,
      timestamp: new Date()
    });
  } catch (error) {
    console.error('Get admin stats error:', error.message);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// Get all API-generated keys (admin only)
app.get('/api/admin/api-keys', requireAuth, requireAdmin, async (req, res) => {
  try {
    const apiKeys = await ApiKey.find({}).sort({ createdAt: -1 });

    const keysWithStatus = apiKeys.map(key => {
      const keyObj = key.toObject();
      keyObj.status = key.updateStatus();
      keyObj.timeLeft = calculateTimeLeft(key.expiresAt);
      return keyObj;
    });

    res.json({
      success: true,
      keys: keysWithStatus,
      total: keysWithStatus.length
    });
  } catch (error) {
    console.error('Get API keys error:', error.message);
    res.status(500).json({ error: 'Failed to fetch API keys' });
  }
});

// Delete API-generated key (admin only)
app.post('/api/admin/delete-api-key', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { username } = req.body;

    if (!username) {
      return res.status(400).json({ error: 'Username is required' });
    }

    const apiKey = await ApiKey.findOne({ username: username.toLowerCase() });
    if (!apiKey) {
      return res.status(404).json({ error: 'API key not found' });
    }

    console.log(`🗑️ Admin deleting API key: ${username}`);

    // Delete from GenzAuth API first
    try {
      await genzauth.deleteUser(username);
      console.log(`✅ Deleted from GenzAuth API: ${username}`);
    } catch (error) {
      console.error(`⚠️ Failed to delete from GenzAuth API:`, error.message);
    }

    // Delete from ApiKey database
    await ApiKey.deleteOne({ username: username.toLowerCase() });
    console.log(`✅ Deleted API key from database: ${username}`);

    await logActivity(req.session.user.username, 'admin-apikey-delete', `Admin deleted API key: ${username}`);

    res.json({
      success: true,
      message: `API key ${username} deleted successfully`
    });
  } catch (error) {
    console.error('Delete API key error:', error.message);
    res.status(500).json({ error: 'Failed to delete API key' });
  }
});

// Mass delete all API-generated keys (admin only)
app.post('/api/admin/mass-delete-api-keys', requireAuth, requireAdmin, async (req, res) => {
  try {
    console.log(`🗑️ Admin ${req.session.user.username} initiating mass delete of all API keys`);

    const allApiKeys = await ApiKey.find({});
    let deleted = 0;
    let failed = 0;
    const errors = [];

    for (const apiKey of allApiKeys) {
      try {
        // Delete from GenzAuth API
        await genzauth.deleteUser(apiKey.username);
        console.log(`✅ Deleted from GenzAuth API: ${apiKey.username}`);
      } catch (error) {
        console.error(`⚠️ Failed to delete from GenzAuth API (${apiKey.username}):`, error.message);
        errors.push(`${apiKey.username}: ${error.message}`);
      }

      try {
        // Delete from database
        await ApiKey.deleteOne({ _id: apiKey._id });
        deleted++;
        console.log(`✅ Deleted from database: ${apiKey.username}`);
      } catch (error) {
        failed++;
        console.error(`❌ Failed to delete from database (${apiKey.username}):`, error.message);
      }
    }

    await logActivity(
      req.session.user.username,
      'admin-mass-apikey-delete',
      `Mass deleted ${deleted} API keys, ${failed} failed`
    );

    await notifyAdminAction(
      req.session.user.username,
      'Mass Delete API Keys',
      `Deleted: ${deleted}, Failed: ${failed}`
    );

    res.json({
      success: true,
      message: `Mass delete complete: ${deleted} deleted, ${failed} failed`,
      deleted,
      failed,
      total: allApiKeys.length,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    console.error('Mass delete API keys error:', error.message);
    res.status(500).json({ error: 'Failed to mass delete API keys' });
  }
});

// Chat API endpoints
app.get('/api/chat/clients', requireAuth, requireAdmin, async (req, res) => {
  try {
    const Client = require('./models/Client');
    const clients = await Client.find({ isActive: true })
      .select('username productKey')
      .sort({ username: 1 });

    res.json({ success: true, clients });
  } catch (error) {
    console.error('Get chat clients error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch clients' });
  }
});

app.get('/api/chat/history', requireAuth, async (req, res) => {
  try {
    const { withUser } = req.query;
    const currentUser = req.session.user.username;

    const messages = await ChatMessage.find({
      $or: [
        { senderUsername: currentUser, receiverUsername: withUser },
        { senderUsername: withUser, receiverUsername: currentUser }
      ]
    }).sort({ timestamp: -1 }).limit(50).exec();

    // Reverse to show oldest first
    messages.reverse();

    res.json({ success: true, messages });
  } catch (error) {
    console.error('Get chat history error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch chat history' });
  }
});

// Admin: Delete chat messages for specific user
app.post('/api/admin/chat/delete-user-messages', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { username } = req.body;

    if (!username) {
      return res.status(400).json({ error: 'Username is required' });
    }

    const result = await ChatMessage.deleteMany({
      $or: [
        { senderUsername: username },
        { receiverUsername: username }
      ]
    });

    await logActivity(req.session.user.username, 'admin-chat', `Deleted ${result.deletedCount} messages for user: ${username}`);

    res.json({
      success: true,
      deletedCount: result.deletedCount,
      message: `Deleted ${result.deletedCount} messages for ${username}`
    });
  } catch (error) {
    console.error('Delete user chat messages error:', error);
    res.status(500).json({ error: 'Failed to delete messages' });
  }
});

// Admin: Delete all chat messages
app.post('/api/admin/chat/delete-all-messages', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await ChatMessage.deleteMany({});

    await logActivity(req.session.user.username, 'admin-chat', `Deleted all chat messages (${result.deletedCount} total)`);

    res.json({
      success: true,
      deletedCount: result.deletedCount,
      message: `Deleted all ${result.deletedCount} chat messages`
    });
  } catch (error) {
    console.error('Delete all chat messages error:', error);
    res.status(500).json({ error: 'Failed to delete messages' });
  }
});

// Admin: Get chat statistics
app.get('/api/admin/chat/stats', requireAuth, requireAdmin, async (req, res) => {
  try {
    const totalMessages = await ChatMessage.countDocuments({});
    const unreadMessages = await ChatMessage.countDocuments({ isRead: false });

    // Get unique users in chat
    const senders = await ChatMessage.distinct('senderUsername');
    const receivers = await ChatMessage.distinct('receiverUsername');
    const uniqueUsers = [...new Set([...senders, ...receivers])];

    res.json({
      success: true,
      stats: {
        totalMessages,
        unreadMessages,
        uniqueUsers: uniqueUsers.length,
        userList: uniqueUsers
      }
    });
  } catch (error) {
    console.error('Get chat stats error:', error);
    res.status(500).json({ error: 'Failed to fetch chat stats' });
  }
});

app.post('/api/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const username = req.session.user.username;

  try {
    const user = await User.findOne({ username });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.password !== currentPassword) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }

    user.password = newPassword;
    user.lastPasswordChange = new Date();
    await user.save();

    await logActivity(username, 'security', 'Password changed');
    await notifyAdminAction(username, 'Changed Password', 'Security');

    res.json({ success: true, message: 'Password changed successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to change password' });
  }
});

// ==================== ADMIN GUEST MANAGEMENT ENDPOINTS ====================

// Restore Single Guest Pass
app.post('/api/admin/restore-guest-pass', requireAuth, requireAdmin, async (req, res) => {
  const { username } = req.body;
  try {
    const user = await User.findOne({ username: username.toLowerCase() });
    if (!user) return res.status(404).json({ error: 'Guest not found' });

    user.guestPassUsed = false;
    user.guestPassType = null;
    await user.save();

    await logActivity(req.session.user.username, 'guest-pass-restore', `Restored guest pass for: ${username}`);
    res.json({ success: true, message: 'Guest pass restored' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to restore guest pass' });
  }
});

// Get all verified users (admin only)
app.get('/api/admin/verified-users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const verifiedUsers = await User.find({ discordVerified: true })
      .select('username discordUsername discordId discordVerified isGuest createdAt')
      .sort({ createdAt: -1 });

    const usersData = verifiedUsers.map(user => ({
      username: user.username,
      discordUsername: user.discordUsername,
      discordId: user.discordId,
      isGuest: user.isGuest,
      discordVerifiedAt: user.createdAt
    }));

    res.json({
      success: true,
      users: usersData,
      total: usersData.length
    });
  } catch (error) {
    console.error('Get verified users error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch verified users' });
  }
});

// Unverify single user (admin only)
app.post('/api/admin/unverify-user', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { username } = req.body;

    if (!username) {
      return res.status(400).json({ error: 'Username is required' });
    }

    const user = await User.findOne({ username: username.toLowerCase() });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    user.discordVerified = false;
    user.discordId = null;
    user.discordUsername = null;
    user.discordAvatar = null;
    user.discordAccessToken = null;
    user.discordRefreshToken = null;
    user.discordTokenExpiresAt = null;
    user.discordEmail = null;
    user.discordGuilds = [];
    await user.save();

    await logActivity(
      req.session.user.username,
      'admin',
      `Unverified Discord for user: ${username}`
    );

    await notifyAdminAction(
      req.session.user.username,
      'Unverified User',
      `${username} - Discord verification removed`
    );

    res.json({
      success: true,
      message: `${username} has been unverified successfully`
    });
  } catch (error) {
    console.error('Unverify user error:', error);
    res.status(500).json({ error: 'Failed to unverify user' });
  }
});

// Unverify all users (admin only)
app.post('/api/admin/unverify-all-users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await User.updateMany(
      { discordVerified: true },
      {
        $set: {
          discordVerified: false,
          discordId: null,
          discordUsername: null,
          discordAvatar: null,
          discordAccessToken: null,
          discordRefreshToken: null,
          discordTokenExpiresAt: null,
          discordEmail: null,
          discordGuilds: []
        }
      }
    );

    await logActivity(
      req.session.user.username,
      'admin',
      `Mass unverified ${result.modifiedCount} Discord users`
    );

    await notifyAdminAction(
      req.session.user.username,
      'Mass Unverify',
      `Removed Discord verification from ${result.modifiedCount} users`
    );

    res.json({
      success: true,
      count: result.modifiedCount,
      message: `Successfully unverified ${result.modifiedCount} users`
    });
  } catch (error) {
    console.error('Unverify all users error:', error);
    res.status(500).json({ error: 'Failed to unverify users' });
  }
});

// Product Management APIs
app.get('/api/admin/products', requireAuth, requireAdmin, async (req, res) => {
  try {
    const products = await Product.find({}).sort({ createdAt: -1 });

    const productsData = products.map(product => ({
      productKey: product.productKey,
      displayName: product.displayName,
      description: product.description,
      isActive: product.isActive,
      packages: Object.fromEntries(product.packages),
      announcements: product.announcements || '',
      genzauthSellerKey: product.genzauthSellerKey || '',
      allowHwidReset: product.allowHwidReset || false,
      maxFreeHwidResets: product.maxFreeHwidResets || 5,
      hwidResetPrice: product.hwidResetPrice || 0,
      downloadLink: product.downloadLink || '',
      setupVideoLink: product.setupVideoLink || '',
      guestVideoLink: product.guestVideoLink || '',
      settings: Object.fromEntries(product.settings || new Map()),
      createdAt: product.createdAt
    }));

    res.json({ success: true, products: productsData });
  } catch (error) {
    console.error('Get products error:', error);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

app.post('/api/admin/products', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { productKey, displayName, description, packages, announcements, genzauthSellerKey, allowHwidReset, maxFreeHwidResets, hwidResetPrice, downloadLink, setupVideoLink, guestVideoLink } = req.body;

    if (!productKey || !displayName) {
      return res.status(400).json({ error: 'Product key and display name are required' });
    }

    // Validate video links if provided
    const urlPattern = /^https?:\/\/.+/i;
    if (setupVideoLink && setupVideoLink.trim() && !urlPattern.test(setupVideoLink.trim())) {
      return res.status(400).json({ error: 'Setup video link must be a valid URL starting with http:// or https://' });
    }
    if (guestVideoLink && guestVideoLink.trim() && !urlPattern.test(guestVideoLink.trim())) {
      return res.status(400).json({ error: 'Guest video link must be a valid URL starting with http:// or https://' });
    }

    const existingProduct = await Product.findOne({ productKey });
    if (existingProduct) {
      return res.status(400).json({ error: 'Product with this key already exists' });
    }

    const packagesMap = new Map(Object.entries(packages || {}));

    const product = await Product.create({
      productKey: productKey.toUpperCase().replace(/\s+/g, '_'),
      displayName,
      description: description || '',
      packages: packagesMap,
      announcements: announcements || '',
      genzauthSellerKey: genzauthSellerKey || '',
      allowHwidReset: allowHwidReset || false,
      maxFreeHwidResets: maxFreeHwidResets || 5,
      hwidResetPrice: hwidResetPrice || 0,
      downloadLink: downloadLink || '',
      setupVideoLink: setupVideoLink || '',
      guestVideoLink: guestVideoLink || '',
      createdBy: req.session.user.username,
      isActive: true
    });

    await logActivity(req.session.user.username, 'product-create', `Created new product: ${displayName}`);

    res.json({
      success: true,
      message: 'Product created successfully',
      product: {
        productKey: product.productKey,
        displayName: product.displayName,
        description: product.description,
        announcements: product.announcements,
        genzauthSellerKey: product.genzauthSellerKey ? '***configured***' : '',
        allowHwidReset: product.allowHwidReset,
        downloadLink: product.downloadLink
      }
    });
  } catch (error) {
    console.error('Create product error:', error);
    res.status(500).json({ error: 'Failed to create product' });
  }
});

app.put('/api/admin/products/:productKey', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { productKey } = req.params;
    const { displayName, description, packages, isActive, announcements, genzauthSellerKey, allowHwidReset, maxFreeHwidResets, hwidResetPrice, downloadLink, setupVideoLink, guestVideoLink } = req.body;

    const product = await Product.findOne({ productKey });
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    // Validate video links if provided
    const urlPattern = /^https?:\/\/.+/i;
    if (setupVideoLink !== undefined && setupVideoLink.trim() && !urlPattern.test(setupVideoLink.trim())) {
      return res.status(400).json({ error: 'Setup video link must be a valid URL starting with http:// or https://' });
    }
    if (guestVideoLink !== undefined && guestVideoLink.trim() && !urlPattern.test(guestVideoLink.trim())) {
      return res.status(400).json({ error: 'Guest video link must be a valid URL starting with http:// or https://' });
    }

    if (displayName) product.displayName = displayName;
    if (description !== undefined) product.description = description;
    if (isActive !== undefined) product.isActive = isActive;
    if (packages) product.packages = new Map(Object.entries(packages));
    if (announcements !== undefined) product.announcements = announcements;
    if (genzauthSellerKey !== undefined) product.genzauthSellerKey = genzauthSellerKey;
    if (allowHwidReset !== undefined) product.allowHwidReset = allowHwidReset;
    if (maxFreeHwidResets !== undefined) product.maxFreeHwidResets = maxFreeHwidResets;
    if (hwidResetPrice !== undefined) product.hwidResetPrice = hwidResetPrice;
    if (downloadLink !== undefined) product.downloadLink = downloadLink;
    if (setupVideoLink !== undefined) product.setupVideoLink = setupVideoLink;
    if (guestVideoLink !== undefined) product.guestVideoLink = guestVideoLink;

    await product.save();

    await logActivity(req.session.user.username, 'product-update', `Updated product: ${productKey}`);

    res.json({
      success: true,
      message: 'Product updated successfully'
    });
  } catch (error) {
    console.error('Update product error:', error);
    res.status(500).json({ error: 'Failed to update product' });
  }
});

app.delete('/api/admin/products/:productKey', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { productKey } = req.params;

    const product = await Product.findOneAndDelete({ productKey });
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    await logActivity(req.session.user.username, 'product-delete', `Deleted product: ${productKey}`);

    res.json({
      success: true,
      message: 'Product deleted successfully'
    });
  } catch (error) {
    console.error('Delete product error:', error);
    res.status(500).json({ error: 'Failed to delete product' });
  }
});

// Get guest pass data for admin panel
app.get('/api/admin/guest-passes', requireAuth, requireAdmin, async (req, res) => {
  try {
    const guests = await User.find({ isGuest: true })
      .select('username guestPassUsed guestPassType discordVerified lastUpdated createdAt')
      .sort({ createdAt: -1 });

    const guestData = guests.map(guest => ({
      username: guest.username,
      passActive: !guest.guestPassUsed,
      guestPassType: guest.guestPassType || '-',
      discordVerified: guest.discordVerified || false,
      lastUpdated: guest.lastUpdated || guest.createdAt
    }));

    res.json(guestData);
  } catch (error) {
    console.error('Get guest passes error:', error);
    res.status(500).json({ error: 'Failed to fetch guest passes' });
  }
});

// Perform guest pass action (restore or disable single user)
app.post('/api/admin/guest-pass-action', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { username, action } = req.body;

    if (!username || !action) {
      return res.status(400).json({ error: 'Username and action are required' });
    }

    const user = await User.findOne({ username: username.toLowerCase() });
    if (!user || !user.isGuest) {
      return res.status(404).json({ error: 'Guest user not found' });
    }

    if (action === 'restore') {
      user.guestPassUsed = false;
      user.guestPassType = null;
    } else if (action === 'disable') {
      user.guestPassUsed = true;
    } else {
      return res.status(400).json({ error: 'Invalid action' });
    }

    user.lastUpdated = new Date();
    await user.save();

    await logActivity(
      req.session.user.username,
      'guest-pass-action',
      `${action === 'restore' ? 'Restored' : 'Disabled'} guest pass for: ${username}`
    );

    res.json({
      success: true,
      message: `Guest pass ${action === 'restore' ? 'restored' : 'disabled'} for ${username}`
    });
  } catch (error) {
    console.error('Guest pass action error:', error);
    res.status(500).json({ error: 'Failed to perform action' });
  }
});

// Restore ALL Guest Passes (ONE CLICK)
app.post('/api/admin/restore-all-guest-passes', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await User.updateMany(
      { isGuest: true },
      {
        guestPassUsed: false,
        guestPassType: null,
        lastUpdated: new Date()
      }
    );
    await logActivity(req.session.user.username, 'guest-passes-restore-all', `Restored ${result.modifiedCount} guest passes`);
    res.json({ success: true, count: result.modifiedCount });
  } catch (error) {
    res.status(500).json({ error: 'Failed to restore guest passes' });
  }
});

// Disable ALL Guest Passes (ONE CLICK)
app.post('/api/admin/disable-all-guest-passes', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await User.updateMany(
      { isGuest: true },
      { guestPassUsed: true }
    );
    await logActivity(req.session.user.username, 'guest-passes-disable-all', `Disabled ${result.modifiedCount} guest passes`);
    res.json({ success: true, count: result.modifiedCount });
  } catch (error) {
    res.status(500).json({ error: 'Failed to disable guest passes' });
  }
});

// Reset ALL Guest Passes (ONE CLICK)
app.post('/api/admin/reset-all-guest-passes', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await User.updateMany(
      { isGuest: true },
      { guestPassUsed: false }
    );
    await logActivity(req.session.user.username, 'guest-passes-reset-all', `Reset ${result.modifiedCount} guest passes`);
    res.json({ success: true, count: result.modifiedCount });
  } catch (error) {
    res.status(500).json({ error: 'Failed to reset guest passes' });
  }
});

// Socket.IO connection handling
const activeUsers = new Map(); // Map of username -> socket.id

io.on('connection', (socket) => {
  console.log('🔌 New socket connection:', socket.id);

  // User joins chat
  socket.on('join-chat', async (data) => {
    const { username, userType } = data;
    socket.username = username;
    socket.userType = userType;
    activeUsers.set(username, socket.id);

    console.log(`✅ ${userType} joined chat: ${username}`);

    // Notify others that user is online
    socket.broadcast.emit('user-online', { username, userType });
  });

  // Send message
  socket.on('send-message', async (data) => {
    try {
      const { senderUsername, senderType, receiverUsername, message } = data;

      // Save message to database
      const chatMessage = await ChatMessage.create({
        senderUsername,
        senderType,
        receiverUsername,
        message
      });

      // Emit to receiver if online
      const receiverSocketId = activeUsers.get(receiverUsername);
      if (receiverSocketId) {
        io.to(receiverSocketId).emit('new-message', {
          _id: chatMessage._id,
          senderUsername,
          senderType,
          receiverUsername,
          message,
          timestamp: chatMessage.timestamp,
          isRead: false
        });
      }

      // Send confirmation back to sender
      socket.emit('message-sent', {
        _id: chatMessage._id,
        senderUsername,
        senderType,
        receiverUsername,
        message,
        timestamp: chatMessage.timestamp,
        isRead: false
      });

    } catch (error) {
      console.error('Error sending message:', error);
      socket.emit('message-error', { error: 'Failed to send message' });
    }
  });

  // Mark messages as read
  socket.on('mark-read', async (data) => {
    try {
      const { messageIds } = data;
      await ChatMessage.updateMany(
        { _id: { $in: messageIds } },
        { isRead: true, readAt: new Date() }
      );

      socket.emit('messages-marked-read', { messageIds });
    } catch (error) {
      console.error('Error marking messages as read:', error);
    }
  });

  // User typing indicator
  socket.on('typing', (data) => {
    const { receiverUsername } = data;
    const receiverSocketId = activeUsers.get(receiverUsername);
    if (receiverSocketId) {
      io.to(receiverSocketId).emit('user-typing', {
        username: socket.username,
        userType: socket.userType
      });
    }
  });

  // Disconnect
  socket.on('disconnect', () => {
    if (socket.username) {
      activeUsers.delete(socket.username);
      socket.broadcast.emit('user-offline', {
        username: socket.username,
        userType: socket.userType
      });
      console.log(`❌ ${socket.userType} left chat: ${socket.username}`);
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🌐 Server running on port ${PORT}`);
  console.log(`🚀 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log('✅ Server ready - accepting connections');
  console.log(`🔐 LicenseAuth: ${process.env.LICENSEAUTH_SELLER_KEY ? 'Configured' : 'Not configured (TEST MODE)'}`);
});

const gracefulShutdown = async (signal) => {
  console.log(`${signal} signal received: closing server`);
  server.close(async () => {
    try {
      await mongoose.connection.close();
      console.log('MongoDB connection closed');
      process.exit(0);
    } catch (err) {
      console.error('Error during shutdown:', err);
      process.exit(1);
    }
  });
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

module.exports = app;