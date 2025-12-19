const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const Reseller = require('../models/Reseller');
const Client = require('../models/Client');
const User = require('../models/User');
const Product = require('../models/Product');
const UID = require('../models/UID');
const genzauth = require('../services/genzauth');
const { generatePassword, generateLicenseKey, generateSimplePassword } = require('../utils/passwordGenerator');

const isReseller = async (req, res, next) => {
    console.log('🔍 Reseller auth check - Session:', JSON.stringify({
        resellerId: req.session?.resellerId,
        resellerUsername: req.session?.resellerUsername,
        isReseller: req.session?.isReseller
    }, null, 2));

    if (req.session?.resellerId && req.session?.isReseller === true) {
        console.log('✅ Reseller authenticated:', req.session.resellerUsername);
        return next();
    }

    console.log('❌ Reseller not authenticated');
    if (req.path.startsWith('/api/')) {
        return res.status(401).json({ error: 'Not authenticated', redirect: '/reseller/login' });
    }
    return res.redirect('/reseller/login');
};

const isAdminOrOwner = async (req, res, next) => {
    try {
        let user = null;

        if (req.session.userId) {
            user = await User.findById(req.session.userId);
        } else if (req.session.user && req.session.user.username) {
            user = await User.findOne({ username: req.session.user.username });
        } else if (req.session.user && req.session.user._id) {
            user = await User.findById(req.session.user._id);
        }

        if (!user) {
            return res.status(401).json({ error: 'Not authenticated', needsAuth: true });
        }

        if (user.isAdmin || user.isOwner || user.isSuperAdmin) {
            return next();
        }

        return res.status(403).json({ error: 'Access denied - Admin or Owner privileges required' });
    } catch (error) {
        console.error('❌ Admin check error:', error);
        return res.status(500).json({ error: 'Server error: ' + error.message });
    }
};

router.post('/api/login', async (req, res) => {
    try {
        let { username, password } = req.body;

        username = username ? username.trim().toLowerCase() : '';
        password = password ? password.trim() : '';

        console.log('📝 Reseller login attempt:', username);

        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password are required' });
        }

        const reseller = await Reseller.findOne({ username });

        if (!reseller) {
            console.log('❌ Reseller not found:', username);
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        if (!reseller.isActive) {
            console.log('❌ Reseller account disabled:', username);
            return res.status(403).json({ error: 'Account is disabled' });
        }

        const passwordMatches = await reseller.comparePassword(password);

        if (!passwordMatches) {
            console.log('❌ Password mismatch for reseller:', username);
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        reseller.lastLogin = new Date();
        await reseller.save();

        req.session.resellerId = reseller._id;
        req.session.resellerUsername = reseller.username;
        req.session.isReseller = true;

        console.log('✅ Reseller logged in:', username);

        res.json({
            success: true,
            message: 'Login successful',
            reseller: {
                username: reseller.username,
                credits: reseller.credits,
                assignedProducts: reseller.assignedProducts
            }
        });
    } catch (error) {
        console.error('Reseller login error:', error);
        res.status(500).json({ error: 'Login failed' });
    }
});

router.post('/api/logout', isReseller, async (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Logout error:', err);
            return res.status(500).json({ error: 'Logout failed' });
        }
        res.json({ success: true, message: 'Logged out successfully' });
    });
});

router.get('/api/profile', isReseller, async (req, res) => {
    try {
        const reseller = await Reseller.findById(req.session.resellerId).select('-password');
        
        if (!reseller) {
            return res.status(404).json({ error: 'Reseller not found' });
        }

        const products = await Product.find({ productKey: { $in: reseller.assignedProducts } });

        res.json({
            success: true,
            reseller: {
                username: reseller.username,
                email: reseller.email,
                credits: reseller.credits,
                assignedProducts: reseller.assignedProducts,
                totalClientsCreated: reseller.totalClientsCreated,
                createdAt: reseller.createdAt,
                lastLogin: reseller.lastLogin
            },
            products: products.map(p => ({
                productKey: p.productKey,
                displayName: p.displayName,
                packages: Object.fromEntries(p.packages)
            }))
        });
    } catch (error) {
        console.error('Get reseller profile error:', error);
        res.status(500).json({ error: 'Failed to fetch profile' });
    }
});

