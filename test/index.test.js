/*
 * Copyright 2025 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

/* eslint-env mocha */
import assert from 'assert';
import esmock from 'esmock';
import { Request, Response } from '@adobe/fetch';
import { main } from '../src/index.js';
import { Nock } from './utils.js';

describe('Index Tests', () => {
  let nock;
  beforeEach(() => {
    nock = new Nock().env();
  });

  afterEach(() => {
    nock.done();
  });

  it('Invoking manually returns 400', async () => {
    const result = await main(new Request('https://localhost/'), { log: console });
    assert.strictEqual(await result.status, 400);
  });

  it('Invoking from AWS EventBridge succeeds', async () => {
    const { main: proxyMain } = await esmock('../src/index.js', {
      '../src/events.js': async () => new Response('', { status: 204 }),
    });

    const result = await proxyMain(
      new Request('https://localhost/', {
        headers: { 'content-type': 'application/json' },
        method: 'POST',
        body: JSON.stringify({ source: 'aws.events' }),
      }),
      { log: console },
    );
    assert.strictEqual(await result.status, 204);
  });

  it('Invoking as SQS trigger succeeds', async () => {
    const { main: proxyMain } = await esmock('../src/index.js', {
      '../src/trigger.js': async () => new Response('', { status: 200 }),
    });

    const result = await proxyMain(new Request('https://localhost/'), { records: [], log: console });
    assert.strictEqual(await result.status, 200);
  });

  it('Invoking with JSON payload succeeds', async () => {
    const { main: proxyMain } = await esmock('../src/index.js', {
      '../src/trigger.js': async () => new Response('', { status: 200 }),
    });

    const result = await proxyMain(new Request('https://localhost/', {
      headers: { 'content-type': 'application/json' },
      method: 'POST',
      body: JSON.stringify([]),
    }), { log: console });
    assert.strictEqual(await result.status, 200);
  });
});
