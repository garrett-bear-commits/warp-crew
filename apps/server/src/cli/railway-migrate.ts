// Railway pre-deploy: bootstrap only this isolated database, then migrate as its owner.
// The running API still connects through DATABASE_URL as foundation_app.
import postgres from 'postgres';
import { migrateUp } from '@foundation/server';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for Railway migrations`);
  return value;
}

const bootstrap = new URL(required('BOOTSTRAP_DATABASE_URL'));
const migrator = new URL(required('MIGRATION_DATABASE_URL'));
const app = new URL(required('DATABASE_URL'));
for (const [url, role] of [
  [migrator, 'foundation_migrator'],
  [app, 'foundation_app'],
] as const) {
  if (url.host !== bootstrap.host || url.pathname !== bootstrap.pathname || url.username !== role)
    throw new Error(
      'Bootstrap, migrator and app URLs must target the same isolated database and assigned roles',
    );
  if (decodeURIComponent(url.password).length < 24)
    throw new Error('Database role passwords must contain at least 24 characters');
}

const sql = postgres(bootstrap.toString(), { max: 1, onnotice: () => {} });
try {
  await sql.begin(async (tx) => {
    // Serialize bootstrap alongside other release steps. Migrations have their own lock.
    await tx`SELECT pg_advisory_xact_lock(4, hashtext('railway-role-bootstrap'))`;
    for (const [url, role] of [
      [migrator, 'foundation_migrator'],
      [app, 'foundation_app'],
    ] as const) {
      const exists = await tx`SELECT 1 FROM pg_roles WHERE rolname = ${role}`;
      if (!exists.length) await tx.unsafe(`CREATE ROLE ${role} NOLOGIN`);
      // DDL cannot use parameter placeholders; quote the password with PostgreSQL itself.
      const [quoted] =
        await tx`SELECT quote_literal(${decodeURIComponent(url.password)}) AS password`;
      await tx.unsafe(
        `ALTER ROLE ${role} LOGIN PASSWORD ${quoted!.password} NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
      );
    }
    const [database] = await tx`SELECT quote_ident(current_database()) AS name`;
    const name = database!.name;
    await tx.unsafe(`REVOKE CONNECT ON DATABASE ${name} FROM PUBLIC`);
    await tx.unsafe(`GRANT CONNECT ON DATABASE ${name} TO foundation_migrator, foundation_app`);
    await tx.unsafe(`ALTER DATABASE ${name} OWNER TO foundation_migrator`);
    await tx`ALTER SCHEMA public OWNER TO foundation_migrator`;
    await tx`REVOKE CREATE ON SCHEMA public FROM PUBLIC`;
    await tx`GRANT USAGE, CREATE ON SCHEMA public TO foundation_migrator`;
    await tx`GRANT USAGE ON SCHEMA public TO foundation_app`;
    await tx`REVOKE ALL ON PARAMETER "foundation.privileged" FROM PUBLIC`;
    await tx`REVOKE ALL ON PARAMETER "foundation.privileged" FROM foundation_app`;
    await tx`GRANT SET ON PARAMETER "foundation.privileged" TO foundation_migrator`;
  });
} finally {
  await sql.end();
}
const result = await migrateUp(migrator.toString(), { log: (message) => console.log(message) });
console.log(`Migrations ready: applied ${result.applied.length}, skipped ${result.skipped.length}`);