router.post('/api/create-client', isReseller, async (req, res) => {
    try {
        const { username, password, autoPassword, productKey, packageKey, assignedUid } = req.body;

        if (!username || !productKey || !packageKey) {
            return res.status(400).json({ error: 'Username, productKey, and packageKey are required' });
        }

        // Generate password if autoPassword is true
        let finalPassword = password;
        if (autoPassword === true) {
            finalPassword = generateSimplePassword();
            console.log(`🔐 Auto-generated password for client: ${username}`);
        } else if (!password) {
            return res.status(400).json({ error: 'Password is required or set autoPassword to true' });
        }

        const reseller = await Reseller.findById(req.session.resellerId);

        if (!reseller) {
            return res.status(404).json({ error: 'Reseller not found' });
        }

        if (!reseller.assignedProducts.includes(productKey)) {
            return res.status(403).json({ error: 'You do not have access to this product' });
        }

        const product = await Product.findOne({ productKey });

        if (!product) {
            return res.status(404).json({ error: 'Product not found' });
        }

        const packageData = product.packages.get(packageKey);

        if (!packageData) {
            return res.status(404).json({ error: 'Package not found' });
        }

        if (reseller.credits < packageData.credits) {
            return res.status(400).json({ 
                error: `Insufficient credits. Required: ${packageData.credits}, Available: ${reseller.credits}` 
            });
        }

        const existingClient = await Client.findOne({ username: username.toLowerCase() });
        if (existingClient) {
            return res.status(400).json({ error: 'Username already exists' });
        }

        // Validate UID for UID_BYPASS product
        if (productKey === 'UID_BYPASS' && assignedUid) {
            if (!/^[0-9]+$/.test(assignedUid)) {
                return res.status(400).json({ error: 'UID must contain only numbers' });
            }
            const existingUID = await UID.findOne({ uid: assignedUid });
            if (existingUID) {
                return res.status(400).json({ error: 'UID already exists' });
            }
        }

        let genzAuthCreated = false;
        let genzAuthError = null;
        let assignedUsername = null;

        // Create GenzAuth account for Aimkill products
        if (productKey === 'AIMKILL') {
            try {
                const duration = packageData.days || 1;
                
                // Get seller key: reseller-specific > product-specific > global
                let sellerKey = reseller.genzauthSellerKey && reseller.genzauthSellerKey.trim() 
                    ? reseller.genzauthSellerKey.trim() 
                    : null;

                console.log(`   Checking reseller seller key: ${sellerKey ? '✅ Found' : '❌ Not found'}`);

                if (!sellerKey && product.genzauthSellerKey && product.genzauthSellerKey.trim()) {
                    sellerKey = product.genzauthSellerKey.trim();
                    console.log(`   Using product seller key: ✅ Found`);
                }

                if (!sellerKey) {
                    const ApiConfig = require('../models/ApiConfig');
                    const config = await ApiConfig.findOne({ configKey: 'main_config' });
                    sellerKey = config?.genzauthSellerKey || process.env.GENZAUTH_SELLER_KEY || null;
                    console.log(`   Checking global seller key: ${sellerKey ? '✅ Found' : '❌ Not found'}`);
                }

                if (!sellerKey) {
                    console.log(`   ❌ No GenzAuth seller key found at any level`);
                    genzAuthError = 'GenzAuth seller key not configured - Please add it in Admin Panel → Products → Edit AIMKILL → GenzAuth Seller Key, or set it for this reseller';
                } else {
                    console.log(`   ✅ Using seller key: ${sellerKey.substring(0, 8)}...`);
                    console.log(`📝 Creating GenzAuth account for client: ${username}`);
                    console.log(`   Duration: ${duration} days`);
                    console.log(`   Product: ${product.displayName} (${productKey})`);

                    const result = await genzauth.createUser(username, password, duration, sellerKey);

                    if (result.success) {
                        console.log(`✅ GenzAuth account created successfully: ${username}`);
                        genzAuthCreated = true;
                        assignedUsername = username;
                    } else {
                        console.error(`❌ GenzAuth creation failed: ${result.error || result.message}`);
                        genzAuthError = result.error || result.message || 'Failed to create GenzAuth account';
                    }
                }
            } catch (error) {
                console.error('❌ GenzAuth API error:', error);
                genzAuthError = error.message;
            }
        }

        const expiresAt = new Date();
        if (packageData.days) {
            expiresAt.setUTCDate(expiresAt.getUTCDate() + packageData.days);
        } else if (packageData.hours) {
            expiresAt.setUTCHours(expiresAt.getUTCHours() + packageData.hours);
        }

        const newClient = await Client.create({
            username: username.toLowerCase(),
            password: finalPassword,
            productKey: productKey,
            assignedUsername: assignedUsername,
            assignedUid: assignedUid || null,
            package: packageKey,
            packageName: packageData.display,
            expiresAt: expiresAt,
            createdBy: `reseller:${reseller.username}`,
            isActive: true
        });

        // Create UID if this is a UID_BYPASS product and UID is provided
        let uidCreated = false;
        let uidError = null;
        if (productKey === 'UID_BYPASS' && assignedUid) {
            try {
                // Calculate duration in hours for the API call
                let durationHours = 24; // default 1 day
                if (packageData.hours) {
                    durationHours = packageData.hours;
                } else if (packageData.days) {
                    durationHours = packageData.days * 24;
                }

                // Call external API to create UID
                const ApiConfig = require('../models/ApiConfig');
                const config = await ApiConfig.findOne({ configKey: 'main_config' });
                const baseUrl = config?.baseUrl || process.env.BASE_URL;
                const apiKey = config?.apiKey || process.env.API_KEY;

                if (baseUrl && apiKey) {
                    const axios = require('axios');
                    const apiUrl = `${baseUrl}?api=${apiKey}&action=create&uid=${assignedUid}&duration=${durationHours}`;
                    console.log(`📡 Calling UID API for reseller client: ${apiUrl.replace(apiKey, '***')}`);
                    
                    await axios.post(apiUrl, {}, { timeout: 10000 });
                    console.log(`✅ UID API call successful for: ${assignedUid}`);
                } else {
                    console.log(`⚠️ UID API not configured, creating local entry only`);
                }

                // Create UID entry in database
                const uidExpiresAt = new Date(expiresAt);
                
                const newUID = await UID.create({
                    uid: assignedUid,
                    createdBy: `reseller:${reseller.username}`,
                    expiresAt: uidExpiresAt,
                    duration: durationHours,
                    status: 'active'
                });
                uidCreated = true;
                console.log(`✅ UID created for client: ${assignedUid}`);
            } catch (error) {
                console.error('❌ UID creation failed:', error);
                uidError = error.response?.data?.message || error.message;
                
                // Rollback: Delete the client record if UID creation fails
                await Client.deleteOne({ _id: newClient._id });
                console.log(`⚠️ Rolled back client creation due to UID API failure`);
                
                return res.status(500).json({ 
                    error: `Failed to create UID: ${uidError}. Client account was not created.` 
                });
            }
        }

        reseller.credits -= packageData.credits;
        reseller.totalClientsCreated += 1;
        await reseller.save();

        console.log(`✅ Reseller ${reseller.username} created client: ${username} for ${productKey} (${packageKey})`);
        console.log(`   Credits used: ${packageData.credits}, Remaining: ${reseller.credits}`);

        const response = {
            success: true,
            message: 'Client account created successfully',
            client: {
                username: newClient.username,
                password: finalPassword,
                productKey: newClient.productKey,
                package: newClient.packageName,
                expiresAt: newClient.expiresAt,
                assignedUid: assignedUid || null
            },
            creditsRemaining: reseller.credits,
            genzAuthCreated,
            uidCreated,
            autoGenerated: autoPassword === true
        };

        if (genzAuthError) {
            response.warning = `Client created but GenzAuth account failed: ${genzAuthError}`;
        }

        if (uidError && productKey === 'UID_BYPASS') {
            response.warning = (response.warning ? response.warning + ' | ' : '') + `UID creation failed: ${uidError}`;
        }

        res.json(response);
    } catch (error) {
        console.error('Create client error:', error);
        res.status(500).json({ error: 'Failed to create client account' });
    }
});

