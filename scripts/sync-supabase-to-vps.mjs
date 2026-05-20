#!/usr/bin/env node
/**
 * Script de sincronização de dados
 * Supabase → PostgreSQL VPS (hype_delivery)
 * 
 * Uso: node scripts/sync-supabase-to-vps.mjs
 */

import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const BATCH_SIZE = 100;
const TABLES_TO_SYNC = [
  { name: "plans", ignoreColumns: ["updated_at"] },
  { name: "stores", ignoreColumns: [] },
  { name: "store_settings", ignoreColumns: [] },
  { name: "categories", ignoreColumns: [] },
  { name: "products", ignoreColumns: [] },
  { name: "product_options", ignoreColumns: [] },
  { name: "product_option_items", ignoreColumns: [] },
  { name: "delivery_zones", ignoreColumns: [] },
  { name: "coupons", ignoreColumns: [] },
  { name: "customers", ignoreColumns: [] },
  { name: "orders", ignoreColumns: [] },
  { name: "order_items", ignoreColumns: [] },
  { name: "order_item_options", ignoreColumns: [] },
  { name: "order_status_history", ignoreColumns: [] },
  { name: "payments", ignoreColumns: [] },
  { name: "subscriptions", ignoreColumns: [] },
  { name: "profiles", ignoreColumns: [] },
  { name: "customer_addresses", ignoreColumns: [] },
  { name: "customer_favorites", ignoreColumns: [] },
];

// Cores para output
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
};

const log = {
  info: (msg) => console.log(`${colors.cyan}→${colors.reset} ${msg}`),
  success: (msg) => console.log(`${colors.green}✓${colors.reset} ${msg}`),
  warn: (msg) => console.log(`${colors.yellow}⚠${colors.reset} ${msg}`),
  error: (msg) => console.log(`${colors.red}✗${colors.reset} ${msg}`),
  header: (msg) => console.log(`\n${colors.bright}${colors.cyan}═══ ${msg} ═══${colors.reset}\n`),
};

async function main() {
  log.header("SINCRONIZAÇÃO SUPABASE → POSTGRESQL VPS");

  // Validar variáveis de ambiente
  const requiredVars = [
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "DATABASE_URL",
  ];

  const missing = requiredVars.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    log.error(`Variáveis de ambiente faltando: ${missing.join(", ")}`);
    log.warn("Configure no arquivo .env ou como variáveis de ambiente");
    process.exit(1);
  }

  // Conectar ao Supabase
  log.info("Conectando ao Supabase...");
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

  // Conectar ao PostgreSQL da VPS
  log.info("Conectando ao PostgreSQL da VPS...");
  const vpsClient = new pg.Client(process.env.DATABASE_URL);
  await vpsClient.connect();
  log.success("Conectado ao banco de dados da VPS");

  try {
    let totalInserted = 0;
    let totalSkipped = 0;
    let totalErrors = 0;

    for (const tableConfig of TABLES_TO_SYNC) {
      const { name: table } = tableConfig;
      
      log.info(`Sincronizando tabela: ${table}`);

      try {
        // 1. Contar registros no Supabase
        const { count: supabaseCount, error: countError } = await supabase
          .from(table)
          .select("id", { count: "exact", head: true });

        if (countError) {
          log.warn(`  Não foi possível contar registros em ${table}: ${countError.message}`);
          totalSkipped++;
          continue;
        }

        const recordCount = supabaseCount || 0;
        if (recordCount === 0) {
          log.warn(`  Nenhum registro encontrado em ${table}`);
          continue;
        }

        log.info(`  ${table}: ${recordCount} registros encontrados no Supabase`);

        // 2. Limpar tabela na VPS (opcional - comentado por segurança)
        // await vpsClient.query(`TRUNCATE ${table} CASCADE;`);

        // 3. Sincronizar em lotes
        let insertedCount = 0;
        let errorCount = 0;

        for (let page = 0; page < Math.ceil(recordCount / BATCH_SIZE); page++) {
          const start = page * BATCH_SIZE;
          const { data, error } = await supabase
            .from(table)
            .select("*")
            .range(start, start + BATCH_SIZE - 1);

          if (error) {
            log.error(`  Erro ao ler página ${page + 1}: ${error.message}`);
            errorCount += BATCH_SIZE;
            continue;
          }

          if (!data || data.length === 0) break;

          // Inserir registros com conflict resolution
          for (const record of data) {
            try {
              const keys = Object.keys(record).filter((k) => !tableConfig.ignoreColumns.includes(k));
              const values = keys.map((k) => record[k]);

              const placeholders = keys.map((_, i) => `$${i + 1}`).join(", ");
              const conflicts = keys.map((k) => `${k} = EXCLUDED.${k}`).join(", ");

              const query = `
                INSERT INTO ${table} (${keys.join(", ")})
                VALUES (${placeholders})
                ON CONFLICT (id) DO UPDATE SET ${conflicts}
                WHERE true;
              `;

              await vpsClient.query(query, values);
              insertedCount++;
            } catch (err) {
              log.warn(`    Erro ao inserir registro: ${err.message}`);
              errorCount++;
            }
          }

          const progress = Math.min((page + 1) * BATCH_SIZE, recordCount);
          log.info(`  Progresso: ${progress}/${recordCount} registros processados`);
        }

        log.success(`  ${table}: ${insertedCount} registros inseridos (${errorCount} erros)`);
        totalInserted += insertedCount;
        totalErrors += errorCount;
      } catch (err) {
        log.error(`Erro ao sincronizar ${table}: ${err.message}`);
        totalErrors++;
      }
    }

    log.header("RESUMO DA SINCRONIZAÇÃO");
    log.success(`Total de registros inseridos: ${totalInserted}`);
    log.warn(`Total de tabelas puladas: ${totalSkipped}`);
    if (totalErrors > 0) {
      log.warn(`Total de erros: ${totalErrors}`);
    } else {
      log.success("Nenhum erro detectado!");
    }

    // Validação final
    log.info("Validando integridade dos dados...");
    const validationQuery = `
      SELECT 
        'plans' as table_name, COUNT(*) as record_count FROM plans
      UNION ALL
      SELECT 'stores', COUNT(*) FROM stores
      UNION ALL
      SELECT 'customers', COUNT(*) FROM customers
      UNION ALL
      SELECT 'orders', COUNT(*) FROM orders
      ORDER BY table_name;
    `;

    const validation = await vpsClient.query(validationQuery);
    console.log("\nDados no PostgreSQL VPS:");
    validation.rows.forEach((row) => {
      console.log(`  ${row.table_name}: ${row.record_count} registros`);
    });

  } catch (err) {
    log.error(`Erro crítico: ${err.message}`);
    process.exit(1);
  } finally {
    await vpsClient.end();
    log.success("Desconectado do banco de dados");
  }

  log.header("SINCRONIZAÇÃO CONCLUÍDA");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
