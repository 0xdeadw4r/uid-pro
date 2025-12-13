const axios = require('axios');
const mongoose = require('mongoose');

const GENZAUTH_API_BASE = 'https://genzauth-tl0c.onrender.com/api/seller';

console.log('🔑 GenzAuth Service Initialized');

async function getSellerKey() {
    try {
        const ApiConfig = mongoose.model('ApiConfig');
        const config = await ApiConfig.findOne({ configKey: 'main_config' });
        return config?.genzauthSellerKey || process.env.GENZAUTH_SELLER_KEY || null;
    } catch (error) {
        console.error('Error fetching seller key from DB:', error.message);
        return process.env.GENZAUTH_SELLER_KEY || null;
    }
}

async function makeRequest(type, additionalParams = {}, customSellerKey = null) {
    try {
        const SELLER_KEY = customSellerKey || await getSellerKey();

        const params = new URLSearchParams({
            sellerkey: SELLER_KEY,
            type,
            format: 'json',
            ...additionalParams
        });

        const url = `${GENZAUTH_API_BASE}?${params.toString()}`;
        console.log(`[GenzAuth API] Request type: ${type}`);

        if (!SELLER_KEY) {
            console.log('⚠️ GenzAuth not configured - using TEST mode');
            return {
                success: false,
                error: 'TEST mode - GenzAuth not configured',
                isTestMode: true
            };
        }

        const response = await axios.get(url, { timeout: 15000 });

        console.log(`[GenzAuth API] Response Status: ${response.status}`);

        if (response.data) {
            console.log(`[GenzAuth API] Response:`, response.data);
            return response.data;
        }

        return {
            success: false,
            error: 'No response data from API'
        };

    } catch (error) {
        console.error(`[GenzAuth API] Error:`, error.message);
        return {
            success: false,
            error: error.message,
            isTestMode: false
        };
    }
}

async function addLicense(expiry, amount = 1) {
    const SELLER_KEY = await getSellerKey();

    if (!SELLER_KEY) {
        const testLicense = generateTestLicense();
        return {
            success: true,
            key: testLicense,
            license: testLicense,
            message: 'TEST mode - GenzAuth not configured',
            isTestMode: true
        };
    }

    const result = await makeRequest('add', {
        expiry: expiry.toString(),
        amount: amount.toString()
    });

    if (result.success) {
        const key = result.data?.[0] || result.license || result.key || result.license_key || (result.licenses && result.licenses[0]);

        if (!key) {
            console.error('❌ No key found in GenzAuth response:', result);
            return {
                success: false,
                error: 'No key returned from GenzAuth API'
            };
        }

        console.log(`✅ GenzAuth license created: ${key}`);

        return {
            success: true,
            key: key,
            license: key,
            message: result.message || 'License created successfully',
            isTestMode: false
        };
    }

    return result;
}

async function verifyLicense(license) {
    return makeRequest('verify', { license });
}

async function activateLicense(license, hwid) {
    return makeRequest('activate', { license, hwid });
}

async function deleteLicense(license) {
    return makeRequest('del', { license });
}

async function banLicense(license) {
    return makeRequest('ban', { license });
}

async function fetchAllUsers() {
    return makeRequest('fetchallusers');
}

async function createUser(username, password, expiry, customSellerKey = null) {
    return makeRequest('createuser', { 
        username, 
        password,
        expiry: expiry.toString()
    }, customSellerKey);
}

async function banUser(username) {
    return makeRequest('banuser', { user: username });
}

async function unbanUser(username) {
    return makeRequest('unbanuser', { user: username });
}

async function deleteUser(username) {
    return makeRequest('deluser', { user: username });
}

async function extendUser(username, days) {
    return makeRequest('extenduser', { user: username, days: days.toString() });
}

async function resetHwid(username, customSellerKey = null) {
    console.log(`[GenzAuth] Resetting HWID for user: ${username}`);
    const result = await makeRequest('resethwid', { user: username }, customSellerKey);

    if (result.success) {
        console.log(`[GenzAuth] ✅ HWID reset successful for: ${username}`);
    } else {
        console.log(`[GenzAuth] ❌ HWID reset failed for: ${username} - ${result.error || result.message}`);
    }

    return result;
}

