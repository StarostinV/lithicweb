/**
 * Alt temporarily switches to VIEW; releasing it must announce the return
 * to the previous tool, or listeners (edge visibility, tab sync) stay in VIEW.
 */
import { Mode, MODES, EDGE_EDITING_MODES } from '../../../src/utils/mode.js';
import { eventBus, Events } from '../../../src/utils/EventBus.js';

function makeMode() {
    const scene = { controls: {}, setGizmoVisible: () => {}, rotationController: null };
    return new Mode(scene);
}

describe('Mode change events', () => {
    afterEach(() => eventBus.offNamespace('modeEventsTest'));

    test('Alt press and release both emit MODE_CHANGED', () => {
        const mode = makeMode();
        mode.setMode(MODES.DRAW, true);

        const seen = [];
        eventBus.on(Events.MODE_CHANGED, (d) => seen.push(d.mode), 'modeEventsTest');

        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt' }));
        window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt' }));

        expect(seen).toEqual([MODES.VIEW, MODES.DRAW]);
        expect(mode.currentMode).toBe(MODES.DRAW);
    });

    test('edge-editing modes are exactly the edge tools', () => {
        expect([...EDGE_EDITING_MODES].sort()).toEqual(
            [MODES.DRAW, MODES.DRAWLINES, MODES.ERASE, MODES.RIDGE].sort());
    });
});
