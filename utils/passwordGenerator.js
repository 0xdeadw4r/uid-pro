const crypto = require('crypto');

// Generate random alphanumeric password
function generatePassword(length = 12) {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
    let password = '';
    for (let i = 0; i < length; i++) {
        password += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return password;
}

// Generate license key in format: XXXX-XXXX-XXXX-XXXX
function generateLicenseKey() {
    const segments = [];
    for (let i = 0; i < 4; i++) {
        const segment = crypto.randomBytes(2).toString('hex').toUpperCase();
        segments.push(segment);
    }
    return segments.join('-');
}

// Generate username-safe password (alphanumeric only)
function generateSimplePassword(length = 10) {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let password = '';
    for (let i = 0; i < length; i++) {
        password += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return password;
}

module.exports = {
    generatePassword,
    generateLicenseKey,
    generateSimplePassword
};
