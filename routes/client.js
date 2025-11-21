const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const Client = require('../models/Client');
const User = require('../models/User');
const genzauth = require('../services/genzauth');

// Middleware to check if user is a client
const isClient = (req, res, next) => {
    console.log('🔍 Client auth check - Path:', req.path);
    console.log('🔍 Client auth check - Session ID:', req.sessionID);
    console.log('🔍 Client auth check - Session:', JSON.stringify({
        clientId: req.session?.clientId,
        clientUsername: req.session?.clientUsername,
        isClient: req.session?.isClient
    }, null, 2));
    
    // Check if client session exists
    if (req.session?.clientId && req.session?.isClient === true) {
        console.log('✅ Client authenticated:', req.session.clientUsername);
        return next();
    }
    
    console.log('❌ Client not authenticated, path:', req.path);
    
    // For API requests, return JSON error
    if (req.path.startsWith('/api/')) {
        return res.status(401).json({ error: 'Not authenticated', redirect: '/client/login' });
    }
    
    // For page requests, redirect to login (but not if already on login page)
    return res.redirect('/client/login');
};

// Middleware to check if user is admin/owner
const isAdminOrOwner = (req, res, next) => {
    // Check both session formats (client and regular admin)
    const userId = req.session.userId || (req.session.user && req.session.user.username);
    
    if (!userId) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    
    // If we have a username from session.user, find by username
    if (req.session.user && req.session.user.username) {
        User.findOne({ username: req.session.user.username }).then(user => {
            if (user && (user.isAdmin || user.isOwner || user.isSuperAdmin)) {
                return next();
            }
            res.status(403).json({ error: 'Access denied' });
        }).catch(err => {
            res.status(500).json({ error: 'Server error' });
        });
    } else {
        // Otherwise find by ID
        User.findById(req.session.userId).then(user => {
            if (user && (user.isAdmin || user.isOwner || user.isSuperAdmin)) {
                return next();
            }
            res.status(403).json({ error: 'Access denied' });
        }).catch(err => {
            res.status(500).json({ error: 'Server error' });
        });
    }
};

// Client Login Page
router.get('/login', (req, res) => {
    // If already logged in, redirect to dashboard
    if (req.session && req.session.clientId && req.session.isClient) {
        return res.redirect('/client/dashboard');
    }
    res.sendFile('client-login.html', { root: './public' });
});

// Client Login API
router.post('/api/login', async (req, res) => {
    try {
        let { username, password } = req.body;
        
        // Trim whitespace from inputs
        username = username ? username.trim() : '';
        password = password ? password.trim() : '';
        
        console.log('📝 Client login attempt:', username);
        
        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password are required' });
        }
        
        const client = await Client.findOne({ username: username.toLowerCase() });
        
        if (!client) {
            console.log('❌ Client not found:', username);
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        if (!client.isActive) {
            console.log('❌ Client account disabled:', username);
            return res.status(403).json({ error: 'Account is disabled' });
        }
        
        console.log('🔐 Checking password for client:', username);
        
        // Check if password is hashed (bcrypt) or plain text
        let passwordMatches = false;
        
        if (client.password.startsWith('$2b$') || client.password.startsWith('$2a$')) {
            // Password is hashed - use bcrypt to compare
            passwordMatches = await bcrypt.compare(password, client.password);
        } else {
            // Password is plain text - direct comparison
            passwordMatches = client.password === password;
        }
        
        if (!passwordMatches) {
            console.log('❌ Password mismatch for client:', username);
            return res.status(401).json({ error: 'Invalid username or password' });
        }
        
        console.log('✅ Password matched for client:', username);
        
        // Update last login
        client.lastLogin = new Date();
        await client.save();
        
        // Set session data - using same pattern as admin login
        req.session.clientId = client._id;
        req.session.clientUsername = client.username;
        req.session.isClient = true;
        
        // Save session with callback - same pattern as admin login
        req.session.save((err) => {
            if (err) {
                console.error('❌ Session save error:', err);
                return res.status(500).json({ error: 'Session error' });
            }
            
            console.log('✅ Client session saved successfully');
            console.log('   Session ID:', req.sessionID);
            console.log('   Client ID:', req.session.clientId);
            console.log('   Client Username:', req.session.clientUsername);
            console.log('   isClient flag:', req.session.isClient);
            
            res.json({ 
                success: true, 
                message: 'Login successful',
                username: client.username,
                redirectUrl: '/client/dashboard'
            });
        });
        
    } catch (error) {
        console.error('❌ Client login error:', error);
        res.status(500).json({ error: 'Login failed. Please try again.' });
    }
});