router.get('/api/my-clients', isReseller, async (req, res) => {
    try {
        const reseller = await Reseller.findById(req.session.resellerId);

        if (!reseller) {
            return res.status(404).json({ error: 'Reseller not found' });
        }

        const clients = await Client.find({ createdBy: `reseller:${reseller.username}` })
            .sort({ createdAt: -1 });

        const clientsWithProducts = await Promise.all(clients.map(async (client) => {
            const product = await Product.findOne({ productKey: client.productKey });
            const clientObj = client.toObject();
            clientObj.product = product ? {
                displayName: product.displayName,
                downloadLink: product.downloadLink
            } : null;
            return clientObj;
        }));

        res.json({
            success: true,
            clients: clientsWithProducts
        });
    } catch (error) {
        console.error('Get reseller clients error:', error);
        res.status(500).json({ error: 'Failed to fetch clients' });
    }
});

router.delete('/api/delete-client/:id', isReseller, async (req, res) => {
    try {
        const { id } = req.params;
        const reseller = await Reseller.findById(req.session.resellerId);

        if (!reseller) {
            return res.status(404).json({ error: 'Reseller not found' });
        }

        const client = await Client.findById(id);

        if (!client) {
            return res.status(404).json({ error: 'Client not found' });
        }

        // Verify ownership
        if (client.createdBy !== `reseller:${reseller.username}`) {
            return res.status(403).json({ error: 'You do not have permission to delete this client' });
        }

        await Client.deleteOne({ _id: id });
        
        console.log(`✅ Reseller ${reseller.username} deleted client: ${client.username}`);

        res.json({ success: true, message: 'Client deleted successfully' });
    } catch (error) {
        console.error('Delete client error:', error);
        res.status(500).json({ error: 'Failed to delete client' });
    }
});

