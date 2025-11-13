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
/* eslint-disable func-names */

import assert from 'assert';
import { promisify } from 'util';
import xml2js from 'xml2js';
import zlib from 'zlib';

import MediaLog from '../../src/s3/MediaLog.js';
import { Nock } from '../utils.js';

const gzip = promisify(zlib.gzip);

/**
 * Default context
 */
const DEFAULT_CONTEXT = () => ({
  log: console,
  env: {},
});

describe('S3 MediaLog tests', () => {
  let nock;

  beforeEach(() => {
    nock = new Nock().env();
  });

  afterEach(() => {
    nock.done();
  });

  const updates = [{
    timestamp: 1722427281000,
    operation: 'ingest',
    mediaHash: '13872adbc8f226c65c00a81078b84ab4152476fc7',
    contentType: 'image/png',
    user: 'uncled@adobe.com',
    path: '/docs/faq',
    originalFilename: 'original-filename.png',
    contentSourceType: 'gdoc-preview',
  }];

  it('Create media logger and append data', async () => {
    const contents = await gzip(JSON.stringify([]));
    const contentBusId = '355d601dd9b577248658b2b9ec3a9d7ddbc57b4428da7b8e532ab5aed6f';

    nock('https://helix-media-logs.s3.us-east-1.amazonaws.com')
      .get(`/${contentBusId}/.index?x-id=GetObject`)
      .reply(200, '2024-07-31-12-01-21-3ADD0B52867FF57D', {
        'content-type': 'text/plain',
      })
      .get(`/${contentBusId}/2024-07-31-12-01-21-3ADD0B52867FF57D.gz?x-id=GetObject`)
      .reply(200, contents, {
        'content-type': 'application/json',
        'content-length': contents.length,
        'content-encoding': 'gzip',
      })
      .put(`/${contentBusId}/2024-07-31-12-01-21-3ADD0B52867FF57D.gz?x-id=PutObject`)
      .reply(function (_, body) {
        assert.strictEqual(this.req.headers['x-amz-meta-last-event-time'], '2024-07-31-12-01-21');
        assert.deepStrictEqual(body, updates);
        return [201];
      });

    const mediaLog = await MediaLog.create(DEFAULT_CONTEXT(), { contentBusId });
    await mediaLog.append(updates);
  });

  it('Simulate pristine environment', async () => {
    let lastLog;
    const contentBusId = '355d601dd9b577248658b2b9ec3a9d7ddbc57b4428da7b8e532ab5aed6f';

    nock('https://helix-media-logs.s3.us-east-1.amazonaws.com')
      .get(`/${contentBusId}/.index?x-id=GetObject`)
      .reply(404, new xml2js.Builder().buildObject({
        Error: {
          Code: 'NoSuchKey',
          Message: 'The specified key does not exist.',
          Key: `/${contentBusId}/.index`,
        },
      }))
      .put(`/${contentBusId}/.index?x-id=PutObject`)
      .reply((_, body) => {
        const logFiles = body.split('\n');
        lastLog = logFiles[logFiles.length - 1];
        return [201];
      })
      .put((uri) => uri.startsWith(`/${contentBusId}/${lastLog}`))
      .reply(201);

    const mediaLog = await MediaLog.create(DEFAULT_CONTEXT(), { contentBusId });
    await mediaLog.append(updates);
  });

  it('Simulate environment where last log has no .gz extension', async () => {
    let lastLog;
    const contentBusId = '355d601dd9b577248658b2b9ec3a9d7ddbc57b4428da7b8e532ab5aed6f';

    nock('https://helix-media-logs.s3.us-east-1.amazonaws.com')
      .get(`/${contentBusId}/.index?x-id=GetObject`)
      .reply(200, '2024-07-31-12-01-21-3ADD0B52867FF57D', {
        'content-type': 'text/plain',
      })
      .get(`/${contentBusId}/2024-07-31-12-01-21-3ADD0B52867FF57D.gz?x-id=GetObject`)
      .reply(404, new xml2js.Builder().buildObject({
        Error: {
          Code: 'NoSuchKey',
          Message: 'The specified key does not exist.',
          Key: `/${contentBusId}/2024-07-31-12-01-21-3ADD0B52867FF57D.gz`,
        },
      }))
      .put(`/${contentBusId}/.index?x-id=PutObject`)
      .reply((_, body) => {
        const logFiles = body.split('\n');
        lastLog = logFiles[logFiles.length - 1];
        return [201];
      })
      .put((uri) => uri.startsWith(`/${contentBusId}/${lastLog}.gz`))
      .reply(201);

    const mediaLog = await MediaLog.create(DEFAULT_CONTEXT(), { contentBusId });
    await mediaLog.append(updates);
  });

  it('Simulate environment where last log is too large', async () => {
    const contents = await gzip(JSON.stringify([]));
    let lastLog;
    const contentBusId = '355d601dd9b577248658b2b9ec3a9d7ddbc57b4428da7b8e532ab5aed6f';

    nock('https://helix-media-logs.s3.us-east-1.amazonaws.com')
      .get(`/${contentBusId}/.index?x-id=GetObject`)
      .reply(200, '2024-07-31-12-01-21-3ADD0B52867FF57D', {
        'content-type': 'text/plain',
      })
      .get(`/${contentBusId}/2024-07-31-12-01-21-3ADD0B52867FF57D.gz?x-id=GetObject`)
      .reply(200, contents, {
        'content-type': 'application/json',
        'content-length': 700000,
        'content-encoding': 'gzip',
      })
      .put(`/${contentBusId}/.index?x-id=PutObject`)
      .reply((_, body) => {
        const logFiles = body.split('\n');
        assert.strictEqual(logFiles.length, 2);
        lastLog = logFiles[logFiles.length - 1];
        return [201];
      })
      .put((uri) => uri.startsWith(`/${contentBusId}/${lastLog}.gz`))
      .reply(201);

    const mediaLog = await MediaLog.create(DEFAULT_CONTEXT(), { contentBusId });
    await mediaLog.append(updates);
  });

  it('Return null when no updates provided', async () => {
    const contentBusId = '355d601dd9b577248658b2b9ec3a9d7ddbc57b4428da7b8e532ab5aed6f';
    const mediaLog = await MediaLog.create(DEFAULT_CONTEXT(), { contentBusId });
    const result = await mediaLog.append([]);
    assert.strictEqual(result, null);
  });

  it('Handle contentBusId-based logging', async () => {
    const contents = await gzip(JSON.stringify([]));
    const contentBusId = '355d601dd9b577248658b2b9ec3a9d7ddbc57b4428da7b8e532ab5aed6f';

    nock('https://helix-media-logs.s3.us-east-1.amazonaws.com')
      .get(`/${contentBusId}/.index?x-id=GetObject`)
      .reply(200, '2024-07-31-12-01-21-ABC123', {
        'content-type': 'text/plain',
      })
      .get(`/${contentBusId}/2024-07-31-12-01-21-ABC123.gz?x-id=GetObject`)
      .reply(200, contents, {
        'content-type': 'application/json',
        'content-length': contents.length,
        'content-encoding': 'gzip',
      })
      .put(`/${contentBusId}/2024-07-31-12-01-21-ABC123.gz?x-id=PutObject`)
      .reply(201);

    const mediaLog = await MediaLog.create(DEFAULT_CONTEXT(), { contentBusId });
    await mediaLog.append(updates);
  });
});
