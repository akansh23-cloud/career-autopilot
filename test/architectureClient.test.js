// Architecture Diagram OS — client-side helper tests.
// Exercises the PURE renderer logic (web/src/lib/architectureSpec.js):
// spec detection, view ordering for tabs, deterministic layout used by the
// canvas, the client Mermaid mirror, and — critically — that old Mermaid
// project data never crashes the new code paths.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  isArchitectureSpec, orderedViews, viewToMermaid, layoutView,
  VIEW_LABELS, NODE_TYPE_COLORS, checkTone, scoreTone,
} from '../web/src/lib/architectureSpec.js';
import { normalizeMermaidInput, layoutGraph } from '../web/src/lib/architecture.js';
import { generateArchitectureSpec } from '../server/utils/architecture/index.js';

const PKG = generateArchitectureSpec(
  { title: 'Placement Hub', description: 'College placement analytics platform for TPO and students', techStack: ['React', 'Node', 'PostgreSQL'] },
  { cloudProvider: 'azure', targetLevel: 'college_saas' }
);

test('isArchitectureSpec accepts real specs and rejects legacy shapes', () => {
  assert.equal(isArchitectureSpec(PKG.architectureSpec), true);
  assert.equal(isArchitectureSpec(null), false);
  assert.equal(isArchitectureSpec('graph TD\n A --> B'), false);
  assert.equal(isArchitectureSpec({ diagrams: { component: 'graph TD' } }), false);
  assert.equal(isArchitectureSpec({ views: [] }), false);
  assert.equal(isArchitectureSpec({ views: [{ nodes: null }] }), false);
});

test('orderedViews returns tabs in the canonical order with labels available', () => {
  const views = orderedViews(PKG.architectureSpec);
  assert.ok(views.length >= 5);
  const idx = (t) => views.findIndex((v) => v.type === t);
  assert.ok(idx('systemContext') < idx('container'));
  assert.ok(idx('container') < idx('security'));
  for (const v of views) assert.ok(VIEW_LABELS[v.type], `label for ${v.type}`);
});

test('layoutView places every node and renders nested group rectangles', () => {
  for (const view of PKG.architectureSpec.views) {
    const { placed, groupRects, width, height } = layoutView(view);
    for (const n of view.nodes) {
      assert.ok(placed[n.id], `${view.type}: node ${n.id} placed`);
      assert.ok(placed[n.id].x >= 0 && placed[n.id].y >= 0);
    }
    assert.ok(width > 0 && height > 0);
    // groups that contain nodes must have a rectangle
    const usedGroups = new Set(view.nodes.map((n) => n.group).filter(Boolean));
    for (const gid of usedGroups) {
      if (view.groups.some((g) => g.id === gid)) {
        assert.ok(groupRects.some((r) => r.id === gid), `${view.type}: rect for ${gid}`);
      }
    }
  }
  // deployment view exercises 3-level nesting (region > vpc > subnet)
  const dep = PKG.architectureSpec.views.find((v) => v.type === 'deployment');
  const { groupRects } = layoutView(dep);
  const region = groupRects.find((r) => r.type === 'region');
  const subnet = groupRects.find((r) => r.type === 'subnet');
  assert.ok(region && subnet && subnet.depth > region.depth);
});

test('layoutView never throws on malformed views', () => {
  for (const bad of [null, {}, { nodes: 'x' }, { nodes: [{ id: 'a', group: 'ghost' }], groups: [] }]) {
    const out = layoutView(bad || {});
    assert.ok(out.width > 0);
  }
});

test('client viewToMermaid matches the legacy parser contract', () => {
  for (const view of PKG.architectureSpec.views) {
    const mermaid = viewToMermaid(view);
    assert.ok(mermaid.startsWith('graph TD'));
    const layout = layoutGraph(mermaid);
    assert.ok(layout.nodes.length > 0, `${view.type} parsed by legacy renderer`);
  }
});

test('old Mermaid data does not crash the new helpers (backward compatibility)', () => {
  const legacy = 'graph TD\n  User["User"]\n  API["API"]\n  User --> API';
  // new spec helpers treat it as not-a-spec, never throw
  assert.equal(isArchitectureSpec(legacy), false);
  assert.deepEqual(orderedViews(legacy), []);
  // the legacy pipeline keeps working untouched
  assert.equal(normalizeMermaidInput(legacy), legacy);
  assert.ok(layoutGraph(legacy).nodes.length === 2);
  // old object shapes from Patent OS / project store also stay safe
  const oldShape = { mermaidDiagrams: [{ title: 'fig', mermaid: legacy }] };
  assert.ok(normalizeMermaidInput(oldShape).includes('graph TD'));
});

test('tone helpers stay within the design-system palette', () => {
  assert.equal(scoreTone(90), 'mint');
  assert.equal(scoreTone(60), 'cyan');
  assert.equal(scoreTone(10), 'amber');
  assert.equal(checkTone('critical'), 'amber');
  assert.equal(checkTone('low'), 'default');
  assert.ok(NODE_TYPE_COLORS.service && NODE_TYPE_COLORS.datastore);
});
