import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import type postgres from 'postgres';

// Compare the committed diagram against actual migrated tables, preserving its hand-written notes.
export async function checkDiagram(db: postgres.Sql, evidence: string) {
  const require = createRequire(join(process.cwd(),'package.json'));
  const { exporter } = require('@dbml/core');
  const sqlPath = join(evidence,'diagram.sql');
  const sql=exporter.export(await readFile('specs/data/model.dbml','utf8'),'postgres');
  await writeFile(sqlPath,sql);
  await db.begin(async tx=>{
    await tx.unsafe('CREATE SCHEMA diagram_check');
    await tx.unsafe('SET LOCAL search_path = diagram_check');
    await tx.unsafe(sql);
    const names=['topics','threads','thread_topics','artifacts','instructions','runs','attachments','artifact_attachments','provider_continuations','incoming_items','permissions','decisions','thread_assessments','application_changes','adapt_workspaces','adapt_executions','scene_bundles','scene_state'];
    async function signature(schema:string) {
      const columns=await tx.unsafe(`SELECT table_name,column_name,udt_name,is_nullable,column_default FROM information_schema.columns WHERE table_schema=$1 AND table_name = ANY($2) ORDER BY table_name,column_name`,[schema,names]);
      const keys=await tx.unsafe(`SELECT t.relname AS table_name,c.contype,pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname=$1 AND t.relname = ANY($2) AND c.contype IN ('p','f')`,[schema,names]);
      const indexes=await tx.unsafe(`SELECT t.relname AS table_name,i.indisunique,i.indisprimary,ARRAY(SELECT a.attname FROM unnest(i.indkey) WITH ORDINALITY AS k(attnum,position) JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.attnum ORDER BY k.position) AS fields FROM pg_index i JOIN pg_class t ON t.oid=i.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname=$1 AND t.relname = ANY($2) AND i.indpred IS NULL`,[schema,names]);
      const normalize=(value:string)=>value.replaceAll('public.','').replaceAll('diagram_check.','').replaceAll(' DEFERRABLE','');
      return {columns:[...columns], indexes:indexes.map(row=>JSON.stringify(row)).sort(), keys:keys.map(row=>`${row.table_name}:${row.contype}:${normalize(row.definition)}`).sort()};
    }
    assert.deepEqual(await signature('public'),await signature('diagram_check'),'DBML and migrated product schema drifted');
    await tx.unsafe('DROP SCHEMA diagram_check CASCADE');
  });
}