router.get('/api/admin/resellers', isAdminOrOwner, async (req, res) => {
    try {
        const resellers = await Reseller.find({}).select('-password').sort({ createdAt: -1 });

        const resellersWithStats = resellers.map(reseller => {
            const resellerObj = reseller.toObject();
            return resellerObj;
        });

        res.json({
            success: true,
            resellers: resellersWithStats
        });
    } catch (error) {
        console.error('Get resellers error:', error);
        res.status(500).json({ error: 'Failed to fetch resellers' });
    }
});

router.post('/api/admin/resellers', isAdminOrOwner, async (req, res) => {
    try {
        const { username, password, autoPassword, email, credits, genzauthSellerKey, assignedProducts } = req.body;

        if (!username) {
            return res.status(400).json({ error: 'Username is required' });
        }

        // Generate password if autoPassword is true
        let finalPassword = password;
        if (autoPassword === true) {
            finalPassword = generatePassword();
            console.log(`🔐 Auto-generated password for reseller: ${username}`);
        } else if (!password) {
            return res.status(400).json({ error: 'Password is required or set autoPassword to true' });
        }

        const existingReseller = await Reseller.findOne({ username: username.toLowerCase() });
        if (existingReseller) {
            return res.status(400).json({ error: 'Reseller username already exists' });
        }

        let user = null;
        if (req.session.userId) {
            user = await User.findById(req.session.userId);
        } else if (req.session.user && req.session.user.username) {
            user = await User.findOne({ username: req.session.user.username });
        }

        const newReseller = await Reseller.create({
            username: username.toLowerCase(),
            password: finalPassword,
            email: email || '',
            credits: credits || 0,
            genzauthSellerKey: genzauthSellerKey || '',
            assignedProducts: assignedProducts || [],
            isActive: true,
            createdBy: user ? user.username : 'admin'
        });

        console.log(`✅ Admin created reseller: ${newReseller.username}`);

        res.json({
            success: true,
            message: 'Reseller created successfully',
            reseller: {
                id: newReseller._id,
                username: newReseller.username,
                password: finalPassword,
                credits: newReseller.credits,
                assignedProducts: newReseller.assignedProducts,
                autoGenerated: autoPassword === true
            }
        });
    } catch (error) {
        console.error('Create reseller error:', error);
        res.status(500).json({ error: 'Failed to create reseller' });
    }
});

