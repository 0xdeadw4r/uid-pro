const axios = require('axios');

const LICENSEAUTH_API_URL = 'https://licenseauth.online/api/seller/';
const SELLER_KEY = process.env.LICENSEAUTH_SELLER_KEY;

console.log('🔑 LicenseAuth Service Initialized');
console.log('Seller Key Status:', SELLER_KEY ? '✅ Configured' : '❌ Not configured - TEST mode enabled');

/**
 * Create a new license key via LicenseAuth API with LUNOX prefix
 * Format: LNX-XXXXX-XXXXX (e.g., LNX-AB12C-DE34F)
 * @param {number} days - Duration in days
 * @param {number} level - License level (default 1)
 * @returns {Promise<Object>} - {success: boolean, key: string, message: string}
 */
async function createKey(days, level = 1) {
    try {
        // LUNOX branded short mask format
        const n1xMask = 'LNX-*****-*****';

        if (!SELLER_KEY) {
            console.log('⚠️ LicenseAuth not configured - using TEST mode');
            const testKey = generateN1XKey();
            return {
                success: true,
                key: testKey,
                message: 'TEST mode - LicenseAuth not configured',
                isTestMode: true
            };
        }

        console.log(`🔐 Creating LicenseAuth key: duration=${days}d, level=${level}, mask=LNX-XXXXX-XXXXX`);

        const params = new URLSearchParams({
            sellerkey: SELLER_KEY,
            type: 'add',
            expiry: days.toString(),
            mask: n1xMask,
            level: level.toString(),
            amount: '1',
            character: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
            note: `LUNOX Key ${days}d via LUNOX CHEATS`,
            format: 'json'
        });

        const response = await axios.get(`${LICENSEAUTH_API_URL}?${params.toString()}`, {
            timeout: 15000
        });

        console.log('✅ LicenseAuth Response:', response.data);

        if (response.data && response.data.success) {
            const key = response.data.license_key || response.data.key;

            if (!key) {
                throw new Error('No key returned from LicenseAuth API');
            }

            console.log(`✅ LicenseAuth key created: ${key}`);

            return {
                success: true,
                key: key,
                message: 'Key created successfully',
                isTestMode: false,
                createdAt: new Date()
            };
        } else {
            console.error('❌ LicenseAuth API Error:', response.data);
            throw new Error(response.data.message || 'LicenseAuth API returned error');
        }

    } catch (error) {
        console.error('❌ LicenseAuth Connection Error:', error.message);

        console.log('⚠️ Falling back to TEST mode with LUNOX prefix');
        const testKey = generateN1XKey();

        return {
            success: true,
            key: testKey,
            message: 'TEST mode (LicenseAuth unavailable)',
            isTestMode: true,
            error: error.message,
            createdAt: new Date()
        };
    }
}

/**
 * Generate LUNOX branded key locally for testing
 * Format: LNX-XXXXX-XXXXX (e.g., LNX-AB12C-DE34F)
 */
function generateN1XKey() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const segment1 = Array(5).fill(0).map(() => chars[Math.floor(Math.random() * chars.length)]).join('');
    const segment2 = Array(5).fill(0).map(() => chars[Math.floor(Math.random() * chars.length)]).join('');
    return `LNX-${segment1}-${segment2}`;
}

/**
 * Delete a license key via LicenseAuth API
 * @param {string} key - License key to delete
 * @returns {Promise<Object>} - {success: boolean, message: string, error?: string}
 */
async function deleteKey(key) {
    try {
        if (!key || typeof key !== 'string') {
            throw new Error('Valid key string is required');
        }

        if (!SELLER_KEY) {
            console.log('⚠️ TEST mode - key deletion simulated');
            return {
                success: true,
                message: 'TEST mode - deletion simulated',
                isTestMode: true
            };
        }

        const params = new URLSearchParams({
            sellerkey: SELLER_KEY,
            type: 'delete',
            license: key.trim(),
            format: 'json'
        });

        console.log(`🗑️ Deleting LicenseAuth key: ${key}`);

        const response = await axios.get(`${LICENSEAUTH_API_URL}?${params.toString()}`, {
            timeout: 10000
        });

        console.log('✅ LicenseAuth Delete Response:', response.data);

        if (response.data && response.data.success) {
            console.log(`✅ Key deleted: ${key}`);
            return {
                success: true,
                message: 'Key deleted successfully',
                isTestMode: false,
                deletedKey: key
            };
        } else {
            console.warn(`⚠️ Delete returned error:`, response.data);
            return {
                success: false,
                error: response.data.message || 'Failed to delete key',
                isTestMode: false
            };
        }

    } catch (error) {
        console.error('❌ Delete key error:', error.message);
        console.log('⚠️ Falling back to TEST mode');

        return {
            success: true,
            message: 'TEST mode - deletion simulated due to error',
            isTestMode: true,
            error: error.message,
            attemptedKey: key
        };
    }
}

/**
 * Get license key information via LicenseAuth API
 * @param {string} key - License key to check
 * @returns {Promise<Object>} - {success: boolean, info?: Object, error?: string}
 */
