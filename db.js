const { Pool } = require('pg');

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASS || 'adminadmin',
    database: process.env.DB_NAME || 'timeshit',
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
});

module.exports = {
    pool
};