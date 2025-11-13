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
import { BatchedQueueClient } from '@adobe/helix-admin-support';
import events, { getInputQueue, getOutputQueue } from '../src/events.js';

/**
 * Default context
 */
const DEFAULT_CONTEXT = (env = {}) => ({
  runtime: { region: 'us-east-1', accountId: '123456789012' },
  log: console,
  env,
});

describe('AWS EventBridge invocation', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('returns response', async () => {
    const receiveStub = sinon.stub(BatchedQueueClient.prototype, 'receive').returns([]);
    const result = await events(DEFAULT_CONTEXT());
    assert.strictEqual(await result.text(), 'Received 0 messages from queue.');
    assert.deepStrictEqual(receiveStub.getCall(0).args, [
      30,
      50,
      1000,
    ]);
  });

  it('processes messages sent by SNS', async () => {
    const createMsg = (
      contentBusId,
      timestamp,
      operation,
      mediaHash,
      contentType,
      user,
      path,
      originalFilename,
      contentSourceType,
    ) => ({
      Body: JSON.stringify({
        Message: JSON.stringify({
          contentBusId,
          timestamp,
          operation,
          mediaHash,
          contentType,
          user,
          path,
          originalFilename,
          contentSourceType,
        }),
        TopicArn: 'arn:aws:sns:us-east-1:012345789012:helix-media-test',
      }),
    });

    const contentBusId1 = '355d601dd9b577248658b2b9ec3a9d7ddbc57b4428da7b8e532ab5aed6f';
    const contentBusId2 = '455d601dd9b577248658b2b9ec3a9d7ddbc57b4428da7b8e532ab5aed6f';

    sinon.stub(BatchedQueueClient.prototype, 'receive').returns([
      createMsg(contentBusId1, 1722427281000, 'ingest', '13872adbc8f226c65c00a81078b84ab4152476fc7', 'image/png', 'uncled@adobe.com', '/docs/faq', 'original-filename.png', 'gdoc-preview'),
      createMsg(contentBusId1, 1722427282000, 'reuse', '13872adbc8f226c65c00a81078b84ab4152476fc7', 'image/png', 'tripod@adobe.com', '/drafts/tripod/docs/faq', 'original-filename.png', 'gdoc-preview'),
      createMsg(contentBusId2, 1722427283000, 'ingest', '23872adbc8f226c65c00a81078b84ab4152476fc7', 'image/jpeg', 'admin@adobe.com', '/images/hero', 'hero.jpg', 'onedrive'),
    ]);

    const sendStub = sinon.stub(BatchedQueueClient.prototype, 'send');
    const deleteStub = sinon.stub(BatchedQueueClient.prototype, 'delete');

    const result = await events(DEFAULT_CONTEXT());
    assert.strictEqual(await result.text(), 'Received 3 messages from queue.');

    const sent = sendStub.getCall(0).args[0].filter((msg) => {
      // eslint-disable-next-line no-param-reassign
      delete msg.MessageDeduplicationId;
      return true;
    });

    assert.deepStrictEqual(sent, [
      {
        MessageBody: `{"key":"${contentBusId1}","updates":[{"contentBusId":"${contentBusId1}","timestamp":1722427281000,"operation":"ingest","mediaHash":"13872adbc8f226c65c00a81078b84ab4152476fc7","contentType":"image/png","user":"uncled@adobe.com","path":"/docs/faq","originalFilename":"original-filename.png","contentSourceType":"gdoc-preview"},{"contentBusId":"${contentBusId1}","timestamp":1722427282000,"operation":"reuse","mediaHash":"13872adbc8f226c65c00a81078b84ab4152476fc7","contentType":"image/png","user":"tripod@adobe.com","path":"/drafts/tripod/docs/faq","originalFilename":"original-filename.png","contentSourceType":"gdoc-preview"}]}`,
        MessageGroupId: contentBusId1,
      },
      {
        MessageBody: `{"key":"${contentBusId2}","updates":[{"contentBusId":"${contentBusId2}","timestamp":1722427283000,"operation":"ingest","mediaHash":"23872adbc8f226c65c00a81078b84ab4152476fc7","contentType":"image/jpeg","user":"admin@adobe.com","path":"/images/hero","originalFilename":"hero.jpg","contentSourceType":"onedrive"}]}`,
        MessageGroupId: contentBusId2,
      },
    ]);

    assert.deepStrictEqual(deleteStub.getCall(0).args, [
      [
        { Body: `{"Message":"{\\"contentBusId\\":\\"${contentBusId1}\\",\\"timestamp\\":1722427281000,\\"operation\\":\\"ingest\\",\\"mediaHash\\":\\"13872adbc8f226c65c00a81078b84ab4152476fc7\\",\\"contentType\\":\\"image/png\\",\\"user\\":\\"uncled@adobe.com\\",\\"path\\":\\"/docs/faq\\",\\"originalFilename\\":\\"original-filename.png\\",\\"contentSourceType\\":\\"gdoc-preview\\"}","TopicArn":"arn:aws:sns:us-east-1:012345789012:helix-media-test"}` },
        { Body: `{"Message":"{\\"contentBusId\\":\\"${contentBusId1}\\",\\"timestamp\\":1722427282000,\\"operation\\":\\"reuse\\",\\"mediaHash\\":\\"13872adbc8f226c65c00a81078b84ab4152476fc7\\",\\"contentType\\":\\"image/png\\",\\"user\\":\\"tripod@adobe.com\\",\\"path\\":\\"/drafts/tripod/docs/faq\\",\\"originalFilename\\":\\"original-filename.png\\",\\"contentSourceType\\":\\"gdoc-preview\\"}","TopicArn":"arn:aws:sns:us-east-1:012345789012:helix-media-test"}` },
        { Body: `{"Message":"{\\"contentBusId\\":\\"${contentBusId2}\\",\\"timestamp\\":1722427283000,\\"operation\\":\\"ingest\\",\\"mediaHash\\":\\"23872adbc8f226c65c00a81078b84ab4152476fc7\\",\\"contentType\\":\\"image/jpeg\\",\\"user\\":\\"admin@adobe.com\\",\\"path\\":\\"/images/hero\\",\\"originalFilename\\":\\"hero.jpg\\",\\"contentSourceType\\":\\"onedrive\\"}","TopicArn":"arn:aws:sns:us-east-1:012345789012:helix-media-test"}` },
      ],
    ]);
  });

  it('processes messages sent by SQS', async () => {
    const createMsg = (
      contentBusId,
      timestamp,
      operation,
      mediaHash,
      contentType,
      user,
      path,
      originalFilename,
      contentSourceType,
    ) => ({
      Body: JSON.stringify({
        contentBusId,
        timestamp,
        operation,
        mediaHash,
        contentType,
        user,
        path,
        originalFilename,
        contentSourceType,
      }),
    });

    const contentBusId1 = '355d601dd9b577248658b2b9ec3a9d7ddbc57b4428da7b8e532ab5aed6f';
    const contentBusId2 = '455d601dd9b577248658b2b9ec3a9d7ddbc57b4428da7b8e532ab5aed6f';

    sinon.stub(BatchedQueueClient.prototype, 'receive').returns([
      createMsg(contentBusId1, 1722427281000, 'ingest', '13872adbc8f226c65c00a81078b84ab4152476fc7', 'image/png', 'uncled@adobe.com', '/docs/faq', 'original-filename.png', 'gdoc-preview'),
      createMsg(contentBusId1, 1722427282000, 'reuse', '13872adbc8f226c65c00a81078b84ab4152476fc7', 'image/png', 'tripod@adobe.com', '/drafts/tripod/docs/faq', 'original-filename.png', 'gdoc-preview'),
      createMsg(contentBusId2, 1722427283000, 'ingest', '23872adbc8f226c65c00a81078b84ab4152476fc7', 'image/jpeg', 'admin@adobe.com', '/images/hero', 'hero.jpg', 'onedrive'),
    ]);

    const sendStub = sinon.stub(BatchedQueueClient.prototype, 'send');
    const deleteStub = sinon.stub(BatchedQueueClient.prototype, 'delete');

    const result = await events(DEFAULT_CONTEXT());
    assert.strictEqual(await result.text(), 'Received 3 messages from queue.');

    const sent = sendStub.getCall(0).args[0].filter((msg) => {
      // eslint-disable-next-line no-param-reassign
      delete msg.MessageDeduplicationId;
      return true;
    });

    assert.deepStrictEqual(sent, [
      {
        MessageBody: `{"key":"${contentBusId1}","updates":[{"contentBusId":"${contentBusId1}","timestamp":1722427281000,"operation":"ingest","mediaHash":"13872adbc8f226c65c00a81078b84ab4152476fc7","contentType":"image/png","user":"uncled@adobe.com","path":"/docs/faq","originalFilename":"original-filename.png","contentSourceType":"gdoc-preview"},{"contentBusId":"${contentBusId1}","timestamp":1722427282000,"operation":"reuse","mediaHash":"13872adbc8f226c65c00a81078b84ab4152476fc7","contentType":"image/png","user":"tripod@adobe.com","path":"/drafts/tripod/docs/faq","originalFilename":"original-filename.png","contentSourceType":"gdoc-preview"}]}`,
        MessageGroupId: contentBusId1,
      },
      {
        MessageBody: `{"key":"${contentBusId2}","updates":[{"contentBusId":"${contentBusId2}","timestamp":1722427283000,"operation":"ingest","mediaHash":"23872adbc8f226c65c00a81078b84ab4152476fc7","contentType":"image/jpeg","user":"admin@adobe.com","path":"/images/hero","originalFilename":"hero.jpg","contentSourceType":"onedrive"}]}`,
        MessageGroupId: contentBusId2,
      },
    ]);

    assert.deepStrictEqual(deleteStub.getCall(0).args, [
      [
        { Body: `{"contentBusId":"${contentBusId1}","timestamp":1722427281000,"operation":"ingest","mediaHash":"13872adbc8f226c65c00a81078b84ab4152476fc7","contentType":"image/png","user":"uncled@adobe.com","path":"/docs/faq","originalFilename":"original-filename.png","contentSourceType":"gdoc-preview"}` },
        { Body: `{"contentBusId":"${contentBusId1}","timestamp":1722427282000,"operation":"reuse","mediaHash":"13872adbc8f226c65c00a81078b84ab4152476fc7","contentType":"image/png","user":"tripod@adobe.com","path":"/drafts/tripod/docs/faq","originalFilename":"original-filename.png","contentSourceType":"gdoc-preview"}` },
        { Body: `{"contentBusId":"${contentBusId2}","timestamp":1722427283000,"operation":"ingest","mediaHash":"23872adbc8f226c65c00a81078b84ab4152476fc7","contentType":"image/jpeg","user":"admin@adobe.com","path":"/images/hero","originalFilename":"hero.jpg","contentSourceType":"onedrive"}` },
      ],
    ]);
  });

  it('handle problems during deserialization', async () => {
    sinon.stub(BatchedQueueClient.prototype, 'receive').returns([{
      MessageId: 'msg-01',
      Body: 'bogus',
    }]);

    const sendStub = sinon.stub(BatchedQueueClient.prototype, 'send');
    const deleteStub = sinon.stub(BatchedQueueClient.prototype, 'delete');

    const result = await events(DEFAULT_CONTEXT());

    assert.strictEqual(await result.text(), 'Received 1 message from queue.');
    assert.deepStrictEqual(sendStub.getCall(0).args, [[]]);
    assert.deepStrictEqual(deleteStub.getCall(0).args, [
      [
        { Body: 'bogus', MessageId: 'msg-01' },
      ],
    ]);
  });

  it('handle problems during receiving', async () => {
    sinon.stub(BatchedQueueClient.prototype, 'receive').throws('receiving failed');

    const result = await events(DEFAULT_CONTEXT());
    assert.strictEqual(await result.status, 500);
  });

  it('returns test queue names', async () => {
    const { runtime: { region, accountId } } = DEFAULT_CONTEXT();

    const inputQueue = getInputQueue(region, accountId, true);
    assert(inputQueue.endsWith('-test'));

    const outputQueue = getOutputQueue(region, accountId, true);
    assert(outputQueue.endsWith('-test.fifo'));
  });
});
