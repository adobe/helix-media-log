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

/* eslint-disable no-console */

import { createServer } from '@adobe/helix-universal-devserver';

async function run() {
  const server = await createServer({
    bundle: 'src/index.js',
    port: 3000,
  });
  
  console.log(`Development server started on http://localhost:${server.port}`);
  console.log('\nTo test the media logger:');
  console.log('curl -X POST http://localhost:3000 \\');
  console.log('  -H "Content-Type: application/json" \\');
  console.log('  -d \'[{"messageId":"msg-0","body":"{\\"org\\":\\"test\\",\\"site\\":\\"site\\",\\"updates\\":[{\\"timestamp\\":1234567890,\\"mediaId\\":\\"abc123\\",\\"action\\":\\"add\\"}]}"}]\'');
}

run();
