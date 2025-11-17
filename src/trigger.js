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
 * Processes the record updates per contentBusId
 *
 * @param {import('@adobe/helix-universal').UniversalContext} context request context
 * @param {string} contentBusId content bus ID
 * @param {object[]} updates updates
 * @returns {Promise<void>}
 */
async function processUpdates(context, contentBusId, updates) {
  const { log, attributes: { messageId: ID } } = context;
  const mediaLog = await MediaLog.create(context, {
    contentBusId,
  });

  try {
    const objectName = await mediaLog.append(updates);
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
 * @param {string} contentBusId content bus ID
 * @param {string} s3Url S3 URL
 * @param {any} message message
 * @returns deserialized object with a `body` property
 */
async function deserialize(context, contentBusId, s3Url, message) {
  const { log, attributes: { messageId: ID } } = context;

  try {
    const s3 = new S3Client();
    const input = s3InputFromURL(s3Url);
    const result = await s3.send(new GetObjectCommand(input));
    const body = await new Response(result.Body, {}).text();
    log.info(`[${ID}][${contentBusId}] serialized message downloaded from: ${s3Url}`);

    // hack to cleanup serialized message
    // eslint-disable-next-line no-param-reassign
    message.cleanup = async () => {
      await s3.send(new DeleteObjectCommand(input));
      log.info(`[${ID}][${contentBusId}] deleted serialized message from: ${s3Url}`);
    };
    return {
      body,
    };
  } catch (e) {
    log.error(`[${ID}][${contentBusId}] error deserializing records from ${s3Url}: ${e.message}`, e);
    return {
      body: JSON.stringify({ contentBusId }),
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
    swapS3Url, contentBusId, updates,
  } = body;

  const { messageId: ID } = context.attributes;
  if (swapS3Url) {
    log.info(`[${ID}][${contentBusId}] message was swapped out to: ${swapS3Url}`);
    const newMsg = await deserialize(context, contentBusId, swapS3Url, message);
    await processMessage(context, newMsg);
  } else if (updates) {
    await processUpdates(context, contentBusId, updates);
  } else {
    log.warn(`[${ID}][${contentBusId}] no updates found in message body: ${JSON.stringify(body)}`);
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
      log.error(`Stack trace: ${e.stack}`);
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
