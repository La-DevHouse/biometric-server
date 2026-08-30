import { initDb, allAsync } from "@/lib/db";

async function verify() {
  await initDb();

  const tables = await allAsync<{ name: string }>(
    `SELECT tablename AS name FROM pg_tables
      WHERE schemaname = 'public' AND tablename NOT LIKE '\\_prisma\\_%'`
  );

  const expectedTables = [
    "devices",
    "commands",
    "attendance_logs",
    "users",
    "enroll_data",
    "block_buffer",
    "raw_traffic",
    "operations",
  ];

  const tableNames = tables.map(t => t.name);
  const missing = expectedTables.filter(t => !tableNames.includes(t));

  console.log("✓ Database initialized");
  console.log(`✓ Found ${tables.length} tables`);

  if (missing.length === 0) {
    console.log("✓ All expected tables present:");
    tables.forEach(t => console.log(`  - ${t.name}`));
  } else {
    console.log("✗ Missing tables:", missing);
    process.exit(1);
  }
}

verify().catch(err => {
  console.error("Database verification failed:", err);
  process.exit(1);
});