// Client Logout
router.post('/api/logout', (req, res) => {
    const username = req.session.clientUsername;
    req.session.destroy((err) => {
        if (err) {
            console.error('❌ Logout error:', err);
            return res.status(500).json({ error: 'Logout failed' });
        }
        console.log('✅ Client logged out:', username);
        res.json({ success: true, message: 'Logged out successfully' });
    });
});

// Client Dashboard
router.get('/dashboard', isClient, (req, res) => {
    res.sendFile('client-dashboard.html', { root: './public' });
});

// Get Client Info
router.get('/api/info', isClient, async (req, res) => {
    try {
        console.log('📊 Getting client info for session:', req.sessionID);
        console.log('   Client ID:', req.session.clientId);
        
        const client = await Client.findById(req.session.clientId)
            .select('-password')
            .populate('createdBy', 'username');
        
        if (!client) {
            console.error('❌ Client not found in database:', req.session.clientId);
            return res.status(404).json({ error: 'Client not found' });
        }
        
        console.log('✅ Client info retrieved:', client.username);
        
        const downloadLink = client.getDownloadLink();
        
        // Get UID info if this is a UID Bypass client
        let uidData = null;
        if (client.productType === 'UID_BYPASS' && client.assignedUid) {
            const UID = require('../models/UID');
            const uidRecord = await UID.findOne({ uid: client.assignedUid });
            if (uidRecord) {
                uidData = {
                    uid: uidRecord.uid,
                    expiresAt: uidRecord.expiresAt,
                    status: uidRecord.status,
                    duration: uidRecord.duration
                };
            }
        }
        
        res.json({
            success: true,
            client: {
                username: client.username,
                productType: client.productType,
                assignedUsername: client.assignedUsername || null,
                assignedUid: client.assignedUid || null,
                uidExpiresAt: uidData ? uidData.expiresAt : null,
                uidStatus: uidData ? uidData.status : null,
                downloadLink: downloadLink || '',
                hasDownloadLink: !!downloadLink,
                lastLogin: client.lastLogin,
                lastHwidReset: client.lastHwidReset,
                hwidResetCount: client.hwidResetCount,
                createdAt: client.createdAt
            }
        });
    } catch (error) {
        console.error('❌ Get client info error:', error);
        res.status(500).json({ error: 'Failed to get client info' });
    }
});

// Create UID Bypass Account
router.post('/api/create-uid-bypass', isClient, async (req, res) => {
    try {
        const { uid, duration } = req.body;
        const client = await Client.findById(req.session.clientId);
        
        if (!client) {
            return res.status(404).json({ error: 'Client not found' });
        }
        
        if (!client.isActive) {
            return res.status(403).json({ error: 'Account is disabled' });
        }
        
        // Only UID_BYPASS clients can use this endpoint
        if (client.productType !== 'UID_BYPASS') {
            return res.status(403).json({ error: 'This feature is only available for UID Bypass clients' });
        }
        
        // Validate inputs
        if (!uid || !duration) {
            return res.status(400).json({ error: 'UID and duration are required' });
        }
        
        if (!/^\d+$/.test(uid)) {
            return res.status(400).json({ error: 'UID must contain only numbers' });
        }
        
        const durationDays = parseInt(duration);
        if (isNaN(durationDays) || durationDays < 1) {
            return res.status(400).json({ error: 'Invalid duration' });
        }
        
        // Check if UID already exists
        const UID = require('../models/UID');
        const existingUID = await UID.findOne({ uid });
        
        if (existingUID) {
            return res.status(400).json({ error: 'UID already exists' });
        }
        
        // Calculate expiry date
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + durationDays);
        
        // Create UID
        const newUID = await UID.create({
            uid,
            createdBy: client.createdBy || null,
            expiresAt,
            duration: `${durationDays}day${durationDays !== 1 ? 's' : ''}`,
            status: 'active'
        });
        
        // Update client with assigned UID
        client.assignedUid = uid;
        await client.save();
        
        res.json({
            success: true,
            message: 'UID Bypass account created successfully',
            uid: {
                uid: newUID.uid,
                expiresAt: newUID.expiresAt,
                duration: newUID.duration,
                status: newUID.status
            }
        });
    } catch (error) {
        console.error('Create UID Bypass error:', error);
        res.status(500).json({ error: 'Failed to create UID Bypass account' });
    }
});

