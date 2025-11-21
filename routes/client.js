const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const Client = require('../models/Client');
const User = require('../models/User');
const genzauth = require('../services/genzauth');

// Middleware to check if user is a client
const isClient = (req, res, next) => {
    console.log('🔍 Client auth check - Session ID:', req.sessionID);
    console.log('🔍 Client auth check - Session data:', req.session);
    
    if (req.session && req.session.clientId && req.session.isClient) {
        console.log('✅ Client authenticated:', req.session.clientUsername);
        return next();
    }
    
    console.log('❌ Client not authenticated');
    
    // For API requests, return JSON error
    if (req.path.includes('/api/')) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    
    // For page requests, redirect to login
    res.redirect('/client/login');
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
    if (req.session.clientId) {
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
        
        console.log('Client login attempt:', username);
        
        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password are required' });
        }
        
        const client = await Client.findOne({ username: username.toLowerCase() });
        
        if (!client) {
            console.log('Client not found:', username);
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        if (!client.isActive) {
            console.log('Client account disabled:', username);
            return res.status(403).json({ error: 'Account is disabled' });
        }
        
        console.log('Login attempt for client:', username);
        console.log('Stored password:', `"${client.password}"`);
        console.log('Entered password:', `"${password}"`);
        
        // Check if password is hashed (bcrypt) or plain text
        let passwordMatches = false;
        
        if (client.password.startsWith('$2b$') || client.password.startsWith('$2a$')) {
            // Password is hashed - use bcrypt to compare
            passwordMatches = await bcrypt.compare(password, client.password);
            console.log('Using bcrypt comparison:', passwordMatches);
        } else {
            // Password is plain text - direct comparison
            passwordMatches = client.password === password;
            console.log('Using direct comparison:', passwordMatches);
        }
        
        if (!passwordMatches) {
            console.log('❌ Password mismatch for client:', username);
            return res.status(401).json({ error: 'Invalid username or password' });
        }
        
        console.log('✅ Password matched for client:', username);
        
        // Update last login
        client.lastLogin = new Date();
        await client.save();
        
        console.log('Client login successful:', username);
        
        // Set session
        req.session.clientId = client._id;
        req.session.clientUsername = client.username;
        req.session.isClient = true;
        
        // Save session and wait for it to be committed
        req.session.save((saveErr) => {
            if (saveErr) {
                console.error('Session save error:', saveErr);
                return res.status(500).json({ error: 'Session save failed' });
            }
            
            console.log('✅ Session saved for client:', username);
            console.log('Session ID:', req.sessionID);
            console.log('Session data:', req.session);
            
            res.json({ 
                success: true, 
                message: 'Login successful',
                redirectUrl: '/client/dashboard'
            });
        });
        
    } catch (error) {
        console.error('Client login error:', error);
        res.status(500).json({ error: 'Login failed' });
    }
});

// Client Logout
router.post('/api/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({ error: 'Logout failed' });
        }
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
        const client = await Client.findById(req.session.clientId)
            .select('-password')
            .populate('createdBy', 'username');
        
        if (!client) {
            return res.status(404).json({ error: 'Client not found' });
        }
        
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
        console.error('Get client info error:', error);
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
        if (![1, 3, 7, 15, 30].includes(durationDays)) {
            return res.status(400).json({ error: 'Invalid duration' });
        }
        
        // Import required models
        const UID = require('../models/UID');
        const axios = require('axios');
        
        // Check if UID already exists
        const existingUID = await UID.findOne({ uid });
        if (existingUID) {
            return res.status(400).json({ error: 'UID already exists' });
        }
        
        // Calculate hours and expiry
        const hours = durationDays * 24;
        const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);
        
        // Call the UID Bypass API
        const apiUrl = `${process.env.BASE_URL}?api=${process.env.API_KEY}&action=create&uid=${uid}&duration=${hours}`;
        
        try {
            await axios.post(apiUrl, {}, { timeout: 10000 });
        } catch (apiError) {
            console.error('UID Bypass API error:', apiError.message);
            return res.status(500).json({ error: 'Failed to create UID in bypass system' });
        }
        
        // Create UID record
        await UID.create({
            uid,
            duration: hours,
            createdBy: client.username,
            expiresAt,
            status: 'active'
        });
        
        res.json({
            success: true,
            message: 'UID Bypass account created successfully',
            uid,
            duration: durationDays,
            expiresAt
        });
        
    } catch (error) {
        console.error('Create UID Bypass error:', error);
        res.status(500).json({ error: 'Failed to create UID Bypass account' });
    }
});

