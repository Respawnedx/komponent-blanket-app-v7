// Usage: node bootstrap-admin.js NJ 1234
// Prints SQL to insert/update an admin user in D1.

const crypto = require('crypto');

const initials = (process.argv[2] || '').trim().toUpperCase();
const pin = (process.argv[3] || '').trim();

if (!initials || !pin) {
  console.error('Usage: node bootstrap-admin.js <INITIALS> <PIN>');
  process.exit(1);
}
if (!/^\d{4,8}$/.test(pin)) {
  console.error('PIN must be 4-8 digits');
  process.exit(1);
}

const iterations = 100000;
const salt = crypto.randomBytes(16);
const hash = crypto.pbkdf2Sync(pin, salt, iterations, 32, 'sha256');

const saltHex = salt.toString('hex');
const hashHex = hash.toString('hex');
const ts = new Date().toISOString();

const sql = `INSERT INTO users(initials, role, pin_salt, pin_hash, disabled, created_at, created_by)
VALUES('${initials}', 'admin', '${saltHex}', '${hashHex}', 0, '${ts}', '${initials}')
ON CONFLICT(initials) DO UPDATE SET role='admin', pin_salt='${saltHex}', pin_hash='${hashHex}', disabled=0;`;

console.log(sql);