// Reset HWID (for AIMKILL clients)
router.post('/api/reset-hwid', isClient, async (req, res) => {
    try {
        const client = await Client.findById(req.session.clientId);
        
        if (!client) {
            return res.status(404).json({ error: 'Client not found' });
        }
        
        if (!client.isActive) {
            return res.status(403).json({ error: 'Account is disabled' });
        }
        
        // Only AIMKILL clients can use this endpoint
        if (client.productType !== 'AIMKILL') {
            return res.status(403).json({ error: 'This feature is only available for Aimkill clients' });
        }
        
        // Check if reset is available
        const now = new Date();
        const resetCooldown = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
        
        if (client.lastHwidReset) {
            const timeSinceLastReset = now - client.lastHwidReset;
            if (timeSinceLastReset < resetCooldown) {
                const hoursRemaining = Math.ceil((resetCooldown - timeSinceLastReset) / (60 * 60 * 1000));
                return res.status(429).json({ 
                    error: `HWID reset is on cooldown. Please wait ${hoursRemaining} hour(s) before trying again.` 
                });
            }
        }
        
        // Perform HWID reset via GenzAuth
        if (client.assignedUsername) {
            try {
                const result = await genzauth.resetHWID(client.assignedUsername);
                if (!result.success) {
                    return res.status(500).json({ error: result.error || 'Failed to reset HWID' });
                }
            } catch (error) {
                console.error('GenzAuth HWID reset error:', error);
                return res.status(500).json({ error: 'Failed to reset HWID through authentication service' });
            }
        }
        
        // Update client
        client.lastHwidReset = now;
        client.hwidResetCount = (client.hwidResetCount || 0) + 1;
        await client.save();
        
        res.json({
            success: true,
            message: 'HWID reset successfully',
            lastReset: client.lastHwidReset,
            resetCount: client.hwidResetCount
        });
    } catch (error) {
        console.error('Reset HWID error:', error);
        res.status(500).json({ error: 'Failed to reset HWID' });
    }
});

// Admin: Get all clients
router.get('/api/admin/clients', isAdminOrOwner, async (req, res) => {
    try {
        const clients = await Client.find()
            .select('-password')
            .populate('createdBy', 'username')
            .sort({ createdAt: -1 });
        
        res.json({ success: true, clients });
    } catch (error) {
        console.error('Get clients error:', error);
        res.status(500).json({ error: 'Failed to get clients' });
    }
});

// Admin: Create client
router.post('/api/admin/clients', isAdminOrOwner, async (req, res) => {
    try {
        const { username, password, productType, assignedUsername, assignedUid } = req.body;
        
        if (!username || !password || !productType) {
            return res.status(400).json({ error: 'Username, password, and product type are required' });
        }
        
        // Check if client already exists
        const existingClient = await Client.findOne({ username: username.toLowerCase() });
        if (existingClient) {
            return res.status(400).json({ error: 'Client with this username already exists' });
        }
        
        // Create client
        const client = await Client.create({
            username: username.toLowerCase(),
            password,
            productType,
            assignedUsername: assignedUsername || null,
            assignedUid: assignedUid || null,
            isActive: true,
            createdBy: req.session.userId,
            lastLogin: null,
            lastHwidReset: null,
            hwidResetCount: 0
        });
        
        res.json({
            success: true,
            message: 'Client created successfully',
            client: {
                id: client._id,
                username: client.username,
                productType: client.productType
            }
        });
    } catch (error) {
        console.error('Create client error:', error);
        res.status(500).json({ error: 'Failed to create client' });
    }
});

// Admin: Update client
router.put('/api/admin/clients/:id', isAdminOrOwner, async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;
        
        // Don't allow updating username
        delete updates.username;
        
        // If password is being updated, it will be hashed by the schema pre-save hook
        
        const client = await Client.findByIdAndUpdate(id, updates, { new: true })
            .select('-password');
        
        if (!client) {
            return res.status(404).json({ error: 'Client not found' });
        }
        
        res.json({
            success: true,
            message: 'Client updated successfully',
            client
        });
    } catch (error) {
        console.error('Update client error:', error);
        res.status(500).json({ error: 'Failed to update client' });
    }
});

// Admin: Delete client
router.delete('/api/admin/clients/:id', isAdminOrOwner, async (req, res) => {
    try {
        const { id } = req.params;
        
        const client = await Client.findByIdAndDelete(id);
        
        if (!client) {
            return res.status(404).json({ error: 'Client not found' });
        }
        
        res.json({
            success: true,
            message: 'Client deleted successfully'
        });
    } catch (error) {
        console.error('Delete client error:', error);
        res.status(500).json({ error: 'Failed to delete client' });
    }
});

module.exports = router;
