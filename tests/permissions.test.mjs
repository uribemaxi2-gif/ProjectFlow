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
    create table auth.users (id uuid primary key, email text unique,
      email_confirmed_at timestamptz default now(), encrypted_password text default 'test-hash');
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
    grant usage on schema public, auth to anon, authenticated;
    insert into auth.users(id, email) values
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
    assert.deepEqual(Object.keys(result).sort(), ['can_create', 'can_invite', 'can_manage', 'can_submit', 'data', 'name', 'project_id', 'project_role', 'role', 'roles_version', 'updated_at']);
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

let inviteProject, otherInviteProject, invitation;
const newcomer = '10000000-0000-0000-0000-000000000004';
test('only the project owner can prepare invitations; preparation does not grant access', async () => {
  await asUser(leader, async () => {
    inviteProject = (await rpc('projectflow_create_project', ['Invitaciones', null, null, 1])).project_id;
    otherInviteProject = (await rpc('projectflow_create_project', ['Otro privado', null, null, 1])).project_id;
    invitation = await rpc('projectflow_prepare_invitation', [inviteProject, '  New@Example.test  ']);
    assert.equal(invitation.email, 'new@example.test');
    assert.equal((await rpc('projectflow_list_editors', [inviteProject])).length, 1);
    assert.equal((await rpc('projectflow_list_invitations', [inviteProject])).length, 1);
    for (const email of [null, '', 'invalid', 'bad @example.test', 'leader@example.test']) {
      await assert.rejects(() => rpc('projectflow_prepare_invitation', [inviteProject, email]), e => e.code === '22023');
    }
    await assert.rejects(() => rpc('projectflow_prepare_invitation', [inviteProject, invitation.email]), e => e.code === '22023');
  });
  for (const id of [null, outsider, responsible]) {
    await asUser(id, async () => {
      await denied(() => db.query('select * from public.projectflow_invitations'));
      await denied(() => rpc('projectflow_prepare_invitation', [inviteProject, 'another@example.test']));
      await denied(() => rpc('projectflow_list_invitations', [inviteProject]));
      await denied(() => rpc('projectflow_cancel_invitation', [inviteProject, invitation.id]));
      await denied(() => rpc('projectflow_get_invitation', [invitation.id]));
      await denied(() => rpc('projectflow_accept_invitation', [invitation.id]));
    }, id ? 'authenticated' : 'anon');
  }
});

test('the recipient must have a confirmed matching email and their own password', async () => {
  await db.query('insert into auth.users(id,email,email_confirmed_at,encrypted_password) values ($1,$2,null,null)', [newcomer, invitation.email]);
  await asUser(newcomer, () => denied(() => rpc('projectflow_accept_invitation', [invitation.id])));
  await db.query('update auth.users set email_confirmed_at = now() where id = $1', [newcomer]);
  await asUser(newcomer, async () => {
    const info = await rpc('projectflow_get_invitation', [invitation.id]);
    assert.equal(info.has_password, false);
    assert.equal((await rpc('projectflow_get_project', [inviteProject])).role, 'viewer');
    await assert.rejects(() => rpc('projectflow_accept_invitation', [invitation.id]), e => e.code === '22023');
  });
  await db.query('update auth.users set encrypted_password = $1 where id = $2', ['test-hash', newcomer]);
  await asUser(newcomer, async () => {
    const result = await rpc('projectflow_accept_invitation', [invitation.id]);
    assert.equal(result.accepted, true);
    assert.equal(result.project_id, inviteProject);
    assert.equal((await rpc('projectflow_get_project', [inviteProject])).role, 'responsible');
    assert.equal((await rpc('projectflow_get_project', [otherInviteProject])).role, 'viewer');
    assert.equal((await rpc('projectflow_get_project', [inviteProject])).can_create, true);
    assert.equal((await rpc('projectflow_accept_invitation', [invitation.id])).accepted, true);
    await denied(() => rpc('projectflow_prepare_invitation', [inviteProject, 'else@example.test']));
  });
  await asUser(leader, async () => {
    assert.deepEqual(await rpc('projectflow_list_invitations', [inviteProject]), []);
    await assert.rejects(() => rpc('projectflow_cancel_invitation', [inviteProject, invitation.id]), e => e.code === '22023');
  });
});

