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
import { DeleteObjectCommand, GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Response } from '@adobe/fetch';
import MediaLog from './s3/MediaLog.js';

/**
 * Processes the record updates per project
 *
 * @param {import('@adobe/helix-universal').UniversalContext} context request context
 * @param {string} key org/site combination, site possibly '*'
 * @param {object[]} updates updates
 * @returns {Promise<void>}
 */
async function processUpdates(context, key, updates) {
  const { log, attributes: { messageId: ID } } = context;
  const [destOrg, destSite] = key.split('/');
  const mediaLog = await MediaLog.create(context, {
    org: destOrg,
    site: destSite !== '*' ? destSite : '*',
  });

  try {
    const objectName = await mediaLog.append(updates.map(({
      org, site, owner, repo, ref, result,
    }) => ({
      ...result, org, site, owner, repo, ref,
    })));
    log.info(`[${ID}] appended ${updates.length} media events to: ${objectName}`);
  } finally {
    mediaLog.close();
  }
}

/**
 * Returns bucket and key from an S3 URL
 * @param {string} s3Url S3 URL
 * @returns object containing `Bucket` and `Key`
 */
function s3InputFromURL(s3Url) {
  const { pathname, host } = new URL(s3Url);
  return {
    Bucket: host,
    Key: pathname.substring(1),
  };
}

/**
 * Deserialize a message that was stored by BatchedQueueClient
 * @param {import('@adobe/helix-universal').UniversalContext} context context
 * @param {string} key key
 * @param {string} s3Url S3 URL
 * @param {any} message message
 * @returns deserialized object with a `body` property
 */
async function deserialize(context, key, s3Url, message) {
  const { log, attributes: { messageId: ID } } = context;

  try {
    const s3 = new S3Client();
    const input = s3InputFromURL(s3Url);
    const result = await s3.send(new GetObjectCommand(input));
    const body = await new Response(result.Body, {}).text();
    log.info(`[${ID}][${key}] serialized message downloaded from: ${s3Url}`);

    // hack to cleanup serialized message
    // eslint-disable-next-line no-param-reassign
    message.cleanup = async () => {
      await s3.send(new DeleteObjectCommand(input));
      log.info(`[${ID}][${key}] deleted serialized message from: ${s3Url}`);
    };
    return {
      body,
    };
  } catch (e) {
    log.error(`[${ID}][${key}] error deserializing records from ${s3Url}: ${e.message}`, e);
    return {
      body: JSON.stringify({ key }),
    };
  }
}

/**
 * Process a message
 * @param {import("@adobe/helix-universal").UniversalContext} context context
 * @param {any} message SQS message
 * @returns {Promise<void>}
 */
async function processMessage(context, message) {
  const { log } = context;
  const body = JSON.parse(message.body);

  const {
    swapS3Url, key, updates,
  } = body;

  const { messageId: ID } = context.attributes;
  if (swapS3Url) {
    log.info(`[${ID}][${key}] message was swapped out to: ${swapS3Url}`);
    const newMsg = await deserialize(context, key, swapS3Url, message);
    await processMessage(context, newMsg);
  } else if (updates) {
    log.debug(`[${ID}][${key}] received updates: ${JSON.stringify(updates, 0, 2)}`);
    await processUpdates(context, key, updates);
  } else {
    log.warn(`[${ID}][${key}] no updates found.`);
  }
}

/**
 * Get triggered from SQS when new messages are available and processes them.
 *
 * @param {import("@adobe/helix-universal").UniversalContext} context context
 * @param {array} messages array of messages
 * @returns {Promise<any>} an object containing failures
 */
async function doRun(context, messages) {
  const { log } = context;

  /* c8 ignore next 3 */
  if (messages.length > 1) {
    log.warn('More than 1 message received. Ensure to set batch-size to 1 in SQS trigger, otherwise you risk too long processing times.');
  }
  log.info(`Processing ${messages.length} records`);
  const ret = {
    batchItemFailures: [],
  };
  for (const message of messages) {
    try {
      /* c8 ignore next */
      context.attributes = context.attributes ?? {};
      context.attributes.messageId = (message.messageId ?? crypto.randomUUID()).substring(0, 8);

      // eslint-disable-next-line no-await-in-loop
      await processMessage(context, message);
      if (message.cleanup) {
        // eslint-disable-next-line no-await-in-loop
        await message.cleanup();
      }
    } catch (e) {
      log.error(`Error processing record ${message.messageId}: ${e.message}`);
      log.debug(e.stack);
      ret.batchItemFailures.push({
        itemIdentifier: message.messageId,
      });
    }
  }
  return ret;
}

export default async function run(context, messages) {
  const ret = await doRun(context, messages);
  return new Response(JSON.stringify(ret), {
    headers: {
      'content-type': 'application/json',
    },
  });
}

