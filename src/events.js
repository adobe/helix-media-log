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
import crypto from 'crypto';
import { Response } from '@adobe/fetch';
import { hsize, BatchedQueueClient } from '@adobe/helix-admin-support';

/**
 * Our service prefix used for SQS objects.
 */
const SERVICE_PREFIX = 'helix-media-log';

/**
 * The queue that contains the messages that represent the media log notifications.
 *
 * @type {string}
 */
export function getInputQueue(region, accountId, test) {
  return `https://sqs.${region}.amazonaws.com/${accountId}/${SERVICE_PREFIX}${test ? '-test' : ''}`;
}

/**
 * The queue that contains the bundled messages by project.
 *
 * @type {string}
 */
export function getOutputQueue(region, accountId, test) {
  return `https://sqs.${region}.amazonaws.com/${accountId}/${SERVICE_PREFIX}${test ? '-test' : ''}.fifo`;
}

/**
 * Return the list of organizations that have root
 * org logging enabled.
 */
function getLoggingOrgs(context) {
  const { env: { HLX_MEDIA_LOGGING_ORGS: json }, log } = context;
  if (json) {
    try {
      const orgs = JSON.parse(json);
      if (Array.isArray(orgs)) {
        return orgs;
      }
    } catch (e) {
      log.warn(`error evaluating ${json} for HLX_MEDIA_LOGGING_ORGS`, e);
    }
  }
  return [];
}

/**
 * Add a single message to the updates for a project, given
 * by its key.
 *
 * @param {any} message message
 * @param {String} key project key
 * @param {Array} projects project array
 */
function addMessage(message, key, projects) {
  let project = projects[key];
  if (!project) {
    project = {
      key, updates: [],
    };
    // eslint-disable-next-line no-param-reassign
    projects[key] = project;
  }
  project.updates.push(message);
}

/**
 * Polls for messages in our incoming queue, groups them by project and feeds
 * them back to our outgoing queue.
 *
 * @param {import("@adobe/helix-universal").UniversalContext} context context
 * @returns {Promise<Response>} a response
 */
async function doRun(context) {
  const { runtime: { region, accountId }, log } = context;
  const loggingOrgs = getLoggingOrgs(context);
  const test = !!process.env.HLX_DEV_SERVER_HOST;

  const client = new BatchedQueueClient({
    log,
    inQueue: getInputQueue(region, accountId, test),
    outQueue: getOutputQueue(region, accountId, test),
  });

  // the max time should be less than the visibility timeout, otherwise the client might receive
  // the same message twice
  const msgs = await client.receive(30, 50, 1000);

  // group the messages by project
  const projects = {};
  for (const msg of msgs) {
    try {
      const body = JSON.parse(msg.Body);
      let message;
      if (body.TopicArn && body.Message) {
        // SNS message, which gets wrapped into Message
        message = JSON.parse(body.Message);
      } else {
        // SQS message, which just contains a body
        message = body;
      }

      // fallback to owner and repo for messages that don't have org and site
      if (!message.org && !message.site) {
        message = {
          ...message,
          org: message.owner,
          site: message.repo,
        };
      }
      const { org, site } = message;
      addMessage(message, `${org}/${site}`, projects);

      if (loggingOrgs.includes(org)) {
        addMessage(message, `${org}/*`, projects);
      }
    } catch (e) {
      log.warn(`error processing message ${msg.MessageId}: ${e.message}`);
    }
  }

  // construct the payload for the FIFO messages. 1 per project
  const payloads = Object.values(projects).map((project) => {
    const { key } = project;
    const body = JSON.stringify(project);
    log.info(`created batched message for ${key}, ${project.updates.length} updates, ${hsize(body.length)}`);
    return {
      MessageGroupId: key,
      MessageDeduplicationId: crypto.randomUUID(), // probably don't need message-deduplication
      MessageBody: body,
    };
  });

  await client.send(payloads);
  await client.delete(msgs);

  return new Response(`Received ${msgs.length} message${msgs.length === 1 ? '' : 's'} from queue.`);
}

export default async function run(context) {
  const { log } = context;

  try {
    const res = await doRun(context);
    return res;
  } catch (e) {
    log.error(`An error occurred while polling media notifications: ${e}`);
    return new Response('', {
      status: 500,
      headers: {
        'x-error': 'error processing media notifications.',
      },
    });
  }
}
