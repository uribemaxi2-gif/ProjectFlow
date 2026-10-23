import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const sql = await readFile(new URL('../supabase/setup.sql', import.meta.url), 'utf8');
const leader = '10000000-0000-0000-0000-000000000001';
const responsible = '10000000-0000-0000-0000-000000000002';
const outsider = '10000000-0000-0000-0000-000000000003';

before(async () => {
  // Supabase supplies these roles, auth.users and auth.uid() in production.
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create table auth.users (id uuid primary key, email text unique);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
    grant usage on schema public, auth to anon, authenticated;
    insert into auth.users values
      ('${leader}', 'leader@example.test'),
      ('${responsible}', 'responsible@example.test'),
      ('${outsider}', 'outsider@example.test');
  `);
  await db.exec(sql);
  await db.query("select public.projectflow_authorize('leader@example.test', 'leader')");
  await db.query("select public.projectflow_authorize('responsible@example.test', 'responsible')");
});

after(() => db.close());

async function asUser(id, run, role = 'authenticated') {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id || '']);
  await db.exec(`set role ${role}`);
  try { return await run(); }
  finally { await db.exec('reset role'); }
}

async function getState() {
  return (await db.query('select public.projectflow_get_state() as result')).rows[0].result;
}

async function save(updates) {
  return (await db.query('select public.projectflow_save($1::jsonb) as result',
    [JSON.stringify(updates)])).rows[0].result;
}

const denied = operation => assert.rejects(operation, error => error.code === '42501');
const update = (key, expected, value) => ({ key, expected, value });

test('anonymous visitors cannot read, save or authorize themselves', async () => {
  await asUser(null, async () => {
    await denied(() => db.query('select * from public.projectflow_state'));
    await denied(getState);
    await denied(() => save([update('equipo14.personas', null, {})]));
    await denied(() => db.query("select public.projectflow_authorize('outsider@example.test', 'leader')"));
  }, 'anon');
});

test('having an account without an authorized role does not give access', async () => {
  await asUser(outsider, async () => {
    assert.equal((await db.query('select * from public.projectflow_state')).rows.length, 0);
    await denied(getState);
    await denied(() => save([update('equipo14.personas', null, {})]));
    await denied(() => db.query("select public.projectflow_authorize('outsider@example.test', 'leader')"));
    await denied(() => db.query('insert into public.projectflow_members values ($1, $2, true)', [outsider, 'leader']));
  });
});

test('leaders save shared data and responsible users can read and update it', async () => {
  await asUser(leader, async () => {
    assert.equal((await getState()).role, 'leader');
    const result = await save([update('equipo14.personas', null, { 1: 'Equipo' })]);
    assert.deepEqual(result.data['equipo14.personas'], { 1: 'Equipo' });
  });
  await asUser(responsible, async () => {
    const result = await getState();
    assert.equal(result.role, 'responsible');
    assert.deepEqual(result.data['equipo14.personas'], { 1: 'Equipo' });
    await save([update('equipo14.hitos', null, { 1: true })]);
  });
});

test('authorized users cannot bypass conflict checks with direct writes or grant roles', async () => {
  await asUser(leader, async () => {
    await denied(() => db.query("update public.projectflow_state set data = '{}'::jsonb"));
    await denied(() => db.query('delete from public.projectflow_state'));
    await denied(() => db.query("select public.projectflow_authorize('outsider@example.test', 'responsible')"));
  });
});

test('stale saves fail without overwriting newer changes', async () => {
  await asUser(leader, async () => {
    await assert.rejects(() => save([update('equipo14.personas', null, { 1: 'Obsoleto' })]),
      error => error.code === '40001');
    assert.deepEqual((await getState()).data['equipo14.personas'], { 1: 'Equipo' });
  });
});

test('backup import is atomic when one of its sections conflicts', async () => {
  await asUser(leader, async () => {
    await assert.rejects(() => save([
      update('equipo14.personas', { 1: 'Equipo' }, { 1: 'Parcial' }),
      update('equipo14.hitos', null, { 1: false })
    ]), error => error.code === '40001');
    const data = (await getState()).data;
    assert.deepEqual(data['equipo14.personas'], { 1: 'Equipo' });
    assert.deepEqual(data['equipo14.hitos'], { 1: true });
  });
});

test('invalid requests and duplicate or unknown sections are rejected', async () => {
  await asUser(leader, async () => {
    for (const payload of [null, {}, [],
      [update('unknown', null, {})],
      [update('equipo14.personas', null, [])],
      [update('equipo14.personas', null, {}), update('equipo14.personas', null, {})]
    ]) {
      await assert.rejects(() => save(payload), error => error.code === '22023');
    }
  });
});

test('revoking a responsible user blocks subsequent reads and writes', async () => {
  await db.query('update public.projectflow_members set active = false where user_id = $1', [responsible]);
  await asUser(responsible, async () => {
    await denied(getState);
    await denied(() => save([update('equipo14.hitos', { 1: true }, { 1: false })]));
    assert.equal((await db.query('select * from public.projectflow_state')).rows.length, 0);
  });
});

test('repeating setup preserves data and does not reactivate revoked accounts', async () => {
  await db.exec(sql);
  await asUser(leader, async () => {
    assert.deepEqual((await getState()).data['equipo14.personas'], { 1: 'Equipo' });
  });
  await asUser(responsible, denied.bind(null, getState));
});
