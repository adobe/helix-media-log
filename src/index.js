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
import wrap from '@adobe/helix-shared-wrap';
import { helixStatus } from '@adobe/helix-status';
import { Response } from '@adobe/fetch';
import bodyData from '@adobe/helix-shared-body-data';
// import secrets from '@adobe/helix-shared-secrets';
import events from './events.js';
import trigger from './trigger.js';

/**
 * This is the main function.
 *
 * @param {import('@adobe/fetch').Request} request request
 * @param {import('@adobe/helix-universal').UniversalContext} context context
 * @returns {Response} a response
 */
async function run(request, context) {
  const { source } = context.data;
  if (source === 'aws.events') {
    return events(context);
  }

  let { records: messages } = context;
  if (!messages && request.method === 'POST' && request.headers.get('content-type') === 'application/json') {
    messages = [{
      body: JSON.stringify(await request.json()),
    }];
  }
  if (messages) {
    return trigger(context, messages);
  }

  return new Response('Bad Request', {
    status: 400,
  });
}

export const main = wrap(run)
  .with(bodyData)
  .with(helixStatus);
