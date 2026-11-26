import React from 'react';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ClassAttendanceAction } from './ClassroomClassPage';
Reflect.set(globalThis, 'React', React);
const render = (props: Partial<React.ComponentProps<typeof ClassAttendanceAction>> = {}) => renderToStaticMarkup(React.createElement(ClassAttendanceAction, {classId:'class-a', administrator:false, archived:false, loading:false, failed:false, activeSessionId:null, ...props}));
test('class primary action resumes the active session instead of starting another', () => {
 const html = render({activeSessionId:'active-a'});
 assert.ok(html.includes('/class/sessions/active-a'));
 assert.ok(html.includes('Resume attendance'));
 assert.ok(!html.includes('/start'));
});
test('class primary action waits for active meeting lookup and offers recovery on failure', () => {
 assert.ok(!render({loading:true}).includes('/start'));
 assert.ok(!render({failed:true}).includes('/start'));
 assert.ok(render({failed:true}).includes('Retry attendance status'));
 assert.ok(render().includes('/class/classes/class-a/start'));
});
test('administrators only view existing attendance and archived classes cannot start meetings', () => {
 assert.equal(render({administrator:true}), '');
 assert.ok(render({administrator:true,activeSessionId:'active-a'}).includes('View session'));
 assert.equal(render({archived:true}), '');
 assert.ok(render({archived:true,activeSessionId:'active-a'}).includes('/class/sessions/active-a'));
});
