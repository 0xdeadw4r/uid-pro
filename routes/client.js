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
const isAdminOrOwner = async (req, res, next) => {
    try {
        console.log('🔍 Admin check - Session:', JSON.stringify({
            userId: req.session.userId,
            sessionUser: req.session.user,
            sessionID: req.sessionID
        }, null, 2));

        // Try multiple session formats
        let user = null;

        // Check if userId exists in session
        if (req.session.userId) {
            user = await User.findById(req.session.userId);
        }
        // Check if user.username exists
        else if (req.session.user && req.session.user.username) {
            user = await User.findOne({ username: req.session.user.username });
        }
        // Check if user object has _id
        else if (req.session.user && req.session.user._id) {
            user = await User.findById(req.session.user._id);
        }

        if (!user) {
            console.log('❌ Admin check failed - No user found in session');
            return res.status(401).json({ error: 'Not authenticated', needsAuth: true });
        }

        console.log('✅ User found:', user.username, 'Admin:', user.isAdmin, 'Owner:', user.isOwner, 'SuperAdmin:', user.isSuperAdmin);

        if (user.isAdmin || user.isOwner || user.isSuperAdmin) {
            console.log('✅ Admin/Owner access granted');
            return next();
        }

        console.log('❌ Admin check failed - Insufficient permissions');
        return res.status(403).json({ error: 'Access denied - Admin or Owner privileges required' });
    } catch (error) {
        console.error('❌ Admin check error:', error);
        return res.status(500).json({ error: 'Server error: ' + error.message });
    }
};