test('revocation cannot be undone by replaying an accepted invitation or repeating setup', async () => {
  await asUser(leader, () => rpc('projectflow_set_editor', [inviteProject, invitation.email, false]));
  await db.exec(sql);
  await asUser(newcomer, async () => {
    await assert.rejects(() => rpc('projectflow_accept_invitation', [invitation.id]), e => e.code === '22023');
    assert.equal((await rpc('projectflow_get_project', [inviteProject])).role, 'viewer');
  });
});

test('resending replaces the previous invitation and cancellation survives setup', async () => {
  const previous = invitation.id;
  await db.query("update public.projectflow_invitations set prepared_at = now() - interval '2 minutes' where id = $1", [previous]);
  await asUser(leader, async () => {
    invitation = await rpc('projectflow_prepare_invitation', [inviteProject, invitation.email]);
    assert.notEqual(invitation.id, previous);
    await assert.rejects(() => rpc('projectflow_cancel_invitation', [otherInviteProject, invitation.id]), e => e.code === '22023');
    await rpc('projectflow_cancel_invitation', [inviteProject, invitation.id]);
  });
  await db.exec(sql);
  await asUser(newcomer, async () => {
    for (const id of [previous, invitation.id]) await assert.rejects(() => rpc('projectflow_accept_invitation', [id]), e => e.code === '22023');
    assert.equal((await rpc('projectflow_get_project', [inviteProject])).role, 'viewer');
  });
});

test('expired invitations and invitations whose issuer lost ownership cannot be accepted', async () => {
  await db.query("update public.projectflow_invitations set prepared_at = now() - interval '2 minutes' where id = $1", [invitation.id]);
  invitation = await asUser(leader, () => rpc('projectflow_prepare_invitation', [inviteProject, invitation.email]));
  await db.query("update public.projectflow_invitations set expires_at = now() - interval '1 minute' where id = $1", [invitation.id]);
  await asUser(newcomer, () => assert.rejects(() => rpc('projectflow_accept_invitation', [invitation.id]), e => e.code === '22023'));
  await db.query("update public.projectflow_invitations set expires_at = now() + interval '1 day' where id = $1", [invitation.id]);
  await db.query('update public.projectflow_project_members set active = false where project_id = $1 and user_id = $2', [inviteProject, leader]);
  await asUser(newcomer, () => denied(() => rpc('projectflow_accept_invitation', [invitation.id])));
  await db.query('update public.projectflow_project_members set active = true where project_id = $1 and user_id = $2', [inviteProject, leader]);
  await db.query('update auth.users set email = $1 where id = $2', ['changed@example.test', newcomer]);
  await asUser(newcomer, () => denied(() => rpc('projectflow_accept_invitation', [invitation.id])));
});

const qa = '10000000-0000-0000-0000-000000000005';
const junior = '10000000-0000-0000-0000-000000000006';
const pm = '10000000-0000-0000-0000-000000000007';
const admin = '10000000-0000-0000-0000-000000000008';
const viewer = '10000000-0000-0000-0000-000000000009';
let rolesProject, unrelatedProject;
const roleUsers = [[qa, 'qa'], [junior, 'pm_junior'], [pm, 'pm'], [admin, 'admin'], [viewer, 'viewer']];

test('five roles expose only their own capabilities and cannot edit unrelated projects', async () => {
  rolesProject = (await asUser(leader, () => rpc('projectflow_create_project', ['Roles', null, null, 2]))).project_id;
  unrelatedProject = (await asUser(leader, () => rpc('projectflow_create_project', ['Ajeno', null, null, 1]))).project_id;
  for (const [user, role] of roleUsers) {
    await db.query('insert into auth.users(id,email) values ($1,$2)', [user, role + '@example.test']);
    await db.query('insert into public.projectflow_project_members(project_id,user_id,role,can_manage) values ($1,$2,$3,$4)', [rolesProject,user,role,role==='admin']);
    await asUser(user, async () => {
      const state = await rpc('projectflow_get_project', [rolesProject]);
      assert.equal(state.project_role, role);
      assert.equal(state.roles_version, 1);
      assert.equal(state.can_submit, role !== 'viewer');
      assert.equal(state.can_invite, ['pm','admin'].includes(role));
      assert.equal(state.can_manage, role === 'admin');
      assert.equal(state.can_create, ['pm_junior','pm','admin'].includes(role));
      assert.equal((await rpc('projectflow_get_project', [unrelatedProject])).project_role, 'viewer');
      await denied(() => rpc('projectflow_save_project', [unrelatedProject, '[]']));
      await denied(() => rpc('projectflow_submit_request', [unrelatedProject, '{}']));
      await denied(() => rpc('projectflow_prepare_invitation_role', [unrelatedProject, 'new@example.test','qa']));
      await denied(() => db.query('select * from public.projectflow_request_receipts'));
      await denied(() => rpc('projectflow_update_member', [rolesProject, 'qa@example.test','admin',true]));
    });
  }
});

