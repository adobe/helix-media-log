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
import sinon from 'sinon';
import trigger from '../src/trigger.js';
import MediaLog from '../src/s3/MediaLog.js';
import { Nock } from './utils.js';

/**
 * Default context
 */
const DEFAULT_CONTEXT = () => ({
  log: console,
});

describe('SQS trigger tests', () => {
  let nock;
  let stub;

  beforeEach(() => {
    nock = new Nock().env();
    stub = sinon.stub(MediaLog, 'create');
  });

  afterEach(() => {
    stub?.restore();
    nock.done();
  });

  it('Process normal message', async () => {
    stub.returns({
      append: (updates) => {
        assert.deepStrictEqual(updates, [{
          timestamp: 1722427281000,
          operation: 'ingest',
          mediaHash: 'test-hash',
          org: 'org',
          site: 'site',
          owner: 'owner',
          repo: 'repo',
          ref: 'ref',
        }]);
        return 'org/site/log';
      },
      close: () => {},
    });

    const messages = [{
      messageId: '374cec7b-d0c8-4a2e-ad0b-67be763cf97e',
      body: JSON.stringify({
        key: 'org/site',
        updates: [{
          org: 'org',
          site: 'site',
          owner: 'owner',
          repo: 'repo',
          ref: 'ref',
          result: {
            timestamp: 1722427281000,
            operation: 'ingest',
            mediaHash: 'test-hash',
          },
        }],
      }),
    }];
    const response = await trigger(DEFAULT_CONTEXT(), messages);
    assert.strictEqual(response.status, 200);

    const json = await response.json();
    assert.deepStrictEqual(json, { batchItemFailures: [] });
  });

  it('Process serialized message', async () => {
    // verify site will be set to `*`
    stub.returns({
      append: (updates) => {
        assert.deepStrictEqual(updates, [{
          timestamp: 1722427281000,
          operation: 'reuse',
          mediaHash: 'test-hash-2',
          org: 'org',
          site: 'site',
          owner: 'owner',
          repo: 'repo',
          ref: 'ref',
        }]);
        return 'org/*/log';
      },
      close: () => {},
    });

    nock('https://helix-content-bus.s3.us-east-1.amazonaws.com')
      .get('/some/swap/key?x-id=GetObject')
      .reply(200, {
        key: 'org/*',
        updates: [{
          org: 'org',
          site: 'site',
          owner: 'owner',
          repo: 'repo',
          ref: 'ref',
          result: {
            timestamp: 1722427281000,
            operation: 'reuse',
            mediaHash: 'test-hash-2',
          },
        }],
      })
      .delete('/some/swap/key?x-id=DeleteObject')
      .reply(201);

    const messages = [{
      body: JSON.stringify({
        key: 'org/*',
        owner: undefined,
        repo: undefined,
        swapS3Url: 's3://helix-content-bus/some/swap/key',
      }),
    }];
    const response = await trigger(DEFAULT_CONTEXT(), messages);
    assert.strictEqual(response.status, 200);

    const json = await response.json();
    assert.deepStrictEqual(json, { batchItemFailures: [] });
  });

  it('Process a failure to append', async () => {
    stub.returns({
      append: () => {
        throw new Error('Whoopsie');
      },
      close: () => {},
    });

    const messages = [{
      body: JSON.stringify({
        key: 'org/site',
        updates: [{
          org: 'org',
          site: 'site',
          owner: 'owner',
          repo: 'repo',
          ref: 'ref',
          result: {
            timestamp: 1722427281000,
            operation: 'ingest',
            mediaHash: 'test-hash',
          },
        }],
      }),
    }];
    const response = await trigger(DEFAULT_CONTEXT(), messages);
    assert.strictEqual(response.status, 200);

    const json = await response.json();
    assert.deepStrictEqual(json, { batchItemFailures: [{}] });
  });

  it('Reports error in deserializing', async () => {
    const messages = [{
      body: JSON.stringify({
        owner: 'owner', repo: 'repo', key: 'owner/repo/media', swapS3Url: 's3://helix-content-bus/some/swap/key',
      }),
    }];
    nock('https://helix-content-bus.s3.us-east-1.amazonaws.com')
      .get('/some/swap/key?x-id=GetObject')
      .reply(404);
    const response = await trigger(DEFAULT_CONTEXT(), messages);
    assert.strictEqual(response.status, 200);
  });

  it('Processes message with no updates', async () => {
    stub.returns({
      append: () => 'org/site/log',
      close: () => {},
    });

    const messages = [{
      body: JSON.stringify({
        key: 'org/site',
      }),
    }];
    const response = await trigger(DEFAULT_CONTEXT(), messages);
    assert.strictEqual(response.status, 200);
  });
});
