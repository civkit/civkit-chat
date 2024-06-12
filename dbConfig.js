"use strict";
const { Pool } = require('pg');
// Create a new pool using environmental variable values
const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD, // Make sure this is a string
    port: process.env.DB_PORT,
    ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false
});
pool.on('error', (err, client) => {
    console.error('Unexpected error on idle client', err);
    process.exit(-1);
});
module.exports = pool;
