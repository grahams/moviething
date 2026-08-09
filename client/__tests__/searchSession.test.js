'use strict';

const { createSearchSession } = require('../add/js/searchSession');

// A stand-in for a jqXHR: a thenable we can settle by hand, plus the abort()
// method jQuery gives us.
function deferred() {
    let resolveFn;
    let rejectFn;
    const promise = new Promise(function (resolve, reject) {
        resolveFn = resolve;
        rejectFn = reject;
    });

    return {
        then: promise.then.bind(promise),
        aborted: false,
        abort: function () {
            this.aborted = true;
            rejectFn(new Error('abort'));
        },
        resolve: resolveFn,
        reject: rejectFn
    };
}

// Lets queued .then callbacks run while timers are faked.
function flush() {
    return Promise.resolve().then(function () {}).then(function () {});
}

function harness(overrides) {
    const requests = [];
    const rendered = [];
    const cleared = [];

    const session = createSearchSession(Object.assign({
        delay: 300,
        minLength: 2,
        search: function (term) {
            const request = deferred();
            request.term = term;
            requests.push(request);
            return request;
        },
        onResults: function (data, term) {
            rendered.push({ data: data, term: term });
        },
        onCleared: function () {
            cleared.push(true);
        }
    }, overrides));

    return { session: session, requests: requests, rendered: rendered, cleared: cleared };
}

beforeEach(() => {
    jest.useFakeTimers();
});

afterEach(() => {
    jest.useRealTimers();
});

describe('createSearchSession', () => {
    test('collapses a burst of keystrokes into one request for the final term', () => {
        const h = harness();

        'Godfather'.split('').reduce(function (typed, ch) {
            const next = typed + ch;
            h.session.input(next);
            jest.advanceTimersByTime(40);
            return next;
        }, '');

        expect(h.requests).toHaveLength(0);

        jest.advanceTimersByTime(300);

        expect(h.requests).toHaveLength(1);
        expect(h.requests[0].term).toBe('Godfather');
    });

    test('does not search until typing pauses for the full delay', () => {
        const h = harness();

        h.session.input('Go');
        jest.advanceTimersByTime(299);
        expect(h.requests).toHaveLength(0);

        jest.advanceTimersByTime(1);
        expect(h.requests).toHaveLength(1);
    });

    test('ignores a stale response that arrives after a newer search was issued', async () => {
        const h = harness();

        h.session.input('Go');
        jest.advanceTimersByTime(300);
        h.session.input('Godfather');
        jest.advanceTimersByTime(300);

        expect(h.requests).toHaveLength(2);

        // The short prefix walks more TMDB pages, so it comes back last.
        h.requests[1].resolve('godfather-results');
        await flush();
        h.requests[0].resolve('go-results');
        await flush();

        expect(h.rendered).toEqual([
            { data: 'godfather-results', term: 'Godfather' }
        ]);
    });

    test('aborts the in-flight request as soon as the term changes', () => {
        const h = harness();

        h.session.input('Go');
        jest.advanceTimersByTime(300);
        expect(h.requests[0].aborted).toBe(false);

        h.session.input('God');
        expect(h.requests[0].aborted).toBe(true);
    });

    test('clears instead of searching when the term is below minLength', () => {
        const h = harness();

        h.session.input('G');
        jest.advanceTimersByTime(300);

        expect(h.requests).toHaveLength(0);
        expect(h.cleared).toHaveLength(1);
    });

    test('a pending search never fires once the term drops below minLength', () => {
        const h = harness();

        h.session.input('Godfather');
        jest.advanceTimersByTime(100);
        h.session.input('G');
        jest.advanceTimersByTime(300);

        expect(h.requests).toHaveLength(0);
    });

    test('an in-flight response cannot re-show results after the term is cleared', async () => {
        const h = harness();

        h.session.input('Godfather');
        jest.advanceTimersByTime(300);
        h.session.input('G');

        h.requests[0].resolve('godfather-results');
        await flush();

        expect(h.rendered).toEqual([]);
        expect(h.cleared).toHaveLength(1);
    });

    test('an in-flight response cannot re-show results after dismiss', async () => {
        const h = harness();

        h.session.input('Godfather');
        jest.advanceTimersByTime(300);
        h.session.dismiss();

        h.requests[0].resolve('godfather-results');
        await flush();

        expect(h.rendered).toEqual([]);
    });

    test('dismiss cancels a search that has not been issued yet', () => {
        const h = harness();

        h.session.input('Godfather');
        jest.advanceTimersByTime(100);
        h.session.dismiss();
        jest.advanceTimersByTime(300);

        expect(h.requests).toHaveLength(0);
    });

    test('reports an error only for the newest request', async () => {
        const errors = [];
        const h = harness({ onError: function () { errors.push(true); } });

        h.session.input('Go');
        jest.advanceTimersByTime(300);
        h.session.input('Godfather');
        jest.advanceTimersByTime(300);

        // requests[0] was aborted by the second input, which rejects it.
        h.requests[1].reject(new Error('boom'));
        await flush();

        expect(errors).toHaveLength(1);
    });

    test('a later search still renders after an earlier one fails', async () => {
        const h = harness();

        h.session.input('Go');
        jest.advanceTimersByTime(300);
        h.requests[0].reject(new Error('boom'));
        await flush();

        h.session.input('Godfather');
        jest.advanceTimersByTime(300);
        h.requests[1].resolve('godfather-results');
        await flush();

        expect(h.rendered).toEqual([
            { data: 'godfather-results', term: 'Godfather' }
        ]);
    });
});