async function fetchAllLicenses() {
    return makeRequest('fetchalllicenses');
}

async function getUserInfo(username, customSellerKey = null) {
    try {
        const SELLER_KEY = customSellerKey || await getSellerKey();

        if (!SELLER_KEY) {
            console.log('⚠️ GenzAuth not configured - using TEST mode');
            return {
                success: false,
                error: 'TEST mode - GenzAuth not configured',
                isTestMode: true
            };
        }

        console.log(`[GenzAuth] Fetching user info for: ${username}`);

        const params = new URLSearchParams({
            sellerkey: SELLER_KEY,
            type: 'fetchuser',
            user: username,
            format: 'json'
        });

        const url = `${GENZAUTH_API_BASE}?${params.toString()}`;
        const response = await axios.get(url, { timeout: 15000 });

        console.log(`[GenzAuth API] Response Status: ${response.status}`);
        console.log(`[GenzAuth API] Response Data:`, response.data);

        if (response.data && response.data.success !== false) {
            console.log(`[GenzAuth] ✅ User info fetched for: ${username}`);
            return {
                success: true,
                data: response.data
            };
        }

        console.log(`[GenzAuth] ❌ Failed to fetch user info for: ${username}`);
        return {
            success: false,
            error: response.data?.message || 'Failed to fetch user info'
        };
    } catch (error) {
        console.error(`[GenzAuth] Error fetching user info:`, error.message);
        return {
            success: false,
            error: error.message,
            isTestMode: false
        };
    }
}

function generateTestLicense(prefix = 'TEST') {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const segments = [prefix];
    for (let i = 0; i < 3; i++) {
        const segment = Array(8).fill(0).map(() => chars[Math.floor(Math.random() * chars.length)]).join('');
        segments.push(segment);
    }
    return segments.join('-');
}

async function createKey(days, level = 1) {
    return addLicense(days, 1);
}

async function deleteKey(key) {
    return deleteLicense(key);
}

async function createMultipleKeys(days, quantity = 1) {
    try {
        console.log(`📝 Creating ${quantity} GenzAuth keys (${days}d each)`);

        const SELLER_KEY = await getSellerKey(); // Moved SELLER_KEY definition here

        if (!SELLER_KEY) {
            const keys = [];
            for (let i = 0; i < quantity; i++) {
                keys.push(generateTestLicense());
            }
            return {
                success: true,
                keys: keys,
                created: keys.length,
                failed: 0,
                message: `TEST mode - Created ${keys.length} test keys`,
                isTestMode: true
            };
        }

        const keys = [];
        const failedAttempts = [];

        for (let i = 0; i < quantity; i++) {
            try {
                const result = await addLicense(days, 1);

                if (result.success && result.key) {
                    keys.push(result.key);
                    console.log(`✅ Key ${i + 1}/${quantity} created: ${result.key}`);
                } else {
                    failedAttempts.push({
                        index: i + 1,
                        error: result.error || result.message || 'Unknown error'
                    });
                    console.warn(`⚠️ Key ${i + 1}/${quantity} creation failed`);
                }
            } catch (error) {
                failedAttempts.push({
                    index: i + 1,
                    error: error.message
                });
                console.error(`❌ Key ${i + 1}/${quantity} error:`, error.message);
            }

            if (i < quantity - 1) {
                await new Promise(resolve => setTimeout(resolve, 200));
            }
        }

        console.log(`📊 Created ${keys.length}/${quantity} keys successfully`);

        return {
            success: keys.length > 0,
            keys: keys,
            created: keys.length,
            failed: failedAttempts.length,
            failedAttempts: failedAttempts,
            message: `Created ${keys.length}/${quantity} keys`
        };

    } catch (error) {
        console.error('❌ Create multiple keys error:', error.message);
        return {
            success: false,
            keys: [],
            created: 0,
            failed: quantity,
            error: error.message
        };
    }
}

module.exports = {
    createKey,
    deleteKey,
    createMultipleKeys,
    addLicense,
    verifyLicense,
    activateLicense,
    deleteLicense,
    banLicense,
    fetchAllUsers,
    createUser,
    banUser,
    unbanUser,
    deleteUser,
    extendUser,
    resetHwid,
    fetchAllLicenses,
    getUserInfo
};