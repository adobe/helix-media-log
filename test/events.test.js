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
    const result = await events(DEFAULT_CONTEXT({ HLX_MEDIA_LOGGING_ORGS: 'not json' }));
    assert.strictEqual(await result.text(), 'Received 0 messages from queue.');
    assert.deepStrictEqual(receiveStub.getCall(0).args, [
      30,
      50,
      1000,
    ]);
  });

  it('processes messages sent by SNS', async () => {
    const createMsg = (org, site, owner, repo) => ({
      Body: JSON.stringify({
        Message: JSON.stringify({
          org, site, owner, repo,
        }),
        TopicArn: 'arn:aws:sns:us-east-1:012345789012:helix-media-test',
      }),
    });

    sinon.stub(BatchedQueueClient.prototype, 'receive').returns([
      createMsg('org1', 'site1', 'owner-1', 'repo-1'),
      createMsg('org1', 'site1', 'owner-1', 'repo-1'),
      createMsg('org2', 'site2', 'owner-2', 'repo-1'),
    ]);

    const sendStub = sinon.stub(BatchedQueueClient.prototype, 'send');
    const deleteStub = sinon.stub(BatchedQueueClient.prototype, 'delete');

    const result = await events(DEFAULT_CONTEXT({ HLX_MEDIA_LOGGING_ORGS: '["org2"]' }));
    assert.strictEqual(await result.text(), 'Received 3 messages from queue.');

    const sent = sendStub.getCall(0).args[0].filter((msg) => {
      // eslint-disable-next-line no-param-reassign
      delete msg.MessageDeduplicationId;
      return true;
    });

    assert.deepStrictEqual(sent, [
      {
        MessageBody: '{"key":"org1/site1","updates":[{"org":"org1","site":"site1","owner":"owner-1","repo":"repo-1"},{"org":"org1","site":"site1","owner":"owner-1","repo":"repo-1"}]}',
        MessageGroupId: 'org1/site1',
      },
      {
        MessageBody: '{"key":"org2/site2","updates":[{"org":"org2","site":"site2","owner":"owner-2","repo":"repo-1"}]}',
        MessageGroupId: 'org2/site2',
      },
      {
        MessageBody: '{"key":"org2/*","updates":[{"org":"org2","site":"site2","owner":"owner-2","repo":"repo-1"}]}',
        MessageGroupId: 'org2/*',
      },
    ]);

    assert.deepStrictEqual(deleteStub.getCall(0).args, [
      [
        { Body: '{"Message":"{\\"org\\":\\"org1\\",\\"site\\":\\"site1\\",\\"owner\\":\\"owner-1\\",\\"repo\\":\\"repo-1\\"}","TopicArn":"arn:aws:sns:us-east-1:012345789012:helix-media-test"}' },
        { Body: '{"Message":"{\\"org\\":\\"org1\\",\\"site\\":\\"site1\\",\\"owner\\":\\"owner-1\\",\\"repo\\":\\"repo-1\\"}","TopicArn":"arn:aws:sns:us-east-1:012345789012:helix-media-test"}' },
        { Body: '{"Message":"{\\"org\\":\\"org2\\",\\"site\\":\\"site2\\",\\"owner\\":\\"owner-2\\",\\"repo\\":\\"repo-1\\"}","TopicArn":"arn:aws:sns:us-east-1:012345789012:helix-media-test"}' },
      ],
    ]);
  });

  it('processes messages sent by SQS, and adds missing org/site', async () => {
    const createMsg = (owner, repo) => ({
      Body: JSON.stringify({
        owner, repo,
      }),
    });

    sinon.stub(BatchedQueueClient.prototype, 'receive').returns([
      createMsg('owner-1', 'repo-1'),
      createMsg('owner-1', 'repo-1'),
      createMsg('owner-1', 'repo-2'),
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
        MessageBody: '{"key":"owner-1/repo-1","updates":[{"owner":"owner-1","repo":"repo-1","org":"owner-1","site":"repo-1"},{"owner":"owner-1","repo":"repo-1","org":"owner-1","site":"repo-1"}]}',
        MessageGroupId: 'owner-1/repo-1',
      },
      {
        MessageBody: '{"key":"owner-1/repo-2","updates":[{"owner":"owner-1","repo":"repo-2","org":"owner-1","site":"repo-2"}]}',
        MessageGroupId: 'owner-1/repo-2',
      },
    ]);

    assert.deepStrictEqual(deleteStub.getCall(0).args, [
      [
        { Body: '{"owner":"owner-1","repo":"repo-1"}' },
        { Body: '{"owner":"owner-1","repo":"repo-1"}' },
        { Body: '{"owner":"owner-1","repo":"repo-2"}' },
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
