const crypto = require('crypto');
require('dotenv').config();

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
const IV_LENGTH = 16;

function getKeyBuffer() {
    if (ENCRYPTION_KEY.length === 64) {
        return Buffer.from(ENCRYPTION_KEY, 'hex');
    }
    return Buffer.from(ENCRYPTION_KEY);
}

function encrypt(text) {
    if (typeof text !== 'string') text = JSON.stringify(text);
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv('aes-256-cbc', getKeyBuffer(), iv);
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decrypt(text) {
    if (!text) return null;
    const textParts = text.split(':');
    const iv = Buffer.from(textParts.shift(), 'hex');
    const encryptedText = Buffer.from(textParts.join(':'), 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', getKeyBuffer(), iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    try {
        return JSON.parse(decrypted.toString());
    } catch (e) {
        return decrypted.toString();
    }
}

module.exports = { encrypt, decrypt };
