const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const Reseller = require('../models/Reseller');
const Client = require('../models/Client');
const User = require('../models/User');
const Product = require('../models/Product');
const genzauth = require('../services/genzauth');

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
        const { username, password, productKey, packageKey } = req.body;

        if (!username || !password || !productKey || !packageKey) {
            return res.status(400).json({ error: 'All fields are required' });
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
            expiresAt.setDate(expiresAt.getDate() + packageData.days);
        } else if (packageData.hours) {
            expiresAt.setHours(expiresAt.getHours() + packageData.hours);
        }

        const newClient = await Client.create({
            username: username.toLowerCase(),
            password: password,
            productKey: productKey,
            assignedUsername: assignedUsername,
            package: packageKey,
            packageName: packageData.display,
            expiresAt: expiresAt,
            createdBy: `reseller:${reseller.username}`,
            isActive: true
        });

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
                productKey: newClient.productKey,
                package: newClient.packageName,
                expiresAt: newClient.expiresAt
            },
            creditsRemaining: reseller.credits,
            genzAuthCreated
        };

        if (genzAuthError) {
            response.warning = `Client created but GenzAuth account failed: ${genzAuthError}`;
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
        const { username, password, email, credits, genzauthSellerKey, assignedProducts } = req.body;

        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password are required' });
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
            password: password,
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
                credits: newReseller.credits,
                assignedProducts: newReseller.assignedProducts
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
