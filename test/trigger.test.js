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
    const contentBusId = '355d601dd9b577248658b2b9ec3a9d7ddbc57b4428da7b8e532ab5aed6f';

    stub.returns({
      append: (updates) => {
        assert.deepStrictEqual(updates, [{
          timestamp: 1722427281000, // 2025-07-31T12:01:21.000
          operation: 'ingest',
          mediaHash: '13872adbc8f226c65c00a81078b84ab4152476fc7',
          contentType: 'image/png',
          user: 'uncled@adobe.com',
          path: '/docs/faq',
          originalFilename: 'original-filename.png',
          contentSourceType: 'gdoc-preview',
        }]);
        return `${contentBusId}/log`;
      },
      close: () => {},
    });

    const messages = [{
      messageId: '374cec7b-d0c8-4a2e-ad0b-67be763cf97e',
      body: JSON.stringify({
        contentBusId,
        updates: [{
          timestamp: 1722427281000,
          operation: 'ingest',
          mediaHash: '13872adbc8f226c65c00a81078b84ab4152476fc7',
          contentType: 'image/png',
          user: 'uncled@adobe.com',
          path: '/docs/faq',
          originalFilename: 'original-filename.png',
          contentSourceType: 'gdoc-preview',
        }],
      }),
    }];
    const response = await trigger(DEFAULT_CONTEXT(), messages);
    assert.strictEqual(response.status, 200);

    const json = await response.json();
    assert.deepStrictEqual(json, { batchItemFailures: [] });
  });

  it('Process serialized message', async () => {
    const contentBusId = '355d601dd9b577248658b2b9ec3a9d7ddbc57b4428da7b8e532ab5aed6f';

    stub.returns({
      append: (updates) => {
        assert.deepStrictEqual(updates, [{
          timestamp: 1722427282000, // 2025-07-31T12:01:22.000
          operation: 'reuse',
          mediaHash: '13872adbc8f226c65c00a81078b84ab4152476fc7',
          contentType: 'image/png',
          user: 'tripod@adobe.com',
          path: '/drafts/tripod/docs/faq',
          originalFilename: 'original-filename.png',
          contentSourceType: 'gdoc-preview',
        }]);
        return `${contentBusId}/log`;
      },
      close: () => {},
    });

    nock('https://helix-content-bus.s3.us-east-1.amazonaws.com')
      .get('/some/swap/key?x-id=GetObject')
      .reply(200, {
        contentBusId,
        updates: [{
          timestamp: 1722427282000,
          operation: 'reuse',
          mediaHash: '13872adbc8f226c65c00a81078b84ab4152476fc7',
          contentType: 'image/png',
          user: 'tripod@adobe.com',
          path: '/drafts/tripod/docs/faq',
          originalFilename: 'original-filename.png',
          contentSourceType: 'gdoc-preview',
        }],
      })
      .delete('/some/swap/key?x-id=DeleteObject')
      .reply(201);

    const messages = [{
      body: JSON.stringify({
        contentBusId,
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
    const contentBusId = '355d601dd9b577248658b2b9ec3a9d7ddbc57b4428da7b8e532ab5aed6f';

    stub.returns({
      append: () => {
        throw new Error('Whoopsie');
      },
      close: () => {},
    });

    const messages = [{
      body: JSON.stringify({
        contentBusId,
        updates: [{
          timestamp: 1722427281000,
          operation: 'ingest',
          mediaHash: '13872adbc8f226c65c00a81078b84ab4152476fc7',
          contentType: 'image/png',
          user: 'uncled@adobe.com',
          path: '/docs/faq',
          originalFilename: 'original-filename.png',
          contentSourceType: 'gdoc-preview',
        }],
      }),
    }];
    const response = await trigger(DEFAULT_CONTEXT(), messages);
    assert.strictEqual(response.status, 200);

    const json = await response.json();
    assert.deepStrictEqual(json, { batchItemFailures: [{}] });
  });

  it('Reports error in deserializing', async () => {
    const contentBusId = '355d601dd9b577248658b2b9ec3a9d7ddbc57b4428da7b8e532ab5aed6f';

    const messages = [{
      body: JSON.stringify({
        owner: 'owner', repo: 'repo', contentBusId, swapS3Url: 's3://helix-content-bus/some/swap/key',
      }),
    }];
    nock('https://helix-content-bus.s3.us-east-1.amazonaws.com')
      .get('/some/swap/key?x-id=GetObject')
      .reply(404);
    const response = await trigger(DEFAULT_CONTEXT(), messages);
    assert.strictEqual(response.status, 200);
  });

  it('Processes message with no updates', async () => {
    const contentBusId = '355d601dd9b577248658b2b9ec3a9d7ddbc57b4428da7b8e532ab5aed6f';

    stub.returns({
      append: () => `${contentBusId}/log`,
      close: () => {},
    });

    const messages = [{
      body: JSON.stringify({
        contentBusId,
      }),
    }];
    const response = await trigger(DEFAULT_CONTEXT(), messages);
    assert.strictEqual(response.status, 200);
  });
});