test('QA appends requests with server-owned status and preserves all project data', async () => {
  const before = await asUser(leader, () => rpc('projectflow_get_project',[rolesProject]));
  const payload = {id:crypto.randomUUID(),title:'Corregir pantalla',detail:'La fecha se corta en móvil',category:'Corrección de error',priority:'Alta',requestedBy:'QA'};
  await asUser(qa, async () => {
    await denied(() => rpc('projectflow_save_project', [rolesProject, JSON.stringify([update('projecthub.cliente.v1',before.data['projecthub.cliente.v1'],{})])]));
    const after = await rpc('projectflow_submit_request', [rolesProject,JSON.stringify(payload)]);
    const request = after.data['projecthub.cliente.v1'].requests[0];
    assert.equal(request.status,'Pendiente'); assert.equal(request.submittedBy,qa); assert.equal(request.title,payload.title);
    assert.deepEqual(after.data['equipo14.personas'],before.data['equipo14.personas']);
    assert.deepEqual(after.data['equipo14.hitos'],before.data['equipo14.hitos']);
    for (const key of ['project','reviews','agreements']) assert.deepEqual(after.data['projecthub.cliente.v1'][key],before.data['projecthub.cliente.v1'][key]);
    assert.equal((await rpc('projectflow_submit_request',[rolesProject,JSON.stringify(payload)])).data['projecthub.cliente.v1'].requests.length,1);
    for (const extra of [{status:'Aprobada'},{decision:'Aceptada'},{submittedBy:leader},{createdAt:'2000-01-01'},{role:'admin'},{requests:[]}]) {
      await assert.rejects(() => rpc('projectflow_submit_request',[rolesProject,JSON.stringify({...payload,id:crypto.randomUUID(),...extra})]), e=>e.code==='22023');
    }
    for (const invalid of [{title:''},{detail:''},{detail:'x'.repeat(5001)},{category:'admin'},{reviewRequired:'true'},{priority:null},{id:'bad'}]) {
      await assert.rejects(() => rpc('projectflow_submit_request',[rolesProject,JSON.stringify({...payload,...invalid})]), e=>e.code==='22023');
    }
  });
  await asUser(leader, () => assert.rejects(() => rpc('projectflow_save_project',[rolesProject,JSON.stringify([update('projecthub.cliente.v1',before.data['projecthub.cliente.v1'],{})])]),e=>e.code==='40001'));
  for(const user of [null,viewer]) await asUser(user,()=>denied(()=>rpc('projectflow_submit_request',[rolesProject,JSON.stringify(payload)])),user?'authenticated':'anon');
});

test('PM menor and PM edit every data section but cannot change roles', async () => {
  for (const user of [junior,pm,admin]) await asUser(user, async () => {
    const state = await rpc('projectflow_get_project',[rolesProject]);
    await rpc('projectflow_save_project',[rolesProject,JSON.stringify(Object.entries(state.data).map(([key,value])=>update(key,value,{...value,testRole:user})))]);
    if (user!==admin) {
      await denied(()=>rpc('projectflow_set_member_role',[rolesProject,'qa@example.test','admin']));
      await denied(()=>rpc('projectflow_set_editor',[rolesProject,'qa@example.test',false]));
      await denied(()=>rpc('projectflow_list_editors',[rolesProject]));
    }
  });
  for(const user of [qa,junior,viewer]) await asUser(user,()=>denied(()=>rpc('projectflow_prepare_invitation_role',[rolesProject,'candidate@example.test','qa'])));
});

