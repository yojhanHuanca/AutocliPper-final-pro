import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorTimelineComponent } from '../../.local/tests/client.mjs';

function harness() {
  const changes = [];
  const vm = {
    spec: { startSeconds: 3.2, endSeconds: 6.4 },
    canChangeCaptions: () => true,
    sourceDuration: () => 10,
    beginFormGesture() {},
    endFormGesture() {},
    timelineStartMin: () => 0,
    timelineStartMax: () => 6.3,
    timelineEndMin: () => 3.3,
    timelineEndMax: () => 10,
    setTimelineStart: value => { changes.push(['start', value]); vm.spec.startSeconds = value; },
    setTimelineEnd: value => { changes.push(['end', value]); vm.spec.endSeconds = value; },
    setTimelineRange: (start, end) => { changes.push(['range', start, end]); vm.spec.startSeconds = start; vm.spec.endSeconds = end; },
  };
  const component = Object.create(EditorTimelineComponent.prototype);
  Object.assign(component, { vm, activeRangeHandle: null, rangePointerOffsetX: 0 });
  return { component, changes };
}

test('dragging either timeline handle updates its matching persisted form value without a pointer jump', () => {
  const { component, changes } = harness();
  let capturedPointer;
  const handle = {
    getBoundingClientRect: () => ({ left: 145, width: 16 }),
    setPointerCapture: id => { capturedPointer = id; },
  };
  const track = { getBoundingClientRect: () => ({ left: 100, width: 200 }) };
  const down = { button: 0, pointerId: 7, clientX: 150, currentTarget: handle, preventDefault() {} };

  component.startRangeDrag(down, 'start', track);
  assert.equal(capturedPointer, 7);
  assert.equal(changes[0][0], 'start');
  assert.ok(Math.abs(changes[0][1] - 2.65) < 1e-9, 'The selected handle center stays at its original time when drag begins.');
  component.moveRangeDrag({ clientX: 200 }, track);
  assert.equal(changes.at(-1)[0], 'start');
  assert.ok(Math.abs(changes.at(-1)[1] - 5.15) < 1e-9);
  component.endRangeDrag();
  component.moveRangeDrag({ clientX: 250 }, track);
  assert.equal(changes.length, 2, 'The end event stops subsequent movement.');

  component.startRangeDrag({ ...down, clientX: 170 }, 'end', track);
  component.moveRangeDrag({ clientX: 190 }, track);
  assert.equal(changes.at(-1)[0], 'end');
});

test('focused clip-range handles support arrows, Home and End', () => {
  const { component, changes } = harness();
  const handled = [];
  const key = value => ({ key: value, preventDefault: () => handled.push(value) });

  component.rangeHandleKeydown(key('ArrowRight'), 'start');
  component.rangeHandleKeydown(key('Home'), 'start');
  component.rangeHandleKeydown(key('End'), 'end');

  assert.deepEqual(changes, [['start', 3.3000000000000003], ['start', 0], ['end', 10]]);
  assert.deepEqual(handled, ['ArrowRight', 'Home', 'End']);
});

test('dragging and keyboard-moving the selected range preserve clip length and stay inside the source', () => {
  const { component, changes } = harness();
  let capturedPointer;
  const selection = { setPointerCapture: id => { capturedPointer = id; } };
  const track = { getBoundingClientRect: () => ({ left: 100, width: 200 }) };
  component.startSelectionDrag({ button: 0, pointerId: 11, clientX: 160, currentTarget: selection, preventDefault() {} });
  assert.equal(capturedPointer, 11);
  component.moveRangeDrag({ clientX: 200 }, track);
  assert.deepEqual(changes, [['range', 5.2, 8.4]]);
  component.endRangeDrag();

  component.startSelectionDrag({ button: 0, pointerId: 12, clientX: 160, currentTarget: selection, preventDefault() {} });
  component.moveRangeDrag({ clientX: 280 }, track);
  assert.deepEqual(changes.at(-1), ['range', 6.8, 10], 'A large pointer jump clamps the whole selection to the source end.');
  component.endRangeDrag();

  const handled = [];
  const key = (value, shiftKey = false) => ({ key: value, shiftKey, preventDefault: () => handled.push(value) });
  component.moveSelectionKeydown(key('ArrowLeft', true));
  component.moveSelectionKeydown(key('Home'));
  component.moveSelectionKeydown(key('End'));
  assert.deepEqual(changes.slice(2), [
    ['range', 5.8, 9],
    ['range', 0, 3.2],
    ['range', 6.8, 10],
  ]);
  assert.deepEqual(handled, ['ArrowLeft', 'Home', 'End']);
});
