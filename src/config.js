'use strict';

const REQUIRED = ['MOONETIX_APP_ID', 'MOONETIX_LINK_SALT', 'MOONETIX_POSTBACK_KEY'];

function loadConfig(env = process.env) {
  const missing = REQUIRED.filter((name) => !env[name]);
  if (missing.length) {
    throw new Error(`Missing environment variables: ${missing.join(', ')}. Copy .env.example to .env and fill it in.`);
  }
  return {
    port: Number(env.PORT || 3000),
    databasePath: env.DATABASE_PATH || './data.sqlite',
    currencyName: env.CURRENCY_NAME || 'Coins',
    appId: env.MOONETIX_APP_ID,
    linkSalt: env.MOONETIX_LINK_SALT,
    postbackKey: env.MOONETIX_POSTBACK_KEY,
  };
}

module.exports = { loadConfig };