test('PM invitations are always QA and cannot alter existing users or other invitations', async () => {
  const invited = '10000000-0000-0000-0000-000000000010';
  const adminInvite = await asUser(leader,()=>rpc('projectflow_prepare_invitation_role',[rolesProject,'admin-invited@example.test','pm']));
  let pending;
  await asUser(pm,async()=>{
    for (const role of ['viewer','pm_junior','pm','admin']) await denied(()=>rpc('projectflow_prepare_invitation_role',[rolesProject,'candidate@example.test',role]));
    await assert.rejects(()=>rpc('projectflow_prepare_invitation_role',[rolesProject,'qa@example.test','qa']),e=>e.code==='22023');
    await denied(()=>rpc('projectflow_prepare_invitation_role',[rolesProject,'admin-invited@example.test','qa']));
    await assert.rejects(()=>rpc('projectflow_cancel_invitation',[rolesProject,adminInvite.id]),e=>e.code==='22023');
    pending = await rpc('projectflow_prepare_invitation',[rolesProject,'pm-invited@example.test']);
    assert.equal(pending.role,'qa');
    assert.deepEqual((await rpc('projectflow_list_invitations',[rolesProject])).map(i=>i.id),[pending.id]);
  });
  await db.query('insert into auth.users(id,email) values ($1,$2)',[invited,pending.email]);
  await asUser(invited,async()=>{
    assert.equal((await rpc('projectflow_get_invitation',[pending.id])).role,'qa');
    await rpc('projectflow_accept_invitation',[pending.id]);
    assert.equal((await rpc('projectflow_get_project',[rolesProject])).project_role,'qa');
    await denied(()=>rpc('projectflow_save_project',[rolesProject,'[]']));
  });
  await asUser(leader,()=>rpc('projectflow_set_editor',[rolesProject,pending.email,false]));
  await asUser(pm,()=>assert.rejects(()=>rpc('projectflow_prepare_invitation_role',[rolesProject,pending.email,'qa']),e=>e.code==='22023'));
  await asUser(invited,()=>assert.rejects(()=>rpc('projectflow_accept_invitation',[pending.id]),e=>e.code==='22023'));
});

test('admin assigns roles per project and the last admin cannot be removed', async () => {
  await asUser(leader,async()=>{
    await rpc('projectflow_set_member_role',[rolesProject,'qa@example.test','pm_junior']);
    await assert.rejects(()=>rpc('projectflow_set_member_role',[unrelatedProject,'leader@example.test','viewer']),e=>e.code==='22023');
    await assert.rejects(()=>rpc('projectflow_set_editor',[unrelatedProject,'leader@example.test',false]),e=>e.code==='22023');
    await assert.rejects(()=>rpc('projectflow_set_member_role',[rolesProject,'qa@example.test','superadmin']),e=>e.code==='22023');
  });
  await asUser(qa,async()=>{
    assert.equal((await rpc('projectflow_get_project',[rolesProject])).project_role,'pm_junior');
    assert.equal((await rpc('projectflow_get_project',[unrelatedProject])).project_role,'viewer');
  });
  await asUser(admin,()=>rpc('projectflow_set_member_role',[rolesProject,'qa@example.test','qa']));
  const before = await asUser(qa,()=>rpc('projectflow_get_project',[rolesProject]));
  await db.exec(sql);
  const after = await asUser(qa,()=>rpc('projectflow_get_project',[rolesProject]));
  assert.equal(after.project_role,'qa'); assert.deepEqual(after.data,before.data);
});

test('creating projects preserves PM roles and copies admins without elevating the creator', async () => {
  for(const [user,role] of [[junior,'pm_junior'],[pm,'pm']]) await asUser(user,async()=>{
    const result = await rpc('projectflow_create_project_from',[rolesProject,'Nuevo con roles',null,null,3]);
    assert.equal(result.project_role,role); assert.equal(result.can_manage,false);
    assert.equal(result.can_invite,role==='pm');
    await denied(()=>rpc('projectflow_set_member_role',[result.project_id,role+'@example.test','admin']));
    const admins = await db.query("select user_id from public.projectflow_project_members where project_id=$1",[result.project_id]).catch(e=>e);
    assert.equal(admins.code,'42501');
    await denied(()=>rpc('projectflow_create_project_from',[unrelatedProject,'Ajeno',null,null,1]));
  });
  for(const user of [qa,viewer]) await asUser(user,()=>denied(()=>rpc('projectflow_create_project_from',[rolesProject,'No permitido',null,null,1])));
});

