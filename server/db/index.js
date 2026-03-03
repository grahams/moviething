'use strict';

const mariadb = require('mariadb');

// Database connection pool
// In tests, mariadb.createPool is mocked to return a mock pool
const pool = mariadb.createPool({
  host: process.env.MOVIETHING_SQL_HOST,
  user: process.env.MOVIETHING_SQL_USER,
  password: process.env.MOVIETHING_SQL_PASS,
  database: process.env.MOVIETHING_SQL_DB,
  connectionLimit: 5,
  acquireTimeout: 60000, // 60 seconds
  timeout: 60000, // 60 seconds
  reconnect: true,
  resetAfterUse: true
});

/**
 * Run a parameterised SQL query.
 * Gets a connection from the pool, executes the query, releases the
 * connection, and returns the result rows.
 *
 * On failure the original error is wrapped with extra context and the
 * connection is still released via the finally block.
 *
 * @param {string} sql    - The SQL statement to execute.
 * @param {Array}  params - Bound parameters for the statement.
 * @returns {Promise<Array>} Resolves with the result rows.
 */
async function query(sql, params) {
  let conn;
  try {
    conn = await pool.getConnection();
    const rows = await conn.query(sql, params);
    return rows;
  } catch (err) {
    throw Object.assign(
      new Error('DB query failed: ' + err.message),
      { cause: err, sql }
    );
  } finally {
    if (conn) conn.release();
  }
}

/**
 * Test the database connection with retry logic.
 * Skipped automatically in the test environment.
 *
 * @param {number} maxRetries - Maximum number of connection attempts (default 10).
 * @param {number} delayMs    - Milliseconds to wait between retries (default 5000).
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function testConnection(maxRetries = 10, delayMs = 5000) {
  if (process.env.NODE_ENV === 'test') {
    console.log('Skipping database connection test in test environment');
    return { success: true };
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Database connection attempt ${attempt}/${maxRetries}...`);
      await query('SELECT 1 as test', []);
      console.log('Successfully connected to MariaDB');
      return { success: true };
    } catch (err) {
      console.error(`Database connection attempt ${attempt} failed:`, err.message);

      if (attempt === maxRetries) {
        console.error(
          'All database connection attempts failed. Server will start but ' +
          'database operations will fail until connection is restored'
        );
        return { success: false, error: err.message };
      }

      console.log(`Waiting ${delayMs}ms before retry...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
}

module.exports = { pool, query, testConnection };