router.put('/api/admin/resellers/:id', isAdminOrOwner, async (req, res) => {
    try {
        const { id } = req.params;
        const { credits, genzauthSellerKey, assignedProducts, isActive, email, password } = req.body;

        const reseller = await Reseller.findById(id);

        if (!reseller) {
            return res.status(404).json({ error: 'Reseller not found' });
        }

        if (credits !== undefined) reseller.credits = credits;
        if (genzauthSellerKey !== undefined) reseller.genzauthSellerKey = genzauthSellerKey;
        if (assignedProducts !== undefined) reseller.assignedProducts = assignedProducts;
        if (isActive !== undefined) reseller.isActive = isActive;
        if (email !== undefined) reseller.email = email;
        if (password && password.trim()) {
            reseller.password = password;
        }

        await reseller.save();

        console.log(`✅ Admin updated reseller: ${reseller.username}`);

        res.json({
            success: true,
            message: 'Reseller updated successfully',
            reseller: {
                id: reseller._id,
                username: reseller.username,
                credits: reseller.credits,
                genzauthSellerKey: reseller.genzauthSellerKey,
                assignedProducts: reseller.assignedProducts,
                isActive: reseller.isActive
            }
        });
    } catch (error) {
        console.error('Update reseller error:', error);
        res.status(500).json({ error: 'Failed to update reseller' });
    }
});

router.delete('/api/admin/resellers/:id', isAdminOrOwner, async (req, res) => {
    try {
        const { id } = req.params;

        const reseller = await Reseller.findByIdAndDelete(id);

        if (!reseller) {
            return res.status(404).json({ error: 'Reseller not found' });
        }

        console.log(`✅ Admin deleted reseller: ${reseller.username}`);

        res.json({
            success: true,
            message: 'Reseller deleted successfully'
        });
    } catch (error) {
        console.error('Delete reseller error:', error);
        res.status(500).json({ error: 'Failed to delete reseller' });
    }
});

