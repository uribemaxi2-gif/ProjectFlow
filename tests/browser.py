"""Browser integration tests using an isolated, simulated Supabase API.

The real SQL authorization rules are exercised separately by npm test.
No test contacts Supabase or sends email.
"""
import base64
import copy
import json
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from functools import partial
from pathlib import Path
import threading
import time
import unittest
from urllib.parse import urlparse

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
            if body.get('password') != 'test-password-only':
                respond(400, {'error': 'invalid_grant', 'error_description': 'Invalid login credentials'})
                return
            email = body['email']
            respond(200, {'access_token': self.jwt(email), 'refresh_token': 'test-refresh-token',
                          'token_type': 'bearer', 'expires_in': 3600, 'expires_at': int(time.time()) + 3600,
                          'user': {'id': email, 'email': email, 'aud': 'authenticated',
                                   'role': 'authenticated', 'app_metadata': {}, 'user_metadata': {}}})
            return
        if path == '/auth/v1/logout':
            respond(200, {})
            return
        token = request.headers.get('authorization', '').removeprefix('Bearer ')
        try:
            part = token.split('.')[1]
            email = json.loads(base64.urlsafe_b64decode(part + '=' * (-len(part) % 4)))['email']
        except (IndexError, ValueError, KeyError):
            email = ''
        if path == '/auth/v1/user':
            respond(200, {'id': email, 'email': email, 'aud': 'authenticated'})
            return
        if path == '/rest/v1/rpc/projectflow_get_state' and (self.public or email in self.roles):
            respond(200, {'data': self.data, 'role': self.roles.get(email, 'viewer')})
            return
        if email not in self.roles:
            respond(403, {'code': '42501', 'message': 'Acceso denegado'})
            return
        if path == '/rest/v1/rpc/projectflow_save':
            if self.fail_next_save:
                self.fail_next_save = False
                respond(503, {'code': 'unavailable', 'message': 'Temporary failure'})
                return
            updates = body['p_updates']
            if any(self.data.get(item['key']) != item['expected'] for item in updates):
                respond(409, {'code': '40001', 'message': 'Concurrent update'})
                return
            for item in updates:
                self.data[item['key']] = copy.deepcopy(item['value'])
            self.saved += 1
            respond(200, {'data': self.data, 'role': self.roles[email]})
            return
        raise AssertionError(f'Unexpected request: {request.method} {path}')


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

    def login(self, page, email='leader@example.test', path='index.html'):
        page.goto(self.base + '/' + path)
        if self.backend.public:
            page.locator('#pf-open-login').click()
        page.locator('#pf-email-input').fill(email)
        page.locator('#pf-password').fill('test-password-only')
        page.locator('#pf-enter').click()
        expect(page.locator('#pf-gate')).to_be_hidden()
        expect(page.locator('#pf-role')).to_have_text('Edición autorizada' if email in self.backend.roles else 'Solo lectura')

    def wait_saved(self, page):
        expect(page.locator('#pf-status')).to_have_text('Guardado compartido')

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
        responsible.locator('nav a[href="cronograma.html"]').click()
        responsible.locator('[data-milestone="1"]').check()
        self.wait_saved(responsible)
        leader.goto(self.base + '/cronograma.html')
        expect(leader.locator('[data-milestone="1"]')).to_be_checked()
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
        first.locator('#pf-refresh').click()
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
        page.locator('#page-resumen [data-create="solicitudes"]').click()
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
        with page.expect_download() as result:
            page.locator('#backup-download').click()
        exported = json.loads(Path(result.value.path()).read_text())
        self.assertEqual(exported['workspaces']['team']['1'], 'Nombre recuperado')

    def test_old_browser_data_are_exported_only_on_request(self):
        page = self.page()
        page.context.add_init_script("localStorage.setItem('equipo14.personas', JSON.stringify({'1':'Nombre anterior'}));")
        self.login(page)
        expect(page.locator('#agenda-title-1')).to_have_value('Definir el objetivo')
        self.assertEqual(self.backend.data, {})
        with page.expect_download() as result:
            page.locator('#pf-previous').click()
        exported = json.loads(Path(result.value.path()).read_text())
        self.assertEqual(exported['workspaces']['team'], {'1': 'Nombre anterior'})
        self.assertEqual(self.backend.data, {})

    def test_mobile_login_navigation_and_logout(self):
        page = self.page(mobile=True)
        self.login(page)
        page.locator('nav a[href="proyecto.html"]').click()
        page.locator('.side-link[data-page="proyecto"]').click()
        expect(page.locator('#project-form')).to_be_visible()
        self.assertLessEqual(page.evaluate('document.documentElement.scrollWidth'), 390)
        page.locator('#pf-logout').click()
        expect(page.locator('#pf-role')).to_have_text('Solo lectura')
        expect(page.locator('.layout')).to_be_visible()
        page.goto(self.base + '/index.html')
        expect(page.locator('#agenda-dueDate-1')).to_have_attribute('readonly', '')
        self.assertLessEqual(page.evaluate('document.documentElement.scrollWidth'), 390)
        page.screenshot(path='/tmp/projectflow-mobile-agenda.png', full_page=True)

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
        page.locator('#pf-open-login').click()
        page.locator('#pf-password').fill('not-submitted')
        page.locator('#pf-cancel-login').click()
        expect(page.locator('.layout')).to_be_visible()
        expect(page.locator('#pf-role')).to_have_text('Solo lectura')
        expect(page.locator('#pf-password')).to_have_value('')


if __name__ == '__main__':
    unittest.main(verbosity=2)
