const { Pool } = require('pg');
require('dotenv').config();

// Using DATABASE_URL from .env
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: parseInt(process.env.DB_POOL_MAX) || 20,
  idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_TIMEOUT) || 10000,
  connectionTimeoutMillis: parseInt(process.env.DB_POOL_CONNECTION_TIMEOUT) || 2000,
});

// Handle pool errors and reconnect
pool.on('error', async (err) => {
  console.error('Unexpected pool error:', err);
  if (err.code === 'PROTOCOL_CONNECTION_LOST' || 
      err.code === 'ECONNREFUSED' ||
      err.code === '57P01') {
    console.log('Attempting to reconnect...');
    await connectWithRetry();
  }
});

const connectWithRetry = async (retries = 5, delay = 2000) => {
  for (let i = 0; i < retries; i++) {
    try {
      const client = await pool.connect();
      console.log('PostgreSQL connected successfully');
      client.release();
      return;
    } catch (err) {
      console.error(`Connection attempt ${i + 1}/${retries} failed:`, err.message);
      if (i < retries - 1) {
        const backoffDelay = delay * Math.pow(2, i);
        console.log(`Retrying in ${backoffDelay/1000} seconds...`);
        await new Promise(resolve => setTimeout(resolve, backoffDelay));
      } else {
        console.error('Max retries reached. Could not connect to database.');
      }
    }
  }
};

// Test connection on init
connectWithRetry();

const query = async (text, params) => {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    console.log('Executed query:', { text: text.substring(0, 100), duration, rows: res.rowCount });
    return res;
  } catch (error) {
    console.error('Query error:', { text: text.substring(0, 100), error: error.message });
    throw error;
  }
};

const getClient = async () => {
  const client = await pool.connect();
  const originalRelease = client.release;
  
  const timeout = setTimeout(() => {
    console.error('A client has been checked out for more than 5 seconds!');
  }, 5000);
  
  client.release = () => {
    clearTimeout(timeout);
    originalRelease.call(client);
  };
  
  return client;
};

const checkHealth = async () => {
  try {
    const result = await query('SELECT NOW() as current_time, version() as pg_version');
    return {
      connected: true,
      timestamp: result.rows[0].current_time,
      version: result.rows[0].pg_version.split(',')[0],
      poolStats: {
        total: pool.totalCount,
        idle: pool.idleCount,
        waiting: pool.waitingCount,
      },
    };
  } catch (error) {
    return {
      connected: false,
      error: error.message,
    };
  }
};

module.exports = {
  query,
  getClient,
  pool,
  checkHealth,
  connectWithRetry,
};