test('demoting an inviter invalidates pending grants and downgrades cannot be undone by replay', async () => {
  const invited='10000000-0000-0000-0000-000000000011';
  const pending=await asUser(pm,()=>rpc('projectflow_prepare_invitation_role',[rolesProject,'later@example.test','qa']));
  await db.query('insert into auth.users(id,email) values ($1,$2)',[invited,pending.email]);
  await asUser(leader,()=>rpc('projectflow_set_member_role',[rolesProject,'pm@example.test','pm_junior']));
  await asUser(invited,()=>denied(()=>rpc('projectflow_accept_invitation',[pending.id])));
  await asUser(leader,()=>rpc('projectflow_set_member_role',[rolesProject,'pm@example.test','pm']));
  await asUser(invited,()=>rpc('projectflow_accept_invitation',[pending.id]));
  await asUser(leader,()=>rpc('projectflow_set_member_role',[rolesProject,pending.email,'viewer']));
  await asUser(invited,()=>assert.rejects(()=>rpc('projectflow_accept_invitation',[pending.id]),e=>e.code==='22023'));
  await db.exec(sql);
  assert.equal((await asUser(invited,()=>rpc('projectflow_get_project',[rolesProject]))).project_role,'viewer');
});

test('admin invitations grant exactly their selected role, including viewer and admin', async () => {
  for (const role of ['viewer','qa','pm_junior','pm','admin']) {
    const user = crypto.randomUUID(), email = 'invite-'+role+'@example.test';
    await db.query('insert into auth.users(id,email) values ($1,$2)',[user,email]);
    const invite = await asUser(admin,()=>rpc('projectflow_prepare_invitation_role',[rolesProject,email,role]));
    await asUser(user,async()=>{
      assert.equal((await rpc('projectflow_get_invitation',[invite.id])).role,role);
      await rpc('projectflow_accept_invitation',[invite.id]);
      assert.equal((await rpc('projectflow_get_project',[rolesProject])).project_role,role);
      assert.equal((await rpc('projectflow_get_project',[unrelatedProject])).project_role,'viewer');
      await rpc('projectflow_accept_invitation',[invite.id]);
    });
  }
});

test('a pre-role database upgrades without restoring revoked accounts or changing pending invitations', async () => {
  const migrationDb = new PGlite();
  try {
    await migrationDb.exec(`
      create role anon; create role authenticated; create schema auth;
      create table auth.users(id uuid primary key,email text,encrypted_password text,email_confirmed_at timestamptz);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      insert into auth.users(id,email) values ('${leader}','leader@example.test'),('${responsible}','responsible@example.test');
    `);
    await migrationDb.exec(await readFile(new URL('./fixtures/private-setup.sql', import.meta.url),'utf8'));
    await migrationDb.exec(`
      select public.projectflow_authorize('leader@example.test','leader');
      select public.projectflow_authorize('responsible@example.test','responsible');
      alter table public.projectflow_state add column project_id uuid not null default gen_random_uuid() unique;
      update public.projectflow_state set data='{"preserved":{"value":"kept"}}';
      create table public.projectflow_project_members (
        project_id uuid references public.projectflow_state(project_id),user_id uuid references auth.users(id),
        can_manage boolean not null default false, active boolean not null default true, primary key(project_id,user_id));
      insert into public.projectflow_project_members select project_id,'${leader}',true,true from public.projectflow_state;
      insert into public.projectflow_project_members select project_id,'${responsible}',false,false from public.projectflow_state;
      create table public.projectflow_invitations (
        id uuid primary key default gen_random_uuid(),project_id uuid references public.projectflow_state(project_id),
        email text not null,invited_by uuid references auth.users(id),status text not null default 'pending',
        prepared_at timestamptz default now(),expires_at timestamptz default now()+interval '7 days',
        accepted_by uuid references auth.users(id),unique(project_id,email));
      insert into public.projectflow_invitations(project_id,email,invited_by)
        select project_id,'old-invitation@example.test','${leader}' from public.projectflow_state;
    `);
    await migrationDb.exec(sql);
    let rows=(await migrationDb.query('select user_id,role,active from public.projectflow_project_members order by user_id')).rows;
    assert.deepEqual(rows,[{user_id:leader,role:'admin',active:true},{user_id:responsible,role:'pm_junior',active:false}]);
    assert.equal((await migrationDb.query('select role from public.projectflow_invitations')).rows[0].role,'pm_junior');
    await migrationDb.query("update public.projectflow_project_members set role='qa' where user_id=$1",[responsible]);
    await migrationDb.exec(sql);
    rows=(await migrationDb.query('select role,active from public.projectflow_project_members where user_id=$1',[responsible])).rows;
    assert.deepEqual(rows,[{role:'qa',active:false}]);
    assert.deepEqual((await migrationDb.query('select data from public.projectflow_state')).rows[0].data,{preserved:{value:'kept'}});
  } finally { await migrationDb.close(); }
});