// Client Login Page - removed, now uses main /login page

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
    const path = require('path');
    res.sendFile(path.join(__dirname, '../views/client-dashboard.html'));
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

        const Product = require('../models/Product');
        const product = await Product.findOne({ productKey: client.productKey });

        const downloadLink = client.customDownloadLink || (product ? product.downloadLink : '');

        // Get UID info if this is a UID Bypass client
        let uidData = null;
        if (client.assignedUid) {
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
                productKey: client.productKey,
                assignedUsername: client.assignedUsername || null,
                assignedUid: client.assignedUid || null,
                uidExpiresAt: uidData ? uidData.expiresAt : null,
                uidStatus: uidData ? uidData.status : null,
                downloadLink: downloadLink || '',
                hasDownloadLink: !!downloadLink,
                lastLogin: client.lastLogin,
                lastHwidReset: client.lastHwidReset,
                hwidResetCount: client.hwidResetCount,
                createdAt: client.createdAt,
                productInfo: product ? {
                    displayName: product.displayName,
                    allowHwidReset: product.allowHwidReset,
                    maxFreeHwidResets: product.maxFreeHwidResets || 5,
                    hwidResetPrice: product.hwidResetPrice || 0,
                    genzAuthSellerApi: product.genzAuthSellerApi
                } : null
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

        const Product = require('../models/Product');
        const product = await Product.findOne({ productKey: client.productKey });

        // Only UID_BYPASS clients can use this endpoint
        if (!product || product.productKey !== 'UID_BYPASS') {
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

// Reset HWID (for clients with product allowing HWID reset)
router.post('/api/reset-hwid', isClient, async (req, res) => {
    try {
        const client = await Client.findById(req.session.clientId);

        if (!client) {
            return res.status(404).json({ error: 'Client not found' });
        }

        if (!client.isActive) {
            return res.status(403).json({ error: 'Account is disabled' });
        }

        const Product = require('../models/Product');
        const product = await Product.findOne({ productKey: client.productKey });

        // Check if the product allows HWID reset
        if (!product || !product.allowHwidReset) {
            return res.status(403).json({ error: 'This feature is not available for your product' });
        }

        // Check if client has exceeded free reset limit
        const currentResetCount = client.hwidResetCount || 0;
        const maxFreeResets = product.maxFreeHwidResets || 5;
        const resetPrice = product.hwidResetPrice || 0;
        const now = new Date();

        if (currentResetCount >= maxFreeResets) {
            const priceMsg = resetPrice > 0 ? ` for $${resetPrice}` : '';
            return res.status(403).json({ 
                error: `You have used all ${maxFreeResets} free HWID resets. Please contact the administrator${priceMsg} to reset your HWID.`,
                limitReached: true,
                resetPrice: resetPrice
            });
        }

        // Perform HWID reset via GenzAuth if configured
        if (client.assignedUsername && product.genzAuthSellerApi) {
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

        const resetsRemaining = maxFreeResets - client.hwidResetCount;
        
        res.json({
            success: true,
            message: `HWID reset successfully. You have ${resetsRemaining} free reset(s) remaining.`,
            lastReset: client.lastHwidReset,
            resetCount: client.hwidResetCount,
            resetsRemaining: resetsRemaining,
            maxFreeResets: maxFreeResets
        });
    } catch (error) {
        console.error('Reset HWID error:', error);
        res.status(500).json({ error: 'Failed to reset HWID' });
    }
});

// Admin: Get all clients
router.get('/admin/clients', isAdminOrOwner, async (req, res) => {
    try {
        const Product = require('../models/Product');

        const clients = await Client.find({})
            .populate('createdBy', 'username')
            .sort({ createdAt: -1 });

        // Populate product info for each client
        const clientsWithProducts = await Promise.all(clients.map(async (client) => {
            const product = await Product.findOne({ productKey: client.productKey });
            const clientObj = client.toObject();
            clientObj.product = product ? {
                displayName: product.displayName,
                allowHwidReset: product.allowHwidReset,
                downloadLink: product.downloadLink,
                genzAuthSellerApi: product.genzAuthSellerApi
            } : null;
            return clientObj;
        }));

        res.json({
            success: true,
            clients: clientsWithProducts
        });
    } catch (error) {
        console.error('Get clients error:', error);
        res.status(500).json({ error: 'Failed to fetch clients' });
    }
});

// Admin: Create client
router.post('/admin/clients', isAdminOrOwner, async (req, res) => {
    try {
        const { 
            username, password, productKey, assignedUsername, assignedUid, notes, customDownloadLink,
            createGenzAuthAccount, genzAuthUsername, genzAuthPassword, genzAuthDuration
        } = req.body;

        if (!username || !password || !productKey) {
            return res.status(400).json({ error: 'Username, password, and product are required' });
        }

        const existingClient = await Client.findOne({ username: username.toLowerCase() });
        if (existingClient) {
            return res.status(400).json({ error: 'Client username already exists' });
        }

        const Product = require('../models/Product');
        const product = await Product.findOne({ productKey });
        if (!product) {
            return res.status(404).json({ error: 'Product not found' });
        }

        // Get the admin user who is creating this client
        let adminUser = null;
        
        if (req.session.userId) {
            adminUser = await User.findById(req.session.userId);
        } else if (req.session.user && req.session.user.username) {
            adminUser = await User.findOne({ username: req.session.user.username });
        } else if (req.session.user && req.session.user._id) {
            adminUser = await User.findById(req.session.user._id);
        }
        
        if (!adminUser) {
            return res.status(401).json({ error: 'Admin user not found' });
        }

        let genzAuthCreated = false;
        let genzAuthError = null;
        let finalAssignedUsername = assignedUsername || null;

        // Create GenzAuth account if requested
        if (createGenzAuthAccount && genzAuthUsername && genzAuthPassword) {
            try {
                const genzauth = require('../services/genzauth');
                const duration = parseInt(genzAuthDuration) || 30;
                
                console.log(`📝 Creating GenzAuth account: ${genzAuthUsername} (${duration}d)`);
                
                const result = await genzauth.createUser(genzAuthUsername, genzAuthPassword, duration);
                
                if (result.success) {
                    console.log(`✅ GenzAuth account created: ${genzAuthUsername}`);
                    genzAuthCreated = true;
                    finalAssignedUsername = genzAuthUsername;
                } else {
                    console.error(`❌ GenzAuth creation failed: ${result.error || result.message}`);
                    genzAuthError = result.error || result.message || 'Failed to create GenzAuth account';
                }
            } catch (error) {
                console.error('❌ GenzAuth API error:', error);
                genzAuthError = error.message;
            }
        }

        const newClient = await Client.create({
            username: username.toLowerCase(),
            password,
            productKey,
            assignedUsername: finalAssignedUsername,
            assignedUid: assignedUid || null,
            notes: notes || null,
            customDownloadLink: customDownloadLink || null,
            createdBy: adminUser._id,
            isActive: true,
            lastLogin: null,
            lastHwidReset: null,
            hwidResetCount: 0
        });

        const response = {
            success: true,
            message: 'Client created successfully',
            client: {
                id: newClient._id,
                username: newClient.username,
                productKey: newClient.productKey,
                productDisplayName: product.displayName
            },
            genzAuthCreated
        };

        if (genzAuthError) {
            response.genzAuthError = genzAuthError;
            response.message += ` (GenzAuth account creation failed: ${genzAuthError})`;
        }

        res.json(response);
    } catch (error) {
        console.error('Create client error:', error);
        res.status(500).json({ error: 'Failed to create client' });
    }
});

// Admin: Update client
router.put('/admin/clients/:id', isAdminOrOwner, async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;

        // Don't allow updating username, productKey, or createdBy directly via this endpoint
        delete updates.username;
        delete updates.productKey;
        delete updates.createdBy;
        delete updates.createdAt;
        delete updates.lastLogin;
        delete updates.lastHwidReset;
        delete updates.hwidResetCount;

        // If password is being updated, it will be handled by schema pre-save hook if it exists
        // Ensure the password field is not directly overwritten if it's not intended
        if (updates.password && updates.password.length < 8) { // Basic password length check
            return res.status(400).json({ error: 'Password must be at least 8 characters long.' });
        }
        
        // Handle customDownloadLink separately if it's being updated
        if (updates.customDownloadLink !== undefined) {
            const clientForLinkUpdate = await Client.findById(id);
            if (!clientForLinkUpdate) {
                return res.status(404).json({ error: 'Client not found' });
            }
            clientForLinkUpdate.customDownloadLink = updates.customDownloadLink;
            await clientForLinkUpdate.save();
            delete updates.customDownloadLink; // Remove from updates to prevent further processing
        }

        const client = await Client.findByIdAndUpdate(id, updates, { new: true })
            .select('-password');

        if (!client) {
            return res.status(404).json({ error: 'Client not found' });
        }

        // If a productKey was intended to be updated, it needs to be re-fetched to get product details
        // For now, we assume productKey is not directly updatable via this PUT, or handled elsewhere.
        // If productKey *can* be updated, you'd need to re-fetch the product and update related fields if necessary.

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

// Admin: Update client download link
router.put('/admin/clients/:id/download-link', isAdminOrOwner, async (req, res) => {
    try {
        const { id } = req.params;
        const { downloadLink } = req.body;

        const client = await Client.findById(id);
        if (!client) {
            return res.status(404).json({ error: 'Client not found' });
        }

        client.customDownloadLink = downloadLink || null;
        await client.save();

        res.json({
            success: true,
            message: 'Download link updated successfully'
        });
    } catch (error) {
        console.error('Update download link error:', error);
        res.status(500).json({ error: 'Failed to update download link' });
    }
});

// Admin: Update global download links by product type
router.put('/admin/download-links', isAdminOrOwner, async (req, res) => {
    try {
        const { aimkillLink, uidBypassLink, silentAimLink } = req.body;

        const Product = require('../models/Product');

        // Update Aimkill product download link
        if (aimkillLink !== undefined) {
            await Product.updateOne(
                { productKey: 'AIMKILL' },
                { $set: { downloadLink: aimkillLink } }
            );
        }

        // Update UID Bypass product download link
        if (uidBypassLink !== undefined) {
            await Product.updateOne(
                { productKey: 'UID_BYPASS' },
                { $set: { downloadLink: uidBypassLink } }
            );
        }

        // Update Silent Aim product download link
        if (silentAimLink !== undefined) {
            const silentAimProduct = await Product.findOne({ productKey: 'SILENT_AIM' });
            if (silentAimProduct) {
                silentAimProduct.downloadLink = silentAimLink;
                await silentAimProduct.save();
            } else {
                // Create if doesn't exist
                await Product.create({
                    productKey: 'SILENT_AIM',
                    displayName: 'Silent Aim',
                    description: 'Silent Aim product for clients',
                    isActive: true,
                    createdBy: 'system',
                    allowHwidReset: false,
                    downloadLink: silentAimLink,
                    packages: new Map()
                });
            }
        }

        res.json({
            success: true,
            message: 'Global download links updated successfully'
        });
    } catch (error) {
        console.error('Update global download links error:', error);
        res.status(500).json({ error: 'Failed to update download links' });
    }
});

// Admin: Delete client
router.delete('/admin/clients/:id', isAdminOrOwner, async (req, res) => {
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