async function getKeyInfo(key) {
    try {
        if (!key || typeof key !== 'string') {
            throw new Error('Valid key string is required');
        }

        if (!SELLER_KEY) {
            return {
                success: false,
                message: 'TEST mode - cannot get key info',
                isTestMode: true
            };
        }

        const params = new URLSearchParams({
            sellerkey: SELLER_KEY,
            type: 'info',
            license: key.trim(),
            format: 'json'
        });

        console.log(`ℹ️ Fetching LicenseAuth key info: ${key}`);

        const response = await axios.get(`${LICENSEAUTH_API_URL}?${params.toString()}`, {
            timeout: 10000
        });

        if (response.data && response.data.success) {
            console.log(`✅ Key info retrieved`);
            return {
                success: true,
                info: response.data,
                isTestMode: false
            };
        } else {
            console.warn(`⚠️ Failed to get key info:`, response.data);
            return {
                success: false,
                error: response.data.message || 'Failed to get key info',
                isTestMode: false
            };
        }

    } catch (error) {
        console.error('❌ Get key info error:', error.message);
        return {
            success: false,
            error: error.message,
            isTestMode: false
        };
    }
}

/**
 * Ban a license key via LicenseAuth API
 * @param {string} key - License key to ban
 * @returns {Promise<Object>} - {success: boolean, message: string, error?: string}
 */
async function banKey(key) {
    try {
        if (!key || typeof key !== 'string') {
            throw new Error('Valid key string is required');
        }

        if (!SELLER_KEY) {
            console.log('⚠️ TEST mode - key ban simulated');
            return {
                success: true,
                message: 'TEST mode - ban simulated',
                isTestMode: true
            };
        }

        const params = new URLSearchParams({
            sellerkey: SELLER_KEY,
            type: 'ban',
            license: key.trim(),
            format: 'json'
        });

        console.log(`🚫 Banning LicenseAuth key: ${key}`);

        const response = await axios.get(`${LICENSEAUTH_API_URL}?${params.toString()}`, {
            timeout: 10000
        });

        if (response.data && response.data.success) {
            console.log(`✅ Key banned: ${key}`);
            return {
                success: true,
                message: 'Key banned successfully',
                isTestMode: false
            };
        } else {
            return {
                success: false,
                error: response.data.message || 'Failed to ban key',
                isTestMode: false
            };
        }

    } catch (error) {
        console.error('❌ Ban key error:', error.message);
        return {
            success: true,
            message: 'TEST mode - ban simulated due to error',
            isTestMode: true,
            error: error.message
        };
    }
}

/**
 * Reset a license key expiry via LicenseAuth API
 * @param {string} key - License key to reset
 * @param {number} days - New duration in days
 * @returns {Promise<Object>} - {success: boolean, message: string, error?: string}
 */
async function resetKey(key, days) {
    try {
        if (!key || typeof key !== 'string') {
            throw new Error('Valid key string is required');
        }

        if (!days || days < 1) {
            throw new Error('Days must be greater than 0');
        }

        if (!SELLER_KEY) {
            console.log('⚠️ TEST mode - key reset simulated');
            return {
                success: true,
                message: 'TEST mode - reset simulated',
                isTestMode: true
            };
        }

        const params = new URLSearchParams({
            sellerkey: SELLER_KEY,
            type: 'reset',
            license: key.trim(),
            expiry: days.toString(),
            format: 'json'
        });

        console.log(`🔄 Resetting LicenseAuth key: ${key} (${days}d)`);

        const response = await axios.get(`${LICENSEAUTH_API_URL}?${params.toString()}`, {
            timeout: 10000
        });

        if (response.data && response.data.success) {
            console.log(`✅ Key reset: ${key}`);
            return {
                success: true,
                message: 'Key reset successfully',
                isTestMode: false
            };
        } else {
            return {
                success: false,
                error: response.data.message || 'Failed to reset key',
                isTestMode: false
            };
        }

    } catch (error) {
        console.error('❌ Reset key error:', error.message);
        return {
            success: true,
            message: 'TEST mode - reset simulated due to error',
            isTestMode: true,
            error: error.message
        };
    }
}

/**
 * Create multiple keys at once with LUNOX prefix
 * @param {number} days - Duration in days
 * @param {number} quantity - Number of keys to create
 * @returns {Promise<Array>} - Array of created keys
 */
async function createMultipleKeys(days, quantity = 1) {
    try {
        console.log(`📝 Creating ${quantity} LicenseAuth keys (${days}d each, LUNOX prefix)`);

        const keys = [];
        const failedAttempts = [];

        for (let i = 0; i < quantity; i++) {
            try {
                const result = await createKey(days, 1);
                if (result.success && result.key) {
                    keys.push(result.key);
                    console.log(`✅ Key ${i + 1}/${quantity} created: ${result.key}`);
                } else {
                    failedAttempts.push({
                        index: i + 1,
                        error: result.message || 'Unknown error'
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
                await new Promise(resolve => setTimeout(resolve, 100));
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

// Placeholder functions for user management (LicenseAuth doesn't support these)
async function createUser(username, password, level = 1) {
    console.warn('⚠️ LicenseAuth does NOT support user creation via API');
    return {
        success: true,
        user: { username, level, isTestMode: true },
        message: 'TEST mode only',
        isTestMode: true
    };
}

async function deleteUser(username) {
    console.warn('⚠️ LicenseAuth does NOT support user deletion via API');
    return {
        success: true,
        message: 'TEST mode only',
        isTestMode: true
    };
}

async function getUserInfo(username) {
    return {
        success: false,
        message: 'LicenseAuth does not support user lookup',
        isTestMode: true
    };
}

async function updateUserPassword(username, newPassword) {
    console.warn('⚠️ LicenseAuth does NOT support password updates via API');
    return {
        success: true,
        message: 'TEST mode only',
        isTestMode: true
    };
}

module.exports = {
    createKey,
    deleteKey,
    getKeyInfo,
    banKey,
    resetKey,
    createMultipleKeys,
    createUser,
    deleteUser,
    getUserInfo,
    updateUserPassword
};
