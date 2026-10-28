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
  await db.exec(await readFile(new URL('./fixtures/private-setup.sql', import.meta.url), 'utf8'));
  await db.query("select public.projectflow_authorize('leader@example.test', 'leader')");
  await db.query("select public.projectflow_authorize('responsible@example.test', 'responsible')");
  await db.exec(sql);
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

test('anonymous visitors can read shared data but cannot write, read members or grant roles', async () => {
  await asUser(null, async () => {
    await denied(() => db.query('select * from public.projectflow_state'));
    await denied(() => db.query('select * from public.projectflow_members'));
    assert.equal((await getState()).role, 'viewer');
    await denied(() => save([update('equipo14.personas', null, {})]));
    await denied(() => db.query("select public.projectflow_authorize('outsider@example.test', 'leader')"));
  }, 'anon');
});

test('having an account without an authorized role only gives public read access', async () => {
  await asUser(outsider, async () => {
    await denied(() => db.query('select * from public.projectflow_state'));
    assert.equal((await getState()).role, 'viewer');
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

test('revoking an editor leaves public read access but blocks writes', async () => {
  await asUser(leader, async () => {
    const id = (await getState()).project_id;
    await rpc('projectflow_set_editor', [id, 'responsible@example.test', false]);
  });
  await asUser(responsible, async () => {
    assert.equal((await getState()).role, 'viewer');
    await denied(() => save([update('equipo14.hitos', { 1: true }, { 1: false })]));
    await denied(() => db.query('select * from public.projectflow_state'));
  });
});

test('repeating setup preserves data and does not reactivate revoked accounts', async () => {
  await db.exec(sql);
  await asUser(leader, async () => {
    assert.deepEqual((await getState()).data['equipo14.personas'], { 1: 'Equipo' });
  });
  await asUser(responsible, async () => {
    assert.equal((await getState()).role, 'viewer');
    await denied(() => save([update('equipo14.hitos', { 1: true }, { 1: false })]));
  });
});


test('anonymous readers receive saved data without member identities', async () => {
  await asUser(null, async () => {
    const result = await getState();
    assert.deepEqual(result.data['equipo14.personas'], { 1: 'Equipo' });
    assert.deepEqual(Object.keys(result).sort(), ['can_create', 'can_manage', 'data', 'name', 'project_id', 'role', 'updated_at']);
  }, 'anon');
});

test('public read migration upgrades private installations without losing data or permissions', async () => {
  const legacy = await readFile(new URL('./fixtures/private-setup.sql', import.meta.url), 'utf8');
  const migration = sql;
  await db.exec(legacy);
  await asUser(null, () => denied(getState), 'anon');
  const before = (await db.query('select data from public.projectflow_state')).rows[0].data;
  await db.exec(migration);
  await db.exec(migration); // Safe to run again from the SQL editor.
  await asUser(null, async () => {
    assert.deepEqual((await getState()).data, before);
    await denied(() => save([update('equipo14.personas', before['equipo14.personas'], {})]));
  }, 'anon');
  await asUser(responsible, async () => {
    assert.equal((await getState()).role, 'viewer');
    await denied(() => save([update('equipo14.hitos', { 1: true }, {})]));
  });
  await asUser(leader, async () => {
    const result = await save([update('equipo14.personas', before['equipo14.personas'], {
      ...before['equipo14.personas'], schedule: [{ id: '1', title: 'Mi actividad', dueDate: '2026-11-01', done: false }]
    })]);
    assert.equal(result.data['equipo14.personas'].schedule[0].title, 'Mi actividad');
  });
});

async function rpc(name, args = []) {
  const placeholders = args.map((_, index) => '$' + (index + 1)).join(',');
  return (await db.query(`select public.${name}(${placeholders}) as result`, args)).rows[0].result;
}
let projectA, projectB;
test('owners create independent projects with different durations and delivery dates', async () => {
  await asUser(leader, async () => {
    projectA = await rpc('projectflow_create_project', ['Proyecto corto', '2026-11-01', '2026-11-14', 2]);
    projectB = await rpc('projectflow_create_project', ['Proyecto largo', '2026-12-01', '2027-02-15', 10]);
    assert.notEqual(projectA.project_id, projectB.project_id);
    assert.equal(projectA.data['equipo14.hitos'].weeks.length, 2);
    assert.equal(projectB.data['equipo14.hitos'].weeks.length, 10);
    assert.equal(projectA.data['projecthub.cliente.v1'].project.targetDate, '2026-11-14');
    assert.equal(projectB.data['equipo14.hitos'].weeks[1].startDate, '2026-12-08');
    const list = await rpc('projectflow_list_projects');
    assert.equal(list.length, 3);
    assert.equal((await getState()).project_id, list[0].id);
    await rpc('projectflow_save_project', [projectA.project_id, JSON.stringify([
      update('equipo14.personas', {schedule:[]}, {schedule:[{id:'task-a',title:'Solo A',dueDate:'2026-11-04',done:false}]})
    ])]);
    assert.deepEqual((await rpc('projectflow_get_project', [projectB.project_id])).data['equipo14.personas'], {schedule:[]});
  });
});
test('public links read one project without revealing the project catalog or editor identities', async () => {
  await asUser(null, async () => {
    assert.equal((await rpc('projectflow_get_project', [projectA.project_id])).name, 'Proyecto corto');
    await denied(() => rpc('projectflow_list_projects'));
    await denied(() => rpc('projectflow_list_editors', [projectA.project_id]));
    await denied(() => rpc('projectflow_create_project', ['Sin permiso', null, null, 2]));
    await denied(() => rpc('projectflow_save_project', [projectA.project_id, '[]']));
  }, 'anon');
});
test('an editor authorized for A cannot write B, grant access or create projects', async () => {
  await asUser(leader, () => rpc('projectflow_set_editor', [projectA.project_id, 'responsible@example.test', true]));
  await asUser(responsible, async () => {
    assert.equal((await rpc('projectflow_get_project', [projectA.project_id])).role, 'responsible');
    assert.equal((await rpc('projectflow_get_project', [projectB.project_id])).role, 'viewer');
    assert.deepEqual((await rpc('projectflow_list_projects')).map(p => p.id), [projectA.project_id]);
    await denied(() => rpc('projectflow_save_project', [projectB.project_id, JSON.stringify([update('equipo14.personas', {schedule:[]}, {})])]));
    await denied(() => rpc('projectflow_set_editor', [projectA.project_id, 'outsider@example.test', true]));
    await denied(() => rpc('projectflow_create_project', ['No autorizado', null, null, 4]));
    await denied(() => rpc('projectflow_list_editors', [projectA.project_id]));
    const state = await rpc('projectflow_get_project', [projectA.project_id]);
    await rpc('projectflow_save_project', [projectA.project_id, JSON.stringify([update('equipo14.personas', state.data['equipo14.personas'], {schedule:[]})])]);
    await denied(() => db.query('select * from public.projectflow_project_members'));
  });
});
test('revocation is per project, survives repeated setup, and does not affect another grant', async () => {
  await asUser(leader, async () => {
    await rpc('projectflow_set_editor', [projectB.project_id, 'responsible@example.test', true]);
    await rpc('projectflow_set_editor', [projectA.project_id, 'responsible@example.test', false]);
    await assert.rejects(() => rpc('projectflow_set_editor', [projectA.project_id, 'leader@example.test', false]), e => e.code === '22023');
  });
  await db.exec(sql);
  await asUser(responsible, async () => {
    assert.equal((await rpc('projectflow_get_project', [projectA.project_id])).role, 'viewer');
    assert.equal((await rpc('projectflow_get_project', [projectB.project_id])).role, 'responsible');
    await denied(() => rpc('projectflow_save_project', [projectA.project_id, JSON.stringify([update('equipo14.personas', {schedule:[]}, {})])]));
  });
});
test('invalid project IDs and dates fail without falling back to the original project', async () => {
  await asUser(leader, async () => {
    await assert.rejects(() => rpc('projectflow_get_project', ['ffffffff-ffff-ffff-ffff-ffffffffffff']), e => e.code === 'P0002');
    for (const args of [['',null,null,1],['Mal',null,null,0],['Mal',null,null,105],['Mal','2026-12-01','2026-11-01',1]]) {
      await assert.rejects(() => rpc('projectflow_create_project', args), e => e.code === '22023');
    }
  });
});

test('removing a week and unassigning its tasks is atomic; stale week assignments fail', async () => {
  await asUser(leader, async () => {
    const state = await rpc('projectflow_get_project', [projectB.project_id]);
    const plan = state.data['equipo14.hitos'];
    const task = {id:'dated-task',title:'Entrega',dueDate:'2026-12-04',done:false,weekId:plan.weeks[0].id};
    await rpc('projectflow_save_project', [projectB.project_id, JSON.stringify([update('equipo14.personas',{schedule:[]},{schedule:[task]})])]);
    const shorter = {weeks:plan.weeks.slice(1)};
    await assert.rejects(() => rpc('projectflow_save_project', [projectB.project_id,JSON.stringify([update('equipo14.hitos',plan,shorter)])]), e => e.code === '40001');
    const unassigned = {schedule:[{...task,weekId:''}]};
    await rpc('projectflow_save_project', [projectB.project_id,JSON.stringify([
      update('equipo14.hitos',plan,shorter), update('equipo14.personas',{schedule:[task]},unassigned)
    ])]);
    assert.equal((await rpc('projectflow_get_project',[projectB.project_id])).data['equipo14.personas'].schedule[0].dueDate,'2026-12-04');
    await assert.rejects(() => rpc('projectflow_save_project',[projectB.project_id,JSON.stringify([update('equipo14.personas',unassigned,{schedule:[task]})])]), e => e.code === '40001');
  });
});
