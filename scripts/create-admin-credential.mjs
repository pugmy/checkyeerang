import { randomBytes, createHash } from "node:crypto";

// Generates a high-entropy one-time password for an Apps Script Script Property.
// Save the password offline. Never commit or paste either value into a public repo.
const password = randomBytes(24).toString("base64url");
const salt = randomBytes(16).toString("hex");
const digest = createHash("sha256").update(salt + ":" + password).digest("hex");
console.log("관리자 비밀번호 (별도로 보관): " + password);
console.log("Apps Script Script Properties → ADMIN_PASSWORD_HASH:");
console.log(salt + ":" + digest);
