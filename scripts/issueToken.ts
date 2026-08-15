/**
 * 开发用令牌签发脚本：node 脚本，输出一个 Bearer 令牌。
 * 用法：tsx scripts/issueToken.ts [subject] [read,write]
 */
import { TokenMiddleware } from '../src/auth/token.js';

const subject = process.argv[2] ?? 'user';
const scopes = (process.argv[3] ?? 'read,write').split(',').map((s) => s.trim());

const auth = new TokenMiddleware();
const token = auth.issue(subject, scopes);
console.log(token);
