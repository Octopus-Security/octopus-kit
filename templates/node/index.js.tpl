'use strict';

/**
 * {{NAME}} — entrypoint.
 *
 * Order matters and is the estate convention:
 *   1. health + build  — ahead of auth, so they answer when a login is exactly
 *                        what is broken (and a denied account can still see them)
 *   2. static assets
 *   3. internal routes — their own shared secret, machine callers, no cookie
 *   4. identify -> requireUser -> app gate -> everything else
 *
 * Every integration is optional: a partner that is not configured or not
 * answering hides the feature (res.locals.suite), it never throws out of a handler.
 */

const path = require('path');
const express = require('express');
const kit = require('octopus-kit/server');
const { loadConfig } = require('./config');
const { buildAuth, sameOrigin } = require('./auth');

const SERVICE = 'octopus-{{SLUG}}';
const cfg = loadConfig();

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
{{#ui}}
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
{{/ui}}

// The stamp is derived from the shipped files; `unknown` is never `current`.
const stamp = kit.createBuildStamp({ service: SERVICE, roots: [__dirname] });
const auth = buildAuth(cfg);
// Dev mode has no octopus-auth to ask, so there is nothing to gate (and /api/build reports no gate).
const gate = kit.createAppGate({
  slug: cfg.authMode === 'dev' ? '' : cfg.appAccessSlug,
  authUrl: cfg.authUrl,
  upgradeUrl: cfg.upgradeUrl,
  appName: '{{NAME}}',
});
// Partners this app CAN use. Add one per integration; none is required.
const suite = kit.createSuite({
  services: {
    cortex: { urlEnv: 'CORTEX_URL', secretEnv: 'INTERNAL_SECRET', probe: '/api/build' },
  },
});

// 1. Health and build, ahead of auth.
kit.healthRoutes(app, { service: SERVICE, stamp, gate });

// 2. Static assets.
{{#ui}}
stamp.express(app); // asset('/app.css') -> /app.css?v=<content hash> in every template
app.use('/public', express.static(path.join(__dirname, 'public'), { index: false, maxAge: '5m' }));
const kitStatic = kit.kitAssets(); // the kit's own tokens + ui CSS, served from node_modules
app.use('/kit', kitStatic);
app.locals.kit = kitStatic.url;     // kit('/tokens/tokens.css') -> /kit/tokens/tokens.css?v=<hash>
app.locals.themeBoot = ''; // the pre-paint theme script; optional, the page renders without it
try { app.locals.themeBoot = require('octopus-kit/tokens/theme-boot.cjs').inlineTag(); } catch { /* kit without tokens: unthemed but working */ }
{{/ui}}

app.use(express.json({ limit: '100kb' }));
app.use(kit.prefs.middleware()); // res.locals.theme from the suite cookie
app.use(suite.middleware());     // res.locals.suite = { cortex: true/false }
{{#ui}}
// res.page(view, data): render a view inside views/layout.ejs.
app.use((req, res, next) => {
  res.page = (view, data = {}) => res.render(view, data, (err, body) => (err ? next(err) : res.render('layout', { title: '', ...data, body })));
  next();
});
{{/ui}}

// 3. Internal (service-to-service) routes. Fail closed: 503 until INTERNAL_SECRET is set.
const internal = express.Router();
internal.get('/whoami', (req, res) => res.json({ ok: true, service: SERVICE, actingFor: kit.serviceUser(req) }));
internal.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use('/api/internal', kit.requireInternalSecret(), internal);

// 4. People: identify -> require a login -> per-app access gate.
app.use(auth.identify);
app.use(auth.requireUser);
app.use(sameOrigin);
app.use(gate);

{{#ui}}
app.get('/', (req, res) => res.page('index', { title: 'Home', user: req.user }));
{{/ui}}
{{#headless}}
app.get('/', (req, res) => res.json({ ok: true, service: SERVICE, user: req.user.username }));
{{/headless}}
app.get('/api/me', (req, res) => res.json({ username: req.user.username }));

app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
{{#ui}}
  return res.status(404).render('error', { title: 'Not found', message: 'There is nothing here.' });
{{/ui}}
{{#headless}}
  return res.status(404).json({ error: 'Not found' });
{{/headless}}
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(`[${SERVICE}]`, err && err.stack ? err.stack : err);
  if (res.headersSent) return undefined;
  if (req.path.startsWith('/api/')) return res.status(500).json({ error: 'Something went wrong.' });
{{#ui}}
  return res.status(500).render('error', { title: 'Error', message: 'Something went wrong.' });
{{/ui}}
{{#headless}}
  return res.status(500).json({ error: 'Something went wrong.' });
{{/headless}}
});

function start() {
  return app.listen(cfg.port, () => console.log(`[${SERVICE}] listening on ${cfg.port} (auth: ${cfg.authMode}, build ${stamp.build})`));
}

if (require.main === module) start();

module.exports = { app, start, stamp, gate, suite };