router.post('/api/generate-license-key', isReseller, async (req, res) => {
    try {
        const { duration } = req.body;

        if (!duration) {
            return res.status(400).json({ error: 'Duration is required' });
        }

        const durationNum = parseInt(duration);
        if (isNaN(durationNum) || durationNum <= 0) {
            return res.status(400).json({ error: 'Duration must be a positive number (in days)' });
        }

        const reseller = await Reseller.findById(req.session.resellerId);

        if (!reseller) {
            return res.status(404).json({ error: 'Reseller not found' });
        }

        // Check if reseller has any products assigned (for license key generation)
        if (!reseller.assignedProducts || reseller.assignedProducts.length === 0) {
            return res.status(403).json({ error: 'You do not have any products assigned. Contact admin to assign products.' });
        }

        // Get the appropriate seller key
        let sellerKey = reseller.genzauthSellerKey && reseller.genzauthSellerKey.trim() 
            ? reseller.genzauthSellerKey.trim() 
            : null;

        console.log(`   Checking reseller seller key: ${sellerKey ? '✅ Found' : '❌ Not found'}`);

        if (!sellerKey) {
            const ApiConfig = require('../models/ApiConfig');
            const config = await ApiConfig.findOne({ configKey: 'main_config' });
            sellerKey = config?.genzauthSellerKey || process.env.GENZAUTH_SELLER_KEY || null;
            console.log(`   Checking global seller key: ${sellerKey ? '✅ Found' : '❌ Not found'}`);
        }

        if (!sellerKey) {
            console.log(`   ❌ No GenzAuth seller key found at any level`);
            return res.status(400).json({ 
                error: 'GenzAuth seller key not configured - Please add it in Admin Panel → Products → Edit AIMKILL → GenzAuth Seller Key, or set it for this reseller' 
            });
        }

        // Check if reseller has enough credits (1 credit per license key)
        const licenseKeyCost = 1;
        if (reseller.credits < licenseKeyCost) {
            return res.status(400).json({ 
                error: `Insufficient credits. Required: ${licenseKeyCost}, Available: ${reseller.credits}` 
            });
        }

        // Call GenzAuth API to actually create the license with reseller's seller key
        console.log(`📝 Calling GenzAuth API to create license for ${reseller.username} (${durationNum} days)`);
        console.log(`   ✅ Using seller key: ${sellerKey.substring(0, 8)}...`);
        const genzauth = require('../services/genzauth');
        const genzauthResult = await genzauth.addLicense(durationNum, 1, sellerKey);

        if (!genzauthResult.success) {
            console.error(`❌ GenzAuth API failed: ${genzauthResult.error}`);
            return res.status(500).json({ error: `Failed to create license via GenzAuth API: ${genzauthResult.error}` });
        }

        const licenseKey = genzauthResult.key || genzauthResult.license;
        if (!licenseKey) {
            console.error('❌ No license key returned from GenzAuth API');
            return res.status(500).json({ error: 'GenzAuth API did not return a license key' });
        }

        // Save to local database for tracking
        const AimkillKey = require('../models/AimkillKey');
        const expiresAt = new Date();
        expiresAt.setUTCDate(expiresAt.getUTCDate() + durationNum);

        const newKey = await AimkillKey.create({
            key: licenseKey,
            duration: durationNum,
            createdBy: `reseller:${reseller.username}`,
            expiresAt: expiresAt,
            status: 'active',
            type: 'license_key'
        });

        // Deduct credits from reseller
        reseller.credits -= licenseKeyCost;
        await reseller.save();

        console.log(`✅ Reseller ${reseller.username} generated license key via GenzAuth: ${licenseKey}`);
        console.log(`   Credits used: ${licenseKeyCost}, Remaining: ${reseller.credits}`);

        res.json({
            success: true,
            message: 'License key generated successfully',
            licenseKey: {
                key: newKey.key,
                duration: newKey.duration,
                expiresAt: newKey.expiresAt,
                status: newKey.status,
                createdAt: newKey.createdAt
            },
            creditsRemaining: reseller.credits
        });
    } catch (error) {
        console.error('❌ Generate license key error:', error.message);
        console.error('Full error:', error);
        res.status(500).json({ error: `Failed to generate license key: ${error.message}` });
    }
});

router.post('/api/create-aimkill-account', isReseller, async (req, res) => {
    try {
        const { username, password, autoPassword, duration } = req.body;

        if (!username || !duration) {
            return res.status(400).json({ error: 'Username and duration are required' });
        }

        // Generate password if autoPassword is true
        let finalPassword = password;
        if (autoPassword === true) {
            finalPassword = generateSimplePassword();
            console.log(`🔐 Auto-generated password for Aimkill account: ${username}`);
        } else if (!password) {
            return res.status(400).json({ error: 'Password is required or set autoPassword to true' });
        }

        // Validate duration (must be positive number)
        const durationNum = parseInt(duration);
        if (isNaN(durationNum) || durationNum <= 0) {
            return res.status(400).json({ error: 'Duration must be a positive number (in days)' });
        }

        const reseller = await Reseller.findById(req.session.resellerId);

        if (!reseller) {
            return res.status(404).json({ error: 'Reseller not found' });
        }

        // Check if AIMKILL product is assigned to reseller
        if (!reseller.assignedProducts.includes('AIMKILL')) {
            return res.status(403).json({ error: 'You do not have access to create Aimkill accounts' });
        }

        // Check for duplicate username
        const AimkillKey = require('../models/AimkillKey');
        const existingAccount = await AimkillKey.findOne({ username: username.toLowerCase() });
        if (existingAccount) {
            return res.status(400).json({ error: 'Aimkill username already exists' });
        }

        // Calculate expiration date
        const expiresAt = new Date();
        expiresAt.setUTCDate(expiresAt.getUTCDate() + durationNum);

        // Create Aimkill account in database
        const newAccount = await AimkillKey.create({
            username: username.toLowerCase(),
            password: finalPassword,
            duration: durationNum,
            createdBy: `reseller:${reseller.username}`,
            expiresAt: expiresAt,
            status: 'active',
            type: 'user_account'
        });

        console.log(`✅ Reseller ${reseller.username} created Aimkill account: ${username}`);

        res.json({
            success: true,
            message: 'Aimkill account created successfully',
            account: {
                username: newAccount.username,
                password: finalPassword,
                duration: newAccount.duration,
                expiresAt: newAccount.expiresAt,
                status: newAccount.status,
                createdAt: newAccount.createdAt,
                autoGenerated: autoPassword === true
            }
        });
    } catch (error) {
        console.error('Create Aimkill account error:', error);
        res.status(500).json({ error: 'Failed to create Aimkill account' });
    }
});

