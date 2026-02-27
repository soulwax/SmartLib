import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL);

try {
  // Check if column exists
  const checkResult = await sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'app_users' AND column_name = 'username';
  `;

  if (checkResult.length > 0) {
    console.log('✓ username column already exists');
  } else {
    console.log('Adding username column...');

    // Add column
    await sql`ALTER TABLE app_users ADD COLUMN username text;`;
    console.log('✓ Added username column');

    // Add unique index
    await sql`
      CREATE UNIQUE INDEX app_users_username_lower_idx
      ON app_users (lower(username))
      WHERE username IS NOT NULL;
    `;
    console.log('✓ Added unique index');

    // Add length constraint
    await sql`
      ALTER TABLE app_users
      ADD CONSTRAINT app_users_username_length_check
      CHECK (username IS NULL OR char_length(username) <= 39);
    `;
    console.log('✓ Added length constraint');
  }

  console.log('\n✅ Database schema updated successfully!');
  console.log('\nYou can now sign in with GitHub OAuth!');
} catch (error) {
  console.error('❌ Error:', error.message);
  process.exit(1);
}