// Reset HWID
router.post('/api/reset-hwid', isClient, async (req, res) => {
    try {
        const client = await Client.findById(req.session.clientId);
        
        if (!client) {
            return res.status(404).json({ error: 'Client not found' });
        }
        
        if (!client.isActive) {
            return res.status(403).json({ error: 'Account is disabled' });
        }
        
        // Only Aimkill clients can reset HWID
        if (client.productType !== 'AIMKILL') {
            return res.status(403).json({ error: 'HWID reset is only available for Aimkill clients' });
        }
        
        // Validate that assignedUsername exists and is not empty
        if (!client.assignedUsername || !client.assignedUsername.trim()) {
            console.error('HWID reset attempted with missing assignedUsername for client:', client.username);
            return res.status(400).json({ error: 'No assigned username configured. Please contact your administrator.' });
        }
        
        // Use GenzAuth to reset HWID for the assigned username
        const result = await genzauth.resetHwid(client.assignedUsername);
        
        if (result.success) {
            // Update client record
            client.lastHwidReset = new Date();
            client.hwidResetCount += 1;
            await client.save();
            
            res.json({
                success: true,
                message: `HWID reset successful for ${client.assignedUsername}`,
                resetCount: client.hwidResetCount,
                lastReset: client.lastHwidReset
            });
        } else {
            const errorMessage = result.error || result.message || 'HWID reset failed';
            console.error('HWID reset failed:', errorMessage);
            res.status(400).json({
                error: errorMessage
            });
        }
        
    } catch (error) {
        console.error('HWID reset error:', error);
        res.status(500).json({ error: 'HWID reset failed' });
    }
});

// ===== ADMIN ROUTES =====

// Get all clients (Admin only)
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

// Create client (Admin only)
router.post('/api/admin/clients', isAdminOrOwner, async (req, res) => {
    try {
        const { 
            username, 
            password, 
            productType, 
            assignedUsername,
            assignedUid,
            notes 
        } = req.body;
        
        // Validate required fields
        if (!username || !password || !productType) {
            return res.status(400).json({ error: 'Username, password, and product type are required' });
        }
        
        // Validate product type
        if (!['AIMKILL', 'UID_BYPASS'].includes(productType)) {
            return res.status(400).json({ error: 'Invalid product type' });
        }
        
        // For AIMKILL clients, assignedUsername is required and must not be empty
        if (productType === 'AIMKILL') {
            const trimmedAssignedUsername = assignedUsername ? assignedUsername.trim() : '';
            if (!trimmedAssignedUsername) {
                return res.status(400).json({ error: 'Assigned username is required and cannot be empty for Aimkill clients' });
            }
        }
        
        // For UID_BYPASS clients, assignedUid is required and must not be empty
        if (productType === 'UID_BYPASS') {
            const trimmedAssignedUid = assignedUid ? assignedUid.trim() : '';
            if (!trimmedAssignedUid) {
                return res.status(400).json({ error: 'UID is required and cannot be empty for UID Bypass clients' });
            }
            if (!/^\d+$/.test(trimmedAssignedUid)) {
                return res.status(400).json({ error: 'UID must contain only numbers' });
            }
        }
        
        // Check if client username already exists
        const existingClient = await Client.findOne({ username: username.toLowerCase() });
        if (existingClient) {
            return res.status(400).json({ error: 'Client username already exists' });
        }
        
        // Get current admin user - handle both session formats
        let adminUser;
        if (req.session.userId) {
            adminUser = await User.findById(req.session.userId);
        } else if (req.session.user && req.session.user.username) {
            adminUser = await User.findOne({ username: req.session.user.username });
        }
        
        if (!adminUser) {
            return res.status(401).json({ error: 'Admin user not found in session' });
        }
        
        console.log('Creating new client:', username.toLowerCase());
        console.log('Password being saved:', `"${password.trim()}"`);
        
        const newClient = new Client({
            username: username.toLowerCase(),
            password: password.trim(),
            productType,
            assignedUsername: productType === 'AIMKILL' ? assignedUsername.trim().toLowerCase() : undefined,
            assignedUid: productType === 'UID_BYPASS' ? assignedUid.trim() : undefined,
            notes: notes || '',
            createdBy: adminUser._id
        });
        
        await newClient.save();
        
        console.log('✅ Client created successfully:', username.toLowerCase());
        
        const clientData = await Client.findById(newClient._id)
            .select('-password')
            .populate('createdBy', 'username');
        
        res.json({ 
            success: true, 
            message: 'Client created successfully',
            client: clientData
        });
        
    } catch (error) {
        console.error('Create client error:', error);
        res.status(500).json({ error: 'Failed to create client' });
    }
});

