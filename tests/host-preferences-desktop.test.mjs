// Optional contract test against the installed Desktop ASAR. Cordis Loader and
// SettingsForms are real. Only the configEditor persistence boundary and WASM
// route registration are in memory: no install, profile file, network or PTY.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import z from '@deepseek-ai/schemastery';
import * as rio from '../src/index.ts';
import { RIO_PREFERENCES_NAMESPACE as ns } from '../src/plugin/preferences.ts';
import { preferenceDefaults } from '../src/preferences/values.ts';

const desktop = process.versions.electron && process.env.DSH_INSTALL_DIR;
test('installed Loader and SettingsForms discover, validate, fence and publish Rio config without remounting the resource', {
  skip: !desktop,
}, async (t) => {
  const resolve = createRequire(join(desktop, 'package.json')).resolve;
  const load = (name) => import(pathToFileURL(resolve(name)).href);
  const { Context } = await load('@deepseek-ai/cordis');
  const { Loader } = await load('@deepseek-ai/cordis-plugin-loader');
  const { SettingsForms } = await load('@deepseek-ai/dsh-settings');
  const root = new Context();
  t.after(() => root.fiber.dispose());
  await root.plugin(Loader).await();
  const resources = [];
  let unmounted = 0;
  root.provide('webServer', {
    register(route) {
      resources.push(route.path);
      return () => ++unmounted;
    },
  });
  root.provide('connection', {
    admit: () => assert.fail('configuration must not visit the WASM route'),
  });
  root.loader.builtins.rio = rio;
  await root.loader.create({ id: ns, name: 'cordis:rio' });
  await root.loader.await();
  const entry = root.loader.resolve(ns);
  const fiber = entry.fiber;
  const ref = fiber.effectiveConfig.fontSize;
  assert.deepEqual(resources, ['/dsh-plugin-rioterm/wasm/0.1.8.wasm']); // No settings provider yet.

  let persisted = {};
  root.provide('configEditor', {
    entries: () => [entry],
    configuration: () => [{ entry, inherited: {}, override: persisted }],
    async edit(owner, change) {
      assert.equal(owner, entry);
      const next = change(structuredClone(persisted), {});
      owner.fiber.resolveConfig(next);
      await owner.update({ config: next });
      persisted = next;
    },
  });
  // Not a directory: SettingsForms' legacy import cannot touch an actual settings document.
  root.provide('profileContext', { home: fileURLToPath(import.meta.url) });
  const events = [];
  root.on('settings/document-updated', (entryId, revision) =>
    events.push([entryId, revision]),
  );
  await root.plugin(SettingsForms).await();
  await root.loader.await();
  const describe = () =>
    root.settings
      .describe({ redactSecrets: true })
      .find((row) => row.ns === ns);
  const first = describe();
  assert.equal(first.autoGenerate, false); // The child's configure call named the parent Rio fiber.
  assert.equal(first.applies, 'live');
  assert.deepEqual(first.value, preferenceDefaults);
  assert.deepEqual(first.user, {});
  const form = new z(JSON.parse(JSON.stringify(first.schema)));
  assert.deepEqual(form({}), preferenceDefaults); // Client wire projection contains plain values, not Volatile refs.
  await root.settings.mutate(
    ns,
    [
      { op: 'set', path: ['fontSize'], value: 17 },
      { op: 'set', path: ['scrollback'], value: 0 },
    ],
    first.revision,
  );
  const saved = describe();
  assert.ok(saved.revision > first.revision);
  assert.ok(events.some(([id, rev]) => id === ns && rev === saved.revision));
  assert.deepEqual(persisted, { fontSize: 17, scrollback: 0 });
  assert.equal(fiber.effectiveConfig.fontSize, ref);
  assert.equal(ref.get(), 17);
  assert.equal(saved.user.scrollback, 0);
  await assert.rejects(
    root.settings.mutate(
      ns,
      [{ op: 'unset', path: ['fontSize'] }],
      first.revision,
    ),
    { code: 'SETTINGS_CONFLICT' },
  );
  await assert.rejects(
    root.settings.mutate(
      ns,
      [{ op: 'set', path: ['fontSize'], value: 4 }],
      saved.revision,
    ),
    /fontSize/,
  );
  assert.deepEqual(describe().user, persisted);
  assert.equal(describe().value.fontSize, 17);
  await root.settings.mutate(
    ns,
    [{ op: 'unset', path: ['fontSize'] }],
    saved.revision,
  );
  assert.deepEqual(persisted, { scrollback: 0 });
  assert.equal(ref.get(), 0);
  assert.equal(resources.length, 1);
  assert.equal(unmounted, 0);
});
