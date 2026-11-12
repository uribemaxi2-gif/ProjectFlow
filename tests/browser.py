"""Browser integration tests using an isolated, simulated Supabase API.

The real SQL authorization rules are exercised separately by npm test.
No test contacts Supabase or sends email.
"""
import base64
import copy
import json
import uuid
import datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from functools import partial
from pathlib import Path
import threading
import time
import unittest
import subprocess
from urllib.parse import urlparse, parse_qs

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
TEAM = 'equipo14.personas'
PLAN = 'equipo14.hitos'
PROJECT = 'projecthub.cliente.v1'


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


class Backend:
    def __init__(self):
        self.data = {}
        self.roles = {'leader@example.test': 'leader', 'responsible@example.test': 'responsible'}
        self.fail_next_save = False
        self.saved = 0
        self.public = True
        self.multi = True
        self.default_id = '20000000-0000-0000-0000-000000000001'
        self.projects = {}
        self.accounts = {email: {'has_password': True, 'metadata': {'display_name':email.split('@')[0]}} for email in (*self.roles, 'outsider@example.test')}
        self.invitations = {}
        self.emails = []
        self.fail_email = False
        self.invitations_available = True
        self.role_features = False
        self.global_scope = False
        self.global_admins = {"leader@example.test"}
        self.receipts = {}
        self.fail_after_request = False
        self.password_updates = []
        self.fail_password_update = False
        self.fail_assignees = False
        self.fail_profile_update = False

    @staticmethod
    def normalized_role(role):
        return {'leader': 'admin', 'responsible': 'pm_junior'}.get(role, role)

    @staticmethod
    def jwt(email):
        def encode(value):
            return base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip('=')
        return encode({'alg': 'HS256', 'typ': 'JWT'}) + '.' + encode({
            'sub': email, 'email': email, 'role': 'authenticated', 'exp': int(time.time()) + 3600
        }) + '.test-signature'

    def route(self, route):
        request = route.request
        path = urlparse(request.url).path
        body = request.post_data_json if request.post_data else {}
        headers = {'access-control-allow-origin': '*', 'access-control-allow-headers': '*'}

        def respond(status, data):
            route.fulfill(status=status, headers=headers, content_type='application/json', body=json.dumps(data))

        if request.method == 'OPTIONS':
            respond(200, {})
            return
        if path == '/auth/v1/token':
            email = body.get('email', '')
            expected = self.accounts.get(email, {}).get('password', 'test-password-only')
            if body.get('password') != expected:
                respond(400, {'error': 'invalid_grant', 'error_description': 'Invalid login credentials'})
                return
            email = body['email']
            self.accounts.setdefault(email, {'has_password': True})
            respond(200, {'access_token': self.jwt(email), 'refresh_token': 'test-refresh-token',
                          'token_type': 'bearer', 'expires_in': 3600, 'expires_at': int(time.time()) + 3600,
                          'user': {'id': email, 'email': email, 'aud': 'authenticated',
                                   'role': 'authenticated', 'app_metadata': {}, 'user_metadata': self.accounts.get(email,{}).get('metadata',{})}})
            return
        if path == '/auth/v1/logout':
            respond(200, {})
            return
        if path == '/auth/v1/recover':
            if self.fail_email:
                respond(500, {'code':'unexpected_failure','msg':'Mail unavailable'})
            else:
                self.emails.append({'email':body['email'],'redirect':parse_qs(urlparse(request.url).query)['redirect_to'][0],'recovery':True})
                respond(200,{})
            return
        if path == '/auth/v1/otp':
            if self.fail_email:
                respond(400, {'code': 'email_address_not_authorized', 'msg': 'Email sending is not configured'})
                return
            # GoTrue creates a random password hash for OTP signups; the user does not know it.
            self.accounts.setdefault(body['email'], {'has_password': True, 'password': 'random-unknown-otp-password'})
            self.emails.append({'email': body['email'], 'redirect': parse_qs(urlparse(request.url).query)['redirect_to'][0], 'create_user': body.get('create_user')})
            respond(200, {})
            return
        token = request.headers.get('authorization', '').removeprefix('Bearer ')
        try:
            part = token.split('.')[1]
            email = json.loads(base64.urlsafe_b64decode(part + '=' * (-len(part) % 4)))['email']
        except (IndexError, ValueError, KeyError):
            email = ''
        if path == '/auth/v1/user':
            if request.method == 'PUT' and 'data' in body:
                if self.fail_profile_update:
                    respond(500, {'code':'unexpected_failure','msg':'Cannot save profile'})
                    return
                self.accounts[email].setdefault('metadata',{}).update(body['data'])
            if request.method == 'PUT' and 'password' in body:
                if self.fail_password_update:
                    respond(422, {'code': 'weak_password', 'msg': 'Password update failed'})
                    return
                self.accounts[email]['has_password'] = True
                self.accounts[email]['password'] = body['password']
                self.password_updates.append(email)
            respond(200, {'id': email, 'email': email, 'aud': 'authenticated', 'role': 'authenticated',
                          'email_confirmed_at': '2026-01-01T00:00:00Z', 'app_metadata': {}, 'user_metadata': self.accounts.get(email,{}).get('metadata',{})})
            return
        name = path.removeprefix('/rest/v1/rpc/')
        if not self.invitations_available and 'invitation' in name:
            respond(404, {'code': 'PGRST202', 'message': 'Function not installed'})
            return
        if not self.multi and name not in ('projectflow_get_state', 'projectflow_save'):
            respond(404, {'code': 'PGRST202', 'message': 'Function not installed'})
            return
        selected = body.get('p_project_id') or body.get('p_source_project_id') or self.default_id
        if name in ('projectflow_get_invitation', 'projectflow_accept_invitation'):
            invitation = self.invitations.get(body['p_invitation_id'])
            if not invitation:
                respond(400, {'code': '22023', 'message': 'El enlace de invitación ya no es válido.'})
                return
            selected = invitation['project_id']
        if selected != self.default_id and selected not in self.projects:
            respond(404, {'code': 'P0002', 'message': 'El proyecto no existe'})
            return
        data = self.data if selected == self.default_id else self.projects[selected]['data']
        roles = self.roles if selected == self.default_id else self.projects[selected]['roles']
        role = 'admin' if self.global_scope and email in self.global_admins else self.normalized_role(roles.get(email, 'viewer'))
        if name in ('projectflow_prepare_invitation', 'projectflow_prepare_invitation_role', 'projectflow_list_invitations', 'projectflow_cancel_invitation'):
            if role not in ('admin', 'pm'):
                respond(403, {'code': '42501', 'message': 'Solo el propietario puede invitar.'})
                return
            if name in ('projectflow_prepare_invitation', 'projectflow_prepare_invitation_role'):
                target = body['p_email'].strip().lower()
                invited_role = body.get('p_role', 'qa' if role == 'pm' else 'pm_junior')
                if role == 'pm' and (invited_role not in ('viewer','qa','pm_junior') if self.global_scope else invited_role != 'qa'):
                    respond(403, {'code': '42501', 'message': 'El PM solo puede invitar como Consultor / QA.'})
                    return
                if self.role_features and target in roles:
                    respond(400, {'code': '22023', 'message': 'Esa cuenta ya tiene un rol.'})
                    return
                for key, item in list(self.invitations.items()):
                    if item['email'] == target and item['project_id'] == selected:
                        del self.invitations[key]
                invitation = {'id': str(uuid.uuid4()), 'email': target, 'project_id': selected,
                              'status': 'pending', 'invited_by': email, 'expired': False,
                              'expires_at': '2030-01-01T00:00:00Z', 'role': invited_role}
                self.invitations[invitation['id']] = invitation
                respond(200, invitation)
            elif name == 'projectflow_list_invitations':
                respond(200, [item for item in self.invitations.values() if item['project_id'] == selected and item['status'] == 'pending' and (role == 'admin' or item['invited_by'] == email)])
            else:
                invitation = self.invitations.get(body['p_invitation_id'])
                if not invitation or invitation['project_id'] != selected or invitation['status'] != 'pending' or (role != 'admin' and invitation['invited_by'] != email):
                    respond(400, {'code': '22023', 'message': 'La invitación cambió. Actualiza la lista.'})
                    return
                invitation['status'] = 'revoked'
                respond(200, None)
            return
        if name in ('projectflow_get_invitation', 'projectflow_accept_invitation'):
            if email != invitation['email'] or self.normalized_role(roles.get(invitation['invited_by'])) not in ('admin', 'pm'):
                respond(403, {'code': '42501', 'message': 'Esta invitación no corresponde a tu cuenta.'})
                return
            if invitation['status'] == 'revoked' or invitation['expired']:
                respond(400, {'code': '22023', 'message': 'La invitación venció o fue cancelada.'})
                return
            if name == 'projectflow_accept_invitation':
                if not self.accounts[email]['has_password']:
                    respond(400, {'code': '22023', 'message': 'Crea primero tu contraseña.'})
                    return
                roles[email] = invitation['role'] if self.role_features else 'responsible'
                invitation['status'] = 'accepted'
            respond(200, {'project_id': selected, 'name': data.get(PROJECT, {}).get('project', {}).get('name', 'Mi proyecto'),
                          'email': email, 'role': invitation['role'], 'accepted': invitation['status'] == 'accepted', 'has_password': self.accounts[email]['has_password']})
            return
        def state():
            result = {'data': data, 'role': roles.get(email, 'viewer'), 'assignee_names': {r['assigneeId']: self.accounts.get(r['assigneeId'],{}).get('metadata',{}).get('display_name','Sin alias') for r in data.get(PROJECT,{}).get('requests',[]) if r.get('assigneeId')}}
            if self.multi:
                result.update({'project_id': selected, 'name': data.get(PROJECT, {}).get('project', {}).get('name', 'Mi proyecto'),
                               'can_create': email == 'leader@example.test', 'can_manage': roles.get(email) == 'leader'})
            if self.role_features:
                current = 'admin' if self.global_scope and email in self.global_admins else self.normalized_role(roles.get(email, 'viewer'))
                result.update({'project_role': current, 'roles_version': 1, 'can_manage': current == 'admin' or (self.global_scope and current == 'pm'), 'scope_version': 2 if self.global_scope else 1,
                               'can_submit': current != 'viewer', 'can_invite': current in ('pm', 'admin'),
                               'can_create': current in ('pm_junior', 'pm', 'admin'),
                               'role': 'leader' if current == 'admin' else 'responsible' if current in ('pm_junior', 'pm') else 'viewer'})
            return result
        if name in ('projectflow_get_state', 'projectflow_get_project') and (self.public or email in roles):
            respond(200, state())
            return
        if name == 'projectflow_list_assignees':
            if self.fail_assignees:
                respond(503, {'code':'unavailable','message':'Temporary failure'})
                return
            if role not in ('pm_junior','pm','admin'):
                respond(403, {'code':'42501','message':'No puedes asignar responsables.'})
                return
            candidates = roles | ({e:'admin' for e in self.global_admins} if self.global_scope else {})
            respond(200, [{'id':e,'email':e,'name':self.accounts.get(e,{}).get('metadata',{}).get('display_name','Sin alias'),'role':self.normalized_role(r)} for e,r in candidates.items() if self.normalized_role(r) in ('qa','pm_junior','pm','admin')])
            return
        if name == 'projectflow_list_projects' and email:
            projects = [(self.default_id, self.data, self.roles)] + [(id, p['data'], p['roles']) for id, p in self.projects.items()]
            respond(200, [{'id': id, 'name': d.get(PROJECT, {}).get('project', {}).get('name', 'Mi proyecto')} for id, d, r in projects if email in r or (self.global_scope and email in self.global_admins)])
            return
        if (name == 'projectflow_create_project' and email == 'leader@example.test') or (name == 'projectflow_create_project_from' and role in ('pm_junior', 'pm', 'admin')):
            selected = str(uuid.uuid4())
            start = datetime.date.fromisoformat(body['p_start']) if body.get('p_start') else None
            weeks = [{'id': str(uuid.uuid4()), 'title': 'Semana '+str(i+1), 'objective': '',
                      'startDate': str(start+datetime.timedelta(days=i*7)) if start else '',
                      'dueDate': str(start+datetime.timedelta(days=i*7+6)) if start else '', 'done': False} for i in range(body['p_weeks'])]
            data = {TEAM:{'schedule':[]}, PLAN:{'weeks':weeks}, PROJECT:{'schema':1,'project':{'name':body['p_name'],'startDate':body.get('p_start') or '', 'targetDate':body.get('p_due') or ''},'requests':[],'reviews':[],'agreements':[],'activity':[]}}
            roles = ({e:r for e,r in roles.items() if self.normalized_role(r) == 'admin'} | {email:role}) if self.role_features else {email:'leader'}
            self.projects[selected] = {'data':data,'roles':roles}
            respond(200, state())
            return
        if name in ('projectflow_list_editors','projectflow_set_editor','projectflow_set_member_role') and (role == 'admin' or (self.global_scope and role == 'pm')):
            if self.global_scope and role == 'pm' and name != 'projectflow_list_editors' and (body.get('p_role','viewer') not in ('viewer','qa','pm_junior') or self.normalized_role(roles.get(body['p_email'])) in ('pm','admin') or body['p_email'] in self.global_admins):
                respond(403, {'code':'42501','message':'El PM solo administra roles inferiores.'})
                return
            if name == 'projectflow_set_member_role' or (name == 'projectflow_set_editor' and not body['p_enabled']):
                target = body['p_email']
                if self.normalized_role(roles.get(target)) == 'admin' and body.get('p_role') != 'admin' and sum(self.normalized_role(r) == 'admin' for r in roles.values()) == 1:
                    respond(400, {'code': '22023', 'message': 'El proyecto debe conservar al menos un admin.'})
                    return
                for item in self.invitations.values():
                    if item['email'] == target and item['project_id'] == selected: item['status'] = 'revoked'
            if name == 'projectflow_set_member_role':
                roles[body['p_email']] = body['p_role']
                if self.global_scope:
                    if body['p_role'] == 'admin': self.global_admins.add(body['p_email'])
                    else: self.global_admins.discard(body['p_email'])
            if name == 'projectflow_set_editor':
                if body['p_enabled']: roles[body['p_email']] = 'responsible'
                else:
                    roles.pop(body['p_email'], None)
                    for item in self.invitations.values():
                        if item['email'] == body['p_email'] and item['project_id'] == selected: item['status'] = 'revoked'
            listed_roles = roles | ({e:'admin' for e in self.global_admins} if self.global_scope else {})
            respond(200, [{'email': e,'name':self.accounts.get(e,{}).get('metadata',{}).get('display_name'),'owner': self.normalized_role(r) == 'admin','active':True,'role':self.normalized_role(r),'self':e == email} for e,r in listed_roles.items()])
            return
        if name == 'projectflow_submit_request' and role in ('qa', 'pm_junior', 'pm', 'admin'):
            payload = body['p_request']
            receipt_key = (selected, payload['id'])
            if receipt_key in self.receipts:
                respond(200, state())
                return
            section = data.setdefault(PROJECT, {'schema':1,'project':{},'requests':[],'reviews':[],'agreements':[],'activity':[]})
            section['requests'].append({**payload,'status':'Pendiente','decision':'','createdDate':'2026-11-05',
                                        'createdAt':'2026-11-05T12:00:00Z','updatedAt':'2026-11-05T12:00:00Z','submittedBy':email,'requestedRole':role})
            self.receipts[receipt_key] = copy.deepcopy(payload)
            if self.fail_after_request:
                self.fail_after_request = False
                respond(503, {'code': 'unavailable', 'message': 'Se perdió la respuesta; reintenta la solicitud.'})
                return
            respond(200, state())
            return
        if role not in ('pm_junior', 'pm', 'admin') or name not in ('projectflow_save','projectflow_save_project'):
            respond(403, {'code': '42501', 'message': 'Acceso denegado'})
            return
        if self.fail_next_save:
            self.fail_next_save = False
            respond(503, {'code': 'unavailable', 'message': 'Temporary failure'})
            return
        updates = body['p_updates']
        if any(data.get(item['key']) != item['expected'] for item in updates):
            respond(409, {'code': '40001', 'message': 'Concurrent update'})
            return
        for item in updates:
            value = copy.deepcopy(item['value'])
            if item['key'] == PROJECT:
                previous = {r.get('id'):r for r in data.get(PROJECT,{}).get('requests',[])}
                for record in value.get('requests',[]):
                    if 'assigneeId' in record:
                        prior = previous.get(record.get('id'),{})
                        assigned = record['assigneeId']
                        record['assigneeName'] = (prior.get('assigneeName','') if assigned and assigned == prior.get('assigneeId') else self.accounts.get(assigned,{}).get('metadata',{}).get('display_name','Sin alias') if assigned else '')
            data[item['key']] = value
        self.saved += 1
        respond(200, state())



class SharedProjectTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=ROOT))
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.base = f'http://127.0.0.1:{cls.server.server_port}'
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(executable_path='/usr/bin/chromium', headless=True)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()
        cls.server.shutdown()
        cls.server.server_close()

    def setUp(self):
        self.backend = Backend()
        self.contexts = []
        self.errors = []

    def tearDown(self):
        for context in self.contexts:
            context.close()
        self.assertEqual(self.errors, [])

    def page(self, mobile=False):
        context = self.browser.new_context(viewport={'width': 390, 'height': 844} if mobile else {'width': 1280, 'height': 720})
        context.route('https://vhpvyebzypqikozzimmw.supabase.co/**', self.backend.route)
        self.contexts.append(context)
        page = context.new_page()
        page.set_default_timeout(8000)
        page.on('pageerror', lambda error: self.errors.append(str(error)))
        return page

    def open_settings(self, page):
        if page.locator('#pf-settings').is_visible():
            return
        if page.locator('#pf-menu-toggle').get_attribute('aria-expanded') == 'false':
            page.locator('#pf-menu-toggle').click()
        page.locator('#pf-open-settings').click()
        expect(page.locator('#pf-settings')).to_be_visible()

    def settings_click(self, page, selector):
        self.open_settings(page)
        section = 'security' if selector == '#pf-set-password' else 'appearance' if selector == '#pf-font-reset' else 'data'
        page.locator('[data-settings-section="'+section+'"]').click()
        page.locator(selector).click()

    def close_settings(self, page):
        if page.locator('#pf-settings').is_visible():
            page.locator('#pf-settings-back').click()
            expect(page.locator('#pf-settings')).to_be_hidden()

    def set_font_level(self, page, level):
        self.open_settings(page)
        page.locator('[data-settings-section=appearance]').click()
        slider = page.get_by_role('slider', name='Tamaño de letra')
        slider.focus()
        slider.press('Home')
        for _ in range(level - 1):
            slider.press('ArrowRight')
        expect(slider).to_have_value(str(level))

    def login(self, page, email='leader@example.test', path='index.html', password='test-password-only'):
        page.goto(self.base + '/' + path)
        if self.backend.public:
            self.settings_click(page, '#pf-open-login')
        page.locator('#pf-email-input').fill(email)
        page.locator('#pf-password').fill(password)
        page.locator('#pf-enter').click()
        expect(page.locator('#pf-gate')).to_be_hidden()
        selected = parse_qs(urlparse(page.url).query).get('project', [self.backend.default_id])[0]
        roles = self.backend.roles if selected == self.backend.default_id else self.backend.projects[selected]['roles']
        labels = {'viewer':'Usuario · Solo lectura','qa':'Consultor / QA','pm_junior':'PM menor','pm':'PM','admin':'Admin global'}
        expected = labels[self.backend.normalized_role(roles.get(email, 'viewer'))] if self.backend.role_features else 'Edición autorizada' if email in roles else 'Solo lectura'
        if self.backend.global_scope and email in self.backend.global_admins: expected = 'Admin global'
        expect(page.locator('#pf-role')).to_have_text(expected)
        self.close_settings(page)

    def wait_saved(self, page):
        expect(page.locator('#pf-status')).to_have_text('Guardado compartido')

    def accept_invitation(self, page):
        if not page.locator('#inv-display-name').input_value():
            page.locator('#inv-display-name').fill('Persona invitada')
        page.locator('#inv-submit').click()

    def open_invitation(self, page, email, invitation_email=None):
        # Simulate an email verification callback on the recipient's own device.
        invitation_email = invitation_email or self.backend.emails[-1]
        page.goto(invitation_email['redirect'] + '#access_token=' + self.backend.jwt(email)
                  + '&refresh_token=test-refresh&expires_in=3600&token_type=bearer&type=magiclink')

    def invite(self, page, email):
        self.settings_click(page, '#pf-project-access')
        page.locator('#pf-add-editor [name="email"]').fill(email)
        page.locator('#pf-add-editor button[type="submit"]').click()
        expect(page.locator('#pf-access-message')).to_contain_text('Invitación enviada')
        return self.backend.emails[-1]

    def test_invited_person_chooses_alias_and_profile_failure_does_not_accept_invitation(self):
        owner=self.page(); self.login(owner)
        self.invite(owner,'new@example.test')
        guest=self.page(mobile=True); self.open_invitation(guest,'new@example.test')
        expect(guest.locator('#inv-display-name')).to_be_visible()
        expect(guest.locator('#inv-display-name')).to_have_value('')
        guest.locator('#inv-password').fill('Abc123')
        guest.locator('#inv-confirm').fill('Abc123')
        guest.locator('#inv-submit').click()
        self.assertEqual(next(iter(self.backend.invitations.values()))['status'],'pending')
        guest.locator('#inv-display-name').fill('  Sol   Torres  ')
        self.backend.fail_profile_update=True
        guest.locator('#inv-submit').click()
        expect(guest.locator('#inv-message')).to_contain_text('No se pudo guardar tu nombre')
        self.assertEqual(next(iter(self.backend.invitations.values()))['status'],'pending')
        self.backend.fail_profile_update=False
        guest.locator('#inv-submit').click()
        expect(guest.locator('#pf-role')).to_have_text('Edición autorizada')
        self.open_settings(guest)
        expect(guest.locator('#pf-account-heading')).to_have_text('Sol Torres')
        expect(guest.locator('#pf-display-name')).to_have_value('Sol Torres')
        self.assertEqual(self.backend.accounts['new@example.test']['metadata']['display_name'],'Sol Torres')
        self.assertEqual(self.backend.accounts['leader@example.test']['metadata']['display_name'],'leader')
        self.assertEqual(self.backend.password_updates,['new@example.test'])
        another=self.page(); self.login(another,'new@example.test',password='Abc123')
        self.open_settings(another)
        expect(another.locator('#pf-account-heading')).to_have_text('Sol Torres')

    def test_existing_user_can_choose_alias_and_responsible_name_updates_without_losing_draft(self):
        self.enable_roles(); self.backend.global_scope=True
        self.backend.accounts['qa@example.test']['metadata']={}
        self.backend.data[PROJECT]={'schema':1,'project':{},'requests':[{'id':'alias-task','title':'Trabajo','detail':'Detalle','assigneeId':'qa@example.test','assigneeName':'antiguo-correo','requestedRole':'admin'}],'reviews':[],'agreements':[],'activity':[]}
        owner=self.page(); owner.clock.install(); self.login(owner,path='proyecto.html')
        owner.get_by_role('button',name='+ Nueva solicitud',exact=True).click()
        owner.locator('#f-title').fill('Borrador que debe conservarse')
        person=self.page(mobile=True); self.login(person,'qa@example.test')
        self.open_settings(person)
        person.locator('[data-settings-section=account]').click()
        expect(person.locator('#pf-account-heading')).to_have_text('Elige tu nombre')
        person.locator('#pf-edit-alias').click()
        person.locator('#pf-display-name').fill('  ')
        person.locator('#pf-save-alias').click()
        expect(person.locator('#pf-profile-message')).to_contain_text('Escribe un nombre')
        person.locator('#pf-display-name').fill('Luna <QA>')
        self.backend.fail_profile_update=True
        person.locator('#pf-save-alias').click()
        expect(person.locator('#pf-profile-message')).to_contain_text('No se pudo guardar')
        person.locator('[data-settings-section=account]').click()
        expect(person.locator('#pf-account-heading')).to_have_text('Elige tu nombre')
        self.backend.fail_profile_update=False
        person.locator('#pf-save-alias').click()
        person.locator('[data-settings-section=account]').click()
        expect(person.locator('#pf-account-heading')).to_have_text('Luna <QA>')
        expect(person.locator('#pf-role')).to_have_text('Consultor / QA')
        expect(person.locator('#pf-account-heading qa')).to_have_count(0)
        owner.clock.fast_forward(31000)
        expect(owner.locator('#recent-requests .record-assignee')).to_contain_text('Luna <QA>')
        expect(owner.locator('#f-title')).to_have_value('Borrador que debe conservarse')
        expect(owner.locator('#edit-dialog')).to_be_visible()
        person.reload()
        person.locator('[data-settings-section=account]').click()
        expect(person.locator('#pf-account-heading')).to_have_text('Luna <QA>')
        expect(person.locator('#pf-settings')).to_be_visible()
        reader=self.page(); reader.goto(self.base+'/proyecto.html')
        expect(reader.locator('#recent-requests .record-assignee')).to_contain_text('Luna <QA>')
        expect(reader.locator('#recent-requests')).not_to_contain_text('antiguo-correo')
        self.assertEqual(self.backend.password_updates,[])

    def test_anonymous_and_unapproved_accounts_can_read_but_cannot_edit(self):
        page = self.page()
        for name in ('index.html', 'cronograma.html', 'proyecto.html'):
            page.goto(self.base + '/' + name)
            expect(page.locator('#pf-role')).to_have_text('Solo lectura')
            expect(page.locator('.layout')).to_be_visible()
            for button in page.locator('[data-pf-edit]').all():
                expect(button).to_be_hidden()
            self.assertIn('autorizadas', page.evaluate("ProjectFlow.set('equipo14.hitos', {}).catch(e => e.message)"))
        page.locator('.side-link[data-page="proyecto"]').click()
        expect(page.locator('#project-name')).to_have_attribute('readonly', '')
        self.login(page, 'outsider@example.test')
        expect(page.locator('#agenda-title-1')).to_have_attribute('readonly', '')
        self.assertEqual(self.backend.saved, 0)
        self.assertEqual(self.backend.data, {})

    def test_two_authorized_browsers_share_agenda_and_milestones(self):
        leader = self.page()
        self.login(leader)
        leader.locator('#agenda-title-1').fill('Integrante compartido')
        self.wait_saved(leader)
        responsible = self.page()
        self.login(responsible, 'responsible@example.test')
        expect(responsible.locator('#agenda-title-1')).to_have_value('Integrante compartido')
        responsible.locator('nav a[href*="cronograma.html"]').click()
        responsible.locator('#week-done').check()
        self.wait_saved(responsible)
        leader.goto(self.base + '/cronograma.html')
        expect(leader.locator('#week-done')).to_be_checked()
        expect(leader.locator('#progress-percent')).to_have_text('25%')

    def test_stale_browser_preserves_other_person_changes(self):
        first = self.page()
        self.login(first)
        first.locator('#agenda-title-1').fill('Inicial')
        self.wait_saved(first)
        second = self.page()
        self.login(second, 'responsible@example.test')
        second.locator('#agenda-title-1').fill('Cambio del responsable')
        self.wait_saved(second)
        first.locator('#agenda-title-1').fill('Cambio sin guardar')
        expect(first.locator('#pf-status')).to_contain_text('Otra persona guardó cambios')
        expect(first.locator('#agenda-title-1')).to_have_value('Cambio sin guardar')
        self.assertEqual(self.backend.data[TEAM]['schedule'][0]['title'], 'Cambio del responsable')
        first.once('dialog', lambda dialog: dialog.accept())
        first.reload()
        expect(first.locator('#agenda-title-1')).to_have_value('Cambio del responsable')

    def test_project_form_and_request_retry_do_not_duplicate_records(self):
        page = self.page()
        self.login(page, path='proyecto.html')
        page.locator('.side-link[data-page="proyecto"]').click()
        page.locator('#project-name').fill('Proyecto compartido')
        page.locator('#project-form button[type="submit"]').click()
        self.wait_saved(page)
        page.reload()
        expect(page.locator('#hero-name')).to_have_text('Proyecto compartido')
        page.get_by_role('button', name='+ Nueva solicitud', exact=True).click()
        page.locator('#f-title').fill('Solicitud compartida')
        page.locator('#f-detail').fill('Detalle de la solicitud.')
        self.backend.fail_next_save = True
        page.locator('#entry-form button[type="submit"]').click()
        expect(page.locator('#sync-label')).to_have_text('No guardado')
        expect(page.locator('#edit-dialog')).to_be_visible()
        expect(page.locator('#f-title')).to_have_value('Solicitud compartida')
        self.assertEqual(len(self.backend.data[PROJECT]['requests']), 0)
        page.locator('#entry-form button[type="submit"]').click()
        expect(page.locator('#edit-dialog')).to_be_hidden()
        self.assertEqual(len(self.backend.data[PROJECT]['requests']), 1)
        other = self.page()
        self.login(other, 'responsible@example.test', 'proyecto.html')
        expect(other.locator('#recent-requests')).to_contain_text('Solicitud compartida')
        expect(other.locator('#stat-total')).to_have_text('1')
        expect(other.locator('#recent-requests')).to_contain_text('Admin global')
        expect(other.locator('#recent-requests')).to_contain_text('Detalle de la solicitud.')
        expect(other.locator('#recent-requests')).to_contain_text('Urgencia: Media')
        other.get_by_role('button', name='+ Nueva revisión', exact=True).click()
        other.locator('#f-title').fill('Revisión compartida')
        other.locator('#f-criteria').fill('Comprobar las fechas de entrega.')
        other.locator('#f-priority').select_option('Alta')
        other.locator('#entry-submit').click()
        expect(other.locator('#edit-dialog')).to_be_hidden()
        other.reload()
        expect(other.locator('#recent-reviews')).to_contain_text('Revisión compartida')
        expect(other.locator('#recent-reviews')).to_contain_text('PM menor')
        expect(other.locator('#recent-reviews')).to_contain_text('Urgencia: Alta')
        reader = self.page(mobile=True); reader.goto(self.base+'/proyecto.html')
        expect(reader.locator('#recent-reviews')).to_contain_text('Comprobar las fechas de entrega.')
        expect(reader.get_by_role('button', name='+ Nueva solicitud', exact=True)).to_be_hidden()
        expect(reader.get_by_role('button', name='+ Nueva revisión', exact=True)).to_be_hidden()

    def test_request_creator_role_assignment_and_layout_survive_edit_and_reload(self):
        self.enable_roles(); self.backend.global_scope = True
        admin = self.page(); self.login(admin, path='proyecto.html')
        admin.get_by_role('button', name='+ Nueva solicitud', exact=True).click()
        expect(admin.locator('#entry-creator-role')).to_have_text('Admin global')
        admin.locator('#f-title').fill('Revisar las fechas de entrega')
        admin.locator('#f-detail').fill('Comprobar el calendario y corregir las fechas de todas las actividades.')
        admin.locator('#f-requestedBy').fill('Maxi')
        expect(admin.locator('#f-assigneeId')).to_be_enabled()
        admin.locator('#f-assigneeId').select_option('pm_junior@example.test')
        admin.locator('#entry-submit').click()
        expect(admin.locator('#edit-dialog')).to_be_hidden()
        self.assertEqual(self.backend.data[PROJECT]['requests'][0]['requestedRole'], 'admin')
        admin.reload()
        admin.locator('.side-link[data-page="solicitudes"]').click()
        row = admin.locator('#requests-list .record')
        expect(row.locator('.record-badges')).to_contain_text('Admin global')
        expect(row.locator('.record-badges')).to_contain_text('Pendiente')
        expect(row.locator('.record-assignee')).to_have_text('Responsable: pm_junior')
        expect(row.locator('.record-meta')).to_contain_text('Solicitante: Maxi')
        self.assertTrue(row.evaluate('(el)=>el.querySelector(".record-actions").getBoundingClientRect().top >= el.querySelector(".record-main").getBoundingClientRect().bottom'))
        editor = self.page(); self.login(editor, 'pm_junior@example.test', 'proyecto.html')
        editor.locator('.side-link[data-page="solicitudes"]').click()
        editor.locator('#requests-list [data-edit-kind]').click()
        expect(editor.locator('#entry-creator-role')).to_have_text('Admin global')
        expect(editor.locator('#f-assigneeId')).to_be_enabled()
        editor.locator('#f-assigneeId').select_option('qa@example.test')
        editor.locator('#f-assigneeId').evaluate("el=>el.selectedOptions[0].dataset.name='Nombre local incorrecto'")
        editor.locator('#entry-submit').click()
        expect(editor.locator('#edit-dialog')).to_be_hidden()
        editor.locator('#requests-list [data-edit-kind]').click()
        editor.locator('#f-detail').fill('Segunda edición consecutiva, sin conflicto.')
        editor.locator('#entry-submit').click()
        expect(editor.locator('#edit-dialog')).to_be_hidden()
        viewer = self.page(mobile=True); viewer.goto(self.base+'/proyecto.html')
        self.set_font_level(viewer,7); self.close_settings(viewer)
        if viewer.locator('#pf-menu-toggle').get_attribute('aria-expanded') == 'false': viewer.locator('#pf-menu-toggle').click()
        viewer.locator('.side-link[data-page="solicitudes"]').click()
        expect(viewer.locator('#requests-list .record-badges')).to_contain_text('Admin global')
        expect(viewer.locator('#requests-list .record-assignee')).to_have_text('Responsable: qa')
        self.assertTrue(viewer.evaluate('document.documentElement.scrollWidth <= innerWidth'))
        viewer.locator('#requests-list [data-view-kind]').click()
        expect(viewer.locator('#entry-creator-role')).to_have_text('Admin global')
        expect(viewer.locator('#f-assigneeId')).to_have_count(0)
        expect(viewer.locator('#entry-fields')).to_contain_text('Responsable de realizar la solicitud')

    def test_legacy_role_stays_unknown_and_assignment_load_failure_preserves_record(self):
        self.backend.data[PROJECT]={'schema':1,'project':{},'requests':[{'id':'old','title':'Antigua','detail':'Sin metadatos históricos','status':'Pendiente','assigneeId':'responsible@example.test','assigneeName':'responsible'}],'reviews':[],'agreements':[],'activity':[]}
        self.backend.fail_assignees = True
        page=self.page(); self.login(page,path='proyecto.html')
        page.locator('.side-link[data-page="solicitudes"]').click()
        page.locator('#requests-list [data-edit-kind]').click()
        expect(page.locator('#entry-creator-role')).to_have_text('Cargo no registrado')
        expect(page.locator('#assignee-retry')).to_be_visible()
        expect(page.locator('#f-assigneeId')).to_be_disabled()
        page.locator('#f-detail').fill('Conservar el autor desconocido y el responsable.')
        page.locator('#entry-submit').click()
        expect(page.locator('#edit-dialog')).to_be_hidden()
        self.assertNotIn('requestedRole',self.backend.data[PROJECT]['requests'][0])
        self.assertEqual(self.backend.data[PROJECT]['requests'][0]['assigneeName'],'responsible')
        page.locator('#requests-list [data-edit-kind]').click()
        expect(page.locator('#assignee-retry')).to_be_visible()
        self.backend.fail_assignees = False
        page.locator('#assignee-retry').click()
        expect(page.locator('#f-assigneeId')).to_be_enabled()
        expect(page.locator('#f-assigneeId')).to_have_value('responsible@example.test')

    def test_project_pdf_download_is_complete_paginated_and_readonly(self):
        project_id=str(uuid.uuid4())
        long_text=('Descripción extensa con acentos: información, revisión y planificación. ' * 180)+'FIN DEL TEXTO LARGO'
        self.backend.projects[project_id]={'roles':{},'data':{
            PROJECT:{'schema':1,'project':{'name':'Proyecto Ñandú','objective':'Objetivo único','notes':'Nota de ficha'},
                'requests':[{'id':'req-1','title':'Solicitud de revisión','detail':long_text,'requestedBy':'José','requestedRole':'admin','assigneeId':'leader@example.test','assigneeName':'Alias anterior','priority':'Alta','status':'Pendiente','dueDate':'2026-12-20'}],
                'reviews':[{'id':'rev-1','title':'Revisión técnica','requestId':'req-1','criteria':'Criterio único','feedback':'Resultado único','priority':'Alta'}],
                'agreements':[{'id':'agr-1','title':'Acuerdo único','description':'Decisión acordada','nextAction':'Próximo paso único'}],
                'activity':[{'id':'log-1','title':'Historial único','detail':'Detalle histórico','at':'2026-11-12T10:00:00Z'}]},
            TEAM:{'schedule':[{'id':'a1','title':'Actividad única','weekId':'w1','dueDate':'2026-12-20','done':True}],'1':'Asignación histórica'},
            PLAN:{'weeks':[{'id':'w1','title':'Semana única','objective':'Objetivo semanal','startDate':'2026-12-01','dueDate':'2026-12-20','done':False,'optional':False}]}}}
        self.backend.accounts['leader@example.test']['metadata']['display_name']='María'
        self.backend.data[PROJECT]={'schema':1,'project':{'name':'PROYECTO AJENO NO EXPORTAR'},'requests':[],'reviews':[],'agreements':[]}
        page=self.page(mobile=True);page.goto(self.base+'/proyecto.html?project='+project_id)
        expect(page.locator('#pf-role')).to_have_text('Solo lectura')
        with page.expect_download() as result: page.locator('#footer-backup').click()
        file=Path(result.value.path()); self.assertTrue(file.read_bytes().startswith(b'%PDF-'))
        self.assertTrue(result.value.suggested_filename.endswith('.pdf'))
        content=subprocess.check_output(['pdftotext','-layout',str(file),'-']).decode()
        for value in ['Proyecto Ñandú','Objetivo único','Actividad única','Semana única','Solicitud de revisión','FIN DEL TEXTO LARGO','Revisión técnica','Criterio único','Acuerdo único','Próximo paso único','Historial único','Asignación histórica','María','Admin global']:
            self.assertIn(value,content)
        self.assertNotIn('PROYECTO AJENO NO EXPORTAR',content)
        self.assertNotIn('Alias anterior',content)
        self.assertGreater(content.count('Página '),2)
        self.assertEqual(self.backend.saved,0)
        result.value.save_as('/tmp/projectflow-report-sample.pdf')

    def test_pdf_failure_can_retry_without_changing_project_data(self):
        page=self.page();self.login(page,path='proyecto.html')
        page.locator('.side-link[data-page="proyecto"]').click()
        page.route('**/NotoSans-Regular.ttf',lambda route:route.abort())
        page.locator('#backup-download').click()
        expect(page.locator('#toast')).to_contain_text('No se pudo generar')
        expect(page.locator('#backup-download')).to_be_enabled()
        page.unroute('**/NotoSans-Regular.ttf')
        with page.expect_download() as result:page.locator('#backup-download').click()
        self.assertTrue(result.value.suggested_filename.endswith('.pdf'))
        self.assertEqual(self.backend.saved,0)

    def test_backup_import_restores_numeric_team_keys_for_everyone(self):
        page = self.page()
        self.login(page, path='proyecto.html')
        page.locator('.side-link[data-page="proyecto"]').click()
        backup = {'schema': 1, 'project': {'name': 'Restaurado'}, 'requests': [], 'reviews': [],
                  'agreements': [], 'activity': [],
                  'workspaces': {'team': {'1': 'Nombre recuperado', 'person-2': 'Otro nombre',
                    'schedule': [{'id': '1', 'title': 'Actividad recuperada', 'dueDate': '2026-11-02', 'done': False}]}, 'milestones': {'1': True}}}
        page.once('dialog', lambda dialog: dialog.accept())
        page.locator('#backup-import').set_input_files({'name': 'backup.json', 'mimeType': 'application/json', 'buffer': json.dumps(backup).encode()})
        expect(page.locator('#toast')).to_have_text('Respaldo importado en el espacio compartido')
        self.assertEqual(self.backend.data[TEAM]['1'], 'Nombre recuperado')
        self.assertEqual(self.backend.data[TEAM]['2'], 'Otro nombre')
        self.assertEqual(self.backend.data[TEAM]['schedule'][0]['dueDate'], '2026-11-02')
        self.assertEqual(self.backend.data[PLAN], {'1': True})
        other = self.page()
        self.login(other, 'responsible@example.test')
        expect(other.locator('#previous-assignment-list')).to_contain_text('Nombre recuperado')
        expect(other.locator('#agenda-dueDate-1')).to_have_value('2026-11-02')
        page.locator('.side-link[data-page="proyecto"]').click()
        page.locator('details').filter(has=page.locator('#backup-json-download')).locator('summary').click()
        with page.expect_download() as result:
            page.locator('#backup-json-download').click()
        exported = json.loads(Path(result.value.path()).read_text())
        self.assertEqual(exported['workspaces']['team']['1'], 'Nombre recuperado')

    def test_old_browser_data_are_exported_only_on_request(self):
        page = self.page()
        page.context.add_init_script("localStorage.setItem('equipo14.personas', JSON.stringify({'1':'Nombre anterior'}));")
        self.login(page)
        expect(page.locator('#agenda-title-1')).to_have_value('Definir el objetivo')
        self.assertEqual(self.backend.data, {})
        with page.expect_download() as result:
            self.settings_click(page, '#pf-previous')
        exported = json.loads(Path(result.value.path()).read_text())
        self.assertEqual(exported['workspaces']['team'], {'1': 'Nombre anterior'})
        self.assertEqual(self.backend.data, {})

    def test_settings_sections_theme_system_and_profile_draft(self):
        page = self.page(mobile=True); self.login(page)
        self.open_settings(page)
        expect(page.locator('[data-settings-section]')).to_have_text(['Cuenta','Apariencia','Avisos','Seguridad','Datos'])
        page.locator('[data-settings-section=account]').click()
        page.locator('#pf-edit-alias').click()
        page.locator('#pf-display-name').fill('Nombre pendiente')
        expect(page.locator('#pf-email')).to_have_text('leader@example.test')
        page.locator('[data-settings-section=notices]').click()
        expect(page.locator('#pf-panel-notices')).to_contain_text('En preparación')
        expect(page.locator('#pf-panel-notices input')).to_have_count(0)
        page.locator('[data-settings-section=security]').click()
        expect(page.locator('#pf-set-password')).to_be_visible()
        expect(page.locator('#pf-share-project')).to_be_hidden()
        page.locator('[data-settings-section=account]').click()
        expect(page.locator('#pf-display-name')).to_have_value('Nombre pendiente')
        page.locator('[data-settings-section=appearance]').click()
        page.emulate_media(color_scheme='dark')
        page.locator('[data-theme=system]').click()
        expect(page.locator('html')).to_have_attribute('data-theme','dark')
        page.emulate_media(color_scheme='light')
        expect(page.locator('html')).to_have_attribute('data-theme','light')
        page.locator('[data-theme=dark]').click()
        page.reload()
        expect(page.locator('[data-theme=dark] button[data-theme=dark]')).to_have_attribute('aria-pressed','true')
        expect(page.locator('#pf-panel-appearance')).to_be_visible()
        self.assertEqual(page.locator('#pf-settings button[data-theme=light]').evaluate('(el) => getComputedStyle(el).backgroundColor'),'rgb(44, 44, 44)')
        self.set_font_level(page,7)
        for section in ['account','appearance','notices','security','data']:
            page.locator('[data-settings-section='+section+']').click()
            self.assertLessEqual(page.evaluate('document.documentElement.scrollWidth'),390)
        self.close_settings(page)
        for path in ['cronograma.html','proyecto.html']:
            page.goto(self.base+'/'+path)
            expect(page.locator('html')).to_have_attribute('data-theme','dark')
            expect(page.locator('#pf-role')).to_have_text('Edición autorizada')
        self.assertEqual(self.backend.saved,0)

    def test_password_recovery_email_callback_and_new_password(self):
        page=self.page(); page.goto(self.base+'/index.html')
        self.settings_click(page,'#pf-open-login')
        page.locator('#pf-email-input').fill('leader@example.test')
        self.backend.fail_email=True
        page.locator('#pf-forgot-password').click()
        expect(page.locator('#pf-message')).to_contain_text('No se pudo enviar')
        self.backend.fail_email=False
        page.locator('#pf-forgot-password').click()
        expect(page.locator('#pf-message')).to_contain_text('Si existe una cuenta')
        email=self.backend.emails[-1]
        self.assertTrue(email['recovery'])
        recipient=self.page(mobile=True)
        recipient.goto(email['redirect']+'#access_token='+self.backend.jwt('leader@example.test')+'&refresh_token=test-refresh&expires_in=3600&token_type=bearer&type=recovery')
        expect(recipient.locator('#pf-password-dialog')).to_be_visible()
        recipient.locator('#pf-new-password').fill('NuevaClave123')
        recipient.locator('#pf-confirm-password').fill('OtraClave123')
        recipient.locator('#pf-password-form button[type=submit]').click()
        expect(recipient.locator('#pf-password-error')).to_contain_text('no coinciden')
        recipient.locator('#pf-confirm-password').fill('NuevaClave123')
        recipient.locator('#pf-password-form button[type=submit]').click()
        expect(recipient.locator('#pf-password-dialog')).to_be_hidden()
        expect(recipient.locator('#pf-password-feedback')).to_contain_text('Contraseña guardada')
        other=self.page(); self.login(other,password='NuevaClave123')
        self.assertEqual(self.backend.roles['leader@example.test'],'leader')
        self.assertEqual(self.backend.password_updates,['leader@example.test'])
        expired=self.page(); expired.goto(self.base+'/index.html#error=access_denied&error_code=otp_expired')
        expect(expired.locator('#pf-message')).to_contain_text('caducó')
        expect(expired.locator('#pf-password-dialog')).to_have_count(0)
        self.assertNotIn('access_token',recipient.url)

    def test_mobile_login_navigation_and_logout(self):
        page = self.page(mobile=True)
        self.login(page)
        expect(page.locator('.sidebar')).to_be_hidden()
        page.get_by_role('button', name='Abrir menú').click()
        page.locator('nav a[href*="proyecto.html"]').click()
        page.get_by_role('button', name='Abrir menú').click()
        page.locator('.side-link[data-page="proyecto"]').click()
        expect(page.locator('#pf-menu-dialog')).not_to_be_visible()
        expect(page.locator('#project-form')).to_be_visible()
        self.assertLessEqual(page.evaluate('document.documentElement.scrollWidth'), 390)
        self.settings_click(page, '#pf-logout')
        expect(page.locator('#pf-role')).to_have_text('Solo lectura')
        self.close_settings(page)
        expect(page.locator('.layout')).to_be_visible()
        page.goto(self.base + '/index.html')
        expect(page.locator('#agenda-dueDate-1')).to_have_attribute('readonly', '')
        self.assertLessEqual(page.evaluate('document.documentElement.scrollWidth'), 390)
        page.screenshot(path='/tmp/projectflow-mobile-agenda.png', full_page=True)

    def test_collapsible_menu_keyboard_and_reading_preferences(self):
        page = self.page()
        page.goto(self.base + '/index.html')
        expect(page.locator('#pf-role')).to_have_text('Solo lectura')
        initial_width = page.locator('#pf-main').bounding_box()['width']
        page.get_by_role('button', name='Cerrar menú').click()
        expect(page.locator('.sidebar')).to_be_hidden()
        self.assertGreater(page.locator('#pf-main').bounding_box()['width'], initial_width)
        self.set_font_level(page, 5)
        self.close_settings(page)
        page.locator('#pf-menu-toggle').click()
        page.reload()
        expect(page.locator('#pf-role')).to_have_text('Solo lectura')
        expect(page.locator('.sidebar')).to_be_hidden()
        expect(page.locator('#pf-text-size')).to_have_value('5')
        self.assertEqual(page.locator('#agenda-title-1').evaluate('(el) => getComputedStyle(el).fontSize'), '20px')
        page.get_by_role('button', name='Abrir menú').click()
        page.locator('nav a[href*="cronograma.html"]').click()
        expect(page.locator('#week-title-input')).to_be_visible()
        expect(page.locator('#pf-text-size')).to_have_value('5')
        page.set_viewport_size({'width': 768, 'height': 800})
        page.get_by_role('button', name='Abrir menú').click()
        expect(page.locator('#pf-menu-close')).to_be_focused()
        page.keyboard.press('Shift+Tab')
        expect(page.locator('#pf-open-settings')).to_be_focused()
        page.keyboard.press('Escape')
        expect(page.locator('#pf-menu-toggle')).to_be_focused()
        expect(page.locator('#pf-menu-toggle')).to_have_attribute('aria-expanded', 'false')
        page.get_by_role('button', name='Abrir menú').click()
        page.mouse.click(760, 200)
        expect(page.locator('#pf-menu-dialog')).not_to_be_visible()
        page.get_by_role('button', name='Abrir menú').click()
        page.set_viewport_size({'width': 1440, 'height': 900})
        expect(page.locator('#pf-menu-dialog')).not_to_be_visible()
        expect(page.locator('.sidebar')).to_be_visible()
        self.settings_click(page, '#pf-font-reset')
        self.close_settings(page)
        self.assertEqual(page.locator('#week-title-input').evaluate('(el) => getComputedStyle(el).fontSize'), '16px')
        self.assertEqual(self.backend.saved, 0)

    def test_settings_account_appearance_sharing_and_project_dialogs(self):
        page = self.page(mobile=True)
        self.login(page)
        project = self.create_project(page, 'Desde los ajustes', 2, '2026-11-14')
        expect(page.locator('#pf-current-project')).to_have_text('Desde los ajustes')
        expect(page.locator('#pf-status')).to_be_visible()
        for selector in ('#pf-open-login', '#pf-logout', '#pf-text-size', '#pf-share-project'):
            expect(page.locator(selector)).to_be_hidden()
        self.set_font_level(page, 5)
        expect(page.locator('.layout')).to_be_hidden()
        page.context.grant_permissions(['clipboard-read', 'clipboard-write'])
        self.settings_click(page, '#pf-share-project')
        expect(page.locator('#pf-project-message')).to_contain_text('Enlace copiado')
        shared = page.evaluate('navigator.clipboard.readText()')
        self.assertEqual(parse_qs(urlparse(shared).query)['project'], [project])
        self.assertEqual(urlparse(shared).fragment, '')
        page.evaluate("() => { navigator.clipboard.writeText = async () => { throw new Error('Clipboard denied'); }; }")
        page.locator('#pf-share-project').click()
        expect(page.locator('#pf-project-message')).to_contain_text(shared)
        self.assertLessEqual(page.evaluate('document.documentElement.scrollWidth'), 390)
        self.settings_click(page, '#pf-project-access')
        expect(page.locator('#pf-add-editor input')).to_be_focused()
        page.locator('#pf-access-close').click()
        expect(page.locator('#pf-project-access')).to_be_focused()
        self.settings_click(page, '#pf-new-project')
        page.keyboard.press('Escape')
        expect(page.locator('#pf-new-project')).to_be_focused()
        reader = self.page(mobile=True)
        reader.goto(shared)
        self.open_settings(reader)
        reader.locator('[data-settings-section=data]').click()
        expect(reader.locator('#pf-share-project')).to_be_visible()
        expect(reader.locator('#pf-new-project')).to_be_hidden()
        expect(reader.locator('#pf-project-access')).to_be_hidden()
        self.settings_click(reader, '#pf-open-login')
        expect(reader.locator('#pf-settings')).to_be_hidden()
        expect(reader.locator('#pf-email-input')).to_be_focused()
        reader.locator('#pf-cancel-login').click()
        expect(reader.locator('#pf-settings')).to_be_visible()
        expect(reader.locator('#pf-current-project')).to_have_text('Desde los ajustes')
        expect(reader.locator('#pf-status')).to_be_visible()
        self.assertEqual(self.backend.saved, 0)

    def test_readable_layout_on_small_mobile_tablet_desktop_and_large_text(self):
        page = self.page()
        self.login(page)
        for width in (320, 390, 768, 1024, 1440):
            page.set_viewport_size({'width': width, 'height': 900})
            for level in (3, 7):
                for name in ('index.html', 'cronograma.html', 'proyecto.html'):
                    with self.subTest(width=width, level=level, page=name):
                        page.goto(self.base + '/' + name)
                        expect(page.locator('#pf-role')).to_have_text('Edición autorizada')
                        self.set_font_level(page, level)
                        self.assertLessEqual(page.evaluate('document.documentElement.scrollWidth'), width)
                        self.close_settings(page)
                        self.assertLessEqual(page.evaluate('document.documentElement.scrollWidth'), width)
                        # Common reading text and form fields must never shrink below 16px.
                        small = page.locator('main p, main label, main input, main button, #pf-session, #pf-projects').evaluate_all('''nodes => nodes.filter(el => el.getClientRects().length && parseFloat(getComputedStyle(el).fontSize) < 16).map(el => el.outerHTML)''')
                        self.assertEqual(small, [])
                        if name == 'index.html':
                            overflow = page.locator('.agenda-row > *').evaluate_all('''nodes => nodes.filter(el => el.getClientRects().length && el.getBoundingClientRect().right > el.parentElement.getBoundingClientRect().right + 1).map(el => el.outerHTML)''')
                            self.assertEqual(overflow, [])
                            self.settings_click(page, '#pf-new-project')
                            expect(page.locator('#pf-project-dialog')).to_be_visible()
                            self.assertTrue(page.locator('#pf-project-dialog').evaluate('(el) => el.scrollWidth <= el.clientWidth'))
                            page.keyboard.press('Escape')
        # Text-only zoom must also reflow; 200% must not clip the content.
        page.set_viewport_size({'width': 390, 'height': 844})
        for name in ('index.html', 'cronograma.html', 'proyecto.html'):
            page.goto(self.base + '/' + name)
            expect(page.locator('#pf-role')).to_have_text('Edición autorizada')
            page.add_style_tag(content='html { font-size: 200% !important; }')
            self.assertLessEqual(page.evaluate('document.documentElement.scrollWidth'), 390)

    def test_seven_font_levels_preview_persistence_and_legacy_preference(self):
        page = self.page(mobile=True)
        page.add_init_script("if (!localStorage.getItem('projectflow.ui.largeText')) localStorage.setItem('projectflow.ui.largeText', 'true')")
        page.goto(self.base + '/index.html')
        expect(page.locator('#pf-role')).to_have_text('Solo lectura')
        expect(page.locator('#pf-text-size')).to_have_value('5')
        for level, pixels in enumerate((14, 15, 16, 18, 20, 22, 24), 1):
            with self.subTest(level=level):
                self.set_font_level(page, level)
                expect(page.locator('#pf-text-description')).to_contain_text(f'Nivel {level} de 7')
                self.assertEqual(page.locator('#pf-font-help').evaluate('(el) => getComputedStyle(el).fontSize'), f'{pixels}px')
                self.assertLessEqual(page.evaluate('document.documentElement.scrollWidth'), 390)
                page.reload()
                expect(page.locator('#pf-settings')).to_be_visible()
                expect(page.locator('#pf-text-size')).to_have_value(str(level))
                self.close_settings(page)
                expect(page.locator('#agenda-title-1')).to_be_visible()
                self.assertEqual(page.locator('#agenda-title-1').evaluate('(el) => getComputedStyle(el).fontSize'), f'{pixels}px')
        self.settings_click(page, '#pf-font-reset')
        page.reload()
        expect(page.locator('#pf-text-size')).to_have_value('3')
        self.assertEqual(page.evaluate('localStorage.getItem("projectflow.ui.fontLevel")'), '3')
        self.assertEqual(self.backend.saved, 0)

    def test_settings_history_preserves_unsaved_project_form(self):
        page = self.page(mobile=True)
        self.login(page, path='proyecto.html')
        page.locator('#pf-menu-toggle').click()
        page.locator('.side-link[data-page="proyecto"]').click()
        page.locator('#project-name').fill('Borrador que todavía no guardo')
        self.set_font_level(page, 7)
        expect(page.locator('.layout')).to_be_hidden()
        self.assertEqual(urlparse(page.url).fragment, 'ajustes')
        page.go_back()
        expect(page.locator('#project-name')).to_be_visible()
        expect(page.locator('#project-name')).to_have_value('Borrador que todavía no guardo')
        page.go_forward()
        expect(page.locator('#pf-settings')).to_be_visible()
        page.locator('.pf-skip').focus()
        page.keyboard.press('Enter')
        expect(page.locator('#pf-settings')).to_be_focused()
        self.assertEqual(urlparse(page.url).fragment, 'ajustes')
        self.close_settings(page)
        expect(page.locator('#project-name')).to_have_value('Borrador que todavía no guardo')
        self.assertEqual(self.backend.saved, 0)

    def test_settings_direct_link_and_unavailable_preference_storage(self):
        page = self.page(mobile=True)
        page.add_init_script('''
          for (const method of ['getItem', 'setItem']) {
            const original = Storage.prototype[method];
            Storage.prototype[method] = function(key, ...args) {
              if (key.startsWith('projectflow.ui.')) throw new Error('Storage unavailable');
              return original.call(this, key, ...args);
            };
          }
        ''')
        page.goto(self.base + '/cronograma.html#ajustes')
        expect(page.locator('#pf-settings')).to_be_visible()
        self.set_font_level(page, 7)
        self.close_settings(page)
        expect(page.locator('#week-title-input')).to_be_visible()
        self.assertEqual(urlparse(page.url).path, '/cronograma.html')
        self.assertEqual(page.locator('#week-title-input').evaluate('(el) => getComputedStyle(el).fontSize'), '24px')
        self.assertEqual(self.backend.saved, 0)

    def test_revoked_membership_locks_the_page_on_next_save(self):
        page = self.page()
        self.login(page)
        del self.backend.roles['leader@example.test']
        page.locator('#agenda-title-1').fill('No debe guardarse')
        expect(page.locator('#pf-gate')).to_be_visible()
        expect(page.locator('.layout')).to_be_hidden()
        self.assertEqual(self.backend.data, {})
        page.locator('#pf-retry').click()
        expect(page.locator('#pf-role')).to_have_text('Solo lectura')
        self.close_settings(page)
        expect(page.locator('.layout')).to_be_visible()

    def test_public_reader_sees_saved_dates_and_automatic_updates(self):
        editor = self.page()
        self.login(editor)
        editor.locator('#agenda-dueDate-1').fill('2026-11-01')
        self.wait_saved(editor)
        reader = self.page()
        reader.clock.install()
        reader.goto(self.base + '/index.html')
        expect(reader.locator('#agenda-dueDate-1')).to_have_value('2026-11-01')
        expect(reader.locator('#agenda-dueDate-1')).to_have_attribute('readonly', '')
        expect(reader.locator('#agenda-done-1')).to_be_disabled()
        editor.locator('#agenda-title-1').fill('Nuevo objetivo personal')
        editor.locator('#agenda-done-1').check()
        self.wait_saved(editor)
        reader.clock.fast_forward(31000)
        expect(reader.locator('#agenda-title-1')).to_have_value('Nuevo objetivo personal')
        expect(reader.locator('#agenda-done-1')).to_be_checked()
        expect(reader.locator('#agenda-done')).to_have_text('1')

    def test_readers_can_filter_and_view_full_records_without_saving(self):
        self.backend.data[PROJECT] = {'schema': 1, 'project': {'name': 'Mi espacio'},
          'requests': [{'id': 'task1', 'title': 'Una tarea', 'detail': 'Detalle completo ' * 50,
                        'status': 'Pendiente', 'link': 'https://example.com/nota'}],
          'reviews': [], 'agreements': [], 'activity': []}
        page = self.page()
        page.goto(self.base + '/proyecto.html')
        page.locator('.side-link[data-page="solicitudes"]').click()
        page.locator('#req-search').fill('no coincide')
        expect(page.locator('#req-count')).to_have_text('0 resultados')
        page.locator('#req-search').fill('Una tarea')
        expect(page.locator('#req-count')).to_have_text('1 resultado')
        expect(page.locator('[data-edit-kind]')).to_have_count(0)
        page.locator('[data-view-kind="requests"]').click()
        expect(page.locator('#f-detail')).to_have_value('Detalle completo ' * 50)
        expect(page.locator('#f-detail')).to_have_attribute('readonly', '')
        expect(page.locator('#f-link')).to_have_value('https://example.com/nota')
        expect(page.locator('#f-status')).to_be_disabled()
        expect(page.locator('#delete-entry')).to_be_hidden()
        expect(page.locator('#entry-form button[type="submit"]')).to_be_hidden()
        page.locator('#entry-form').dispatch_event('submit')
        self.assertEqual(self.backend.saved, 0)
        page.locator('#entry-form [data-close]').click()
        expect(page.locator('#edit-dialog')).to_be_hidden()

    def test_agenda_add_remove_and_export_preserve_legacy_data(self):
        self.backend.data[TEAM] = {'1': 'Nombre anterior'}
        page = self.page()
        self.login(page)
        page.locator('#agenda-add').click()
        title = page.locator('.agenda-title input').last
        title.fill('Nueva actividad personal')
        page.locator('.agenda-row input[type="date"]').last.fill('2026-11-03')
        self.wait_saved(page)
        self.assertEqual(self.backend.data[TEAM]['1'], 'Nombre anterior')
        self.assertEqual(self.backend.data[TEAM]['schedule'][-1]['dueDate'], '2026-11-03')
        with page.expect_download() as result:
            page.locator('#export-csv').click()
        self.assertIn('Nueva actividad personal', Path(result.value.path()).read_text())
        page.once('dialog', lambda dialog: dialog.accept())
        page.locator('.agenda-row button').last.click()
        self.wait_saved(page)
        self.assertEqual(len(self.backend.data[TEAM]['schedule']), 6)

    def test_private_database_explains_pending_update_and_still_allows_editors(self):
        self.backend.public = False
        self.backend.multi = False
        page = self.page()
        page.goto(self.base + '/index.html')
        expect(page.locator('#pf-message')).to_contain_text('todavía no está disponible')
        expect(page.locator('.layout')).to_be_hidden()
        self.login(page)
        page.locator('#agenda-dueDate-1').fill('2026-11-01')
        self.wait_saved(page)

    def test_public_login_can_be_cancelled_without_losing_read_access(self):
        page = self.page()
        page.goto(self.base + '/index.html')
        self.settings_click(page, '#pf-open-login')
        page.locator('#pf-password').fill('not-submitted')
        page.locator('#pf-cancel-login').click()
        expect(page.locator('#pf-settings')).to_be_visible()
        self.close_settings(page)
        expect(page.locator('.layout')).to_be_visible()
        expect(page.locator('#pf-role')).to_have_text('Solo lectura')
        expect(page.locator('#pf-password')).to_have_value('')

    def create_project(self, page, name, count, due):
        self.settings_click(page, '#pf-new-project')
        page.locator('#pf-project-create [name="name"]').fill(name)
        page.locator('#pf-project-create [name="start"]').fill('2026-11-01')
        page.locator('#pf-project-create [name="due"]').fill(due)
        page.locator('#pf-project-create [name="weeks"]').fill(str(count))
        page.locator('#pf-project-create button[type="submit"]').click()
        expect(page.locator('#pf-project-select option:checked')).to_have_text(name)
        return parse_qs(urlparse(page.url).query)['project'][0]

    def test_multiple_projects_keep_dates_tasks_and_navigation_separate(self):
        page = self.page()
        self.login(page)
        first = self.create_project(page, 'Corto', 2, '2026-11-14')
        page.locator('#agenda-add').click()
        page.locator('.agenda-title input').fill('Entrega corta')
        page.locator('.agenda-row input[type="date"]').fill('2026-11-10')
        page.locator('.agenda-row select').select_option(index=1)
        self.wait_saved(page)
        page.locator('nav a[href*="cronograma.html"]').click()
        expect(page.locator('#plan-weeks button')).to_have_count(2)
        expect(page.locator('#week-tasks')).to_contain_text('Entrega corta')
        self.assertIn(first, page.url)
        second = self.create_project(page, 'Largo', 10, '2027-01-15')
        expect(page.locator('#agenda-list .agenda-row')).to_have_count(0)
        page.locator('nav a[href*="cronograma.html"]').click()
        expect(page.locator('#plan-weeks button')).to_have_count(10)
        page.locator('nav a[href*="proyecto.html"]').click()
        page.locator('.side-link[data-page="proyecto"]').click()
        expect(page.locator('#project-delivery')).to_have_value('2027-01-15')
        self.open_settings(page)
        page.locator('[data-settings-section=data]').click()
        page.locator('#pf-switch-project').click()
        page.locator('#pf-project-select').select_option(first)
        expect(page.locator('.agenda-title input')).to_have_value('Entrega corta')
        expect(page.locator('.agenda-row input[type="date"]')).to_have_value('2026-11-10')
        self.assertEqual(len(self.backend.projects[second]['data'][TEAM]['schedule']), 0)
        page.context.grant_permissions(['clipboard-read','clipboard-write'])
        self.settings_click(page, '#pf-share-project')
        expect(page.locator('#pf-project-message')).to_contain_text('Enlace copiado')
        shared = page.evaluate('navigator.clipboard.readText()')
        reader = self.page(); reader.goto(shared)
        expect(reader.locator('.agenda-title input')).to_have_value('Entrega corta')
        expect(reader.locator('#pf-project-select')).to_be_hidden()
        expect(reader.locator('#pf-new-project')).to_be_hidden()
        expect(reader.locator('#pf-role')).to_have_text('Solo lectura')

    def test_editor_grants_are_limited_to_one_project_and_can_be_revoked(self):
        owner = self.page(); self.login(owner)
        first = self.create_project(owner, 'Compartido', 3, '2026-11-21')
        self.settings_click(owner, '#pf-project-access')
        owner.locator('#pf-add-editor [name="email"]').fill('responsible@example.test')
        owner.locator('#pf-add-editor button[type="submit"]').click()
        expect(owner.locator('#pf-access-message')).to_contain_text('solo este proyecto')
        self.assertNotIn('responsible@example.test', self.backend.projects[first]['roles'])
        recipient = self.page()
        self.open_invitation(recipient, 'responsible@example.test')
        expect(recipient.locator('#inv-new-password')).to_be_visible()
        recipient.locator('[name="password-mode"][value="existing"]').check()
        recipient.locator('#inv-current-password').fill('test-password-only')
        expect(recipient.locator('#inv-password-kept')).to_be_visible()
        expect(recipient.locator('#inv-new-password')).to_be_hidden()
        self.accept_invitation(recipient)
        expect(recipient.locator('#pf-role')).to_have_text('Edición autorizada')
        owner.locator('#pf-access-close').click()
        second = self.create_project(owner, 'Otro', 7, '2026-12-20')
        editor = self.page(); self.login(editor, 'responsible@example.test', 'index.html?project='+first)
        expect(editor.locator('#pf-role')).to_have_text('Edición autorizada')
        expect(editor.locator('#pf-project-access')).to_be_hidden()
        editor.goto(self.base+'/index.html?project='+second)
        expect(editor.locator('#pf-role')).to_have_text('Solo lectura')
        expect(editor.locator('#agenda-add')).to_be_hidden()
        self.open_settings(owner)
        owner.locator('[data-settings-section=data]').click()
        owner.locator('#pf-switch-project').click()
        owner.locator('#pf-project-select').select_option(first)
        self.settings_click(owner, '#pf-project-access')
        owner.locator('#pf-editor-list button').click()
        expect(owner.locator('#pf-access-message')).to_contain_text('retirado')
        editor.goto(self.base+'/index.html?project='+first)
        expect(editor.locator('#pf-role')).to_have_text('Solo lectura')

    def test_new_recipient_sets_private_password_on_mobile_without_changing_owner_session(self):
        owner = self.page(); self.login(owner)
        project = self.create_project(owner, 'Proyecto invitado', 2, '2026-12-01')
        self.invite(owner, 'new@example.test')
        self.assertNotIn('new@example.test', self.backend.projects[project]['roles'])
        owner.locator('#pf-access-close').click()
        owner.reload()
        expect(owner.locator('#pf-role')).to_have_text('Edición autorizada')
        self.settings_click(owner, '#pf-project-access')
        expect(owner.locator('#pf-editor-list')).to_contain_text('leader@example.test · Propietario')
        recipient = self.page(mobile=True)
        recipient.add_init_script("localStorage.setItem('projectflow.ui.fontLevel', '7')")
        self.open_invitation(recipient, 'new@example.test')
        expect(recipient.locator('#inv-new-password')).to_be_visible()
        self.assertEqual(recipient.evaluate('getComputedStyle(document.documentElement).fontSize'), '24px')
        self.assertTrue(recipient.evaluate('document.documentElement.scrollWidth <= innerWidth'))
        recipient.locator('#inv-password').fill('my-private-password')
        recipient.locator('#inv-confirm').fill('different-password')
        self.accept_invitation(recipient)
        expect(recipient.locator('#inv-message')).to_contain_text('no coinciden')
        self.assertTrue(self.backend.accounts['new@example.test']['has_password'])
        self.assertEqual(self.backend.password_updates, [])
        recipient.locator('#inv-confirm').fill('my-private-password')
        self.accept_invitation(recipient)
        expect(recipient.locator('#pf-role')).to_have_text('Edición autorizada')
        self.assertEqual(parse_qs(urlparse(recipient.url).query)['project'], [project])
        self.assertNotIn('new@example.test', self.backend.roles)
        self.assertTrue(self.backend.accounts['new@example.test']['has_password'])

    def test_invitation_does_not_accept_when_password_update_or_existing_password_fails(self):
        self.enable_roles()
        owner = self.page(); self.login(owner)
        self.invite(owner, 'new@example.test')
        recipient = self.page(); self.open_invitation(recipient, 'new@example.test')
        expect(recipient.locator('#inv-new-password')).to_be_visible()
        recipient.locator('[name="password-mode"][value="existing"]').check()
        recipient.locator('#inv-current-password').fill('incorrect-password')
        self.accept_invitation(recipient)
        expect(recipient.locator('#inv-message')).to_contain_text('no es correcta')
        self.assertNotIn('new@example.test', self.backend.roles)
        recipient.locator('[name="password-mode"][value="new"]').check()
        recipient.locator('#inv-password').fill('Abc123')
        recipient.locator('#inv-confirm').fill('Abc123')
        self.backend.fail_password_update = True
        self.accept_invitation(recipient)
        expect(recipient.locator('#inv-message')).to_contain_text('No se pudo guardar')
        self.assertNotIn('new@example.test', self.backend.roles)
        self.assertEqual(self.backend.password_updates, [])
        self.backend.fail_password_update = False
        self.accept_invitation(recipient)
        expect(recipient.locator('#pf-role')).to_have_text('Consultor / QA')
        self.assertEqual(self.backend.password_updates, ['new@example.test'])
        returning = self.page()
        self.login(returning, 'new@example.test', password='Abc123')
        expect(returning.locator('#pf-role')).to_have_text('Consultor / QA')

    def test_existing_recipient_confirms_password_without_replacing_it(self):
        self.enable_roles()
        owner = self.page(); self.login(owner)
        self.invite(owner, 'outsider@example.test')
        recipient = self.page(); self.open_invitation(recipient, 'outsider@example.test')
        recipient.locator('[name="password-mode"][value="existing"]').check()
        recipient.locator('#inv-current-password').fill('test-password-only')
        self.accept_invitation(recipient)
        expect(recipient.locator('#pf-role')).to_have_text('Consultor / QA')
        self.assertEqual(self.backend.password_updates, [])
        returning = self.page(); self.login(returning, 'outsider@example.test')
        expect(returning.locator('#pf-role')).to_have_text('Consultor / QA')

    def test_already_accepted_user_can_define_password_in_settings_and_sign_in_again(self):
        self.enable_roles()
        self.backend.accounts['qa@example.test']['password'] = 'unknown-temporary-password'
        page = self.page(mobile=True)
        # Simulate a recipient who accepted with the old flow and still has a session.
        owner = self.page(); self.login(owner)
        email = self.invite(owner, 'outsider@example.test')
        self.open_invitation(page, 'qa@example.test', email)
        page.goto(self.base + '/index.html')
        expect(page.locator('#pf-role')).to_have_text('Consultor / QA')
        self.set_font_level(page, 7)
        self.settings_click(page, '#pf-set-password')
        page.locator('#pf-new-password').fill('Xyz789')
        page.locator('#pf-confirm-password').fill('not-the-same-password')
        page.locator('#pf-password-form button[type="submit"]').click()
        expect(page.locator('#pf-password-error')).to_contain_text('no coinciden')
        self.assertEqual(self.backend.password_updates, [])
        page.locator('#pf-confirm-password').fill('Xyz789')
        self.backend.fail_password_update = True
        page.locator('#pf-password-form button[type="submit"]').click()
        expect(page.locator('#pf-password-error')).to_contain_text('No se pudo guardar')
        self.assertTrue(page.locator('#pf-password-dialog').evaluate('(el) => el.scrollWidth <= el.clientWidth'))
        self.backend.fail_password_update = False
        page.locator('#pf-password-form button[type="submit"]').click()
        expect(page.locator('#pf-password-dialog')).to_be_hidden()
        expect(page.locator('#pf-new-password')).to_have_value('')
        expect(page.locator('#pf-password-feedback')).to_contain_text('Contraseña guardada')
        self.assertEqual(self.backend.password_updates, ['qa@example.test'])
        self.assertEqual(self.backend.roles['qa@example.test'], 'qa')
        self.assertNotIn('password', self.backend.accounts['leader@example.test'])
        self.settings_click(page, '#pf-logout')
        expect(page.locator('#pf-role')).to_have_text('Usuario · Solo lectura')
        expect(page.locator('#pf-set-password')).to_be_hidden()
        self.login(page, 'qa@example.test', password='Xyz789')
        expect(page.locator('#pf-role')).to_have_text('Consultor / QA')

    def test_existing_recipient_can_reenter_by_email_and_set_password_without_role_changes(self):
        self.enable_roles()
        page = self.page()
        page.goto(self.base + '/index.html')
        self.settings_click(page, '#pf-open-login')
        page.locator('#pf-email-input').fill('qa@example.test')
        page.locator('#pf-login-link').click()
        expect(page.locator('#pf-message')).to_contain_text('Revisa tu correo')
        self.assertFalse(self.backend.emails[-1]['create_user'])
        self.assertEqual(self.backend.roles['qa@example.test'], 'qa')
        self.assertEqual(self.backend.invitations, {})
        self.open_invitation(page, 'qa@example.test')
        expect(page.locator('#pf-role')).to_have_text('Consultor / QA')
        self.settings_click(page, '#pf-set-password')
        page.locator('#pf-new-password').fill('password-after-email-link')
        page.locator('#pf-confirm-password').fill('password-after-email-link')
        page.locator('#pf-password-form button[type="submit"]').click()
        expect(page.locator('#pf-password-feedback')).to_contain_text('Contraseña guardada')
        self.assertEqual(self.backend.roles['qa@example.test'], 'qa')
        another_device = self.page()
        self.login(another_device, 'qa@example.test', password='password-after-email-link')

    def test_email_failure_is_pending_and_can_be_resent_or_cancelled(self):
        owner = self.page(mobile=True); self.login(owner)
        self.backend.fail_email = True
        self.settings_click(owner, '#pf-project-access')
        owner.locator('#pf-add-editor [name="email"]').fill('new@example.test')
        owner.locator('#pf-add-editor button[type="submit"]').click()
        expect(owner.locator('#pf-access-message')).to_contain_text('no se pudo enviar')
        expect(owner.locator('#pf-invitation-list')).to_contain_text('Pendiente de aceptación')
        self.assertEqual(self.backend.emails, [])
        self.assertNotIn('new@example.test', self.backend.roles)
        old_id = next(iter(self.backend.invitations))
        self.backend.fail_email = False
        owner.get_by_role('button', name='Reenviar', exact=True).click()
        expect(owner.locator('#pf-access-message')).to_contain_text('Invitación enviada')
        self.assertNotIn(old_id, self.backend.invitations)
        self.assertTrue(owner.locator('#pf-access-dialog').evaluate('(el) => el.scrollWidth <= el.clientWidth'))
        owner.get_by_role('button', name='Cancelar invitación', exact=True).click()
        expect(owner.locator('#pf-access-message')).to_contain_text('cancelada')
        expect(owner.locator('#pf-invitation-list')).to_contain_text('No hay invitaciones')
        recipient = self.page(); self.open_invitation(recipient, 'new@example.test')
        expect(recipient.locator('#inv-message')).to_contain_text('cancelada')
        expect(recipient.locator('#inv-accept')).to_be_hidden()

    def test_invitation_rejects_wrong_account_and_handles_invalid_or_used_link(self):
        owner = self.page(); self.login(owner)
        email = self.invite(owner, 'responsible@example.test')
        recipient = self.page(); self.open_invitation(recipient, 'outsider@example.test')
        expect(recipient.locator('#inv-message')).to_contain_text('no corresponde')
        expect(recipient.locator('#inv-accept')).to_be_hidden()
        recipient.locator('#inv-switch').click()
        expect(recipient.locator('#inv-login')).to_be_visible()
        recipient.locator('#inv-login [name="email"]').fill('responsible@example.test')
        recipient.locator('#inv-login [name="password"]').fill('test-password-only')
        recipient.locator('#inv-login button').click()
        expect(recipient.locator('#inv-accept')).to_be_visible()
        self.accept_invitation(recipient)
        expect(recipient.locator('#pf-role')).to_have_text('Edición autorizada')
        reader = self.page()
        reader.goto(email['redirect'] + '#error=access_denied&error_code=otp_expired')
        expect(reader.locator('#inv-message')).to_contain_text('venció o ya se usó')
        expect(reader.locator('#inv-login')).to_be_visible()
        reader.goto(self.base + '/invitacion.html?invitation=invalid')
        expect(reader.locator('#inv-message')).to_contain_text('no es válido')
        expect(reader.locator('#inv-accept')).to_be_hidden()

    def test_missing_invitation_migration_preserves_editor_removal(self):
        self.backend.invitations_available = False
        owner = self.page(); self.login(owner)
        self.settings_click(owner, '#pf-project-access')
        expect(owner.locator('#pf-access-message')).to_contain_text('aún no están activadas')
        expect(owner.locator('#pf-add-editor button')).to_be_disabled()
        owner.get_by_role('button', name='Quitar permiso', exact=True).click()
        expect(owner.locator('#pf-access-message')).to_contain_text('retirado')
        self.assertNotIn('responsible@example.test', self.backend.roles)
        self.assertEqual(self.backend.emails, [])

    def test_reader_cannot_prepare_an_invitation_or_trigger_email_from_app(self):
        reader = self.page(); reader.goto(self.base + '/index.html')
        expect(reader.locator('#pf-role')).to_have_text('Solo lectura')
        error = reader.evaluate("ProjectFlow.inviteEditor('someone@example.test').catch(e => e.message)")
        self.assertIn('propietario', error)
        self.assertEqual(self.backend.emails, [])

    def enable_roles(self):
        self.backend.role_features = True
        for role in ('qa', 'pm_junior', 'pm', 'viewer'):
            email = role + '@example.test'
            self.backend.roles[email] = role
            self.backend.accounts[email] = {'has_password': True,'metadata':{'display_name':email.split('@')[0]}}

    def test_pm_can_manage_only_lower_roles_in_selected_project(self):
        self.enable_roles(); self.backend.global_scope = True
        page = self.page(mobile=True); self.login(page, 'pm@example.test')
        self.settings_click(page, '#pf-project-access')
        expect(page.locator('#pf-members-section')).to_be_visible()
        self.assertEqual(page.locator('#pf-invite-role option').evaluate_all('(items)=>items.map(i=>i.value)'), ['viewer','qa','pm_junior'])
        for email in ('pm@example.test','leader@example.test'):
            row = page.locator('#pf-editor-list li').filter(has_text=email)
            expect(row.locator('select')).to_have_count(0)
            expect(row.locator('button')).to_have_count(0)
        row = page.locator('#pf-editor-list li').filter(has_text='qa@example.test')
        row.locator('select').select_option('pm_junior')
        row.get_by_role('button', name='Guardar rol').click()
        expect(page.locator('#pf-access-message')).to_contain_text('Rol actualizado')
        self.assertEqual(self.backend.roles['qa@example.test'], 'pm_junior')
        page.locator('#pf-invite-role').select_option('pm_junior')
        page.locator('#pf-add-editor [name="email"]').fill('outsider@example.test')
        page.locator('#pf-add-editor button[type="submit"]').click()
        expect(page.locator('#pf-access-message')).to_contain_text('Invitación enviada')
        self.assertEqual(next(iter(self.backend.invitations.values()))['role'], 'pm_junior')

    def test_global_admin_sees_all_projects_and_can_promote_another_admin(self):
        self.enable_roles(); self.backend.global_scope = True
        other = str(uuid.uuid4())
        self.backend.projects[other] = {'data': {PROJECT:{'project':{'name':'Proyecto ajeno'}}}, 'roles':{'pm@example.test':'pm'}}
        page = self.page(); self.login(page)
        self.open_settings(page)
        expect(page.locator('#pf-project-select option[value="'+other+'"]')).to_have_count(1)
        page.locator('[data-settings-section=data]').click()
        page.locator('#pf-switch-project').click()
        page.locator('#pf-project-select').select_option(other)
        expect(page.locator('#pf-role')).to_have_text('Admin global')
        self.settings_click(page, '#pf-project-access')
        row = page.locator('#pf-editor-list li').filter(has_text='pm@example.test')
        row.locator('select').select_option('admin')
        row.get_by_role('button', name='Guardar rol').click()
        expect(page.locator('#pf-access-message')).to_contain_text('Admin global')
        self.assertIn('pm@example.test', self.backend.global_admins)
        promoted = self.page(); self.login(promoted,'pm@example.test')
        expect(promoted.locator('#pf-role')).to_have_text('Admin global')

    def test_qa_sends_request_without_editing_other_records_and_retry_is_not_duplicated(self):
        self.enable_roles()
        page = self.page(mobile=True)
        page.clock.install()
        self.login(page, 'qa@example.test', 'proyecto.html')
        self.set_font_level(page, 7); self.close_settings(page)
        expect(page.locator('#pf-new-project')).to_be_hidden()
        expect(page.locator('#pf-project-access')).to_be_hidden()
        page.get_by_role('button', name='+ Nueva solicitud', exact=True).click()
        expect(page.locator('#entry-creator-role')).to_have_text('Consultor / QA')
        expect(page.locator('#f-assigneeId')).to_have_count(0)
        expect(page.locator('#f-status')).to_have_count(0)
        expect(page.locator('#f-decision')).to_have_count(0)
        expect(page.locator('#delete-entry')).to_be_hidden()
        page.locator('#f-title').fill('Error de lectura en móvil')
        page.locator('#f-detail').fill('El texto de la fecha se corta')
        page.locator('#f-category').select_option('Corrección de error')
        self.backend.data[TEAM] = {'schedule': [{'id':'another-task','title':'Cambio de PM','done':False}]}
        page.clock.fast_forward(31000)
        expect(page.locator('#f-title')).to_have_value('Error de lectura en móvil')
        expect(page.locator('#edit-dialog')).to_be_visible()
        self.assertTrue(page.locator('#edit-dialog').evaluate('(el) => el.scrollWidth <= el.clientWidth'))
        self.backend.fail_after_request = True
        page.locator('#entry-submit').click()
        expect(page.locator('#sync-label')).to_have_text('No guardado')
        expect(page.locator('#f-title')).to_have_value('Error de lectura en móvil')
        page.locator('#entry-submit').click()
        expect(page.locator('#edit-dialog')).to_be_hidden()
        self.assertEqual(len(self.backend.data[PROJECT]['requests']), 1)
        self.assertEqual(self.backend.data[PROJECT]['requests'][0]['status'], 'Pendiente')
        expect(page.locator('#recent-requests')).to_contain_text('Consultor / QA')
        expect(page.get_by_role('button', name='+ Nueva revisión', exact=True)).to_be_hidden()
        self.assertEqual(self.backend.data[TEAM]['schedule'][0]['title'], 'Cambio de PM')
        if page.locator('#pf-menu-toggle').get_attribute('aria-expanded') == 'false': page.locator('#pf-menu-toggle').click()
        page.locator('.side-link[data-page="solicitudes"]').click()
        page.locator('[data-view-kind="requests"]').click()
        expect(page.locator('#f-title')).to_have_attribute('readonly', '')
        expect(page.locator('#entry-submit')).to_be_hidden()
        expect(page.locator('#delete-entry')).to_be_hidden()
        page.locator('#entry-form [data-close]').click()
        page.goto(self.base + '/index.html')
        expect(page.locator('#agenda-add')).to_be_hidden()
        expect(page.locator('.agenda-title input')).to_have_attribute('readonly', '')

    def test_pm_junior_can_create_and_edit_but_cannot_invite_or_promote_self(self):
        self.enable_roles()
        page = self.page(); self.login(page, 'pm_junior@example.test')
        expect(page.locator('#agenda-add')).to_be_visible()
        self.open_settings(page)
        expect(page.locator('#pf-project-access')).to_be_hidden()
        project = self.create_project(page, 'Proyecto del PM menor', 3, '2026-12-01')
        self.assertEqual(self.backend.projects[project]['roles']['pm_junior@example.test'], 'pm_junior')
        self.assertEqual(self.backend.projects[project]['roles']['leader@example.test'], 'leader')
        expect(page.locator('#pf-role')).to_have_text('PM menor')
        expect(page.locator('#pf-project-access')).to_be_hidden()
        page.locator('#agenda-add').click()
        self.wait_saved(page)
        self.assertEqual(len(self.backend.projects[project]['data'][TEAM]['schedule']), 1)
        error = page.evaluate("ProjectFlow.projectRpc('projectflow_set_member_role', {p_project_id:ProjectFlow.project().id,p_email:'pm_junior@example.test',p_role:'admin'}).catch(e=>e.message)")
        self.assertIn('denegado', error)

    def test_pm_invites_only_qa_and_recipient_sees_role_before_accepting(self):
        self.enable_roles()
        page = self.page(); self.login(page, 'pm@example.test')
        self.settings_click(page, '#pf-project-access')
        expect(page.locator('#pf-members-section')).to_be_hidden()
        expect(page.locator('#pf-invite-role')).to_be_hidden()
        expect(page.locator('#pf-invite-help')).to_contain_text('Consultor / QA')
        page.locator('#pf-add-editor [name="email"]').fill('outsider@example.test')
        page.locator('#pf-add-editor button[type="submit"]').click()
        expect(page.locator('#pf-access-message')).to_contain_text('Invitación enviada')
        expect(page.locator('#pf-invitation-list')).to_contain_text('Consultor / QA')
        self.assertEqual(next(iter(self.backend.invitations.values()))['role'], 'qa')
        recipient = self.page(); self.open_invitation(recipient, 'outsider@example.test')
        expect(recipient.locator('#inv-role')).to_have_text('Rol: Consultor / QA')
        expect(recipient.locator('#inv-permissions')).to_contain_text('enviar solicitudes')
        recipient.locator('[name="password-mode"][value="existing"]').check()
        recipient.locator('#inv-current-password').fill('test-password-only')
        self.accept_invitation(recipient)
        expect(recipient.locator('#pf-role')).to_have_text('Consultor / QA')
        expect(recipient.locator('#agenda-add')).to_be_hidden()

    def test_admin_changes_roles_and_cannot_remove_last_admin(self):
        self.enable_roles()
        page = self.page(mobile=True); self.login(page)
        self.settings_click(page, '#pf-project-access')
        qa = page.locator('#pf-editor-list li').filter(has_text='qa@example.test')
        qa.locator('select').select_option('pm')
        qa.get_by_role('button', name='Guardar rol').click()
        expect(page.locator('#pf-access-message')).to_contain_text('Rol actualizado: PM')
        self.assertEqual(self.backend.roles['qa@example.test'], 'pm')
        admin = page.locator('#pf-editor-list li').filter(has_text='leader@example.test')
        admin.locator('select').select_option('viewer')
        admin.get_by_role('button', name='Guardar rol').click()
        expect(page.locator('#pf-access-message')).to_contain_text('al menos un admin')
        self.assertEqual(self.backend.roles['leader@example.test'], 'leader')
        self.assertTrue(page.locator('#pf-access-dialog').evaluate('(el) => el.scrollWidth <= el.clientWidth'))
        page.locator('#pf-add-editor [name="email"]').fill('new-admin@example.test')
        page.locator('#pf-invite-role').select_option('admin')
        page.locator('#pf-add-editor button[type="submit"]').click()
        expect(page.locator('#pf-access-message')).to_contain_text('rol Admin')
        self.assertEqual(next(iter(self.backend.invitations.values()))['role'], 'admin')

    def test_role_change_detected_even_when_general_edit_permission_is_unchanged(self):
        self.enable_roles()
        page = self.page(); page.clock.install()
        self.login(page, 'pm@example.test')
        self.backend.roles['pm@example.test'] = 'pm_junior'
        page.clock.fast_forward(31000)
        expect(page.locator('#pf-gate')).to_be_visible()
        expect(page.locator('#pf-message')).to_contain_text('Tus permisos cambiaron')
        page.locator('#pf-retry').click()
        expect(page.locator('#pf-role')).to_have_text('PM menor')
        expect(page.locator('#pf-project-access')).to_be_hidden()

    def test_roles_keep_public_reading_without_an_account(self):
        self.enable_roles()
        page = self.page()
        for path in ('index.html','cronograma.html','proyecto.html'):
            page.goto(self.base + '/' + path)
            expect(page.locator('#pf-role')).to_have_text('Usuario · Solo lectura')
            expect(page.locator('.layout')).to_be_visible()
            expect(page.locator('#pf-project-access')).to_be_hidden()
            for control in page.locator('[data-pf-edit], [data-pf-submit]').all(): expect(control).to_be_hidden()

    def test_custom_week_removal_preserves_task_dates_and_unassigns_tasks(self):
        page = self.page(); self.login(page)
        project = self.create_project(page, 'Plan flexible', 1, '2026-11-07')
        page.locator('#agenda-add').click()
        page.locator('.agenda-title input').fill('Tarea con fecha')
        page.locator('.agenda-row input[type="date"]').fill('2026-11-04')
        page.locator('.agenda-row select').select_option(index=1)
        self.wait_saved(page)
        page.locator('nav a[href*="cronograma.html"]').click()
        page.locator('#week-title-input').fill('Primera fase')
        page.locator('#week-due').fill('2026-11-06')
        self.wait_saved(page)
        page.once('dialog', lambda dialog: dialog.accept())
        page.locator('#plan-remove').click()
        expect(page.locator('#plan-weeks button')).to_have_count(0)
        task = self.backend.projects[project]['data'][TEAM]['schedule'][0]
        self.assertEqual(task['dueDate'],'2026-11-04')
        self.assertEqual(task['weekId'],'')
        page.locator('#plan-add').click()
        self.wait_saved(page)
        expect(page.locator('#plan-weeks button')).to_have_count(1)

    def test_unknown_project_never_opens_or_writes_the_original(self):
        page = self.page()
        page.goto(self.base+'/index.html?project=ffffffff-ffff-ffff-ffff-ffffffffffff')
        expect(page.locator('#pf-message')).to_contain_text('no existe')
        expect(page.locator('.layout')).to_be_hidden()
        self.assertEqual(self.backend.saved,0)


if __name__ == '__main__':
    unittest.main(verbosity=2)