// Update client (Admin only)
router.put('/api/admin/clients/:id', isAdminOrOwner, async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;
        
        // Don't allow updating certain fields
        delete updates._id;
        delete updates.createdBy;
        delete updates.createdAt;
        
        // Get current client to check product type
        const currentClient = await Client.findById(id);
        if (!currentClient) {
            return res.status(404).json({ error: 'Client not found' });
        }
        
        // Normalize assignedUsername if provided
        if (updates.assignedUsername !== undefined) {
            updates.assignedUsername = updates.assignedUsername ? updates.assignedUsername.trim().toLowerCase() : null;
        }
        
        // Normalize assignedUid if provided
        if (updates.assignedUid !== undefined) {
            updates.assignedUid = updates.assignedUid ? updates.assignedUid.trim() : null;
            if (updates.assignedUid && !/^\d+$/.test(updates.assignedUid)) {
                return res.status(400).json({ error: 'UID must contain only numbers' });
            }
        }
        
        // Validate productType change
        if (updates.productType) {
            if (!['AIMKILL', 'UID_BYPASS'].includes(updates.productType)) {
                return res.status(400).json({ error: 'Invalid product type' });
            }
            
            // If changing to or staying as AIMKILL, assignedUsername is required
            if (updates.productType === 'AIMKILL') {
                const assignedUsername = updates.assignedUsername !== undefined ? updates.assignedUsername : currentClient.assignedUsername;
                if (!assignedUsername || assignedUsername.trim() === '') {
                    return res.status(400).json({ error: 'Assigned username is required for Aimkill clients' });
                }
                updates.assignedUid = null; // Clear UID for Aimkill
            }
            
            // If changing to UID_BYPASS, assignedUid is required
            if (updates.productType === 'UID_BYPASS') {
                const assignedUid = updates.assignedUid !== undefined ? updates.assignedUid : currentClient.assignedUid;
                if (!assignedUid || assignedUid.trim() === '') {
                    return res.status(400).json({ error: 'UID is required for UID Bypass clients' });
                }
                updates.assignedUsername = null; // Clear username for UID Bypass
            }
        } else {
            // If productType is not changing but we're updating an Aimkill client
            if (currentClient.productType === 'AIMKILL' && updates.assignedUsername !== undefined) {
                if (!updates.assignedUsername || updates.assignedUsername.trim() === '') {
                    return res.status(400).json({ error: 'Assigned username cannot be empty for Aimkill clients' });
                }
            }
            
            // If productType is not changing but we're updating a UID Bypass client
            if (currentClient.productType === 'UID_BYPASS' && updates.assignedUid !== undefined) {
                if (!updates.assignedUid || updates.assignedUid.trim() === '') {
                    return res.status(400).json({ error: 'UID cannot be empty for UID Bypass clients' });
                }
            }
        }
        
        const client = await Client.findByIdAndUpdate(
            id,
            updates,
            { new: true, runValidators: true }
        ).select('-password').populate('createdBy', 'username');
        
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

// Delete client (Admin only)
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

// Update download links (Admin only)
router.put('/api/admin/download-links', isAdminOrOwner, async (req, res) => {
    try {
        let { aimkillLink, uidBypassLink } = req.body;
        
        // Validate URLs if provided
        const urlPattern = /^(https?:\/\/)?([\da-z\.-]+)\.([a-z\.]{2,6})([\/\w \.-]*)*\/?$/i;
        
        if (aimkillLink && aimkillLink.trim() && !urlPattern.test(aimkillLink)) {
            return res.status(400).json({ error: 'Invalid Aimkill download link URL' });
        }
        
        if (uidBypassLink && uidBypassLink.trim() && !urlPattern.test(uidBypassLink)) {
            return res.status(400).json({ error: 'Invalid UID Bypass download link URL' });
        }
        
        // Update all clients' download links
        const updateData = {};
        if (aimkillLink !== undefined) {
            updateData['downloadLinks.aimkill'] = aimkillLink.trim();
        }
        if (uidBypassLink !== undefined) {
            updateData['downloadLinks.uidBypass'] = uidBypassLink.trim();
        }
        
        await Client.updateMany({}, { $set: updateData });
        
        res.json({ 
            success: true, 
            message: 'Download links updated successfully' 
        });
        
    } catch (error) {
        console.error('Update download links error:', error);
        res.status(500).json({ error: 'Failed to update download links' });
    }
});

// Update specific client's download link (Admin only)
router.put('/api/admin/clients/:id/download-link', isAdminOrOwner, async (req, res) => {
    try {
        const { id } = req.params;
        let { downloadLink } = req.body;
        
        // Validate URL if provided
        const urlPattern = /^(https?:\/\/)?([\da-z\.-]+)\.([a-z\.]{2,6})([\/\w \.-]*)*\/?$/i;
        if (downloadLink && downloadLink.trim() && !urlPattern.test(downloadLink)) {
            return res.status(400).json({ error: 'Invalid download link URL' });
        }
        
        const client = await Client.findById(id);
        
        if (!client) {
            return res.status(404).json({ error: 'Client not found' });
        }
        
        downloadLink = downloadLink ? downloadLink.trim() : '';
        
        // Update the appropriate download link based on product type
        if (client.productType === 'AIMKILL') {
            client.downloadLinks.aimkill = downloadLink;
        } else if (client.productType === 'UID_BYPASS') {
            client.downloadLinks.uidBypass = downloadLink;
        }
        
        await client.save();
        
        res.json({ 
            success: true, 
            message: 'Download link updated successfully',
            client: await Client.findById(id).select('-password')
        });
        
    } catch (error) {
        console.error('Update client download link error:', error);
        res.status(500).json({ error: 'Failed to update download link' });
    }
});

module.exports = router;
