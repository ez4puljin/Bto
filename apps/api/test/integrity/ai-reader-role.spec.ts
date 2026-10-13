import type { Client } from 'pg';
import { aiReaderSettings } from '../../src/db/provisioning';
import { connectAs, sqlStateOf } from '../harness/apps';

/**
 * The AI assistant's database barriers (ADR-0045 #4, #8): role ai_reader reads the views of schema ai
 * and nothing else, PUBLIC lost its default privileges, app cannot read the views, and the question
 * log is append-only for every role.
 */
describe('integrity: the AI assistant reads only through ai_reader', () => {
  let reader: Client;
  let app: Client;
  let migrator: Client;

  beforeAll(async () => {
    reader = await connectAs('ai_reader');
    app = await connectAs('app');
    migrator = await connectAs('migrator');
  });
  afterAll(async () => {
    await reader.end();
    await app.end();
    await migrator.end();
  });

  it('ai_reader cannot write, create, or read outside schema ai, even in a read-write transaction', async () => {
    expect(await sqlStateOf(reader.query('SELECT id FROM public.users'))).toBe('42501');
    // Its sessions are read-only by default: DDL and a large object are refused as writes.
    expect(await sqlStateOf(reader.query('CREATE TABLE ai.probe (id int)'))).toBe('25006');
    expect(await sqlStateOf(reader.query('SELECT lo_create(0)'))).toBe('25006');
    await reader.query('BEGIN READ WRITE');
    try {
      expect(await sqlStateOf(reader.query('CREATE TEMP TABLE probe (id int)'))).toBe('42501');
    } finally {
      await reader.query('ROLLBACK');
    }
    await reader.query('BEGIN READ WRITE');
    try {
      expect(await sqlStateOf(reader.query(`UPDATE ai.customers SET name = 'x' WHERE false`))).toBe(
        '42501',
      );
    } finally {
      await reader.query('ROLLBACK');
    }
    await reader.query('BEGIN READ WRITE');
    try {
      expect(await sqlStateOf(reader.query('CREATE TABLE ai.probe (id int)'))).toBe('42501');
    } finally {
      await reader.query('ROLLBACK');
    }
    await reader.query('BEGIN READ WRITE');
    try {
      expect(await sqlStateOf(reader.query('CREATE TABLE public.probe (id int)'))).toBe('42501');
    } finally {
      await reader.query('ROLLBACK');
    }
  });

  it('ai_reader may run no SECURITY DEFINER function', async () => {
    const { rows } = await migrator.query<{ name: string }>(
      `SELECT p.oid::regprocedure::text AS name FROM pg_proc p
        WHERE p.prosecdef AND has_function_privilege('ai_reader', p.oid, 'EXECUTE')`,
    );
    expect(rows).toEqual([]);
  });

  it('PUBLIC keeps no privilege on the database or on schema public', async () => {
    const database = await migrator.query<{ privilege: string }>(
      `SELECT a.privilege_type AS privilege FROM pg_database d, aclexplode(d.datacl) a
        WHERE d.datname = current_database() AND a.grantee = 0`,
    );
    expect(database.rows).toEqual([]);
    const schema = await migrator.query<{ privilege: string }>(
      `SELECT a.privilege_type AS privilege FROM pg_namespace n, aclexplode(n.nspacl) a
        WHERE n.nspname = 'public' AND a.grantee = 0`,
    );
    expect(schema.rows).toEqual([]);
  });

  it('app neither uses schema ai nor holds a privilege on its views', async () => {
    const { rows } = await migrator.query<{ usage: boolean; views: string }>(
      `SELECT has_schema_privilege('app', 'ai', 'USAGE') AS usage,
              (SELECT count(*)::text FROM information_schema.role_table_grants
                WHERE table_schema = 'ai' AND grantee = 'app') AS views`,
    );
    expect(rows[0]).toEqual({ usage: false, views: '0' });
    expect(await sqlStateOf(app.query('SELECT * FROM ai.stock'))).toBe('42501');
  });

  it('the role carries its session defaults', async () => {
    // The integrity project's PGOPTIONS lowers statement_timeout per connection: read the role.
    const { rows } = await migrator.query<{ config: string[] }>(
      `SELECT rolconfig AS config FROM pg_roles WHERE rolname = 'ai_reader'`,
    );
    expect(rows[0]?.config).toEqual(
      expect.arrayContaining([
        'default_transaction_read_only=on',
        'search_path=ai',
        'statement_timeout=30s',
        'transaction_timeout=60s',
        'idle_in_transaction_session_timeout=10s',
        'client_connection_check_interval=2s',
      ]),
    );
    const session = await reader.query<Record<string, string>>(
      `SELECT current_setting('default_transaction_read_only') AS read_only,
              current_setting('search_path') AS search_path,
              current_setting('TimeZone') AS time_zone`,
    );
    expect(session.rows[0]).toEqual({
      read_only: 'on',
      search_path: 'ai',
      time_zone: 'Asia/Ulaanbaatar',
    });
    // Provisioning outside tests caps the role at 4 connections (tests share it across workers).
    expect(aiReaderSettings()[0]).toBe('ALTER ROLE "ai_reader" CONNECTION LIMIT 4');
  });

  describe('ai_questions is append-only', () => {
    beforeAll(async () => {
      const user = await migrator.query<{ id: string }>(
        `INSERT INTO users (username, full_name, status) VALUES ('ai_probe', 'AI probe', 'ACTIVE')
         RETURNING id`,
      );
      const userId = user.rows[0]?.id;
      const conversation = await app.query<{ id: string }>(
        `INSERT INTO ai_conversations (user_id, title) VALUES ($1, 'probe') RETURNING id`,
        [userId],
      );
      await app.query(
        `INSERT INTO ai_questions (conversation_id, user_id, question, status, duration_ms, provider, model)
         VALUES ($1, $2, 'probe?', 'UNSUPPORTED', 1, 'openai', 'test-model')`,
        [conversation.rows[0]?.id, userId],
      );
    });

    it('app may not update, delete or truncate (REVOKE: 42501)', async () => {
      expect(await sqlStateOf(app.query(`UPDATE ai_questions SET question = 'x'`))).toBe('42501');
      expect(await sqlStateOf(app.query('DELETE FROM ai_questions'))).toBe('42501');
      expect(await sqlStateOf(app.query('TRUNCATE ai_questions'))).toBe('42501');
      expect(await sqlStateOf(app.query('DELETE FROM ai_conversations'))).toBe('42501');
      expect(await sqlStateOf(app.query('DELETE FROM ai_reports'))).toBe('42501');
    });

    it('even the migrator cannot update, delete or truncate (trigger: 23001)', async () => {
      expect(await sqlStateOf(migrator.query(`UPDATE ai_questions SET question = 'x'`))).toBe(
        '23001',
      );
      expect(await sqlStateOf(migrator.query('DELETE FROM ai_questions'))).toBe('23001');
      expect(await sqlStateOf(migrator.query('TRUNCATE ai_questions CASCADE'))).toBe('23001');
    });
  });
});
