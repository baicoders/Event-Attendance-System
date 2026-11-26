import React from 'react';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import ClassCard from './ClassCard';
import type { ClassSummary } from '../types/class';
Reflect.set(globalThis, 'React', React);
const item = { id: 'class-a', displayName: 'English A', subject: { title: 'English' }, term: { name: 'First term' }, termId: 'term', sections: [], primaryTeacher: { name: 'Teacher' }, archivedAt: null, activeSession: null, latestSession: null } as unknown as ClassSummary;
test('administrator class cards never offer starting attendance, including the teacher workspace', () => {
  for (const basePath of ['/class/classes', '/class/admin/classes']) {
    const html = renderToStaticMarkup(React.createElement(ClassCard, { item, basePath, viewerRole: 'ADMIN' }));
    assert.ok(!html.includes('/start'));
    assert.ok(!html.includes('Start attendance'));
    assert.ok(html.includes('Open class'));
  }
});
test('administrators can view an existing meeting and teachers can start or continue one', () => {
  const active = { ...item, activeSession: { id: 'meeting', scheduledStartAt: '2026-11-13T00:00:00Z' } };
  const admin = renderToStaticMarkup(React.createElement(ClassCard, { item: active, viewerRole: 'ADMIN' }));
  assert.ok(admin.includes('View session'));
  assert.ok(!admin.includes('/start'));
  assert.ok(renderToStaticMarkup(React.createElement(ClassCard, { item, viewerRole: 'MEMBER' })).includes('/start'));
  assert.ok(renderToStaticMarkup(React.createElement(ClassCard, { item: active, viewerRole: 'MEMBER' })).includes('Continue session'));
});
