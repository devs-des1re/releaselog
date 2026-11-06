import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  ContributorResolutionError,
  GitHubContributorApi,
  noreplyLogin,
  resolveContributors,
  type ContributorApi,
} from '../src/contributors';
import type { Commit } from '../src/types';

function commit(overrides: Partial<Commit> = {}): Commit {
  return {
    sha: 'a1b2c3d',
    shortSha: 'a1b2c3d',
    authorLogin: null,
    authorName: 'Arjun',
    authorEmail: 'arjun@example.com',
    prNumber: null,
    desc: 'feat: add a feature',
    subject: 'add a feature',
    scope: null,
    type: 'feat',
    breaking: false,
    section: 'features',
    ...overrides,
  };
}

function fakeApi(overrides: Partial<ContributorApi> = {}): ContributorApi {
  return {
    getCommitAuthorLogin: () => Promise.resolve(null),
    searchUsersByEmail: () => Promise.resolve([]),
    searchUsersByName: () => Promise.resolve([]),
    ...overrides,
  };
}

describe('noreplyLogin', () => {
  it('extracts logins from numeric and legacy noreply addresses', () => {
    expect(noreplyLogin('12345+octocat@users.noreply.github.com')).toBe('octocat');
    expect(noreplyLogin('octocat@users.noreply.github.com')).toBe('octocat');
    expect(noreplyLogin('49699333+dependabot[bot]@users.noreply.github.com')).toBe(
      'dependabot[bot]',
    );
    expect(noreplyLogin('arjun@example.com')).toBeNull();
  });
});

