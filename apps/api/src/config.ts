const production = process.env.NODE_ENV === 'production';
const origin = process.env.APP_ORIGIN || 'http://localhost:4200';
if (production && (!process.env.APP_ORIGIN || !origin.startsWith('https://'))) throw new Error('APP_ORIGIN deve ser uma origem HTTPS em produção.');
if (new URL(origin).origin !== origin) throw new Error('APP_ORIGIN deve conter apenas protocolo e domínio, sem caminho ou barra final.');
const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS || 0);
if (!Number.isInteger(trustProxyHops) || trustProxyHops < 0) throw new Error('TRUST_PROXY_HOPS inválido.');
const sessionDays = Number(process.env.SESSION_DAYS || 7);
if (!Number.isInteger(sessionDays) || sessionDays < 1 || sessionDays > 30) throw new Error('SESSION_DAYS deve ser de 1 a 30.');
export const config = { production, origin, trustProxyHops, sessionDays, port: Number(process.env.PORT || 3000) };