router.get('/api/my-licenses', isReseller, async (req, res) => {
    try {
        const reseller = await Reseller.findById(req.session.resellerId);

        if (!reseller) {
            return res.status(404).json({ error: 'Reseller not found' });
        }

        const AimkillKey = require('../models/AimkillKey');
        const licenses = await AimkillKey.find({ 
            createdBy: `reseller:${reseller.username}`,
            type: 'license_key'
        })
            .sort({ createdAt: -1 });

        res.json({
            success: true,
            licenses: licenses.map(license => ({
                id: license._id,
                key: license.key,
                duration: license.duration,
                expiresAt: license.expiresAt,
                status: license.status,
                createdAt: license.createdAt
            }))
        });
    } catch (error) {
        console.error('Get licenses error:', error);
        res.status(500).json({ error: 'Failed to fetch licenses' });
    }
});

router.get('/api/aimkill-accounts', isReseller, async (req, res) => {
    try {
        const reseller = await Reseller.findById(req.session.resellerId);

        if (!reseller) {
            return res.status(404).json({ error: 'Reseller not found' });
        }

        if (!reseller.assignedProducts.includes('AIMKILL')) {
            return res.status(403).json({ error: 'You do not have access to Aimkill accounts' });
        }

        const AimkillKey = require('../models/AimkillKey');
        const accounts = await AimkillKey.find({ createdBy: `reseller:${reseller.username}` })
            .select('-password')
            .sort({ createdAt: -1 });

        res.json({
            success: true,
            accounts: accounts.map(account => ({
                id: account._id,
                username: account.username,
                duration: account.duration,
                expiresAt: account.expiresAt,
                status: account.status,
                createdAt: account.createdAt
            }))
        });
    } catch (error) {
        console.error('Get Aimkill accounts error:', error);
        res.status(500).json({ error: 'Failed to fetch Aimkill accounts' });
    }
});

router.delete('/api/aimkill-accounts/:id', isReseller, async (req, res) => {
    try {
        const { id } = req.params;
        const reseller = await Reseller.findById(req.session.resellerId);

        if (!reseller) {
            return res.status(404).json({ error: 'Reseller not found' });
        }

        const AimkillKey = require('../models/AimkillKey');
        const account = await AimkillKey.findById(id);

        if (!account) {
            return res.status(404).json({ error: 'Account not found' });
        }

        // Verify ownership
        if (account.createdBy !== `reseller:${reseller.username}`) {
            return res.status(403).json({ error: 'You can only delete your own accounts' });
        }

        await AimkillKey.findByIdAndDelete(id);
        
        console.log(`✅ Reseller ${reseller.username} deleted Aimkill account: ${account.username}`);

        res.json({
            success: true,
            message: 'Aimkill account deleted successfully'
        });
    } catch (error) {
        console.error('Delete Aimkill account error:', error);
        res.status(500).json({ error: 'Failed to delete Aimkill account' });
    }
});

router.get('/portal', isReseller, (req, res) => {
    const path = require('path');
    res.sendFile(path.join(__dirname, '..', 'views', 'reseller-portal.html'));
});

router.get('/login', (req, res) => {
    if (req.session?.resellerId && req.session?.isReseller) {
        return res.redirect('/reseller/portal');
    }
    res.redirect('/?tab=reseller');
});

module.exports = router;
