import { connectDatabase, databaseErrorCode } from '../db.js';
import { seedDocumentProfiles } from '../document-data.js';

if (process.env.NODE_ENV === 'production') throw new Error('Demo seed is disabled in production');
const connection = connectDatabase();
try {
  const inserted = await connection.db.transaction(tx => seedDocumentProfiles(tx));
  console.log(`Demo document profiles added: ${inserted}; existing profiles preserved`);
} catch (error) {
  console.error('Demo document profile seed failed:', databaseErrorCode(error));
  process.exitCode = 1;
} finally {
  await connection.close();
}