describe('resolveContributors', () => {
  it('resolves noreply addresses without calling the API', async () => {
    const getCommitAuthorLogin = vi.fn((_sha: string) => Promise.resolve<string | null>(null));
    const result = await resolveContributors(
      [
        commit({
          authorEmail: '12345+octocat@users.noreply.github.com',
          authorName: 'The Octocat',
        }),
      ],
      { api: fakeApi({ getCommitAuthorLogin }), searchIntervalMs: 0 },
    );

    expect(result.contributors).toEqual([
      {
        login: 'octocat',
        name: 'The Octocat',
        email: '12345+octocat@users.noreply.github.com',
        commitCount: 1,
        resolved: true,
      },
    ]);
    expect(getCommitAuthorLogin).not.toHaveBeenCalled();
  });

  it('falls through commit shas until the API returns a login', async () => {
    const getCommitAuthorLogin = vi.fn((sha: string) =>
      Promise.resolve<string | null>(sha === 'second' ? 'arjun' : null),
    );
    const result = await resolveContributors(
      [
        commit({ sha: 'first', authorEmail: 'arjun@example.com' }),
        commit({ sha: 'second', authorEmail: 'arjun@example.com' }),
      ],
      { api: fakeApi({ getCommitAuthorLogin }), searchIntervalMs: 0 },
    );

    expect(result.contributors[0]).toMatchObject({ login: 'arjun', commitCount: 2 });
    expect(getCommitAuthorLogin).toHaveBeenCalledTimes(2);
  });

  it('caches commit lookups by sha across different emails', async () => {
    const getCommitAuthorLogin = vi.fn((_sha: string) =>
      Promise.resolve<string | null>('shared-user'),
    );
    const result = await resolveContributors(
      [
        commit({ sha: 'shared', authorEmail: 'one@example.com' }),
        commit({ sha: 'shared', authorEmail: 'two@example.com' }),
      ],
      { api: fakeApi({ getCommitAuthorLogin }), searchIntervalMs: 0 },
    );

    expect(getCommitAuthorLogin).toHaveBeenCalledTimes(1);
    expect(result.contributors).toHaveLength(1);
    expect(result.contributors[0]).toMatchObject({ login: 'shared-user', commitCount: 2 });
  });

  it('falls back to a user search by email', async () => {
    const searchUsersByEmail = vi.fn((email: string) =>
      Promise.resolve([{ login: 'email-user', email }]),
    );
    const searchUsersByName = vi.fn((_name: string) => Promise.resolve([]));
    const result = await resolveContributors([commit()], {
      api: fakeApi({ searchUsersByEmail, searchUsersByName }),
      searchIntervalMs: 0,
    });

    expect(result.contributors[0]).toMatchObject({ login: 'email-user', resolved: true });
    expect(searchUsersByEmail).toHaveBeenCalledWith('arjun@example.com');
    expect(searchUsersByName).not.toHaveBeenCalled();
  });

  it('only uses fuzzy name search when enabled', async () => {
    const searchUsersByName = vi.fn((_name: string) => Promise.resolve([{ login: 'name-user' }]));

    const withoutFuzzy = await resolveContributors([commit()], {
      api: fakeApi({ searchUsersByName }),
      searchIntervalMs: 0,
    });

    expect(withoutFuzzy.contributors[0]).toMatchObject({ login: null, resolved: false });
    expect(searchUsersByName).not.toHaveBeenCalled();

    const withFuzzy = await resolveContributors([commit()], {
      api: fakeApi({ searchUsersByName }),
      searchIntervalMs: 0,
      fuzzyNameSearch: true,
    });

    expect(withFuzzy.contributors[0]).toMatchObject({ login: 'name-user', resolved: true });
  });

  it('merges multiple emails that resolve to the same login', async () => {
    const searchUsersByEmail = vi.fn((email: string) =>
      Promise.resolve([{ login: 'same-user', email }]),
    );
    const result = await resolveContributors(
      [
        commit({ sha: 'one', authorEmail: 'one@example.com' }),
        commit({ sha: 'two', authorEmail: 'two@example.com' }),
        commit({ sha: 'three', authorEmail: 'two@example.com' }),
      ],
      { api: fakeApi({ searchUsersByEmail }), searchIntervalMs: 0 },
    );

    expect(result.contributors).toHaveLength(1);
    expect(result.contributors[0]).toMatchObject({
      login: 'same-user',
      commitCount: 3,
      resolved: true,
    });
  });

  it('reports unresolved authors with their commit', async () => {
    const result = await resolveContributors(
      [
        commit({
          sha: 'deadbee',
          authorName: 'Mystery Person',
          authorEmail: 'mystery@example.com',
        }),
      ],
      { api: fakeApi(), searchIntervalMs: 0 },
    );

    expect(result.unresolved).toEqual([
      { name: 'Mystery Person', email: 'mystery@example.com', sha: 'deadbee' },
    ]);
    expect(result.contributors[0]).toMatchObject({
      login: null,
      name: 'Mystery Person',
      commitCount: 1,
      resolved: false,
    });
  });

  it('fails with a table when pings are required and authors are unresolved', async () => {
    await expect(
      resolveContributors(
        [
          commit({ sha: 'aaa1111', authorName: 'First Person', authorEmail: 'first@example.com' }),
          commit({
            sha: 'bbb2222',
            authorName: 'Second Person',
            authorEmail: 'second@example.com',
          }),
        ],
        { api: fakeApi(), searchIntervalMs: 0, requirePings: true },
      ),
    ).rejects.toMatchObject({
      name: 'ContributorResolutionError',
      unresolved: [
        { name: 'First Person', email: 'first@example.com', sha: 'aaa1111' },
        { name: 'Second Person', email: 'second@example.com', sha: 'bbb2222' },
      ],
    });

    await expect(
      resolveContributors(
        [commit({ authorName: 'First Person', authorEmail: 'first@example.com' })],
        { api: fakeApi(), searchIntervalMs: 0, requirePings: true },
      ),
    ).rejects.toThrow(/\| Name \| Email \| Commit \|/);
  });

  it('throttles search calls to the configured interval', async () => {
    const sleep = vi.fn((_milliseconds: number) => Promise.resolve());
    await resolveContributors(
      [
        commit({ sha: 'one', authorEmail: 'one@example.com' }),
        commit({ sha: 'two', authorEmail: 'two@example.com' }),
      ],
      { api: fakeApi(), searchIntervalMs: 1000, sleep },
    );

    expect(sleep).toHaveBeenCalled();
  });

  it('exposes the unresolved list on the error instance', async () => {
    const error = await resolveContributors([commit({ authorEmail: 'missing@example.com' })], {
      api: fakeApi(),
      searchIntervalMs: 0,
      requirePings: true,
    }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(ContributorResolutionError);
    expect((error as ContributorResolutionError).unresolved).toHaveLength(1);
  });
});

describe('GitHubContributorApi', () => {
  const server = setupServer(
    http.get('https://api.github.com/repos/acme/repo/commits/:sha', ({ params }) =>
      HttpResponse.json({ author: { login: `user-${String(params.sha)}` } }),
    ),
    http.get('https://api.github.com/search/users', ({ request }) => {
      const query = new URL(request.url).searchParams.get('q') ?? '';
      return HttpResponse.json({
        items: [{ login: query.includes('in:email') ? 'email-match' : 'name-match' }],
      });
    }),
    http.get('https://api.github.com/users/:login', ({ params }) =>
      HttpResponse.json({
        login: params.login,
        email: params.login === 'email-match' ? 'person@example.com' : null,
      }),
    ),
  );

  beforeAll(() => {
    server.listen({ onUnhandledFrame: 'error' });
  });

  afterEach(() => {
    server.resetHandlers();
  });

  afterAll(() => {
    server.close();
  });

  it('reads commit authors and exact profile emails over HTTP', async () => {
    const api = new GitHubContributorApi('test-token', 'acme', 'repo', (input, init) =>
      fetch(input, init),
    );

    await expect(api.getCommitAuthorLogin('abc123')).resolves.toBe('user-abc123');
    await expect(api.searchUsersByEmail('person@example.com')).resolves.toEqual([
      { login: 'email-match', email: 'person@example.com' },
    ]);
    await expect(api.searchUsersByName('Arjun')).resolves.toEqual([{ login: 'name-match' }]);
  });
});
